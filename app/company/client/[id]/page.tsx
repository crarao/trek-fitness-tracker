'use client'

import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter, useParams, useSearchParams } from 'next/navigation'
import { formatMoney, currencySymbol, normalizeCurrency, CURRENCIES } from '@/lib/currency'
import { type Country, COUNTRIES, normalizeCountry, formatDate, localDateIso, parseDate } from '@/lib/locale'
import { type PhoneCountry, splitE164, toE164, clientPhoneValue, displayPhone, phoneCountry, shownEmail, isNoLogin, waDigits, phoneHint, usernameOf, isPhoneLogin } from '@/lib/phone'
import UsernameField, { type UsernameStatus } from '@/app/username-field'
import { GUARDIAN_RELATIONS } from '@/lib/guardian'
import { type Branch, type Batch, BRANCH_COLUMNS, BATCH_COLUMNS, sortBatches, batchWhen } from '@/lib/batches'
import { type AttendanceRow, ATTENDANCE_COLUMNS, monthStats, statsText, monthRange, addDays, batchesOn as batchesMeetingOn, tapRow, buildAttendanceMessage } from '@/lib/attendance'
import CountryCodePicker from '@/app/country-code-picker'
import { weekStatus, dayKey, isRestDay, doneDayKeys, weekEnd, localToday } from '@/lib/plan-summary'
import { type PlanJson, type PlanDay, type ExercisesDone, planJsonOf, summarizeAny, planToText, cleanPlan, workoutDays, emptyPlan, textToPlan, tickedFromSaved, exercisesDoneFor, todayWeekday, daysInWeekOrder, exerciseDetail, dayLabel } from '@/lib/plan-structure'
import PlanEditor from '@/app/plan-editor'
import PlanCopySheet from '@/app/plan-copy-sheet'
import { estimateKcal, kcalText, thisWeekMonday, doneDayNotes } from '@/lib/calories'
import { activityText } from '@/lib/activities'
import { planAdherence, currentPlan, recentAdherence, pct, pctColor, withoutEarlyLinks, linkForDate } from '@/lib/adherence'
import SessionForm, { type SessionDraft, emptyDraft } from '@/app/session-form'
import { buildProgressMessage, buildSessionMessage, maskPhone, summarizeWeek, planForWeek, recentWeeksAdherence, type ShareClient } from '@/lib/progress-share'
import { weeklyTotals } from '@/lib/weekly-totals'
import { beforeYouStart, isCovering } from '@/lib/coach-today'
import { isCoachCompany } from '@/lib/company-type'
import { memberWord, staffWord, isDojo } from '@/lib/labels'
import { type BeltRank, BELT_RANK_COLUMNS, gradingOn, beltLabel, beltOptions } from '@/lib/belts'
import dynamic from 'next/dynamic'
import { loadGymStaff } from '@/lib/gym-staff'
import { type Exercise, EXERCISE_COLUMNS } from '@/lib/exercises'
import { type ExerciseLog, type DatedLog, type LogDraft, type LogInsert, EXERCISE_LOG_COLUMNS, lastLogFor, prefill, stepWeight, numberFromInput, rowsToSave, isTimedOrDistance, logDetail, logLine, strengthReport } from '@/lib/exercise-logs'

// Charts load only when the Progress view is shown (keeps Chart.js out of the first download)
const ProgressCharts = dynamic(() => import('@/app/progress-charts'), {
  ssr: false,
  loading: () => <p className="text-xs text-gray-500 px-1">Loading charts…</p>,
})
// Per-exercise top weight per month (#80); Chart.js, loaded only when the Progress tab shows it
const ExerciseProgressChart = dynamic(() => import('@/app/exercise-progress'), { ssr: false })

type ClientProfile = {
  full_name: string
  email: string
  phone: string | null
  age: number | null
  gender: string | null
  height_cm: number | null
  weight_kg: number | null
  fitness_level: string | null
  available_days: string | null
  food_preference: string | null
  meals_per_day: number | null
  medical_conditions: string | null
  emergency_contact_name: string | null
  emergency_contact_phone: string | null
  goal: string | null
  trainer_name: string | null
  diet_plan: string | null
  client_type: string | null
  archived_at: string | null
  primary_coach_id?: string | null   // usual coach (#40); a soft link, never limits who can train the client
  created_at?: string                // joined date (header "Joined Oct 2026")
  country?: string | null    // client's own country / default currency (multi-country gyms, db/2026-11-01-multi-country.md)
  currency?: string | null
  // Parent / guardian (db/2026-11-03-guardian.md): undefined before that SQL runs
  guardian_name?: string | null
  guardian_phone?: string | null
  guardian_relation?: string | null
  // Branch and home batch (db/2026-11-03-branches-batches.md): undefined before that SQL runs
  branch_id?: string | null
  batch_id?: string | null
  // Current belt (belt grading, lib/belts.ts): undefined before that SQL runs
  current_rank_id?: string | null
  rank_achieved_on?: string | null
}

// Owner, partners and coaches of the gym (names for "by Coach X", the primary-coach dropdown)
type Staff = { id: string; full_name: string; role: string; archived_at: string | null }


type Membership = {
  id: string
  plan_type: string
  amount_paid: number
  start_date: string
  end_date: string
  created_at?: string
  currency?: string | null // the currency it was paid in; never changes once saved
}

type Plan = {
  id: string
  week_start: string
  plan_details: string
  workout_time: string | null
  plan_json?: unknown   // structured days (newer plans); null for text-only plans
}

type Session = {
  id: string
  session_date: string
  duration_minutes: number
  notes: string
  weekly_plan_id?: string | null
  plan_day?: string | null   // set when the client logged it from a day of the plan
  exercises_done?: unknown   // { done: [names], total } when the client ticked exercises
  activity?: string | null   // what was done, from the client's Log tab ("run", "sport:Badminton")
  logged_by?: string | null  // staff member who logged it for the client; null = the client logged it
}

type Feedback = {
  id: string
  session_id: string
  star_rating: number
  admin_feedback: string
}

function daysLeftFromDate(endDate: string): number {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.ceil((new Date(endDate).getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
}

function elapsedPct(startDate: string, endDate: string): number {
  const total = new Date(endDate).getTime() - new Date(startDate).getTime()
  const elapsed = Date.now() - new Date(startDate).getTime()
  return Math.min(Math.max((elapsed / total) * 100, 0), 100)
}

// Local date as YYYY-MM-DD
const formatIso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
// A date-only value plus n days, as YYYY-MM-DD
const isoAdd = (iso: string, n: number) => { const d = parseDate(iso.slice(0, 10)); d.setDate(d.getDate() + n); return formatIso(d) }

export default function ClientDetailPage() {
  const router = useRouter()
  const params = useParams()
  const clientId = params.id as string
  // "?tab=plans&day=today" (owner dashboard → Mark today): open Plans on today's day of this week's plan;
  // "?tab=sessions" opens the Sessions tab
  const searchParams = useSearchParams()
  const linkTab = searchParams.get('tab')
  const linkDay = searchParams.get('day')
  // "?tab=sessions&log=today" (dojo sensei home): Sessions tab with the Log session form open
  const linkLog = searchParams.get('log')
  const linkApplied = useRef(false)

  const [client, setClient] = useState<ClientProfile | null>(null)
  const [plans, setPlans] = useState<Plan[]>([])
  const [sessions, setSessions] = useState<Session[]>([])
  const [feedback, setFeedback] = useState<Feedback[]>([])
  // Names of the staff who logged sessions for this client (logged_by → profiles.full_name)
  const [staffNames, setStaffNames] = useState<Record<string, string>>({})
  const [activeTab, setActiveTab] = useState<'plans' | 'sessions' | 'progress' | 'profile'>('profile')
  const [showPlanForm, setShowPlanForm] = useState(false)
  const [newPlan, setNewPlan] = useState({ week_start: '', plan_details: '', workout_time: '' })
  const [saving, setSaving] = useState(false)
  const [editingPlan, setEditingPlan] = useState<Plan | null>(null)
  const [deletingPlanId, setDeletingPlanId] = useState<string | null>(null)
  const [generatingPlan, setGeneratingPlan] = useState(false)
  const [generatedPlan, setGeneratedPlan] = useState('')
  const [generatedJson, setGeneratedJson] = useState<PlanJson | null>(null) // structured AI draft, edited day by day
  // Day-by-day editor state: new manual plan (or pasted text) and the plan being edited
  const [newPlanJson, setNewPlanJson] = useState<PlanJson | null>(null)
  const [newPlanTextMode, setNewPlanTextMode] = useState(false)
  const [editingJson, setEditingJson] = useState<PlanJson | null>(null)
  const [showGeneratedPlan, setShowGeneratedPlan] = useState(false)
  const [aiPlanMeta, setAiPlanMeta] = useState({ week_start: '', workout_time: '' })
  const [highlightPlanId, setHighlightPlanId] = useState<string | null>(null)
  // After a plan is assigned or edited, bring its card into view once the list has reloaded
  const [scrollToPlanId, setScrollToPlanId] = useState<string | null>(null)
  // AI diet chart: draft is reviewed/edited by the coach before saving to profiles.diet_plan
  const [dietGenerating, setDietGenerating] = useState(false)
  const [dietDraft, setDietDraft] = useState('')
  const [dietError, setDietError] = useState('')
  const [savingDiet, setSavingDiet] = useState(false)
  const dietPanelRef = useRef<HTMLDivElement | null>(null)
  // Compact plan cards: one expanded at a time; older plans behind "Show older"
  const [expandedPlanId, setExpandedPlanId] = useState<string | null>(null)
  const [showAllPlans, setShowAllPlans] = useState(false)
  // Plans tab: open ⋯ menu on a plan card, the selected day of each plan's 7-day strip (not this week's:
  // that one is coachOpenDay), and the + New plan sheet
  const [planMenuId, setPlanMenuId] = useState<string | null>(null)
  const [selDay, setSelDay] = useState<Record<string, string>>({})
  const [newPlanSheetOpen, setNewPlanSheetOpen] = useState(false)
  const [copyClientOpen, setCopyClientOpen] = useState(false) // New plan → Copy from a client
  const [sheetWeek, setSheetWeek] = useState('')   // "Week starts" in the + New plan sheet
  const sheetDragY = useRef<number | null>(null)
  const manualFormRef = useRef<HTMLDivElement | null>(null)
  const aiPanelRef = useRef<HTMLDivElement | null>(null)
  const aiWorkingRef = useRef<HTMLDivElement | null>(null)
  const [planError, setPlanError] = useState('')
  const [toast, setToast] = useState<{ text: string; kind: 'success' | 'error' } | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [aiError, setAiError] = useState('')
  // Notes for the coach about the AI plan's schedule (e.g. the client's notes ask for a different number of days)
  const [scheduleNotes, setScheduleNotes] = useState<string[]>([])
  // #37: AI plans used this month for this client (null = not loaded / couldn't be counted)
  const [aiPlans, setAiPlans] = useState<{ used: number; limit: number; resetsOn: string } | null>(null)
  const [aiElapsed, setAiElapsed] = useState(0)
  const aiAbort = useRef<AbortController | null>(null)
  const [feedbackText, setFeedbackText] = useState<Record<string, string>>({})
  const [savedFeedback, setSavedFeedback] = useState<Record<string, boolean>>({})
  const [showResetPassword, setShowResetPassword] = useState(false)
  // Header ⋯ menu and the goal chip (tap shows the full goal)
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false)
  const [goalOpen, setGoalOpen] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [resetMessage, setResetMessage] = useState('')
  const [resetting, setResetting] = useState(false)
  const [showResetPasswordValue, setShowResetPasswordValue] = useState(false)
  // Create login (client added without one): username + password, /api/create-login
  const [showCreateLogin, setShowCreateLogin] = useState(false)
  const [createLogin, setCreateLogin] = useState<{ username: string; password: string; saving: boolean; error: string }>({ username: '', password: '', saving: false, error: '' })
  const [createLoginStatus, setCreateLoginStatus] = useState<UsernameStatus>('empty')
  const [loading, setLoading] = useState(true)
  const [memberships, setMemberships] = useState<Membership[]>([])
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [showEditClient, setShowEditClient] = useState(false)
  const [editClientForm, setEditClientForm] = useState({
    full_name: '', phone: '',
    plan_type: '1 Month', amount_paid: '',
    start_date: new Date().toISOString().split('T')[0], end_date: '',
    client_type: 'member',
    // Multi-country: the client's country, phone code and default currency; the renewal's currency
    country: 'IN' as Country, phone_country: 'IN' as PhoneCountry, currency: '', membership_currency: ''
  })
  const [savingEdit, setSavingEdit] = useState(false)
  const [editMessage, setEditMessage] = useState('')
  const [savingMembership, setSavingMembership] = useState(false)
  const [membershipMessage, setMembershipMessage] = useState('')
  // Renew = new entry starting after the current one; Correct = edit the current entry
  const [membershipMode, setMembershipMode] = useState<'renew' | 'correct'>('renew')
  const [deletingClient, setDeletingClient] = useState(false)
  const [editingClientProfile, setEditingClientProfile] = useState(false)
  const [clientProfileForm, setClientProfileForm] = useState({
    trainer_name: '', diet_plan: '',
    goal: '', age: '', gender: '', height_cm: '', weight_kg: '',
    fitness_level: '', food_preference: '', meals_per_day: '', available_days: '',
    medical_conditions: '', emergency_contact_name: '', emergency_contact_phone: '',
    guardian_name: '', guardian_phone: '', guardian_relation: '',
    branch_id: '', batch_id: '',
    rank_id: '', belt_since: ''
  })
  // Belt grading (companies.grading_enabled; lib/belts.ts): the gym's belts. Empty = off (Belt fields hidden)
  const [beltRanks, setBeltRanks] = useState<BeltRank[]>([])
  const beltsOn = beltRanks.length > 0
  // Dojo branches & batches (db/2026-11-03-branches-batches.md): loaded with the client; empty / off before the SQL
  const [branchList, setBranchList] = useState<Branch[]>([])
  const [batchList, setBatchList] = useState<Batch[]>([])
  const [batchesOn, setBatchesOn] = useState(false)
  // Dojo attendance (#78, db/2026-11-03-attendance.md): this student's rows; on once the table exists
  const [attendanceOn, setAttendanceOn] = useState(false)
  const [attRows, setAttRows] = useState<AttendanceRow[]>([])
  const [savingAtt, setSavingAtt] = useState(false)
  const [savingClientProfile, setSavingClientProfile] = useState(false)
  const [clientProfileMessage, setClientProfileMessage] = useState('')
  // Coach marks a plan day done for the client (gym PT: the client trains in front of the coach).
  // Ticks per "planId:Day", kept on this device under "coach-ticks:<planId>:<Day>" so they never mix
  // with the client's own ticks ("cb-ticks") on a shared phone.
  const COACH_TICKS = 'coach-ticks:'
  // Dojo "Log session" form on the Sessions tab (no plan): its key in markKey
  const DOJO_LOG_KEY = 'dojo-log'
  const [coachTicks, setCoachTicks] = useState<Record<string, number[]>>(() => {
    if (typeof window === 'undefined') return {}
    const out: Record<string, number[]> = {}
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (!k?.startsWith(COACH_TICKS)) continue
        const list = JSON.parse(localStorage.getItem(k) || '[]')
        if (Array.isArray(list) && list.length) out[k.slice(COACH_TICKS.length)] = list.filter(n => typeof n === 'number')
      }
    } catch { /* storage unavailable: ticks just won't survive a reload */ }
    return out
  })
  const setDayTicks = (key: string, list: number[]) => {
    setCoachTicks(prev => {
      const next = { ...prev }
      if (list.length) next[key] = list; else delete next[key]
      return next
    })
    try {
      if (list.length) localStorage.setItem(COACH_TICKS + key, JSON.stringify(list))
      else localStorage.removeItem(COACH_TICKS + key)
    } catch { /* ignore */ }
  }
  const toggleCoachTick = (planId: string, day: string, i: number) => {
    const key = `${planId}:${day}`
    const cur = coachTicks[key] || []
    setDayTicks(key, cur.includes(i) ? cur.filter(x => x !== i) : [...cur, i])
  }
  // Open day row on this week's plan ("Mon"), the open "Mark done" form ("planId:Mon", or "planId:" for a
  // text plan), and a day already done that the coach asked to log again (confirm step)
  const [coachOpenDay, setCoachOpenDay] = useState<string | null>(null)
  const [markKey, setMarkKey] = useState<string | null>(null)
  const [markAgainKey, setMarkAgainKey] = useState<string | null>(null)
  const coachDraft = (): SessionDraft => ({ ...emptyDraft(), duration_minutes: '60', session_date: localToday() })
  const [markForm, setMarkForm] = useState<SessionDraft>(coachDraft)
  const [markError, setMarkError] = useState('')
  const [savingMark, setSavingMark] = useState(false)
  // The session the coach just marked done ("planId:Mon" key), for "Send to <client> on WhatsApp"
  const [lastMarked, setLastMarked] = useState<{ key: string; session: Session } | null>(null)
  // Weight / reps per exercise (#80, db/2026-11-05-exercise-logs.md): on once the table answers.
  // exLogs = this client's logs; exLibrary = starter list + this gym's exercises (to match names to ids).
  const [exerciseLogsOn, setExerciseLogsOn] = useState(false)
  const [exLogs, setExLogs] = useState<ExerciseLog[]>([])
  const [exLibrary, setExLibrary] = useState<Exercise[]>([])
  // Numbers the coach changed on ticked exercises, per "planId:Day" → position. Kept on this device
  // under "coach-weights:<planId>:<Day>" like the ticks, so a reload mid-workout keeps them.
  const COACH_WEIGHTS = 'coach-weights:'
  const [logDrafts, setLogDrafts] = useState<Record<string, Record<number, LogDraft>>>(() => {
    if (typeof window === 'undefined') return {}
    const out: Record<string, Record<number, LogDraft>> = {}
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (!k?.startsWith(COACH_WEIGHTS)) continue
        const v = JSON.parse(localStorage.getItem(k) || '{}')
        if (v && typeof v === 'object') out[k.slice(COACH_WEIGHTS.length)] = v
      }
    } catch { /* storage unavailable: numbers just won't survive a reload */ }
    return out
  })
  const saveDayDrafts = (key: string, next: Record<number, LogDraft> | null) => {
    setLogDrafts(prev => {
      const all = { ...prev }
      if (next && Object.keys(next).length) all[key] = next; else delete all[key]
      return all
    })
    try {
      if (next && Object.keys(next).length) localStorage.setItem(COACH_WEIGHTS + key, JSON.stringify(next))
      else localStorage.removeItem(COACH_WEIGHTS + key)
    } catch { /* ignore */ }
  }
  // Session saved but its weights weren't: kept here to retry the weights only (never the session)
  const [weightsRetry, setWeightsRetry] = useState<{ key: string; rows: LogInsert[]; error: string } | null>(null)
  const [retryingWeights, setRetryingWeights] = useState(false)
  const exLibraryLoaded = useRef(false)
  // "Share progress" on WhatsApp (Sessions / Progress tabs). Last week by default on Mon and Tue.
  const [shareOpen, setShareOpen] = useState(false)
  const [shareWeek, setShareWeek] = useState<'this' | 'last'>(() => ([1, 2].includes(new Date().getDay()) ? 'last' : 'this'))
  const [shareNote, setShareNote] = useState('')
  const [shareText, setShareText] = useState('')
  const [shareEdited, setShareEdited] = useState(false) // coach typed in the preview: keep their text
  // PDF: include the week's day-by-day plan (exercises, sets, weights)? Off = only the daily summary
  // and the Strength table. Remembered on this device; on by default (the report as before).
  const PDF_PLAN_KEY = 'pdf-include-plan'
  const [pdfIncludePlan, setPdfIncludePlan] = useState(() => {
    try { return typeof window === 'undefined' || localStorage.getItem(PDF_PLAN_KEY) !== '0' } catch { return true }
  })
  const choosePdfIncludePlan = (on: boolean) => {
    setPdfIncludePlan(on)
    try { localStorage.setItem(PDF_PLAN_KEY, on ? '1' : '0') } catch { /* ignore */ }
  }
  const [coachName, setCoachName] = useState('')        // logged-in staff user, for the sign-off
  const [staff, setStaff] = useState<Staff[]>([])
  const [savingPrimaryCoach, setSavingPrimaryCoach] = useState(false)
  // Who is looking (#40). A coach never queries memberships (no access) and gets no member admin controls.
  const [viewerId, setViewerId] = useState<string | null>(null)
  const [isCoach, setIsCoach] = useState(false)
  const viewerPromise = useRef<Promise<{ id: string; full_name: string; role: string; company_id: string | null } | null> | null>(null)
  const getViewer = () => {
    viewerPromise.current ??= (async () => {
      // getSession reads the saved login locally (the proxy already verified it with Supabase)
      const { data: { session } } = await supabase.auth.getSession()
      const user = session?.user
      if (!user) return null
      const { data } = await supabase.from('profiles').select('full_name, role, company_id').eq('id', user.id).single()
      return { id: user.id, full_name: data?.full_name || '', role: data?.role || '', company_id: data?.company_id ?? null }
    })()
    return viewerPromise.current
  }
  // "Before you start" card: collapsed or open, remembered per viewer on this device
  const [bysOpen, setBysOpen] = useState(true)
  const sharePanelRef = useRef<HTMLDivElement | null>(null)
  const [makingPdf, setMakingPdf] = useState(false)

  useEffect(() => { initialize() }, [clientId])

  // Esc closes the + New plan sheet and the plan ⋯ menu
  useEffect(() => {
    if (!newPlanSheetOpen && !planMenuId) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setNewPlanSheetOpen(false); setPlanMenuId(null) } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [newPlanSheetOpen, planMenuId])

  // Esc closes the header ⋯ menu
  useEffect(() => {
    if (!headerMenuOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setHeaderMenuOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [headerMenuOpen])

  // #37: load "3 of 5 AI plans used this month" (only shown when AI plans are on for the company)
  useEffect(() => {
    if (!clientId) return
    let cancelled = false
    fetch(`/api/ai-plan-usage?clientId=${encodeURIComponent(String(clientId))}`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (!cancelled) setAiPlans(d?.aiPlans ?? null) })
      .catch(() => { /* no count shown; the server still enforces the cap */ })
    return () => { cancelled = true }
  }, [clientId])

  // Logged-in staff member's name (WhatsApp sign-off), their role, and the gym's staff (owner, partners, coaches)
  useEffect(() => {
    (async () => {
      const data = await getViewer()
      if (!data) return
      setCoachName(data.full_name)
      setViewerId(data.id)
      setIsCoach(data.role === 'coach')
      try { if (localStorage.getItem(`bys-collapsed:${data.id}`) === '1') setBysOpen(false) } catch { /* storage unavailable */ }
      if (!data.company_id) return
      // Through gym_staff() (coaches can't read owner / partner rows directly)
      setStaff(await loadGymStaff(data.company_id))
    })()
  }, [])

  useEffect(() => {
    if (shareOpen) sharePanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [shareOpen])

  // Apply the link once the client and plans have loaded
  useEffect(() => {
    if (linkApplied.current || loading || !client) return
    linkApplied.current = true
    // Dojo: no Plans tab (attendance replaces plans later): plan links open Sessions, "today" opens Log session
    if (isDojo((client as { companies?: { business_type?: string | null } }).companies?.business_type) && (linkTab === 'plans' || linkTab === 'sessions')) {
      setActiveTab('sessions')
      if (linkLog === 'today' || linkDay === 'today') openMarkForm(DOJO_LOG_KEY)
      return
    }
    if (linkTab === 'sessions') { setActiveTab('sessions'); return } // owner dashboard → Today's sessions
    if (linkTab !== 'plans') return
    setActiveTab('plans')
    if (linkDay !== 'today') return
    const cur = currentPlan(plans)
    if (!cur) return
    setExpandedPlanId(cur.id)
    setScrollToPlanId(cur.id)
    const today = planJsonOf(cur)?.days.find(d => d.day === todayWeekday())
    if (today && !today.rest) setCoachOpenDay(today.day)
  }, [loading, client, plans, linkTab, linkDay])

  // Seconds counter for the AI "working" panel
  useEffect(() => {
    if (!generatingPlan) return
    setAiElapsed(0)
    const t = setInterval(() => setAiElapsed(s => s + 1), 1000)
    return () => clearInterval(t)
  }, [generatingPlan])

  // Calorie estimate per session (null without weight or minutes); weekly totals from Monday
  const sessionKcal = (s: Session) => estimateKcal({
    minutes: s.duration_minutes, weightKg: client?.weight_kg, label: s.plan_day, activity: s.activity,
    businessType: (client as { companies?: { business_type?: string } } | null)?.companies?.business_type,
  })
  const weekStartIso = thisWeekMonday()
  const lastWeekStartIso = (() => {
    const d = new Date(weekStartIso + 'T00:00:00'); d.setDate(d.getDate() - 7)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })()
  const weekKcal = sessions.filter(s => s.session_date >= weekStartIso).reduce((n, s) => n + (sessionKcal(s) || 0), 0)
  const lastWeekKcal = sessions.filter(s => s.session_date >= lastWeekStartIso && s.session_date < weekStartIso).reduce((n, s) => n + (sessionKcal(s) || 0), 0)

  const showToast = (text: string, kind: 'success' | 'error' = 'success') => {
    if (toastTimer.current) clearTimeout(toastTimer.current)
    setToast({ text, kind })
    toastTimer.current = setTimeout(() => setToast(null), 3000)
  }

  // Default "Week starting": today if it's Monday, otherwise the coming Monday (local date, YYYY-MM-DD)
  const nextMonday = () => {
    const d = new Date()
    const add = (8 - d.getDay()) % 7
    d.setDate(d.getDate() + add)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }

  // Bring whichever plan panel just opened into view (important on phones)
  useEffect(() => {
    if (showPlanForm) manualFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [showPlanForm])
  useEffect(() => {
    if (showGeneratedPlan) aiPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [showGeneratedPlan])
  useEffect(() => {
    if (generatingPlan) aiWorkingRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [generatingPlan])
  // The saved plan's card, once it is on screen (older plans may be behind "Show older")
  useEffect(() => {
    if (!scrollToPlanId) return
    const el = document.getElementById(`plan-${scrollToPlanId}`)
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setScrollToPlanId(null)
  }, [scrollToPlanId, plans])

  useEffect(() => {
    if (!editClientForm.start_date) return
    const start = new Date(editClientForm.start_date)
    const end = new Date(start)
    if (editClientForm.plan_type === '1 Month') end.setMonth(end.getMonth() + 1)
    else if (editClientForm.plan_type === '3 Months') end.setMonth(end.getMonth() + 3)
    else if (editClientForm.plan_type === '6 Months') end.setMonth(end.getMonth() + 6)
    else if (editClientForm.plan_type === '1 Year') end.setFullYear(end.getFullYear() + 1)
    setEditClientForm(prev => ({ ...prev, end_date: end.toISOString().split('T')[0] }))
  }, [editClientForm.plan_type, editClientForm.start_date])

  // Loads the page's data in parallel (one round trip instead of five).
  // Pass only the parts that changed after a save to avoid reloading everything.
  type Part = 'client' | 'memberships' | 'plans' | 'sessions'
  const loadData = async (parts: Part[] = ['client', 'memberships', 'plans', 'sessions']) => {
    const want = (p: Part) => parts.includes(p)
    // One small query for the names of everyone who logged a session for the client (not one per session)
    const loadStaffNames = async (rows: Session[]) => {
      const ids = [...new Set(rows.map(r => r.logged_by).filter((x): x is string => !!x && x !== clientId))]
      if (!ids.length) { setStaffNames({}); return }
      const { data } = await supabase.from('profiles').select('id, full_name').in('id', ids)
      setStaffNames(Object.fromEntries((data || []).map(p => [p.id, p.full_name || ''])))
    }
    await Promise.all([
      want('client') && (async () => {
        const { data: clientData } = await supabase
          .from('profiles')
          .select('*, companies:company_id(*)') // all gym settings, incl. ai_diet_enabled once that column exists
          .eq('id', clientId)
          .single()
        setClient(clientData)
        if (clientData?.company_id) setCompanyId(clientData.company_id)
        // Belt grading on: the gym's belts (Profile tab); an error = none yet, fields stay hidden
        if (clientData?.company_id && gradingOn((clientData as { companies?: { grading_enabled?: boolean | null } }).companies)) {
          const { data: ranks, error: ranksError } = await supabase.from('belt_ranks').select(BELT_RANK_COLUMNS)
            .eq('company_id', clientData.company_id).order('rank_order')
          if (ranksError) console.error('Belt ranks error:', ranksError)
          else setBeltRanks((ranks || []) as BeltRank[])
        }
        // Dojo: the gym's branches and batches (for the Profile tab); an error = tables not there yet
        const bt = (clientData as { companies?: { business_type?: string | null } } | null)?.companies?.business_type
        if (clientData?.company_id && isDojo(bt)) {
          const [br, ba] = await Promise.all([
            supabase.from('branches').select(BRANCH_COLUMNS).eq('company_id', clientData.company_id).order('name'),
            supabase.from('batches').select(BATCH_COLUMNS).eq('company_id', clientData.company_id),
          ])
          if (!br.error && !ba.error) {
            setBranchList((br.data || []) as Branch[])
            setBatchList((ba.data || []) as Batch[])
            setBatchesOn(true)
            const att = await supabase.from('attendance').select(ATTENDANCE_COLUMNS)
              .eq('profile_id', clientId).order('class_date', { ascending: false }).limit(1000)
            if (!att.error) { setAttRows((att.data || []) as AttendanceRow[]); setAttendanceOn(true) }
          }
        }
      })(),
      want('memberships') && (async () => {
        // Coaches: plan and dates only, from pt_membership_status() (no amounts, no history)
        if ((await getViewer())?.role === 'coach') {
          const { data: status, error: statusError } = await supabase.rpc('pt_membership_status')
          if (statusError) console.error('Membership status error:', statusError)
          const row = ((status || []) as { profile_id: string; plan_type: string | null; start_date: string | null; end_date: string | null }[])
            .find(m => m.profile_id === clientId)
          setMemberships(row?.start_date && row.end_date
            ? [{ id: 'status', plan_type: row.plan_type || '', amount_paid: 0, start_date: row.start_date, end_date: row.end_date }]
            : [])
          return
        }
        const { data: membershipsData } = await supabase
          .from('memberships')
          .select('*') // * so memberships.currency is read once it exists
          .eq('profile_id', clientId)
          .order('start_date', { ascending: false })
          .order('created_at', { ascending: false })
        setMemberships(membershipsData || [])
      })(),
      want('plans') && (async () => {
        const { data: plansData } = await supabase
          .from('weekly_plans')
          .select('*')
          .eq('client_id', clientId)
          .order('week_start', { ascending: false })
        setPlans(plansData || [])
      })(),
      // Weight / reps logs (#80): an error = the table isn't there yet, so the weight rows stay hidden.
      // Newest first (at most 1000 come back, so the oldest drop off first). The library is read once.
      want('sessions') && (async () => {
        const [lg, lib] = await Promise.all([
          supabase.from('exercise_logs').select(EXERCISE_LOG_COLUMNS).eq('client_id', clientId)
            .order('created_at', { ascending: false }).limit(1000),
          exLibraryLoaded.current ? null : supabase.from('exercises').select(EXERCISE_COLUMNS).order('name').limit(1000),
        ])
        if (lg.error) { setExerciseLogsOn(false); return }
        setExLogs((lg.data || []) as ExerciseLog[])
        if (lib && !lib.error) { exLibraryLoaded.current = true; setExLibrary((lib.data || []) as Exercise[]) }
        setExerciseLogsOn(true)
      })(),
      want('sessions') && (async () => {
        // Sessions with their feedback in one request; falls back to two if the join isn't available
        const joined = await supabase
          .from('logged_sessions')
          .select('*, session_feedback(*)')
          .eq('client_id', clientId)
          .order('session_date', { ascending: true })
        if (!joined.error) {
          const rows = (joined.data || []) as (Session & { session_feedback?: Feedback[] | null })[]
          setSessions(rows.map(r => { const copy = { ...r }; delete copy.session_feedback; return copy as Session }))
          setFeedback(rows.flatMap(r => r.session_feedback || []))
          await loadStaffNames(rows)
          return
        }
        const { data: sessionsData } = await supabase
          .from('logged_sessions')
          .select('*')
          .eq('client_id', clientId)
          .order('session_date', { ascending: true })
        setSessions(sessionsData || [])
        await loadStaffNames(sessionsData || [])
        const sessionIds = sessionsData?.map(s => s.id) || []
        if (sessionIds.length) {
          const { data: feedbackData } = await supabase
            .from('session_feedback')
            .select('*')
            .in('session_id', sessionIds)
          setFeedback(feedbackData || [])
        } else {
          setFeedback([])
        }
      })(),
    ])
    setLoading(false)
  }
  const initialize = () => loadData()

  const clientFirstName = (client?.full_name || '').trim().split(/\s+/)[0] || 'client'
  // "by Coach Priya" when staff logged it for the client, "by client" when the client logged it
  // " (covering)" when the coach who logged it isn't the client's primary coach
  const loggedByText = (s: Session) => {
    if (!s.logged_by || s.logged_by === clientId) return 'by client'
    // A name saved as "Coach Ravi" shouldn't read "Coach Coach"
    const first = (staffNames[s.logged_by] || staff.find(x => x.id === s.logged_by)?.full_name || '').trim().replace(/^(coach|sensei)\s+/i, '').split(/\s+/)[0]
    const covering = isCovering(s.logged_by, { id: clientId, primary_coach_id: client?.primary_coach_id })
    const bt = (client as { companies?: { business_type?: string | null } } | null)?.companies?.business_type
    const word = staffWord(bt).one
    // Only coach / sensei logins read "by Coach Ravi"; the owner / a partner shows by name
    if (staff.find(x => x.id === s.logged_by)?.role !== 'coach') return `by ${first || 'staff'}` + (covering ? ' (covering)' : '')
    return (first ? `by ${word} ${first}` : `by ${word.toLowerCase()}`) + (covering ? ' (covering)' : '')
  }
  const staffFirstName = (id: string | null | undefined) => (staff.find(x => x.id === id)?.full_name || '').trim().split(/\s+/)[0]
  // Individual coach company (company_type = 'coach'): the owner is the coach, so no coach names or primary coach
  const coachCompany = isCoachCompany((client as { companies?: { company_type?: string | null } } | null)?.companies)
  // Dojo (business type martial_arts): "Sensei", every student is PT (no PT badge / checkbox), short profile (age, gender, medical, parent)
  const dojoType = (client as { companies?: { business_type?: string | null } } | null)?.companies?.business_type
  const dojo = isDojo(dojoType)
  // Dojo with the attendance table: attendance replaces Log session (Sessions tab = Attendance, Progress counts classes)
  const attendanceMode = dojo && attendanceOn
  const sw = staffWord(dojoType)
  // Shown near Mark done when a coach trains someone else's client (or a client with no primary coach)
  const coveringBadge = () => {
    if (coachCompany || !isCoach || !viewerId || !isCovering(viewerId, { id: clientId, primary_coach_id: client?.primary_coach_id })) return null
    const primary = staffFirstName(client?.primary_coach_id)
    return (
      <p className="text-[11px] text-gray-500 mb-2">
        {client?.primary_coach_id ? `Covering for ${primary || `their ${sw.one.toLowerCase()}`}` : `No primary ${sw.one.toLowerCase()}`}
      </p>
    )
  }
  // Sessions for counting plan days (done ticks, adherence, reports): a session dated before its
  // plan started counts in its own week instead (lib/adherence.ts withoutEarlyLinks, 14 Nov)
  const countSessions = withoutEarlyLinks(sessions, plans)
  // Done-day notes on plan cards ("45 min · ~265 kcal") plus who logged the day's latest session
  const doneNotesWithWho = (planId: string) => {
    const notes = doneDayNotes(planId, countSessions, sessionKcal)
    for (const day of Object.keys(notes)) {
      const latest = countSessions.filter(x => x.weekly_plan_id === planId && dayKey(x.plan_day) === day).pop()
      if (latest && !coachCompany) notes[day] = [notes[day], loggedByText(latest)].filter(Boolean).join(' · ')
    }
    return notes
  }
  const openMarkForm = (key: string) => {
    setMarkError('')
    setMarkAgainKey(null)
    setMarkForm(coachDraft())
    setMarkKey(key)
  }
  const closeMarkForm = () => { setMarkKey(null); setMarkAgainKey(null); setMarkError('') }

  // ---- Weight / reps per exercise (#80) ----
  // Logs with their session's date (for "last time" and months); logs of sessions not loaded are left out
  const sessionDates = Object.fromEntries(sessions.map(x => [x.id, x.session_date]))
  const datedLogs: DatedLog[] = exLogs.flatMap(l => sessionDates[l.session_id] ? [{ ...l, session_date: sessionDates[l.session_id].slice(0, 10) }] : [])
  const logsBySession = exLogs.reduce<Record<string, ExerciseLog[]>>((acc, l) => {
    (acc[l.session_id] ||= []).push(l)
    return acc
  }, {})
  // The numbers shown on a ticked exercise: what the coach changed, else the last log, else the plan
  const draftFor = (key: string, i: number, e: PlanDay['exercises'][number]): LogDraft =>
    logDrafts[key]?.[i] ?? prefill(e, lastLogFor(e, datedLogs, exLibrary))
  const setDraft = (key: string, i: number, e: PlanDay['exercises'][number], patch: Partial<LogDraft>) =>
    saveDayDrafts(key, { ...(logDrafts[key] || {}), [i]: { ...draftFor(key, i, e), ...patch } })
  // Saves the weight rows for a session already saved. Returns an error message, or '' when saved.
  const insertWeights = async (rows: LogInsert[]): Promise<string> => {
    if (!rows.length) return ''
    const { error } = await supabase.from('exercise_logs').insert(rows)
    return error ? error.message || 'please try again' : ''
  }
  const retryWeights = async () => {
    if (!weightsRetry) return
    setRetryingWeights(true)
    const err = await insertWeights(weightsRetry.rows)
    setRetryingWeights(false)
    if (err) { setWeightsRetry({ ...weightsRetry, error: err }); return }
    setWeightsRetry(null)
    showToast('✓ Weights saved')
    loadData(['sessions'])
  }
  // Under the plan day after a save whose weights failed: the session is saved, retry the weights only
  const weightsBanner = (key: string) => weightsRetry?.key === key ? (
    <div className="bg-red-950/40 border border-red-800 rounded-xl px-3 py-2.5 mb-3 space-y-2" role="alert">
      <p className="text-xs text-red-300">Session saved, but the weights weren&apos;t: {weightsRetry.error}</p>
      <div className="flex gap-2">
        <button type="button" onClick={retryWeights} disabled={retryingWeights}
          className="flex-1 bg-red-600 hover:bg-red-500 disabled:opacity-60 text-white text-sm font-medium py-2 rounded-lg">
          {retryingWeights ? 'Saving…' : 'Retry saving weights'}
        </button>
        <button type="button" onClick={() => setWeightsRetry(null)}
          className="px-3 bg-gray-800 hover:bg-gray-700 text-white text-sm rounded-lg">Dismiss</button>
      </div>
    </div>
  ) : null
  // The sets × reps @ kg row under a ticked exercise (not for timed / distance exercises).
  // Boxes keep what is typed and save on leaving the box (so "12.5" can be typed); −/+ redraw them.
  const renderWeightRow = (key: string, i: number, e: PlanDay['exercises'][number]) => {
    if (!exerciseLogsOn || isTimedOrDistance(e)) return null
    const d = draftFor(key, i, e)
    const last = lastLogFor(e, datedLogs, exLibrary)
    const box = 'min-w-0 bg-gray-800 text-white text-center rounded-lg px-1 py-2 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm'
    const step = 'w-9 h-9 shrink-0 rounded-lg bg-gray-800 border border-gray-700 text-white text-base leading-none hover:bg-gray-700'
    const num = (v: number | null) => (v == null ? '' : String(v))
    return (
      <div className="pl-11 pr-3 pb-2.5 -mt-1">
        {/* Two groups that each stay on one line; on a narrow phone the weight group moves under the first */}
        <div className="flex items-end gap-x-4 gap-y-2 flex-wrap">
          <div className="shrink-0">
            <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Sets × reps</p>
            <div className="flex items-center gap-1.5">
              <input type="text" inputMode="numeric" aria-label={`${e.name} sets`} className={`${box} w-12`}
                key={`sets:${key}:${i}:${d.sets}`} defaultValue={num(d.sets)}
                onBlur={ev => setDraft(key, i, e, { sets: numberFromInput(ev.target.value, 'sets') })} />
              <span className="text-gray-500 text-sm">×</span>
              <input type="text" inputMode="numeric" aria-label={`${e.name} reps`} className={`${box} w-12`}
                key={`reps:${key}:${i}:${d.reps}`} defaultValue={num(d.reps)}
                onBlur={ev => setDraft(key, i, e, { reps: numberFromInput(ev.target.value, 'reps') })} />
            </div>
          </div>
          <div className="shrink-0">
            <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Weight (kg)</p>
            <div className="flex items-center gap-1.5">
              <button type="button" aria-label={`${e.name}: less weight`} className={step}
                onClick={() => setDraft(key, i, e, { weight: stepWeight(d.weight, -1) })}>−</button>
              <input type="text" inputMode="decimal" aria-label={`${e.name} weight in kg`} className={`${box} w-16`} placeholder="–"
                key={`weight:${key}:${i}:${d.weight}`} defaultValue={num(d.weight)}
                onBlur={ev => setDraft(key, i, e, { weight: numberFromInput(ev.target.value, 'weight') })} />
              <button type="button" aria-label={`${e.name}: more weight`} className={step}
                onClick={() => setDraft(key, i, e, { weight: stepWeight(d.weight, 1) })}>+</button>
            </div>
          </div>
        </div>
        <p className="text-[11px] text-gray-500 mt-1">
          {last ? <>Last time: {logDetail(last) || '—'} · {formatDate(last.session_date, country, 'dayMonth')}</> : 'First time logging this exercise'}
        </p>
      </div>
    )
  }

  // "Mark done for <client>": saves a session for the client like the client's own Done ✓
  // (app/client/page.tsx handleLogDay), plus logged_by = the staff member saving it.
  // day/label are null for a text-only plan (saved without plan_day, like the client's Log tab).
  // plan null = a dojo session with no plan (Sessions tab → Log session; weekly_plan_id stays empty)
  const handleCoachLogDay = async (plan: Plan | null, day: PlanDay | null, label: string | null) => {
    setMarkError('')
    const minutes = parseInt(markForm.duration_minutes)
    if (!minutes || minutes <= 0) { setMarkError('Enter how many minutes they trained'); return }
    if (!markForm.session_date) { setMarkError('Pick the date'); return }
    setSavingMark(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setSavingMark(false); router.push('/login'); return }
    const tickKey = day && plan ? `${plan.id}:${day.day}` : ''
    const ticked = day ? coachTicks[tickKey] || [] : []
    // A backdated session goes to the plan covering its date (lib/adherence.ts linkForDate, 14 Nov)
    const link = linkForDate(plans, plan?.id ?? null, markForm.session_date, label)
    const row: Record<string, unknown> = {
      client_id: clientId,
      weekly_plan_id: link.weekly_plan_id,
      session_date: markForm.session_date,
      duration_minutes: minutes,
      notes: markForm.notes,
      plan_day: link.plan_day,
      logged_by: user.id,
      ...(day && ticked.length ? { exercises_done: exercisesDoneFor(day, ticked) } : {}),
    }
    let { data: session, error } = await supabase.from('logged_sessions').insert(row).select().single()
    // Columns added later in Supabase (exercises_done, plan_day, logged_by): if one is missing, save without it
    for (const col of ['exercises_done', 'plan_day', 'logged_by']) {
      if (error && col in row && new RegExp(col, 'i').test(error.message)) {
        delete row[col]
        ;({ data: session, error } = await supabase.from('logged_sessions').insert(row).select().single())
      }
    }
    if (error || !session) {
      setSavingMark(false)
      setMarkError('Could not save: ' + (error?.message || 'please try again'))
      return
    }
    if (markForm.star_rating > 0 && !isCoach) {
      await supabase.from('session_feedback').insert({ session_id: session.id, star_rating: markForm.star_rating, admin_feedback: null })
    }
    // Weight / reps of the ticked exercises (#80), after the session. If this fails the session stays
    // saved and the weights can be retried on their own (weightsBanner).
    let weightsErr = ''
    if (exerciseLogsOn && day && tickKey && ticked.length && companyId) {
      const shown = ticked.filter(i => day.exercises[i])
      const drafts: Record<number, LogDraft> = Object.fromEntries(shown.map(i => [i, draftFor(tickKey, i, day.exercises[i])]))
      const rows = rowsToSave({ exercises: day.exercises, ticked: shown, drafts, sessionId: session.id, clientId, companyId, loggedBy: user.id, library: exLibrary })
      weightsErr = await insertWeights(rows)
      setWeightsRetry(weightsErr ? { key: tickKey, rows, error: weightsErr } : null)
    }
    if (tickKey) saveDayDrafts(tickKey, null) // saved with the session now (or kept in weightsRetry)
    setSavingMark(false)
    closeMarkForm()
    setMarkForm(coachDraft())
    if (tickKey) setDayTicks(tickKey, []) // saved with the session now
    if (plan) setLastMarked({ key: `${plan.id}:${day?.day ?? ''}`, session: session as Session })
    if (weightsErr) showToast(`${day ? day.day : 'Session'} saved, but the weights weren't. Tap Retry under the day.`, 'error')
    else if (link.moved) showToast(`✓ Saved on ${formatDate(markForm.session_date, country, 'weekday')}, ${link.weekStart ? `in the plan for the week of ${formatDate(link.weekStart, country, 'dayMonth')}` : 'a week with no plan'}`)
    else showToast(`✓ ${day ? day.day : 'Session'} ${plan ? 'done' : 'logged'} for ${clientFirstName}`)
    loadData(['sessions'])
  }

  // Shared insert for both the manual form and the AI panel.
  // Only clears/closes the form when the database confirms the save.
  const insertPlan = async (plan: { week_start: string; plan_details: string; workout_time: string; plan_json?: PlanJson | null }, opts?: { toast?: string; errorToast?: boolean }) => {
    if (!plan.week_start || !plan.plan_details.trim()) {
      setPlanError('Pick a week and add plan details before saving.')
      return false
    }
    setSaving(true)
    setPlanError('')
    const row = {
      client_id: clientId,
      week_start: plan.week_start,
      plan_details: plan.plan_details,
      workout_time: plan.workout_time || null,
    }
    let { data: inserted, error } = await supabase.from('weekly_plans')
      .insert(plan.plan_json ? { ...row, plan_json: plan.plan_json } : row).select('id').single()
    // If the plan_json column hasn't been added in Supabase yet, save the text plan alone
    if (error && plan.plan_json && /plan_json/i.test(error.message)) {
      ;({ data: inserted, error } = await supabase.from('weekly_plans').insert(row).select('id').single())
    }
    setSaving(false)
    if (error) {
      setPlanError('Could not save the plan: ' + error.message)
      if (opts?.errorToast) showToast('Could not save the plan: ' + error.message, 'error')
      return false
    }
    // Briefly highlight the new card so the coach sees where it went
    if (inserted?.id) {
      setHighlightPlanId(inserted.id)
      setScrollToPlanId(inserted.id)
      setTimeout(() => setHighlightPlanId(null), 4000)
    }
    showToast(opts?.toast ?? `✓ Plan assigned for week of ${formatDate(plan.week_start, country, 'dayMonth')}`)
    loadData(['plans'])
    return true
  }

  // Copy a plan's days to a new week (new row, so no days are done and no ticks carry over)
  const copyPlanTo = (plan: Plan, start: string) => {
    const json = planJsonOf(plan)
    return insertPlan({
      week_start: start,
      plan_details: json ? planToText(json) : plan.plan_details,
      workout_time: plan.workout_time || '',
      plan_json: json,
    }, { toast: `✓ Plan copied to week of ${formatDate(start, country, 'dayMonth')}`, errorToast: true })
  }

  // + New plan sheet. Week starts today when no plan covers today, else the day after this week's plan ends.
  const openNewPlanSheet = () => {
    const cur = currentPlan(plans)
    setSheetWeek(cur ? isoAdd(cur.week_start, 7) : localToday())
    setPlanError('')
    setAiError('')
    setPlanMenuId(null)
    setNewPlanSheetOpen(true)
  }
  // The manual builder (day-by-day editor), for the week picked in the sheet
  const openManualBuilder = (week: string) => {
    setPlanError('')
    setAiError('')
    setShowGeneratedPlan(false)
    setNewPlan(prev => ({ ...prev, week_start: week || prev.week_start || nextMonday() }))
    // Start from the client's available days as workout days
    setNewPlanJson(prev => prev ?? emptyPlan(client?.available_days))
    setNewPlanTextMode(false)
    setShowPlanForm(true)
  }

  // Cleans a structured plan for saving; null (with an error shown) if it has no workout yet
  const readyToSave = (plan: PlanJson): PlanJson | null => {
    const cleaned = cleanPlan(plan)
    if (workoutDays(cleaned).length === 0 || !cleaned.days.some(d => !d.rest && d.exercises.length)) {
      setPlanError('Add at least one workout day with an exercise.')
      return null
    }
    return cleaned
  }

  const handleAddPlan = async () => {
    let ok = false
    if (!newPlanTextMode && newPlanJson) {
      if (!newPlan.week_start) { setPlanError('Pick the week first.'); return }
      const cleaned = readyToSave(newPlanJson)
      if (!cleaned) return
      ok = await insertPlan({ ...newPlan, plan_details: planToText(cleaned), plan_json: cleaned })
    } else {
      ok = await insertPlan(newPlan)
    }
    if (ok) {
      setNewPlan({ week_start: '', plan_details: '', workout_time: '' })
      setNewPlanJson(null)
      setNewPlanTextMode(false)
      setShowPlanForm(false)
    }
  }

  // Pasted text → days for the editor (coach checks the result)
  const convertTextToDays = (text: string, apply: (p: PlanJson) => void) => {
    const parsed = textToPlan(text, client?.available_days)
    if (!parsed) {
      setPlanError('Could not find day headings (like "Monday – Legs" or "Day 1 – Legs"). Add the days by hand, or save it as text.')
      return false
    }
    setPlanError('')
    apply(parsed)
    showToast('Converted to days ✓ Check each day before saving')
    return true
  }

  const handleAssignGeneratedPlan = async () => {
    let ok = false
    if (generatedJson) {
      const cleaned = readyToSave(generatedJson)
      if (!cleaned) return
      ok = await insertPlan({ ...aiPlanMeta, plan_details: planToText(cleaned), plan_json: cleaned })
    } else {
      ok = await insertPlan({ ...aiPlanMeta, plan_details: generatedPlan })
    }
    if (ok) {
      setGeneratedPlan('')
      setGeneratedJson(null)
      setAiPlanMeta({ week_start: '', workout_time: '' })
      setShowGeneratedPlan(false)
    }
  }

  // Plan dates are stored as YYYY-MM-DD; formatDate parses them as local
  // dates (no day shift in the US) and uses the company's country format.
  const formatWeekStart = (d: string) => formatDate(d.slice(0, 10), country, 'long')

const handleUpdatePlan = async () => {
  if (!editingPlan) return
  let cleaned: PlanJson | null = null
  if (editingJson) {
    if (!editingPlan.week_start) { setPlanError('Pick the week first.'); return }
    cleaned = readyToSave(editingJson)
    if (!cleaned) return
  } else if (!editingPlan.week_start || !editingPlan.plan_details.trim()) {
    setPlanError('Pick a week and add plan details before saving.')
    return
  }
  setSaving(true)
  setPlanError('')
  const base = {
    week_start: editingPlan.week_start,
    plan_details: cleaned ? planToText(cleaned) : editingPlan.plan_details,
    workout_time: editingPlan.workout_time || null,
  }
  // Structured: save the days; text edit of a plan that had days: clear them so the text shows
  const withJson = cleaned ? { ...base, plan_json: cleaned } : editingPlan.plan_json ? { ...base, plan_json: null } : base
  // .select() so an update blocked by database rules (0 rows, no error) isn't reported as saved
  let { data: updated, error } = await supabase.from('weekly_plans').update(withJson).eq('id', editingPlan.id).select('id')
  // If the plan_json column hasn't been added in Supabase yet, save the text alone
  if (error && /plan_json/i.test(error.message)) {
    ;({ data: updated, error } = await supabase.from('weekly_plans').update(base).eq('id', editingPlan.id).select('id'))
  }
  setSaving(false)
  if (error) {
    setPlanError('Could not save changes: ' + error.message)
    return
  }
  if (!updated?.length) {
    setPlanError("Couldn't save: not allowed for this login")
    return
  }
  const editedId = editingPlan.id
  setEditingPlan(null)
  setEditingJson(null)
  setScrollToPlanId(editedId)
  setHighlightPlanId(editedId)
  setTimeout(() => setHighlightPlanId(prev => (prev === editedId ? null : prev)), 4000)
  loadData(['plans'])
  showToast('Plan updated ✓')
}

const handleDeletePlan = async (planId: string) => {
  if (!confirm('Delete this plan? This cannot be undone.')) return
  setDeletingPlanId(planId)
  const { error } = await supabase
    .from('weekly_plans')
    .delete()
    .eq('id', planId)
  setDeletingPlanId(null)
  if (error) {
    showToast('Could not delete the plan: ' + error.message, 'error')
    return
  }
  loadData(['plans'])
  showToast('Plan deleted')
}


const handleGenerateDiet = async () => {
  setDietGenerating(true)
  setDietError('')
  setDietDraft('')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 60000)
  try {
    const response = await fetch('/api/generate-diet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({ clientId }),
    })
    let data: { diet?: string; error?: string } = {}
    try { data = await response.json() } catch { /* non-JSON, e.g. server timeout page */ }
    if (response.ok && data.diet) {
      setDietDraft(data.diet)
      setTimeout(() => dietPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
    } else {
      setDietError('Could not create a diet chart' + (data.error ? ': ' + data.error : '. Please try again.'))
    }
  } catch {
    setDietError(controller.signal.aborted ? 'The AI took too long (over 60 seconds). Please try again.' : 'Network problem. Check your connection and try again.')
  } finally {
    clearTimeout(timer)
    setDietGenerating(false)
  }
}

const handleSaveDiet = async () => {
  if (!dietDraft.trim()) return
  setSavingDiet(true)
  const { error } = await supabase.from('profiles').update({ diet_plan: dietDraft.trim() }).eq('id', clientId)
  setSavingDiet(false)
  if (error) {
    showToast('Could not save the diet chart: ' + error.message, 'error')
    return
  }
  setDietDraft('')
  showToast('Diet chart saved ✓')
  loadData(['client'])
}

const handleSaveClientProfile = async () => {
  setSavingClientProfile(true)
  // Dojo branch / home batch: through update-client (checks gym and branch on the server), only when changed
  if (dojo && batchesOn && client && 'batch_id' in client
      && ((clientProfileForm.branch_id || null) !== (client.branch_id || null) || (clientProfileForm.batch_id || null) !== (client.batch_id || null))) {
    const response = await fetch('/api/update-client', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: clientId, branch_id: clientProfileForm.branch_id || null, batch_id: clientProfileForm.batch_id || null })
    })
    const result = await response.json().catch(() => ({ error: "Couldn't save" }))
    if (result.error) {
      setSavingClientProfile(false)
      showToast("Couldn't save the batch: " + result.error, 'error')
      return
    }
  }
  // Belt + since when: through update-client (checks the belt, writes the history row), only when changed
  if (beltsOn && client
      && ((clientProfileForm.rank_id || null) !== (client.current_rank_id || null)
          || (clientProfileForm.belt_since || null) !== (client.rank_achieved_on || null))) {
    if (!clientProfileForm.rank_id && clientProfileForm.belt_since) {
      setSavingClientProfile(false)
      showToast('Pick the belt first, then the date', 'error')
      return
    }
    const response = await fetch('/api/update-client', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: clientId, current_rank_id: clientProfileForm.rank_id || null, rank_achieved_on: clientProfileForm.belt_since || null })
    })
    const result = await response.json().catch(() => ({ error: "Couldn't save" }))
    if (result.error) {
      setSavingClientProfile(false)
      showToast("Couldn't save the belt: " + result.error, 'error')
      return
    }
    if (result.warning) showToast(result.warning, 'error')
  }
  // Parent / guardian: saved through update-client (checks the phone on the server), only once the columns exist
  if (client && 'guardian_phone' in client) {
    const raw = clientProfileForm.guardian_phone.trim()
    let parentPhone = ''
    if (raw) {
      const parts = splitE164(raw.startsWith('+') ? raw : clientPhoneValue(phoneCountry(client.country || country), raw), country)
      if (!parts) {
        setSavingClientProfile(false)
        showToast('Enter a valid parent phone number, or leave it empty', 'error')
        return
      }
      parentPhone = toE164(parts.country, parts.local)
    }
    const response = await fetch('/api/update-client', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: clientId,
        guardian_name: clientProfileForm.guardian_name,
        guardian_phone: parentPhone,
        guardian_relation: clientProfileForm.guardian_relation,
      })
    })
    const result = await response.json().catch(() => ({ error: "Couldn't save" }))
    if (result.error) {
      setSavingClientProfile(false)
      showToast("Couldn't save parent details: " + result.error, 'error')
      return
    }
  }
  const { error: profileError } = await supabase
    .from('profiles')
    .update({
      trainer_name: clientProfileForm.trainer_name || null,
      diet_plan: clientProfileForm.diet_plan || null,
      goal: clientProfileForm.goal || null,
      age: clientProfileForm.age ? parseInt(clientProfileForm.age) : null,
      gender: clientProfileForm.gender || null,
      height_cm: clientProfileForm.height_cm ? parseFloat(clientProfileForm.height_cm) : null,
      weight_kg: clientProfileForm.weight_kg ? parseFloat(clientProfileForm.weight_kg) : null,
      fitness_level: clientProfileForm.fitness_level || null,
      food_preference: clientProfileForm.food_preference || null,
      meals_per_day: clientProfileForm.meals_per_day ? parseInt(clientProfileForm.meals_per_day) : null,
      available_days: clientProfileForm.available_days || null,
      medical_conditions: clientProfileForm.medical_conditions || null,
      emergency_contact_name: clientProfileForm.emergency_contact_name || null,
      emergency_contact_phone: clientProfileForm.emergency_contact_phone || null,
    })
    .eq('id', clientId)
  if (profileError) {
    setSavingClientProfile(false)
    showToast('Could not save profile: ' + profileError.message, 'error')
    return
  }
  setClientProfileMessage('Saved! ✓')
  showToast('Profile saved ✓')
  setSavingClientProfile(false)
  setEditingClientProfile(false)
  setTimeout(() => setClientProfileMessage(''), 3000)
  loadData(['client'])
}

const handleGeneratePlan = async () => {
  setGeneratingPlan(true)
  setShowGeneratedPlan(false)
  setGeneratedPlan('')
  setScheduleNotes([])
  setShowPlanForm(false)
  setPlanError('')
  setAiError('')

  const controller = new AbortController()
  aiAbort.current = controller
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; controller.abort() }, 60000)

  try {
    const response = await fetch('/api/generate-plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        profile: {
          ...client,
          business_type: (client as any)?.companies?.business_type || 'gym'
        }
      })
    })

    let data: { plan?: string; plan_json?: unknown; scheduleNotes?: string[]; error?: string; aiPlans?: { used: number; limit: number; resetsOn: string } | null } = {}
    try { data = await response.json() } catch { /* non-JSON, e.g. server timeout page */ }
    if (data.aiPlans) setAiPlans(data.aiPlans)

    if (response.ok && data.plan) {
      setGeneratedPlan(data.plan)
      setGeneratedJson(data.plan_json ? planJsonOf({ plan_json: data.plan_json }) : null)
      setScheduleNotes(Array.isArray(data.scheduleNotes) ? data.scheduleNotes.filter(n => typeof n === 'string') : [])
      setAiPlanMeta(prev => ({ ...prev, week_start: prev.week_start || nextMonday() }))
      setShowGeneratedPlan(true)
    } else if (response.status === 429) {
      setAiError(data.error || 'All AI plans for this client are used this month. You can still write a plan by hand.')
    } else if (response.status === 504) {
      setAiError('The AI took too long to respond. Please try again.')
    } else {
      setAiError('Could not generate a plan' + (data.error ? ': ' + data.error : '. Please try again.'))
    }
  } catch {
    if (controller.signal.aborted) {
      setAiError(timedOut ? 'The AI took too long (over 60 seconds). Please try again.' : '')
    } else {
      setAiError('Network problem — check your connection and try again.')
    }
  } finally {
    clearTimeout(timer)
    aiAbort.current = null
    setGeneratingPlan(false)
  }
}

const cancelGeneratePlan = () => {
  aiAbort.current?.abort()
}


  const handleSaveFeedback = async (sessionId: string) => {
    const existing = feedback.find(f => f.session_id === sessionId)
    if (existing) {
      await supabase.from('session_feedback')
        .update({ admin_feedback: feedbackText[sessionId] })
        .eq('id', existing.id)
    } else {
      await supabase.from('session_feedback').insert({
        session_id: sessionId,
        admin_feedback: feedbackText[sessionId],
        star_rating: null
      })
    }
    setSavedFeedback(prev => ({ ...prev, [sessionId]: true }))
    setTimeout(() => setSavedFeedback(prev => ({ ...prev, [sessionId]: false })), 2000)
    loadData(['sessions'])
  }

const handleResetPassword = async () => {
  setResetting(true)
  setResetMessage('')

  const response = await fetch('/api/reset-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId: clientId,
      newPassword: newPassword
    })
  })

  const result = await response.json()
  if (result.error) {
    setResetMessage('Error: ' + result.error)
  } else {
    setResetMessage('Password reset successfully! ✓')
    showToast('Password reset ✓')
    setNewPassword('')
    setTimeout(() => {
      setShowResetPassword(false)
      setResetMessage('')
    }, 2000)
  }
  setResetting(false)
}



  // Give a no-login client a username + password (the same Auth user gets a real login; nothing is deleted)
  const handleCreateLogin = async () => {
    if (createLoginStatus === 'taken') { setCreateLogin({ ...createLogin, error: 'That username is taken. Pick one of the suggestions' }); return }
    if (createLogin.password.length < 6) { setCreateLogin({ ...createLogin, error: 'Password must be at least 6 characters' }); return }
    setCreateLogin({ ...createLogin, saving: true, error: '' })
    const response = await fetch('/api/create-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: clientId, username: createLogin.username, password: createLogin.password })
    })
    const result = await response.json().catch(() => ({ error: 'Network error' }))
    if (!response.ok || result.error) { setCreateLogin({ ...createLogin, saving: false, error: result.error || `Couldn't create the login (${response.status})` }); return }
    showToast(`Login created ✓ ${result.username}`)
    setShowCreateLogin(false)
    setCreateLogin({ username: '', password: '', saving: false, error: '' })
    loadData(['client'])
  }

  const getFeedback = (sessionId: string) => feedback.find(f => f.session_id === sessionId)

  // Phone as saved: +<code><digits> (lib/phone.ts). Typed with a + : read as is; otherwise with the picked / home code.
  const phoneToSave = () => {
    const raw = editClientForm.phone.trim()
    if (raw.startsWith('+')) {
      const parts = splitE164(raw, country)
      return parts ? toE164(parts.country, parts.local) : raw
    }
    return clientPhoneValue(multiCountry ? editClientForm.phone_country : editClientForm.phone_country || (country ?? 'IN'), raw)
  }

  const handleEditClient = async () => {
    setSavingEdit(true)
    setEditMessage('')
    const response = await fetch('/api/update-client', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: clientId, full_name: editClientForm.full_name, phone: phoneToSave(),
        // Multi-country gyms only: the client's own country and default currency (old payments keep theirs)
        ...(multiCountry ? { country: editClientForm.country, currency: editClientForm.currency || baseCurrency } : {})
      })
    })
    const result = await response.json()
    if (result.error) {
      setSavingEdit(false)
      setEditMessage('Error: ' + result.error)
      return
    }
    await supabase.from('profiles').update({ client_type: dojo ? 'pt' : editClientForm.client_type }).eq('id', clientId)
    setSavingEdit(false)
    setEditMessage('Saved! ✓')
    showToast(`${memberWord((client as { companies?: { business_type?: string | null } } | null)?.companies?.business_type).one} updated ✓`)
    loadData(['client'])
    setTimeout(() => { setShowEditClient(false); setEditMessage('') }, 1000)
  }

  const todayLocal = () => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }

  // A renewal starts when the current membership ends (if it hasn't ended yet), otherwise today
  const renewalStartDate = () => {
    const latest = memberships[0]
    const today = todayLocal()
    return latest?.end_date && latest.end_date > today ? latest.end_date : today
  }

  const switchMembershipMode = (mode: 'renew' | 'correct') => {
    const latest = memberships[0]
    setMembershipMode(mode)
    setMembershipMessage('')
    if (mode === 'correct' && latest) {
      setEditClientForm(prev => ({
        ...prev,
        plan_type: latest.plan_type,
        amount_paid: latest.amount_paid?.toString() || '',
        start_date: latest.start_date,
        end_date: latest.end_date,
      }))
    } else {
      setEditClientForm(prev => ({ ...prev, start_date: renewalStartDate() }))
    }
  }

  const handleRenewMembership = async () => {
    if (!companyId) return
    if (!editClientForm.start_date || !editClientForm.end_date) {
      showToast('Pick a start date for the renewal', 'error')
      return
    }
    setSavingMembership(true)
    const { error: renewError } = await supabase.from('memberships').insert({
      profile_id: clientId,
      company_id: companyId,
      plan_type: editClientForm.plan_type,
      amount_paid: parseFloat(editClientForm.amount_paid) || 0,
      start_date: editClientForm.start_date,
      end_date: editClientForm.end_date,
      // Carries the latest membership's currency forward unless changed (multi-country picker)
      ...(currencyColumns ? { currency: editClientForm.membership_currency || renewalCurrency() } : {})
    })
    if (renewError) {
      setSavingMembership(false)
      showToast('Could not renew: ' + renewError.message, 'error')
      return
    }
    if (client?.archived_at) {
      await supabase.from('profiles').update({ archived_at: null }).eq('id', clientId)
    }
    setMembershipMessage('')
    showToast(`Membership renewed ✓ ${formatDate(editClientForm.start_date, country, 'dayMonth')} → ${formatDate(editClientForm.end_date, country, 'medium')}`)
    setSavingMembership(false)
    // Close the edit panel so the updated membership card is what the coach sees
    setShowEditClient(false)
    window.scrollTo({ top: 0, behavior: 'smooth' })
    setTimeout(() => setMembershipMessage(''), 3000)
    loadData(['memberships', 'client'])
  }

  const handleCorrectMembership = async () => {
    const latest = memberships[0]
    if (!latest) return
    setSavingMembership(true)
    // Never sends a currency: a saved payment's currency can't change (trigger protect_membership_currency)
    const { error: correctError } = await supabase.from('memberships').update({
      plan_type: editClientForm.plan_type,
      amount_paid: parseFloat(editClientForm.amount_paid) || 0,
      start_date: editClientForm.start_date,
      end_date: editClientForm.end_date
    }).eq('id', latest.id)
    if (correctError) {
      setSavingMembership(false)
      showToast('Could not save the correction: ' + correctError.message, 'error')
      return
    }
    setMembershipMessage('')
    showToast('Membership corrected ✓')
    setSavingMembership(false)
    setShowEditClient(false)
    window.scrollTo({ top: 0, behavior: 'smooth' })
    setTimeout(() => setMembershipMessage(''), 3000)
    loadData(['memberships'])
  }

  const handleDeleteClient = async () => {
    if (!confirm(`Delete ${client?.full_name}? This will remove all their data and cannot be undone.`)) return
    setDeletingClient(true)
    await fetch('/api/delete-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: clientId })
    })
    router.push('/company')
  }

  const handleArchiveClient = async () => {
    if (!confirm(`Archive ${client?.full_name}? They will be hidden from the dashboard but all data is kept.`)) return
    await supabase.from('profiles').update({ archived_at: new Date().toISOString() }).eq('id', clientId)
    router.push('/company')
  }

  // Primary coach (owner and partners only; saved through update-client, which checks the coach)
  const handleSavePrimaryCoach = async (coachId: string) => {
    setSavingPrimaryCoach(true)
    const response = await fetch('/api/update-client', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: clientId, primary_coach_id: coachId || null })
    })
    const result = await response.json().catch(() => ({ error: 'Network error' }))
    setSavingPrimaryCoach(false)
    if (!response.ok || result.error) { showToast("Couldn't save: " + (result.error || response.status), 'error'); return }
    const word = staffWord((client as { companies?: { business_type?: string | null } } | null)?.companies?.business_type).one
    showToast(coachId ? `Primary ${word.toLowerCase()}: ${staff.find(x => x.id === coachId)?.full_name || ''} ✓` : `No primary ${word.toLowerCase()} ✓`)
    loadData(['client'])
  }

  const handleUnarchiveClient = async () => {
    await supabase.from('profiles').update({ archived_at: null }).eq('id', clientId)
    loadData(['client'])
  }

  const getChartData = () => {
    if (sessions.length === 0) return null
    // Last 8 Monday–Sunday weeks, empty weeks as 0 (same weeks as the PDF report)
    const weeks = weeklyTotals(sessions, localDateIso(), 8)
    return {
      labels: weeks.map(w => formatDate(w.start, country, 'dayMonth')),
      sessionCounts: weeks.map(w => w.sessions),
      minuteCounts: weeks.map(w => w.minutes),
    }
  }

  // null until the client/company row has loaded, so dates don't flash the wrong format
  // #37: this client's AI plans for the month are used up (the server refuses a 6th as well)
  const aiPlansUsedUp = !!aiPlans && aiPlans.used >= aiPlans.limit
  const country: Country | null = client ? normalizeCountry((client as { companies?: { country?: string | null } }).companies?.country) : null
  // Train module on for this gym (Plans / Sessions / Progress tabs for PT clients)
  const trainModule = !!(client as { companies?: { client_module_enabled?: boolean | null } } | null)?.companies?.client_module_enabled
  const chartData = getChartData()
  // "Log today's session" bar: today's workout day of this week's plan (or this week's text plan).
  // Hidden when there is nothing to log today (no plan this week, or today is a rest day).
  const todayLog = (() => {
    if (client?.client_type !== 'pt' || !trainModule || dojo) return null
    const cur = currentPlan(plans)
    if (!cur) return null
    const json = planJsonOf(cur)
    if (!json) return { plan: cur, day: null as string | null, label: 'Log today\'s session' }
    const d = json.days.find(x => x.day === todayWeekday())
    if (!d || d.rest) return null
    return { plan: cur, day: d.day as string | null, label: `Log today's session · ${d.focus || 'Workout'}` }
  })()
  const openTodayLog = () => {
    if (!todayLog) return
    const key = `${todayLog.plan.id}:${todayLog.day ?? ''}`
    setActiveTab('plans')
    setNewPlanSheetOpen(false)
    if (todayLog.day) setCoachOpenDay(todayLog.day)
    // A day already done asks before logging a second session (same as under the day)
    if (todayLog.day && doneDayKeys(todayLog.plan.id, countSessions).has(todayLog.day)) { setMarkError(''); setMarkAgainKey(key) }
    else openMarkForm(key)
    setScrollToPlanId(todayLog.plan.id)
  }
  const totalMinutes = sessions.reduce((sum, s) => sum + (s.duration_minutes || 0), 0)
  // null until the client/company row has loaded; INR only if the company's currency is empty
  const currency: string | null = client ? ((client as any).companies?.currency || 'INR') : null
  const baseCurrency = normalizeCurrency(currency)
  // Multi-country gyms (super admin switch, db/2026-11-01-multi-country.md): client country / currency fields
  const gym = (client as { companies?: { multi_country_enabled?: boolean | null; allowed_currencies?: string[] | null } } | null)?.companies
  const multiCountry = !!gym?.multi_country_enabled
  const currencyColumns = !!gym && 'allowed_currencies' in gym
  const allowedCurrencies = gym?.allowed_currencies?.length ? gym.allowed_currencies : [baseCurrency]
  // A renewal's currency: the latest membership's, else the client's, else the gym's base currency
  const renewalCurrency = () => memberships[0]?.currency || client?.currency || baseCurrency
  // Every amount in its own row's currency
  const moneyOf = (m: Membership) => formatMoney(Number(m.amount_paid), currency === null ? null : (m.currency || currency))

  // ---- Share progress on WhatsApp ----
  const company = (client as { companies?: { name?: string | null; business_type?: string | null } } | null)?.companies
  // The week being shared is always Monday–Sunday, like the Progress charts and "Calories since Mon"
  // (decided 28 Oct). Days done of the plan come from the plan covering today (or a day a week ago).
  const shareWeekPlan = () => {
    const weekStart = shareWeek === 'this' ? weekStartIso : lastWeekStartIso
    return { plan: planForWeek(plans, weekStart), weekStart }
  }
  const shareMessage = () => {
    // Dojo with attendance: classes attended this / last month instead of the session week
    if (attendanceMode && client) {
      const today = localDateIso()
      return buildAttendanceMessage({
        client, companyName: company?.name || '', staffName: coachName, rows: attRows,
        homeBatch: batchList.find(b => b.id === client.batch_id) ?? null, today,
        month: shareWeek === 'this' ? today : addDays(monthRange(today).from, -1), since: client.created_at ?? null, note: shareNote, country,
      })
    }
    const { plan, weekStart } = shareWeekPlan()
    return buildProgressMessage({
      client: (client || { full_name: '', phone: null }) as ShareClient,
      companyName: company?.name || '',
      businessType: company?.business_type,
      coachName,
      plan,
      sessions: countSessions,
      weekStart,
      note: shareNote,
      country: country ?? 'IN',
    })
  }
  // PDF of the week (numbers, the message as edited, charts of the last 8 weeks) to send any way
  const handleDownloadPdf = async (text: string) => {
    if (!client) return
    setMakingPdf(true)
    try {
      const { plan, weekStart } = shareWeekPlan()
      const week = summarizeWeek({ plan, sessions: countSessions, weekStart, weightKg: client.weight_kg, businessType: company?.business_type })
      // Last 4 Monday weeks up to this week, counted like the week card (lib/progress-share.ts)
      const four = recentWeeksAdherence({ plans, sessions: countSessions, weekStart })
      const { downloadProgressPdf } = await import('@/lib/progress-pdf')
      const safeName = client.full_name.trim().replace(/[^\w]+/g, '-').replace(/^-|-$/g, '') || 'client'
      await downloadProgressPdf({
        companyName: company?.name || '', clientName: client.full_name, weekStart, country: country ?? 'IN',
        text, week, fourWeeks: four, totals: weeklyTotals(sessions, weekStart, 8), // same weeks as the Progress tab
        // The day-by-day plan only when the coach leaves "Include the week's plan" on
        plan: (() => { const json = plan && pdfIncludePlan ? planJsonOf(plan) : null; return plan && json ? { weekStart, json } : null })(), // the report's Monday week (14 Nov: a Sunday-start plan read "Week of 8 Nov" under a "Week of 9 Nov" report)
        // Strength by exercise (#80): logs up to the report week's Sunday (or today, if that's earlier)
        strength: exerciseLogsOn ? strengthReport(datedLogs, exLibrary, [isoAdd(weekStart, 6), localDateIso()].sort()[0]) : null,
        showCalories: false, // decided 5 Nov: no calories in the PDF report (WhatsApp messages keep them)
      }, `${safeName}-progress-${weekStart}.pdf`)
      showToast('✓ PDF downloaded')
    } catch (e) {
      showToast('Could not make the PDF: ' + (e instanceof Error ? e.message : 'please try again'), 'error')
    }
    setMakingPdf(false)
  }
  // ---- Dojo attendance (#78) ----
  const homeBatch = batchList.find(b => b.id === client?.batch_id) ?? null
  const attendanceSummary = () => {
    const today = localDateIso()
    const since = client?.created_at ?? null
    const thisMonth = monthStats({ profileId: clientId, homeBatch, rows: attRows, month: today, today, since })
    const lastMonth = monthStats({ profileId: clientId, homeBatch, rows: attRows, month: addDays(monthRange(today).from, -1), today, since })
    return { thisMonth, lastMonth }
  }
  const renderAttendanceSummary = () => {
    const { thisMonth, lastMonth } = attendanceSummary()
    return (
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-gray-900 rounded-2xl p-4 border border-gray-800 text-center">
          <p className="text-2xl font-bold text-orange-500">{statsText(thisMonth).replace(/ class(es)?$/, '')}</p>
          <p className="text-xs text-gray-500 mt-1">Classes this month</p>
        </div>
        <div className="bg-gray-900 rounded-2xl p-4 border border-gray-800 text-center">
          <p className="text-2xl font-bold text-gray-300">{statsText(lastMonth).replace(/ class(es)?$/, '')}</p>
          <p className="text-xs text-gray-500 mt-1">Last month</p>
        </div>
      </div>
    )
  }
  // "Came today" for this student in their home batch (when it meets today), saved like a roll-call tap
  const toggleCameToday = async () => {
    if (!client || !homeBatch || !companyId) return
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const today = localDateIso()
    const current = attRows.some(r => r.batch_id === homeBatch.id && r.class_date === today && r.present)
    const row = tapRow({ batchId: homeBatch.id, date: today, student: { id: clientId, full_name: client.full_name, batch_id: client.batch_id }, companyId, current, markedBy: user.id })
    setSavingAtt(true)
    const { data, error } = await supabase.from('attendance')
      .upsert(row, { onConflict: 'batch_id,profile_id,class_date' }).select(ATTENDANCE_COLUMNS)
    setSavingAtt(false)
    if (error || !data?.length) { showToast(error ? 'Could not save: ' + error.message : "Couldn't save: not allowed for this login", 'error'); return }
    const saved = data[0] as AttendanceRow
    setAttRows(rs => [saved, ...rs.filter(r => !(r.batch_id === saved.batch_id && r.class_date === saved.class_date))])
    showToast(saved.present ? `✓ ${clientFirstName} came today` : `${clientFirstName} marked not here today`)
  }
  const renderAttendance = () => {
    const today = localDateIso()
    const meetsToday = homeBatch && batchesMeetingOn([homeBatch], today).length > 0
    const cameToday = homeBatch ? attRows.some(r => r.batch_id === homeBatch.id && r.class_date === today && r.present) : false
    const recent = attRows.filter(r => r.present).slice(0, 30)
    const batchName = (id: string) => batchList.find(b => b.id === id)?.name || 'Class'
    return (
      <>
        {renderAttendanceSummary()}
        {homeBatch ? (
          <div className="bg-gray-900 rounded-2xl px-5 py-4 border border-gray-800 space-y-3">
            <p className="text-xs text-gray-500">Home batch: <span className="text-white">{homeBatch.name}</span>{batchWhen(homeBatch, country) ? ` · ${batchWhen(homeBatch, country)}` : ''}</p>
            {meetsToday && (
              <button type="button" onClick={toggleCameToday} disabled={savingAtt} aria-pressed={cameToday}
                className={`w-full min-h-[48px] rounded-xl text-sm font-semibold transition disabled:opacity-50 ${cameToday ? 'bg-green-700 hover:bg-green-600 text-white' : 'bg-orange-500 hover:bg-orange-400 text-white'}`}>
                {cameToday ? `✓ Came today (tap to undo)` : `Mark came today · ${homeBatch.name}`}
              </button>
            )}
            <button type="button" data-nav onClick={() => router.push(`/company/attendance/${homeBatch.id}`)}
              className="w-full text-sm text-gray-300 border border-gray-700 hover:border-gray-500 rounded-xl py-2">
              Open {homeBatch.name} class list →
            </button>
          </div>
        ) : (
          <p className="bg-gray-900 rounded-2xl px-5 py-4 border border-gray-800 text-sm text-gray-400">No home batch yet: set it on the Profile tab. They can still be marked as a drop-in in any class.</p>
        )}
        <div className="bg-gray-900 rounded-2xl px-5 py-4 border border-gray-800">
          <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Classes attended</p>
          {recent.length === 0 ? <p className="text-sm text-gray-500">None yet.</p> : (
            <ul className="space-y-1.5">
              {recent.map(r => (
                <li key={`${r.batch_id}-${r.class_date}`} className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-white">{formatDate(r.class_date, country, 'weekday')}</span>
                  <span className="text-gray-400 truncate">{batchName(r.batch_id)}{r.is_drop_in ? ' · drop-in' : ''}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        {sessions.length > 0 && <p className="text-xs text-gray-500 uppercase tracking-wider pt-2">Sessions logged before attendance</p>}
      </>
    )
  }

  const renderShare = () => {
    if (!shareOpen) return (
      <button type="button" onClick={() => setShareOpen(true)}
        className="w-full bg-green-700 hover:bg-green-600 text-white text-sm font-medium py-2.5 rounded-xl transition">
        📤 Share progress
      </button>
    )
    const msg = shareMessage()
    const text = shareEdited ? shareText : msg.text
    return (
      <div ref={sharePanelRef} className="bg-gray-900 rounded-2xl p-4 border border-green-800 space-y-3 scroll-mt-4">
        <div className="flex justify-between items-center">
          <p className="text-sm font-semibold text-white">📤 Share progress on WhatsApp</p>
          <button type="button" onClick={() => setShareOpen(false)} aria-label="Close"
            className="text-gray-500 hover:text-white text-lg leading-none px-1">✕</button>
        </div>
        <div className="flex gap-1 bg-gray-800 p-1 rounded-xl">
          {(['this', 'last'] as const).map(w => (
            <button key={w} type="button" onClick={() => setShareWeek(w)}
              className={`flex-1 py-1.5 text-xs font-medium rounded-lg transition ${shareWeek === w ? 'bg-green-600 text-white' : 'text-gray-400 hover:text-white'}`}>
              {attendanceMode ? (w === 'this' ? 'This month' : 'Last month') : w === 'this' ? 'This week' : 'Last week'}
            </button>
          ))}
        </div>
        <textarea value={shareNote} onChange={e => setShareNote(e.target.value)} rows={2} maxLength={300}
          placeholder="Add a note (optional)"
          className="w-full bg-gray-800 text-white rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-green-600 border border-gray-700 text-sm resize-none" />
        <div>
          <div className="flex justify-between items-center mb-1">
            <label htmlFor="share-preview" className="text-xs text-gray-500 uppercase tracking-wider">Message</label>
            {shareEdited && (
              <button type="button" onClick={() => setShareEdited(false)}
                className="text-xs text-gray-400 hover:text-white underline underline-offset-2">Reset text</button>
            )}
          </div>
          <textarea id="share-preview" value={text} rows={12}
            onChange={e => { setShareText(e.target.value); setShareEdited(true) }}
            className="w-full bg-gray-800 text-white rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-green-600 border border-gray-700 text-sm" />
        </div>
        <p className="text-xs text-gray-400">
          {msg.toPhone ? <>To: <span className="text-white">{msg.toLabel}</span> · {maskPhone(msg.toPhone, country ?? 'IN')}</> : <span className="text-amber-400">No phone number on profile</span>}
        </p>
        <div className="flex gap-2">
          <button type="button" disabled={!msg.toPhone || !text.trim()}
            onClick={() => msg.toPhone && window.open(`https://wa.me/${msg.toPhone}?text=${encodeURIComponent(text)}`, '_blank')}
            className="flex-1 bg-green-600 hover:bg-green-500 text-white text-sm font-semibold py-2.5 rounded-xl transition disabled:opacity-40 disabled:cursor-not-allowed">
            Send on WhatsApp
          </button>
          <button type="button" disabled={!text.trim()}
            onClick={async () => {
              try { await navigator.clipboard.writeText(text); showToast('✓ Copied') }
              catch { showToast('Could not copy: select the text and copy it', 'error') }
            }}
            className="px-4 bg-gray-800 hover:bg-gray-700 text-white text-sm rounded-xl transition disabled:opacity-40">
            Copy text
          </button>
        </div>
        {!attendanceMode && (
          <div className="space-y-2">
            <label className="flex items-start gap-2.5 text-xs text-gray-300 cursor-pointer">
              <input type="checkbox" checked={pdfIncludePlan} onChange={e => choosePdfIncludePlan(e.target.checked)}
                className="mt-0.5 w-4 h-4 accent-green-600 shrink-0" />
              <span>
                Include the week&apos;s plan in the PDF
                <span className="block text-gray-500">Exercises with sets and weights, day by day. Off: daily summary and the strength table only.</span>
              </span>
            </label>
            <button type="button" disabled={makingPdf} onClick={() => handleDownloadPdf(text)}
              className="w-full bg-gray-800 hover:bg-gray-700 border border-gray-700 text-white text-sm font-medium py-2.5 rounded-xl transition disabled:opacity-50">
              {makingPdf ? 'Making PDF…' : '⬇ Download PDF (message + charts)'}
            </button>
          </div>
        )}
      </div>
    )
  }

  // Edit member panel (opens in Renew mode)
  const openEditClient = () => {
    const latest = memberships[0]
    const parts = splitE164(client?.phone, country)
    const clientCountry = normalizeCountry(client?.country || country)
    setEditClientForm({
      full_name: client?.full_name || '',
      // The number without its code (the code is in the picker / the gym's own); unreadable values as saved
      phone: parts ? (multiCountry || parts.country === phoneCountry(country) ? parts.local : displayPhone(client?.phone, country)) : client?.phone || '',
      phone_country: parts?.country ?? clientCountry,
      country: clientCountry,
      currency: client?.currency || baseCurrency,
      membership_currency: '',
      plan_type: latest?.plan_type || '1 Month',
      amount_paid: latest?.amount_paid?.toString() || '',
      // Opens in Renew mode: dates start after the current membership (or today)
      start_date: renewalStartDate(),
      end_date: '',
      client_type: client?.client_type || 'member'
    })
    setMembershipMode('renew')
    setMembershipMessage('')
    setShowEditClient(!showEditClient)
  }

  // Skeleton while loading, so the page appears instantly instead of a blank "Loading..."
  if (loading) return (
    <div className="min-h-screen bg-gray-950 text-white" aria-busy="true">
      <span className="sr-only" role="status">Loading client…</span>
      <div className="bg-gray-900 border-b border-gray-800 px-6 py-4 flex items-center gap-3">
        <div className="h-8 w-16 rounded-lg bg-gray-800 animate-pulse" />
        <div className="h-9 w-9 rounded-lg bg-gray-800 animate-pulse" />
        <div className="space-y-2">
          <div className="h-4 w-32 rounded bg-gray-800 animate-pulse" />
          <div className="h-3 w-24 rounded bg-gray-800/70 animate-pulse" />
        </div>
      </div>
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="h-28 rounded-2xl bg-gray-900 border border-gray-800 animate-pulse" />
          <div className="h-28 rounded-2xl bg-gray-900 border border-gray-800 animate-pulse" />
        </div>
        <div className="h-10 rounded-xl bg-gray-900 border border-gray-800 animate-pulse" />
        <div className="h-64 rounded-2xl bg-gray-900 border border-gray-800 animate-pulse" />
      </div>
    </div>
  )

  return (
    <div data-testid="page-client" className="min-h-screen bg-gray-950 text-white">
      {/* + New plan bottom sheet: AI, manual, or copy the latest plan to the chosen week */}
      {newPlanSheetOpen && client && (() => {
        const first = (client.full_name || '').trim().split(/\s+/)[0] || 'client'
        const aiOn = (client as { companies?: { ai_plans_enabled?: boolean | null } }).companies?.ai_plans_enabled !== false
        const left = aiPlans ? Math.max(0, aiPlans.limit - aiPlans.used) : null
        // Latest plan that has started (else the newest), for "Copy last week's plan"
        const started = plans.filter(p => p.week_start.slice(0, 10) <= localToday()).sort((x, y) => y.week_start.localeCompare(x.week_start))
        const source = started[0] ?? [...plans].sort((x, y) => y.week_start.localeCompare(x.week_start))[0]
        const close = () => setNewPlanSheetOpen(false)
        const option = 'w-full min-h-[64px] text-left rounded-2xl border px-4 py-3 transition disabled:opacity-50 disabled:cursor-not-allowed'
        return (
          <div className="fixed inset-0 z-[55] flex items-end justify-center" role="dialog" aria-modal="true" aria-labelledby="new-plan-title">
            <div className="absolute inset-0 bg-black/70" onClick={close} aria-hidden="true" />
            <div className="relative w-full max-w-2xl bg-gray-900 border-t border-gray-800 rounded-t-3xl shadow-2xl max-h-[90vh] overflow-y-auto pb-[env(safe-area-inset-bottom)]">
              <div className="pt-2 pb-1 flex justify-center touch-none cursor-grab"
                onTouchStart={e => { sheetDragY.current = e.touches[0].clientY }}
                onTouchMove={e => { if (sheetDragY.current !== null && e.touches[0].clientY - sheetDragY.current > 80) { sheetDragY.current = null; close() } }}
                onTouchEnd={() => { sheetDragY.current = null }}>
                <span className="w-10 h-1.5 rounded-full bg-gray-700" aria-hidden="true" />
              </div>
              <div className="px-5 pb-6">
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0 pt-2">
                    <h2 id="new-plan-title" className="text-lg font-bold text-white">New plan for {first}</h2>
                    {client.goal && <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">Goal: {client.goal}</p>}
                  </div>
                  <button type="button" onClick={close} aria-label="Close"
                    className="w-11 h-11 -mr-2 flex items-center justify-center text-gray-400 hover:text-white rounded-xl hover:bg-gray-800 transition text-lg">✕</button>
                </div>

                <label htmlFor="sheet-week" className="text-xs text-gray-500 mt-5 mb-1.5 block uppercase tracking-wider">Week starts</label>
                <input id="sheet-week" type="date" value={sheetWeek} onChange={e => setSheetWeek(e.target.value)}
                  className="w-full min-h-[44px] bg-gray-800 text-white rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm" />
                <p className="text-xs text-gray-400 mt-1">{sheetWeek ? `Covers ${formatDate(sheetWeek, country, 'weekday')} – ${formatDate(weekEnd(sheetWeek), country, 'weekday')} (7 days)` : 'Pick the first day of the plan'}</p>

                <div className="space-y-2 mt-5">
                  {aiOn && (
                    <button type="button" disabled={!sheetWeek || aiPlansUsedUp || generatingPlan}
                      onClick={() => { setAiPlanMeta(prev => ({ ...prev, week_start: sheetWeek })); close(); handleGeneratePlan() }}
                      className={`${option} bg-purple-950/40 border-purple-800 hover:border-purple-500`}>
                      <span className="flex items-center justify-between gap-3">
                        <span className="text-sm font-semibold text-white">✨ Generate with AI</span>
                        {left !== null && (
                          <span className={`text-[11px] shrink-0 ${aiPlansUsedUp ? 'text-amber-400' : 'text-purple-300'}`}>
                            {aiPlansUsedUp ? 'No AI plans left this month' : `${left} of ${aiPlans!.limit} left this month`}
                          </span>
                        )}
                      </span>
                      <span className="block text-xs text-gray-400 mt-1">
                        {aiPlansUsedUp && aiPlans
                          ? `More from ${formatDate(aiPlans.resetsOn, country, 'dayMonth')}. Building a plan by hand still works.`
                          : 'Uses goal, injuries and schedule from profile. You review before assigning.'}
                      </span>
                    </button>
                  )}
                  <button type="button" disabled={!sheetWeek || generatingPlan}
                    onClick={() => { close(); openManualBuilder(sheetWeek) }}
                    className={`${option} bg-gray-800/60 border-gray-700 hover:border-orange-500`}>
                    <span className="block text-sm font-semibold text-white">✍️ Build manually</span>
                    <span className="block text-xs text-gray-400 mt-1">Pick exercises from the list, set sets and reps per day.</span>
                  </button>
                  <button type="button" disabled={!sheetWeek || generatingPlan}
                    onClick={() => { close(); setCopyClientOpen(true) }}
                    className={`${option} bg-gray-800/60 border-gray-700 hover:border-orange-500`}>
                    <span className="block text-sm font-semibold text-white">📋 Copy from a client</span>
                    <span className="block text-xs text-gray-400 mt-1">Start from a plan you gave another client. You review before assigning.</span>
                  </button>
                </div>

                {source && (
                  <button type="button" disabled={!sheetWeek || saving}
                    onClick={async () => { if (await copyPlanTo(source, sheetWeek)) close() }}
                    className="w-full min-h-[44px] mt-3 text-sm text-orange-400 hover:text-orange-300 disabled:opacity-50">
                    {saving ? 'Copying…' : 'Copy last week\'s plan instead'}
                    <span className="block text-[11px] text-gray-500">From {formatDate(source.week_start.slice(0, 10), country, 'dayMonth')} – {formatDate(weekEnd(source.week_start), country, 'dayMonth')}</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        )
      })()}
      {/* New plan → Copy from a client: the picked plan opens in the manual builder for the chosen week */}
      <PlanCopySheet open={copyClientOpen} onClose={() => setCopyClientOpen(false)}
        onPick={(plan, from) => {
          openManualBuilder(sheetWeek)
          setNewPlanJson({ ...plan, days: plan.days.map(d => ({ ...d, exercises: d.exercises.map(e => ({ ...e })) })) })
          setCopyClientOpen(false)
          showToast(`Copied from ${from} ✓ Check it, then save`)
        }}
        currentClientId={clientId} country={country ?? 'IN'} />
      {toast && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center px-6 pointer-events-none">
          <div role="status"
            className={`min-w-[280px] max-w-sm text-center px-10 py-6 rounded-2xl text-lg font-semibold shadow-2xl ring-1 ring-black/20 ${toast.kind === 'success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'}`}>
            {toast.text}
          </div>
        </div>
      )}
      {/* Header: back, name, coach · joined, ⋯ member actions, goal + membership chips */}
      {(() => {
        const coachLabel = client?.primary_coach_id
          ? (client.primary_coach_id === viewerId ? 'You' : staff.find(x => x.id === client.primary_coach_id)?.full_name || client?.trainer_name || sw.one)
          : client?.trainer_name || ''
        const joined = client?.created_at ? formatDate(client.created_at, country, 'monthYear') : ''
        const metaLine = [
          !coachCompany && (coachLabel ? `${sw.one}: ${coachLabel}` : `No ${sw.one.toLowerCase()}`),
          joined && `Joined ${joined}`,
        ].filter(Boolean).join(' · ')
        const m = memberships[0]
        const mDays = m ? daysLeftFromDate(m.end_date) : null
        const mEnd = m ? formatDate(m.end_date, country, 'dayMonth') : ''
        const mChip = m && mDays !== null
          ? mDays < 0 ? { dot: 'bg-red-500', text: `Expired ${mEnd}`, cls: 'text-red-300 border-red-900' }
            : mDays <= 11 ? { dot: 'bg-amber-500', text: `Expiring ${mEnd}`, cls: 'text-amber-300 border-amber-900' }
            : { dot: 'bg-green-500', text: `Active till ${mEnd}`, cls: 'text-green-300 border-green-900' }
          : null
        const menuItem = 'w-full text-left px-4 min-h-[44px] text-sm hover:bg-gray-800 transition flex items-center'
        return (
          <div className="bg-gray-900 border-b border-gray-800">
            <div className="max-w-2xl mx-auto px-4 sm:px-6 pt-3 pb-4">
              <div className="flex items-start gap-2">
                <button data-nav onClick={() => router.push(isCoach ? '/coach' : '/company')} aria-label="Back"
                  className="shrink-0 w-11 h-11 -ml-2 flex items-center justify-center text-gray-400 hover:text-white rounded-xl transition text-xl">
                  ←
                </button>
                <div className="flex-1 min-w-0 pt-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h1 className="text-2xl font-bold text-white leading-tight break-words">{client?.full_name}</h1>
                    {client?.client_type === 'pt' && !dojo && (
                      <span className="text-xs bg-purple-900/50 text-purple-400 border border-purple-800 px-2 py-0.5 rounded-full">PT</span>
                    )}
                    {client?.archived_at && (
                      <span className="text-xs bg-gray-800 text-gray-400 border border-gray-700 px-2 py-0.5 rounded-full">Archived</span>
                    )}
                  </div>
                  {metaLine && <p className="text-xs text-gray-500 mt-0.5">{metaLine}</p>}
                </div>
                {/* Member admin (reset password, edit / renew, archive, delete): owner and partners only */}
                {!isCoach && (
                  <div className="relative shrink-0">
                    <button type="button" onClick={() => setHeaderMenuOpen(o => !o)} aria-label="Member actions"
                      aria-haspopup="menu" aria-expanded={headerMenuOpen}
                      className="w-11 h-11 flex items-center justify-center text-gray-400 hover:text-white rounded-xl hover:bg-gray-800 transition text-xl leading-none">
                      ⋯
                    </button>
                    {headerMenuOpen && (<>
                      <div className="fixed inset-0 z-40" onClick={() => setHeaderMenuOpen(false)} aria-hidden="true" />
                      <div role="menu" className="absolute right-0 top-12 z-50 w-48 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl overflow-hidden py-1">
                        <button role="menuitem" type="button" onClick={() => { setHeaderMenuOpen(false); openEditClient() }}
                          className={`${menuItem} text-orange-400`}>Edit</button>
                        {/* No login yet (coach-run member): Create login instead of Reset password */}
                        {isNoLogin(client?.email) && (
                          <button role="menuitem" type="button" onClick={() => { setHeaderMenuOpen(false); setShowResetPassword(false); setShowCreateLogin(!showCreateLogin) }}
                            className={`${menuItem} text-gray-200`}>Create login</button>
                        )}
                        {!isNoLogin(client?.email) && (
                          <button role="menuitem" type="button" onClick={() => { setHeaderMenuOpen(false); setShowResetPassword(!showResetPassword) }}
                            className={`${menuItem} text-gray-200`}>Reset password</button>
                        )}
                        {client?.archived_at ? (
                          <button role="menuitem" type="button" onClick={() => { setHeaderMenuOpen(false); handleUnarchiveClient() }}
                            className={`${menuItem} text-green-400`}>Restore</button>
                        ) : (
                          <button role="menuitem" type="button" onClick={() => { setHeaderMenuOpen(false); handleArchiveClient() }}
                            className={`${menuItem} text-gray-200`}>Archive</button>
                        )}
                        <button role="menuitem" type="button" disabled={deletingClient} onClick={() => { setHeaderMenuOpen(false); handleDeleteClient() }}
                          className={`${menuItem} text-red-400 border-t border-gray-800 disabled:opacity-50`}>{deletingClient ? 'Deleting...' : 'Delete'}</button>
                      </div>
                    </>)}
                  </div>
                )}
              </div>
              {(client?.goal || mChip) && (
                <div className="flex flex-wrap gap-2 mt-3">
                  {client?.goal && (
                    <button type="button" onClick={() => setGoalOpen(o => !o)} aria-expanded={goalOpen}
                      aria-label={goalOpen ? 'Hide full goal' : 'Show full goal'}
                      className={`min-h-[44px] text-left text-xs text-orange-200 bg-orange-950/60 border border-orange-900 rounded-xl px-3 py-2 transition hover:border-orange-700 ${goalOpen ? 'w-full' : 'max-w-full min-w-0'}`}>
                      <span className={goalOpen ? 'whitespace-pre-wrap' : 'block truncate'}>
                        <span className="text-orange-400">Goal:</span> {client.goal}
                      </span>
                    </button>
                  )}
                  {mChip && (
                    <span className={`min-h-[44px] inline-flex items-center gap-2 text-xs bg-gray-950 border rounded-xl px-3 ${mChip.cls}`}>
                      <span className={`w-2 h-2 rounded-full ${mChip.dot}`} aria-hidden="true" />
                      {mChip.text}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        )
      })()}

      {/* Edit Client Panel */}
      {showEditClient && !isCoach && (
        <div className="bg-gray-900 border-b border-gray-800 px-6 py-5">
          <div className="max-w-2xl mx-auto space-y-4">

            {/* Client details */}
            <p className="text-xs text-gray-500 uppercase tracking-wider">Client Details</p>
            <input type="text" placeholder="Full name"
              value={editClientForm.full_name}
              onChange={e => setEditClientForm({ ...editClientForm, full_name: e.target.value })}
              className="w-full bg-gray-800 text-white rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm" />
            {multiCountry && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Country</label>
                  <select value={editClientForm.country}
                    onChange={e => {
                      const c = normalizeCountry(e.target.value)
                      const own = COUNTRIES.find(x => x.code === c)?.currency
                      setEditClientForm({ ...editClientForm, country: c, phone_country: c, currency: own && allowedCurrencies.includes(own) ? own : editClientForm.currency })
                    }}
                    className="w-full bg-gray-800 text-white rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm">
                    {COUNTRIES.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Currency (new payments)</label>
                  <select value={editClientForm.currency || baseCurrency}
                    onChange={e => setEditClientForm({ ...editClientForm, currency: e.target.value })}
                    className="w-full bg-gray-800 text-white rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm">
                    {CURRENCIES.filter(c => allowedCurrencies.includes(c.code) || c.code === editClientForm.currency).map(c => <option key={c.code} value={c.code}>{c.label}</option>)}
                  </select>
                </div>
                <p className="col-span-2 -mt-1 text-xs text-gray-500">Payments already saved keep the currency they were paid in.</p>
              </div>
            )}
            {multiCountry ? (
              <div className="flex gap-2">
                <CountryCodePicker value={editClientForm.phone_country}
                  onChange={c => setEditClientForm({ ...editClientForm, phone_country: c })}
                  className="rounded-xl focus:ring-orange-500 py-2.5" />
                <input type="tel" placeholder="Phone number"
                  value={editClientForm.phone}
                  onChange={e => setEditClientForm({ ...editClientForm, phone: e.target.value })}
                  className="w-full min-w-0 bg-gray-800 text-white rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm" />
              </div>
            ) : (
              <input type="tel" placeholder="Phone number"
                value={editClientForm.phone}
                onChange={e => setEditClientForm({ ...editClientForm, phone: e.target.value })}
                className="w-full bg-gray-800 text-white rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm" />
            )}
            {/* Dojo: every student is PT (senseis see them, progress can be shared), so no checkbox */}
            {!dojo && <label className="flex items-center gap-3 cursor-pointer py-1">
              <input type="checkbox"
                checked={editClientForm.client_type === 'pt'}
                onChange={e => setEditClientForm({ ...editClientForm, client_type: e.target.checked ? 'pt' : 'member' })}
                className="w-4 h-4 rounded border-gray-600 bg-gray-800 accent-purple-500" />
              <span className="text-sm text-gray-300">Personal Training (PT) member</span>
            </label>}
            {editMessage && (
              <p className={`text-sm ${editMessage.includes('Error') ? 'text-red-400' : 'text-green-400'}`}>{editMessage}</p>
            )}
            <button
              onClick={handleEditClient}
              disabled={savingEdit}
              className="w-full bg-orange-500 hover:bg-orange-400 text-white font-semibold py-2.5 rounded-xl transition disabled:opacity-50 text-sm">
              {savingEdit ? 'Saving...' : multiCountry ? 'Save Details' : 'Save Name / Phone'}
            </button>

            {/* Membership */}
            <div className="border-t border-gray-800 pt-4 space-y-3">
              <div className="flex justify-between items-center">
                <p className="text-xs text-gray-500 uppercase tracking-wider">Membership</p>
                {memberships[0] && (
                  <span className="text-xs text-gray-600">
                    Current: {memberships[0].plan_type} · ends {formatDate(memberships[0].end_date, country, 'medium')}
                  </span>
                )}
              </div>
              {memberships[0] && (
                <div className="flex gap-1 bg-gray-800 p-1 rounded-xl w-fit" role="tablist">
                  {(['renew', 'correct'] as const).map(mode => (
                    <button key={mode} role="tab" aria-selected={membershipMode === mode}
                      onClick={() => switchMembershipMode(mode)}
                      className={`px-4 py-1.5 text-xs font-medium rounded-lg transition ${membershipMode === mode ? 'bg-orange-500 text-white' : 'text-gray-400 hover:text-white'}`}>
                      {mode === 'renew' ? 'Renew' : 'Correct current'}
                    </button>
                  ))}
                </div>
              )}
              <p className="text-xs text-gray-500">
                {membershipMode === 'renew'
                  ? 'Adds a new membership. It starts when the current one ends (or today if it has already ended). History is kept.'
                  : 'Fixes a mistake in the current membership. No new entry is added.'}
              </p>
              <div className="grid grid-cols-2 gap-3">
                <select
                  value={editClientForm.plan_type}
                  onChange={e => setEditClientForm({ ...editClientForm, plan_type: e.target.value })}
                  className="bg-gray-800 text-white rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm">
                  <option>1 Month</option>
                  <option>3 Months</option>
                  <option>6 Months</option>
                  <option>1 Year</option>
                </select>
                {(() => {
                  // Renew: the latest payment's currency carried forward (picker in multi-country gyms).
                  // Correct: always the current entry's own currency, never changed.
                  const shown = membershipMode === 'correct' && memberships[0]
                    ? (memberships[0].currency || currency)
                    : (editClientForm.membership_currency || renewalCurrency())
                  const picker = multiCountry && (membershipMode === 'renew' || !memberships[0])
                  return (
                    <div className="flex gap-2 min-w-0">
                      {picker && (
                        <select aria-label="Currency" value={shown || baseCurrency}
                          onChange={e => setEditClientForm({ ...editClientForm, membership_currency: e.target.value })}
                          className="shrink-0 bg-gray-800 text-white rounded-xl px-2 py-2.5 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm">
                          {CURRENCIES.filter(c => allowedCurrencies.includes(c.code) || c.code === shown).map(c => <option key={c.code} value={c.code}>{c.code}</option>)}
                        </select>
                      )}
                      <input type="number" placeholder={shown ? `Amount paid (${currencySymbol(shown)})` : 'Amount paid'}
                        value={editClientForm.amount_paid}
                        onChange={e => setEditClientForm({ ...editClientForm, amount_paid: e.target.value })}
                        className="w-full min-w-0 bg-gray-800 text-white rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm placeholder-gray-600" />
                    </div>
                  )
                })()}
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Start Date</label>
                  <input type="date"
                    value={editClientForm.start_date}
                    onChange={e => setEditClientForm({ ...editClientForm, start_date: e.target.value })}
                    className="w-full bg-gray-800 text-white rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">End Date (auto)</label>
                  <input type="date"
                    value={editClientForm.end_date}
                    onChange={e => setEditClientForm({ ...editClientForm, end_date: e.target.value })}
                    className="w-full bg-gray-800 text-white rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm" />
                </div>
                {editClientForm.start_date && (
                  <p className="col-span-2 -mt-1 text-xs text-gray-400">
                    {formatDate(editClientForm.start_date, country, 'medium')}
                    {editClientForm.end_date ? ` → ${formatDate(editClientForm.end_date, country, 'medium')}` : ''}
                  </p>
                )}
              </div>
              {membershipMessage && (
                <p className="text-green-400 text-sm">{membershipMessage}</p>
              )}
              {membershipMode === 'renew' || !memberships[0] ? (
                <button
                  onClick={handleRenewMembership}
                  disabled={savingMembership || !editClientForm.start_date}
                  className="w-full bg-orange-500 hover:bg-orange-400 text-white font-semibold py-2.5 rounded-xl transition disabled:opacity-50 text-sm">
                  {savingMembership ? 'Saving...' : memberships[0] ? 'Renew membership' : 'Add membership'}
                </button>
              ) : (
                <button
                  onClick={handleCorrectMembership}
                  disabled={savingMembership}
                  className="w-full bg-gray-700 hover:bg-gray-600 text-white font-semibold py-2.5 rounded-xl transition disabled:opacity-50 text-sm">
                  {savingMembership ? 'Saving...' : 'Save correction'}
                </button>
              )}
            </div>

          </div>
        </div>
      )}

{showCreateLogin && !isCoach && isNoLogin(client?.email) && (
  <div className="bg-gray-900 border-b border-gray-800 px-6 py-4">
    <div className="max-w-2xl mx-auto space-y-3">
      <p className="text-xs text-gray-500 uppercase tracking-wider">Create login for {client?.full_name}</p>
      <p className="text-xs text-gray-500">They log in with this username and password. Usernames are unique across CoachBoard. Their phone stays for contact only.</p>
      <UsernameField value={createLogin.username} fullName={client?.full_name || ''}
        onChange={v => setCreateLogin({ ...createLogin, username: v, error: '' })} onStatus={setCreateLoginStatus}
        placeholder="Username, e.g. anand.k" />
      <input type="text" placeholder="Password (min 6)" aria-label="Password" autoComplete="new-password"
        value={createLogin.password}
        onChange={e => setCreateLogin({ ...createLogin, password: e.target.value, error: '' })}
        className="w-full bg-gray-800 text-white rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm" />
      {createLogin.error && <p className="text-sm text-red-400">{createLogin.error}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={handleCreateLogin} disabled={createLogin.saving || !createLogin.username || createLoginStatus === 'invalid' || createLoginStatus === 'checking'}
          className="flex-1 bg-orange-500 hover:bg-orange-400 text-white font-semibold py-2.5 rounded-xl transition disabled:opacity-50 text-sm">
          {createLogin.saving ? 'Creating...' : 'Create login'}
        </button>
        <button type="button" onClick={() => setShowCreateLogin(false)}
          className="px-4 border border-gray-700 rounded-xl text-gray-400 hover:bg-gray-800 text-sm transition">Cancel</button>
      </div>
    </div>
  </div>
)}

{showResetPassword && !isCoach && (
  <div className="bg-gray-900 border-b border-gray-800 px-6 py-4">
    <div className="max-w-2xl mx-auto space-y-3">
      <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Reset Client Password</p>
      <div className="relative">
        <input
          type={showResetPasswordValue ? 'text' : 'password'}
          placeholder="New password for client"
          value={newPassword}
          onChange={e => setNewPassword(e.target.value)}
          className="w-full bg-gray-800 text-white rounded-xl px-4 py-2.5 pr-10 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm" />
        <button type="button" onClick={() => setShowResetPasswordValue(!showResetPasswordValue)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition">
          {showResetPasswordValue
            ? <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" /></svg>
            : <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
          }
        </button>
      </div>
      {resetMessage && (
        <p className={`text-sm ${resetMessage.includes('✓') ? 'text-green-400' : 'text-red-400'}`}>
          {resetMessage}
        </p>
      )}
      <button
        onClick={handleResetPassword}
        disabled={resetting}
        className="w-full bg-orange-500 hover:bg-orange-400 text-white font-semibold py-2.5 rounded-xl transition disabled:opacity-50 text-sm">
        {resetting ? 'Resetting...' : 'Reset Password'}
      </button>
    </div>
  </div>
)}

      {/* Stats (PT clients with the Train tabs see activities / minutes in Progress instead) */}
      {!(client?.client_type === 'pt' && trainModule) && (
      <div className="max-w-2xl mx-auto px-6 pt-5 grid grid-cols-2 gap-3 mb-2">
        {client?.client_type === 'pt' ? (
          <>
            <div className="bg-gray-900 rounded-2xl p-4 border border-gray-800 text-center">
              <p className="text-2xl font-bold text-orange-500">{sessions.length}</p>
              <p className="text-xs text-gray-500 mt-1">Total Activities</p>
            </div>
            <div className="bg-gray-900 rounded-2xl p-4 border border-gray-800 text-center">
              <p className="text-2xl font-bold text-orange-500">{totalMinutes}</p>
              <p className="text-xs text-gray-500 mt-1">Total Minutes</p>
            </div>
          </>
        ) : (
          <>
            <div className="bg-gray-900 rounded-2xl p-4 border border-gray-800 text-center">
              <p className="text-2xl font-bold text-orange-500">{memberships[0]?.plan_type || '—'}</p>
              <p className="text-xs text-gray-500 mt-1">Current Plan</p>
              {memberships[0] && (
                <p className="text-xs text-gray-600 mt-1">{moneyOf(memberships[0])}</p>
              )}
              {memberships[0] && (
                <p className="text-xs text-gray-600 mt-1">
                  {formatDate(memberships[0].start_date, country, 'dayMonth')}
                  {' → '}
                  {formatDate(memberships[0].end_date, country, 'medium')}
                </p>
              )}
            </div>
            <div className="bg-gray-900 rounded-2xl p-4 border border-gray-800 text-center">
              {memberships[0] ? (() => {
                const days = daysLeftFromDate(memberships[0].end_date)
                const pct = elapsedPct(memberships[0].start_date, memberships[0].end_date)
                const color = days < 0 ? 'text-red-400' : days <= 11 ? 'text-amber-400' : 'text-green-400'
                const barColor = days < 0 ? 'bg-red-500' : days <= 11 ? 'bg-amber-500' : 'bg-green-500'
                return (
                  <>
                    <p className={`text-2xl font-bold ${color}`}>{Math.abs(days)}</p>
                    <p className="text-xs text-gray-500 mt-1">{days < 0 ? 'Days Overdue' : 'Days Left'}</p>
                    <div className="w-full bg-gray-700 rounded-full h-1.5 mt-2">
                      <div className={`h-1.5 rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
                    </div>
                  </>
                )
              })() : (
                <>
                  <p className="text-2xl font-bold text-gray-600">—</p>
                  <p className="text-xs text-gray-500 mt-1">No membership</p>
                </>
              )}
            </div>
          </>
        )}
      </div>
      )}

      {/* Before you start (#40): what any staff member should know before training this PT client */}
      {client?.client_type === 'pt' && (() => {
        const b = beforeYouStart({ ...client, id: clientId }, sessions.map(x => ({ ...x, client_id: clientId })), { ...Object.fromEntries(staff.map(x => [x.id, x.full_name])), ...staffNames }, localDateIso(), sw.one, new Set(staff.filter(x => x.role === 'coach').map(x => x.id)))
        const primary = client.primary_coach_id ? staff.find(x => x.id === client.primary_coach_id)?.full_name : null
        const toggle = () => {
          const next = !bysOpen
          setBysOpen(next)
          try { if (viewerId) localStorage.setItem(`bys-collapsed:${viewerId}`, next ? '0' : '1') } catch { /* storage unavailable */ }
        }
        return (
          <div className="max-w-2xl mx-auto px-6 mt-3">
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
              <button type="button" onClick={toggle} aria-expanded={bysOpen} className="w-full flex items-center justify-between text-left gap-3">
                <span className="text-xs text-gray-500 uppercase tracking-wider">Before you start</span>
                <span className="flex items-center gap-2 min-w-0">
                  {!bysOpen && b.medical && <span className="text-[11px] text-amber-400 truncate">⚠ {b.medical}</span>}
                  <span className={`text-gray-500 text-sm transition-transform inline-block ${bysOpen ? 'rotate-180' : ''}`}>▾</span>
                </span>
              </button>
              {bysOpen && (
                <div className="mt-3 space-y-2.5 text-sm">
                  {!coachCompany && (
                    <p className="text-gray-400">
                      Primary {sw.one.toLowerCase()}: <span className="text-white">{client.primary_coach_id ? (client.primary_coach_id === viewerId ? 'You' : primary || sw.one) : `No primary ${sw.one.toLowerCase()}`}</span>
                    </p>
                  )}
                  {b.goal && <p className="text-gray-400">Goal: <span className="text-white">{b.goal}</span></p>}
                  {b.medical && (
                    <p className="text-amber-300 bg-amber-950/40 border border-amber-900 rounded-lg px-3 py-2">⚠ Medical / injuries: {b.medical}</p>
                  )}
                  {/* Last sessions: shown here when there is no Sessions tab (Train module off); otherwise in Sessions */}
                  {!trainModule && (<>
                  <p className="text-gray-400">
                    {b.daysSinceLast === null ? 'No sessions yet'
                      : b.daysSinceLast === 0 ? 'Last trained today'
                      : `Last trained ${b.daysSinceLast} day${b.daysSinceLast === 1 ? '' : 's'} ago`}
                  </p>
                  {b.lastTwo.length > 0 && (
                    <ul className="divide-y divide-gray-800 border-t border-gray-800">
                      {b.lastTwo.map((x, i) => (
                        <li key={i} className="py-2">
                          <p className="text-xs text-white">
                            {formatDate(x.date, country, 'weekday')}
                            {x.day ? <span className="text-gray-400"> · {x.day}</span> : null}
                            {x.exercises ? <span className="text-gray-400"> · {x.exercises}</span> : null}
                            {x.minutes ? <span className="text-gray-400"> · {x.minutes} min</span> : null}
                            {!coachCompany && <span className="text-gray-500"> · by {x.by}{x.covering ? ' (covering)' : ''}</span>}
                          </p>
                          {x.notes && <p className="text-xs text-gray-400 mt-0.5">{x.notes}</p>}
                        </li>
                      ))}
                    </ul>
                  )}
                  {b.totalSessions > 0 && (client as any)?.companies?.client_module_enabled && (
                    <button type="button" onClick={() => setActiveTab('sessions')}
                      className="text-xs text-orange-400 hover:text-orange-300">
                      See all {b.totalSessions} session{b.totalSessions === 1 ? '' : 's'} →
                    </button>
                  )}
                  </>)}
                </div>
              )}
            </div>
          </div>
        )
      })()}

      {/* Tabs — PT members only, requires client module */}
      {client?.client_type === 'pt' && (client as any)?.companies?.client_module_enabled && (
        <div className="sticky top-0 z-30 bg-gray-950 mt-3 mb-4">
          <div className="max-w-2xl mx-auto px-4 sm:px-6 py-2">
          <div role="tablist" className={`grid ${dojo ? 'grid-cols-3' : 'grid-cols-4'} gap-1 bg-gray-900 p-1 rounded-xl border border-gray-800`}>
            {/* Dojo: no Plans tab (attendance with batches replaces it later; saved plans are kept) */}
            {(dojo ? ['profile', 'sessions', 'progress'] as const : ['profile', 'plans', 'sessions', 'progress'] as const).map(tab => (
              <button key={tab} role="tab" aria-selected={activeTab === tab} onClick={() => setActiveTab(tab)}
                className={`min-h-[44px] text-xs font-medium rounded-lg transition ${activeTab === tab
                  ? 'bg-orange-500 text-white'
                  : 'text-gray-400 hover:text-white'}`}>
                {tab === 'plans' ? 'Plans' : tab === 'sessions' ? (attendanceMode ? 'Attendance' : 'Sessions') : tab === 'progress' ? 'Progress' : 'Profile'}
              </button>
            ))}
          </div>
          </div>
        </div>
      )}

      <div className={`max-w-2xl mx-auto px-6 ${todayLog ? 'pb-32' : 'pb-8'}`}>

        {/* PLANS / SESSIONS / PROGRESS — PT members only, requires client module */}
        {client?.client_type === 'pt' && (client as any)?.companies?.client_module_enabled && (<>

        {/* PLANS TAB */}
        {activeTab === 'plans' && !dojo && (
          <div>
{(() => {
  const missing = [
    !client?.goal && 'goal',
    !client?.fitness_level && 'fitness level',
    !client?.available_days && 'available days',
  ].filter(Boolean) as string[]
  // Only about AI plans: nothing to say when they're turned off for this company
  if (!missing.length || (client as { companies?: { ai_plans_enabled?: boolean | null } } | null)?.companies?.ai_plans_enabled === false) return null
  return (
    <div className="bg-yellow-950/60 border border-yellow-800 rounded-2xl px-4 py-3 mb-4 flex flex-wrap items-center justify-between gap-2">
      <p className="text-xs text-yellow-300">
        Add {missing.join(', ').replace(/, ([^,]*)$/, ' and $1')} in Profile for a better AI plan.
      </p>
      <button onClick={() => setActiveTab('profile')}
        className="text-xs text-yellow-200 border border-yellow-700 hover:border-yellow-500 px-3 py-1 rounded-lg transition">
        Open Profile
      </button>
    </div>
  )
})()}
{generatingPlan && (
  <div ref={aiWorkingRef} className="bg-gray-900 rounded-2xl p-5 border border-purple-800 mb-4">
  <style>{`
    @keyframes cb-indet { 0% { transform: translateX(-100%) } 100% { transform: translateX(300%) } }
    .cb-indet { animation: cb-indet 1.4s ease-in-out infinite; }
    @media (prefers-reduced-motion: reduce) { .cb-indet { animation: none; width: 100%; opacity: .5 } }
  `}</style>
  <div className="flex items-center gap-4">
    <div className="w-6 h-6 rounded-full border-2 border-purple-400 border-t-transparent animate-spin shrink-0" />
    <div className="flex-1">
      <p className="text-sm text-white font-medium">Creating a plan for {client?.full_name?.split(' ')[0] || 'this client'}…</p>
      <p className="text-xs text-gray-500 mt-0.5">
        {aiElapsed < 20 ? 'Usually takes 10–20 seconds.' : 'Taking a bit longer than usual…'} {aiElapsed}s
      </p>
    </div>
    <button onClick={cancelGeneratePlan}
      className="text-xs text-gray-400 hover:text-white border border-gray-700 px-3 py-1.5 rounded-lg transition">
      Cancel
    </button>
  </div>
  <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-gray-800" aria-hidden="true">
    <div className="cb-indet h-full w-1/3 rounded-full bg-purple-500" />
  </div>
  </div>
)}
{aiError && !generatingPlan && (
  <div className="bg-red-950 border border-red-900 rounded-2xl px-5 py-4 mb-4 flex items-start gap-3">
    <p className="flex-1 text-sm text-red-300">{aiError}</p>
    {!aiPlansUsedUp && (
    <button onClick={handleGeneratePlan}
      className="text-xs text-white bg-red-800 hover:bg-red-700 px-3 py-1.5 rounded-lg transition">
      Try again
    </button>
    )}
    <button onClick={() => setAiError('')}
      className="text-xs text-red-400 hover:text-white">
      ✕
    </button>
  </div>
)}
{showGeneratedPlan && generatedPlan && (
  <div ref={aiPanelRef} className="scroll-mt-4 bg-gray-900 rounded-2xl p-5 border border-purple-800 space-y-4 mb-4">
    <div className="flex justify-between items-center">
      <p className="text-xs text-purple-400 uppercase tracking-wider font-medium">✨ AI Generated Plan</p>
      <button
        onClick={() => { setShowGeneratedPlan(false); setPlanError('') }}
        className="text-xs text-gray-500 hover:text-white">
        Dismiss
      </button>
    </div>
    {scheduleNotes.length > 0 && (
      <div className="bg-amber-950 border border-amber-800 rounded-xl px-4 py-3 space-y-1">
        {scheduleNotes.map(n => <p key={n} className="text-sm text-amber-200">{n}</p>)}
      </div>
    )}
    {generatedJson ? (
      <PlanEditor value={generatedJson} onChange={setGeneratedJson} weekStart={aiPlanMeta.week_start} companyId={companyId} clientId={clientId} country={country ?? 'IN'} allowCopy={false} />
    ) : (
    <textarea
  value={generatedPlan}
  onChange={e => setGeneratedPlan(e.target.value)}
  rows={15}
  className="w-full bg-gray-800 text-white rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-purple-500 border border-gray-700 text-sm resize-none" />
    )}
    <div className="border-t border-gray-800 pt-4">
      <label className="text-xs text-gray-500 mb-1.5 block uppercase tracking-wider">Week starting</label>
      <input type="date" value={aiPlanMeta.week_start}
        onChange={e => setAiPlanMeta({ ...aiPlanMeta, week_start: e.target.value })}
        className="w-full bg-gray-800 text-white rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-purple-500 border border-gray-700 text-sm mb-1" />
      <p className="text-xs text-gray-400 mb-3">{aiPlanMeta.week_start ? `Covers ${formatDate(aiPlanMeta.week_start, country, 'weekday')} – ${formatDate(weekEnd(aiPlanMeta.week_start), country, 'weekday')} (7 days)` : '\u00a0'}</p>
      <label className="text-xs text-gray-500 mb-1.5 block uppercase tracking-wider">Workout Time</label>
      <input type="time" value={aiPlanMeta.workout_time}
        onChange={e => setAiPlanMeta({ ...aiPlanMeta, workout_time: e.target.value })}
        className="w-full bg-gray-800 text-white rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-purple-500 border border-gray-700 text-sm mb-3" />
      {planError && <p className="text-xs text-red-400 mb-3">{planError}</p>}
      <button
        onClick={handleAssignGeneratedPlan}
        disabled={saving || !aiPlanMeta.week_start || (!generatedJson && !generatedPlan.trim())}
        className="w-full bg-purple-600 hover:bg-purple-500 text-white font-semibold py-2.5 rounded-xl transition disabled:opacity-50 text-sm">
        {saving ? 'Assigning...' : 'Assign plan to client'}
      </button>
    </div>
  </div>
)}
            {showPlanForm && (
              <div ref={manualFormRef} className="scroll-mt-4 bg-gray-900 rounded-2xl p-5 border border-gray-800 space-y-4 mb-4">
                <h3 className="font-semibold text-sm">New Weekly Plan</h3>
                <div>
                  <label className="text-xs text-gray-500 mb-1.5 block uppercase tracking-wider">Week starting</label>
                  <input type="date" value={newPlan.week_start}
                    onChange={e => setNewPlan({ ...newPlan, week_start: e.target.value })}
                    className="w-full bg-gray-800 text-white rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm" />
                  {newPlan.week_start && <p className="text-xs text-gray-400 mt-1">Covers {formatDate(newPlan.week_start, country, 'weekday')} – {formatDate(weekEnd(newPlan.week_start), country, 'weekday')} (7 days)</p>}
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1.5 block uppercase tracking-wider">Workout Time</label>
                  <input type="time" value={newPlan.workout_time}
                    onChange={e => setNewPlan({ ...newPlan, workout_time: e.target.value })}
                    className="w-full bg-gray-800 text-white rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm" />
                </div>
                {!newPlanTextMode && newPlanJson ? (
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-xs text-gray-500 uppercase tracking-wider">Days</label>
                      <button type="button" onClick={() => { setPlanError(''); setNewPlanTextMode(true) }}
                        className="text-xs text-gray-400 hover:text-white underline underline-offset-2">Paste a plan as text instead</button>
                    </div>
                    <PlanEditor value={newPlanJson} onChange={setNewPlanJson} weekStart={newPlan.week_start} companyId={companyId} clientId={clientId} country={country ?? 'IN'} />
                  </div>
                ) : (
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs text-gray-500 uppercase tracking-wider">Plan details</label>
                    <button type="button" onClick={() => { setPlanError(''); setNewPlanJson(prev => prev ?? emptyPlan(client?.available_days)); setNewPlanTextMode(false) }}
                      className="text-xs text-gray-400 hover:text-white underline underline-offset-2">Back to day-by-day</button>
                  </div>
                  <textarea
                    placeholder="Monday – Legs&#10;- Squats – 3 x 10, rest 60 s&#10;Tuesday – Rest&#10;Wednesday – Upper body&#10;- Push-ups – 3 x 12"
                    value={newPlan.plan_details}
                    onChange={e => setNewPlan({ ...newPlan, plan_details: e.target.value })}
                    rows={6}
                    className="w-full bg-gray-800 text-white rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm resize-none" />
                  <button type="button" disabled={!newPlan.plan_details.trim()}
                    onClick={() => convertTextToDays(newPlan.plan_details, p => { setNewPlanJson(p); setNewPlanTextMode(false) })}
                    className="mt-2 w-full text-xs text-orange-300 border border-orange-800 hover:border-orange-500 py-2 rounded-lg disabled:opacity-40">
                    Convert to days ▸
                  </button>
                  <p className="text-[11px] text-gray-500 mt-1">Or assign it as text. The client will see it as written, without day rows.</p>
                </div>
                )}
                {planError && <p className="text-xs text-red-400">{planError}</p>}
                <div className="flex gap-2">
                  <button onClick={handleAddPlan} disabled={saving || !newPlan.week_start || (newPlanTextMode && !newPlan.plan_details.trim())}
                    className="flex-1 bg-orange-500 hover:bg-orange-400 text-white font-semibold py-2.5 rounded-xl transition disabled:opacity-50 text-sm">
                    {saving ? 'Assigning...' : 'Assign plan to client'}
                  </button>
                  <button onClick={() => { setShowPlanForm(false); setPlanError('') }}
                    className="flex-1 bg-gray-800 hover:bg-gray-700 text-white text-sm py-2.5 rounded-xl transition">
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {(() => {
              const today = localToday()
              const cur = currentPlan(plans)
              const upcoming = plans.filter(p => p !== cur && weekStatus(p.week_start) === 'upcoming')
                .sort((x, y) => x.week_start.localeCompare(y.week_start))
              const past = plans.filter(p => p !== cur && weekStatus(p.week_start) !== 'upcoming')
                .sort((x, y) => y.week_start.localeCompare(x.week_start))
              const PAST_SHOWN = 5 // newest past plans shown before "Show older plans"
              const shownPast = showAllPlans ? past : past.slice(0, PAST_SHOWN)
              const s = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

              // ⋯ on a plan: Edit plan, Copy to next week, Delete plan (owner / partner only)
              const renderPlanMenu = (plan: Plan, withNew = false) => {
                const nextStart = isoAdd(plan.week_start, 7)
                const item = 'w-full text-left px-4 min-h-[44px] text-sm hover:bg-gray-800 transition flex items-center'
                return (
                  <div className="relative shrink-0">
                    <button type="button" onClick={e => { e.stopPropagation(); setPlanMenuId(planMenuId === plan.id ? null : plan.id) }}
                      aria-label={`Plan actions for week of ${formatWeekStart(plan.week_start)}`} aria-haspopup="menu" aria-expanded={planMenuId === plan.id}
                      className="w-11 h-11 -mr-2 flex items-center justify-center text-gray-400 hover:text-white rounded-xl hover:bg-gray-800 transition text-xl leading-none">
                      ⋯
                    </button>
                    {planMenuId === plan.id && (<>
                      <div className="fixed inset-0 z-40" onClick={e => { e.stopPropagation(); setPlanMenuId(null) }} aria-hidden="true" />
                      <div role="menu" className="absolute right-0 top-11 z-50 w-56 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl overflow-hidden py-1">
                        {withNew && (
                          <button role="menuitem" type="button" disabled={generatingPlan}
                            onClick={e => { e.stopPropagation(); openNewPlanSheet() }}
                            className={`${item} text-orange-400 border-b border-gray-800 disabled:opacity-50`}>+ New plan</button>
                        )}
                        <button role="menuitem" type="button"
                          onClick={e => { e.stopPropagation(); setPlanMenuId(null); setPlanError(''); setEditingPlan(plan); setEditingJson(planJsonOf(plan)) }}
                          className={`${item} text-gray-100`}>Edit plan</button>
                        <button role="menuitem" type="button" disabled={saving}
                          onClick={e => { e.stopPropagation(); setPlanMenuId(null); copyPlanTo(plan, nextStart) }}
                          className={`${item} text-gray-100 disabled:opacity-50`}>Copy to next week <span className="ml-auto text-xs text-gray-500">{formatDate(nextStart, country, 'dayMonth')}</span></button>
                        {!isCoach && (
                          <button role="menuitem" type="button" disabled={deletingPlanId === plan.id}
                            onClick={e => { e.stopPropagation(); setPlanMenuId(null); handleDeletePlan(plan.id) }}
                            className={`${item} text-red-400 border-t border-gray-800 disabled:opacity-50`}>{deletingPlanId === plan.id ? 'Deleting…' : 'Delete plan'}</button>
                        )}
                      </div>
                    </>)}
                  </div>
                )
              }

              // One plan: "This week" card (variant 'current', always open) or a row (tap to open its week)
              const renderPlan = (plan: Plan, variant: 'current' | 'row') => {
                const ring = highlightPlanId === plan.id ? 'border-green-500 ring-2 ring-green-500' : 'border-gray-800'
                if (editingPlan?.id === plan.id) return (
                  <div key={plan.id} id={`plan-${plan.id}`} className={`scroll-mt-20 bg-gray-900 rounded-2xl p-4 border ${ring}`}>
      <div className="space-y-3">
        <p className="text-xs text-gray-500 uppercase tracking-wider">Editing Plan</p>
        <input type="date"
          value={editingPlan.week_start}
          onChange={e => setEditingPlan({ ...editingPlan, week_start: e.target.value })}
          className="w-full bg-gray-800 text-white rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm" />
        {editingPlan.week_start && <p className="text-xs text-gray-400 -mt-1">Covers {formatDate(editingPlan.week_start, country, 'weekday')} – {formatDate(weekEnd(editingPlan.week_start), country, 'weekday')} (7 days)</p>}
        <div>
          <label className="text-xs text-gray-500 mb-1.5 block uppercase tracking-wider">Workout Time</label>
          <input type="time" value={editingPlan.workout_time || ''}
            onChange={e => setEditingPlan({ ...editingPlan, workout_time: e.target.value })}
            className="w-full bg-gray-800 text-white rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm" />
        </div>
        {editingJson ? (
          <PlanEditor value={editingJson} onChange={setEditingJson} weekStart={editingPlan.week_start} companyId={companyId} clientId={clientId} country={country ?? 'IN'} />
        ) : (
          <>
            <textarea
              value={editingPlan.plan_details}
              onChange={e => setEditingPlan({ ...editingPlan, plan_details: e.target.value })}
              rows={10}
              className="w-full bg-gray-800 text-white rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm resize-none" />
            <div className="flex gap-2">
              <button type="button"
                onClick={() => convertTextToDays(editingPlan.plan_details, setEditingJson)}
                className="flex-1 text-xs text-orange-300 border border-orange-800 hover:border-orange-500 py-2 rounded-lg">
                Convert to day-by-day ▸
              </button>
              <button type="button"
                onClick={() => { setPlanError(''); setEditingJson(emptyPlan(client?.available_days)) }}
                className="flex-1 text-xs text-gray-300 border border-gray-700 hover:border-gray-500 py-2 rounded-lg">
                Start fresh day-by-day
              </button>
            </div>
            <p className="text-[11px] text-gray-500 -mt-1">This is an older text plan. Converting doesn&apos;t save anything until you tap Save Changes.</p>
          </>
        )}
        {planError && <p className="text-xs text-red-400">{planError}</p>}
        <div className="flex gap-2">
          <button onClick={handleUpdatePlan} disabled={saving || !editingPlan.week_start || (!editingJson && !editingPlan.plan_details.trim())}
            className="flex-1 bg-orange-500 hover:bg-orange-400 text-white text-sm py-2.5 rounded-xl transition disabled:opacity-50 font-medium">
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
          <button onClick={() => { setEditingPlan(null); setEditingJson(null); setPlanError('') }}
            className="flex-1 bg-gray-800 hover:bg-gray-700 text-white text-sm py-2.5 rounded-xl transition">
            Cancel
          </button>
        </div>
      </div>
                  </div>
                )
                const summary = summarizeAny(plan, plan.week_start)
                const planJson = planJsonOf(plan)
                const status = weekStatus(plan.week_start)
                const done = doneDayKeys(plan.id, countSessions)
                const workoutLabels = summary.days.filter(d => !isRestDay(d))
                const doneCount = workoutLabels.filter(d => done.has(dayKey(d))).length
                const isCurrent = status === 'current'
                const open = variant === 'current' || expandedPlanId === plan.id
                const start = plan.week_start.slice(0, 10)
        const renderMarkPanel = (day: PlanDay | null, label: string | null) => {
          const key = `${plan.id}:${day?.day ?? ''}`
          const isDone = !!day && done.has(day.day)
          const n = day ? (coachTicks[key] || []).length : 0
          // Right after Mark done: the confirmation with a one-session WhatsApp message
          const sent = lastMarked?.key === key ? (() => {
            const msg = buildSessionMessage({
              client: client as ShareClient, companyName: company?.name || '', businessType: company?.business_type,
              coachName, session: lastMarked.session, country: country ?? 'IN',
            })
            const to = (msg.toLabel.match(/\(([^)]*)\)/)?.[1] || msg.toLabel).trim().split(/\s+/)[0]
            return (
              <div className="bg-green-950/40 border border-green-800 rounded-xl px-3 py-2.5 mb-3 space-y-2">
                <div className="flex justify-between items-start gap-2">
                  <p className="text-xs font-semibold text-green-400">✓ {day ? day.day : 'Session'} done for {clientFirstName}</p>
                  <button type="button" onClick={() => setLastMarked(null)} aria-label="Dismiss"
                    className="text-gray-500 hover:text-white text-sm leading-none">✕</button>
                </div>
                {msg.toPhone ? (
                  <button type="button"
                    onClick={() => window.open(`https://wa.me/${msg.toPhone}?text=${encodeURIComponent(msg.text)}`, '_blank')}
                    className="w-full bg-green-600 hover:bg-green-500 text-white text-sm font-medium py-2 rounded-lg transition">
                    Send to {to} on WhatsApp
                  </button>
                ) : (
                  <p className="text-xs text-gray-500">No phone number on profile to send on WhatsApp</p>
                )}
              </div>
            )
          })() : null
          if (markKey === key) return (
            <div className={day ? 'border-t border-gray-800 pt-3' : ''}>
              {coveringBadge()}
              <SessionForm mode="day" idPrefix={`mark-${plan.id}`} value={markForm} onChange={setMarkForm}
                feelingEnabled={!isCoach}
                country={country} notesEnabled={(client as { companies?: { session_notes_enabled?: boolean | null } } | null)?.companies?.session_notes_enabled !== false}
                notesLabel="Notes (optional)"
                error={markError} saving={savingMark} submitLabel={`Done ✓ for ${clientFirstName}`}
                onSubmit={() => handleCoachLogDay(plan, day, label)} onCancel={closeMarkForm}
                heading={
                  <p className="text-xs font-semibold text-green-400">
                    {day ? `${day.day} done for ${clientFirstName}` : `Session done for ${clientFirstName}`}
                    {day && (n
                      ? <span className="font-normal text-gray-400"> · {n} of {day.exercises.length} exercise{day.exercises.length === 1 ? '' : 's'} ticked</span>
                      : <span className="font-normal text-gray-500"> · tick exercises above, or just save</span>)}
                  </p>
                } />
            </div>
          )
          if (isDone && markAgainKey === key) return (
            <div className="border-t border-gray-800 pt-3 space-y-2">
              <p className="text-xs text-amber-300">{day!.day} is already marked done. Log another session for this day?</p>
              <div className="flex gap-2">
                <button type="button" onClick={() => openMarkForm(key)}
                  className="flex-1 bg-amber-600 hover:bg-amber-500 text-white text-sm font-medium py-2.5 rounded-xl">Yes, log again</button>
                <button type="button" onClick={() => setMarkAgainKey(null)}
                  className="px-4 bg-gray-800 hover:bg-gray-700 text-white text-sm rounded-xl">Cancel</button>
              </div>
            </div>
          )
          if (isDone) return (
            <div className="border-t border-gray-800 pt-3">
              {weightsBanner(key)}
              {sent}
              <button type="button" onClick={() => { setMarkError(''); setMarkAgainKey(key) }}
                className="text-xs text-gray-400 hover:text-white underline underline-offset-2">Log another session for {day!.day}</button>
            </div>
          )
          return (
            <div className={day ? 'border-t border-gray-800 pt-3' : ''}>
              {weightsBanner(key)}
              {sent}
              {coveringBadge()}
              <button type="button" onClick={() => openMarkForm(key)}
                className="w-full bg-green-600 hover:bg-green-500 text-white font-semibold py-3 rounded-xl text-sm">
                Mark done for {clientFirstName}
              </button>
            </div>
          )
        }
                const allDone = workoutLabels.length > 0 && doneCount >= workoutLabels.length
                const badge = status === 'upcoming'
                  ? <span className="text-[11px] font-medium text-blue-300 bg-blue-950 border border-blue-800 px-2 py-0.5 rounded-full shrink-0">Upcoming</span>
                  : workoutLabels.length > 0
                    ? <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full border shrink-0 ${allDone ? 'text-green-300 bg-green-950 border-green-800' : 'text-orange-300 bg-orange-950/60 border-orange-900'}`}>{doneCount} of {workoutLabels.length} done</span>
                    : null

                // The open week: 7-day strip, legend, the selected day's exercises (text plans: the text)
                const renderWeek = () => {
                  if (!planJson) return (
                    <div className="border-t border-gray-800 px-4 py-4 space-y-3">
                      <p className="text-sm text-gray-300 whitespace-pre-wrap leading-relaxed">{plan.plan_details}</p>
                      {isCurrent && renderMarkPanel(null, null)}
                    </div>
                  )
                  const days = daysInWeekOrder(planJson, start)
                  const dates = days.map((_, i) => isoAdd(start, i))
                  const todayIdx = dates.indexOf(today)
                  const fallback = todayIdx >= 0 ? days[todayIdx].day : (days.find(d => !d.rest) ?? days[0]).day
                  const chosen = variant === 'current' ? coachOpenDay : selDay[plan.id]
                  const selIdx = Math.max(0, days.findIndex(d => d.day === (chosen && days.some(x => x.day === chosen) ? chosen : fallback)))
                  const select = (day: string) => {
                    if (variant === 'current') setCoachOpenDay(day)
                    else setSelDay(prev => ({ ...prev, [plan.id]: day }))
                    closeMarkForm()
                  }
                  const d = days[selIdx]
                  const dayDone = !d.rest && done.has(d.day)
                  const notes = dayDone ? doneNotesWithWho(plan.id)[d.day] : ''
                  // What was ticked on the day (latest session for it); this week's days not yet done show the coach's ticks
                  // "Log another session" on a done day (its form is open): tick afresh, with weight rows (#80)
                  const loggingAgain = isCurrent && dayDone && markKey === `${plan.id}:${d.day}`
                  const saved = countSessions.filter(x => x.weekly_plan_id === plan.id && dayKey(x.plan_day) === d.day && x.exercises_done)
                  const ticks = loggingAgain ? coachTicks[`${plan.id}:${d.day}`] || []
                    : saved.length ? tickedFromSaved(d, saved[saved.length - 1].exercises_done)
                    : isCurrent && !dayDone ? coachTicks[`${plan.id}:${d.day}`] || [] : []
                  const canTick = isCurrent && !d.rest && (!dayDone || loggingAgain)
                  const showTicks = canTick || ticks.length > 0
                  return (
                    <>
                      <div className="px-3 pt-1 pb-3">
                        <div className="grid grid-cols-7 gap-1">
                          {days.map((x, i) => {
                            const isDone = !x.rest && done.has(x.day)
                            const isSel = i === selIdx
                            const circle = isDone ? 'bg-green-600 border-2 border-green-600 text-white'
                              : x.rest ? 'border border-gray-700 text-gray-500'
                              : 'border-2 border-orange-500 text-orange-300'
                            return (
                              <button key={x.day} type="button" onClick={() => select(x.day)} aria-pressed={isSel}
                                aria-label={`${formatDate(dates[i], country, 'weekday')}, ${x.rest ? 'Rest' : x.focus || 'Workout'}${isDone ? ', done' : ''}`}
                                className="flex flex-col items-center gap-1 py-1 min-h-[44px] rounded-xl focus:outline-none focus-visible:bg-gray-800">
                                <span className={`text-[11px] font-medium ${dates[i] === today ? 'text-orange-400' : 'text-gray-500'}`} aria-hidden="true">{x.day[0]}</span>
                                <span aria-hidden="true"
                                  className={`w-9 h-9 rounded-full grid place-items-center text-sm font-semibold ${circle} ${isSel ? 'ring-2 ring-white ring-offset-2 ring-offset-gray-900' : ''}`}>
                                  {isDone ? '✓' : parseDate(dates[i]).getDate()}
                                </span>
                                <span aria-hidden="true" className={`w-1.5 h-1.5 rounded-full ${dates[i] === today ? 'bg-orange-500' : 'bg-transparent'}`} />
                              </button>
                            )
                          })}
                        </div>
                        <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 mt-2 text-[11px] text-gray-500" aria-hidden="true">
                          <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-green-600" />Done</span>
                          <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full border-2 border-orange-500" />Workout</span>
                          <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full border border-gray-600" />Rest</span>
                          <span className="inline-flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-orange-500" />Today</span>
                        </div>
                      </div>
                      <div className="border-t border-gray-800 px-4 py-4 space-y-3">
                        <div>
                          <p className="text-xs text-gray-500">{formatDate(dates[selIdx], country, 'weekday')}</p>
                          <p className={`text-base font-semibold mt-0.5 ${d.rest ? 'text-gray-300' : 'text-white'}`}>{d.rest ? 'Rest day' : d.focus || 'Workout'}</p>
                          {dayDone && <p className="text-xs text-green-400 mt-1">✓ Done{notes ? ` · ${notes}` : ''}</p>}
                        </div>
                        {d.rest && <p className="text-sm text-gray-400">Rest and recovery. Nothing to log.</p>}
                        {d.exercises.length > 0 && (
                          <ol className={`divide-y divide-gray-800 rounded-xl border border-gray-800 ${d.rest ? 'opacity-70' : 'bg-gray-950/40'}`}>
                            {d.rest && <li className="px-3 py-2 text-[11px] uppercase tracking-wider text-gray-500">Optional</li>}
                            {d.exercises.map((e, i) => {
                              const ticked = ticks.includes(i)
                              const body = (
                                <>
                                  {showTicks && (
                                    <span aria-hidden="true"
                                      className={`mt-0.5 w-5 h-5 shrink-0 rounded-full border grid place-items-center text-[11px] font-bold ${ticked ? 'bg-green-600 border-green-500 text-white' : 'border-gray-600 text-transparent'}`}>✓</span>
                                  )}
                                  <span className="flex-1 min-w-0">
                                    <span className="flex items-baseline justify-between gap-3">
                                      <span className={`text-sm ${ticked ? 'text-gray-400 line-through decoration-gray-600' : 'text-gray-100'}`}>{e.name}</span>
                                      {exerciseDetail(e) && <span className="text-xs text-orange-300 shrink-0 text-right">{exerciseDetail(e)}</span>}
                                    </span>
                                    {e.note && <span className="block text-[11px] text-gray-500 mt-0.5">{e.note}</span>}
                                  </span>
                                </>
                              )
                              return (
                                <li key={i}>
                                  {canTick ? (
                                    <>
                                      <button type="button" role="checkbox" aria-checked={ticked}
                                        onClick={() => toggleCoachTick(plan.id, d.day, i)}
                                        className="w-full min-h-[44px] flex items-start gap-3 text-left px-3 py-2.5">
                                        {body}
                                      </button>
                                      {ticked && renderWeightRow(`${plan.id}:${d.day}`, i, e)}
                                    </>
                                  ) : (
                                    <div className="flex items-start gap-3 px-3 py-2">{body}</div>
                                  )}
                                </li>
                              )
                            })}
                          </ol>
                        )}
                        {isCurrent && !d.rest && renderMarkPanel(d, dayLabel(d))}
                        {planJson.note && <p className="text-[11px] text-gray-500">{planJson.note}</p>}
                      </div>
                    </>
                  )
                }

                if (variant === 'current') return (
                  <div key={plan.id} id={`plan-${plan.id}`} className={`scroll-mt-20 bg-gray-900 rounded-2xl border transition-shadow duration-700 ${ring}`}>
                    <div className="flex items-start gap-2 px-4 pt-3 pb-2">
                      <div className="flex-1 min-w-0 pt-1">
                        <p className="text-[11px] font-semibold text-orange-400 uppercase tracking-wider">This week</p>
                        <p className="text-sm font-semibold text-white mt-0.5">
                          {formatDate(start, country, 'weekday')} – {formatDate(weekEnd(plan.week_start), country, 'weekday')}
                          {plan.workout_time && <span className="text-xs font-normal text-orange-400"> · ⏰ {plan.workout_time}</span>}
                        </p>
                      </div>
                      <div className="pt-2">{badge}</div>
                      {renderPlanMenu(plan, true)}
                    </div>
                    {renderWeek()}
                  </div>
                )
                return (
                  <div key={plan.id} id={`plan-${plan.id}`} className={`scroll-mt-20 bg-gray-900 rounded-2xl border transition-shadow duration-700 ${ring}`}>
                    <div className="flex items-center gap-2 pr-4">
                      <button type="button" onClick={() => { setExpandedPlanId(open ? null : plan.id); closeMarkForm() }} aria-expanded={open}
                        className="flex-1 min-w-0 min-h-[56px] text-left pl-4 py-3 flex items-center gap-3 rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500">
                        <span className="flex-1 min-w-0">
                          <span className="block text-sm font-semibold text-white">
                            {formatDate(start, country, 'dayMonth')} – {formatDate(weekEnd(plan.week_start), country, 'dayMonth')}
                          </span>
                          <span className="block text-xs text-gray-500 mt-0.5">
                            {summary.days.length > 0
                              ? `${s(summary.workoutDays, 'workout')}${summary.exercises > 0 ? ` · ${s(summary.exercises, 'exercise')}` : ''}`
                              : 'Text plan'}
                            {plan.workout_time ? ` · ⏰ ${plan.workout_time}` : ''}
                          </span>
                        </span>
                        {badge}
                        <span className="text-gray-500 text-xs" aria-hidden="true">{open ? '▾' : '▸'}</span>
                      </button>
                      {open && renderPlanMenu(plan)}
                    </div>
                    {open && renderWeek()}
                  </div>
                )
              }

              const lastEnded = past[0] ? formatDate(weekEnd(past[0].week_start), country, 'weekday') : ''
              return (
                <div className="space-y-5">
                  {upcoming.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs text-gray-500 uppercase tracking-wider px-1">Upcoming</p>
                      {upcoming.map(p => renderPlan(p, 'row'))}
                    </div>
                  )}
                  {cur ? renderPlan(cur, 'current') : (
                    <div className="bg-gray-900 rounded-2xl border border-gray-800 px-6 py-8 text-center">
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-10 h-10 mx-auto text-gray-500" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
                      </svg>
                      <p className="text-base font-semibold text-white mt-3">No plan for this week</p>
                      {lastEnded && <p className="text-xs text-gray-500 mt-1">Last plan ended {lastEnded}</p>}
                      <button type="button" onClick={openNewPlanSheet} disabled={generatingPlan}
                        className="mt-5 w-full sm:w-auto sm:px-10 min-h-[48px] bg-orange-500 hover:bg-orange-400 text-white text-sm font-semibold rounded-xl transition disabled:opacity-50">
                        + New plan
                      </button>
                    </div>
                  )}
                  {past.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs text-gray-500 uppercase tracking-wider px-1">Past plans</p>
                      {shownPast.map(p => renderPlan(p, 'row'))}
                      {past.length > PAST_SHOWN && (
                        <button onClick={() => setShowAllPlans(!showAllPlans)}
                          className="w-full min-h-[44px] text-xs text-gray-400 hover:text-white border border-gray-800 hover:border-gray-600 rounded-xl transition">
                          {showAllPlans ? 'Show fewer' : `Show older plans (${past.length - PAST_SHOWN})`}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )
            })()}
          </div>
        )}

        {/* SESSIONS TAB */}
        {activeTab === 'sessions' && (
          <div className="space-y-3">
            {attendanceMode && renderAttendance()}
            {/* Last trained (moved here from Before you start) */}
            {!attendanceMode && (() => {
              const b = beforeYouStart({ ...client, id: clientId }, sessions.map(x => ({ ...x, client_id: clientId })), { ...Object.fromEntries(staff.map(x => [x.id, x.full_name])), ...staffNames }, localDateIso(), sw.one, new Set(staff.filter(x => x.role === 'coach').map(x => x.id)))
              return (
                <div className="bg-gray-900 rounded-2xl px-5 py-4 border border-gray-800 flex items-center justify-between gap-3">
                  <p className="text-sm text-white">
                    {b.daysSinceLast === null ? 'No sessions yet'
                      : b.daysSinceLast === 0 ? 'Last trained today'
                      : `Last trained ${b.daysSinceLast} day${b.daysSinceLast === 1 ? '' : 's'} ago`}
                  </p>
                  {b.totalSessions > 0 && <p className="text-xs text-gray-500 shrink-0">{b.totalSessions} session{b.totalSessions === 1 ? '' : 's'}</p>}
                </div>
              )
            })()}
            {/* Dojo: no plans, so staff log a session here (stop-gap attendance until Build 3) */}
            {dojo && !attendanceMode && (markKey === DOJO_LOG_KEY ? (
              <div className="bg-gray-900 rounded-2xl px-5 py-4 border border-gray-800">
                {coveringBadge()}
                <SessionForm mode="day" idPrefix="dojo-log" value={markForm} onChange={setMarkForm}
                  feelingEnabled={!isCoach}
                  country={country} notesEnabled={(client as { companies?: { session_notes_enabled?: boolean | null } } | null)?.companies?.session_notes_enabled !== false}
                  notesLabel="Notes (optional)"
                  error={markError} saving={savingMark} submitLabel={`Save session for ${clientFirstName}`}
                  onSubmit={() => handleCoachLogDay(null, null, null)} onCancel={closeMarkForm}
                  heading={<p className="text-xs font-semibold text-green-400">Session for {clientFirstName}</p>} />
              </div>
            ) : (
              <button type="button" onClick={() => openMarkForm(DOJO_LOG_KEY)}
                className="w-full min-h-[44px] bg-gray-900 hover:bg-gray-800 border border-gray-800 rounded-2xl text-sm text-orange-400 font-medium transition">
                + Log session for {clientFirstName}
              </button>
            ))}
            {renderShare()}
            {sessions.length === 0 ? (attendanceMode ? null : (
              <div className="bg-gray-900 rounded-2xl p-10 text-center text-gray-500 border border-gray-800">
                No sessions logged yet.
              </div>
            )) : (
              [...sessions].reverse().map(session => {
                const fb = getFeedback(session.id)
                return (
                  <div key={session.id} className="bg-gray-900 rounded-2xl p-5 border border-gray-800">
                    <div className="flex justify-between items-start mb-3">
                      <div>
                        <p className="text-sm font-medium text-white">
                          {formatDate(session.session_date, country, 'weekday')}
                          {!coachCompany && <span className="text-xs font-normal text-gray-500"> · {loggedByText(session)}</span>}
                        </p>
                        {session.duration_minutes && (
                          <p className="text-xs text-gray-500 mt-0.5">{session.activity ? <span className="text-gray-300">{activityText(session.activity)} · </span> : null}{session.duration_minutes} min{sessionKcal(session) ? ` · ${kcalText(sessionKcal(session))} (est.)` : ''}</p>
                        )}
                        {session.plan_day && (
                          <p className="text-xs text-green-400 mt-1">
                            ✓ {session.plan_day}
                            {(() => {
                              const ex = session.exercises_done as ExercisesDone | null | undefined
                              return ex && Array.isArray(ex.done) && ex.total ? <span className="text-gray-400"> · {ex.done.length} of {ex.total} exercise{ex.total === 1 ? '' : 's'}</span> : null
                            })()}
                          </p>
                        )}
                        {/* Weight / reps per exercise (#80): "Squat 3×10 @ 12 kg" */}
                        {logsBySession[session.id]?.length ? (
                          <ul className="mt-1.5 space-y-0.5">
                            {[...logsBySession[session.id]].sort((a, b) => a.position - b.position).map(l => (
                              <li key={l.id} className="text-xs text-gray-300">{logLine(l)}</li>
                            ))}
                          </ul>
                        ) : null}
                      </div>
                      {fb?.star_rating && (
                        <div className="flex gap-0.5">
                          {[1,2,3,4,5].map(s => (
                            <span key={s} className={s <= fb.star_rating ? 'text-orange-400 text-sm' : 'text-gray-700 text-sm'}>★</span>
                          ))}
                        </div>
                      )}
                    </div>
                    {session.notes && (
                      <p className="text-xs text-gray-400 mb-3 bg-gray-800 rounded-lg px-3 py-2">{session.notes}</p>
                    )}
                    {/* Coaches read feedback but can't give it */}
                    {(client as any)?.companies?.feedback_enabled !== false && isCoach && fb?.admin_feedback && (
                      <div className="border-t border-gray-800 pt-3">
                        <p className="text-xs text-gray-500 mb-1 uppercase tracking-wider">Feedback</p>
                        <p className="text-xs text-gray-300 whitespace-pre-wrap">{fb.admin_feedback}</p>
                      </div>
                    )}
                    {(client as any)?.companies?.feedback_enabled !== false && !isCoach && (
                    <div className="border-t border-gray-800 pt-3">
                      <label className="text-xs text-gray-500 mb-1.5 block uppercase tracking-wider">Your feedback</label>
                      <textarea
                        placeholder="Add coaching feedback..."
                        defaultValue={fb?.admin_feedback || ''}
                        onChange={e => setFeedbackText({ ...feedbackText, [session.id]: e.target.value })}
                        rows={2}
                        className="w-full bg-gray-800 text-white rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-xs resize-none" />
                      <button
                        onClick={() => handleSaveFeedback(session.id)}
                        className="mt-2 bg-orange-500 hover:bg-orange-400 text-white text-xs px-4 py-1.5 rounded-lg transition font-medium">
                        {savedFeedback[session.id] ? '✓ Saved!' : 'Save Feedback'}
                      </button>
                    </div>
                    )}
                  </div>
                )
              })
            )}
          </div>
        )}

        {/* PROGRESS TAB */}
        {activeTab === 'progress' && attendanceMode && (
          <div className="space-y-4">
            {renderAttendanceSummary()}
            {renderShare()}
          </div>
        )}
        {activeTab === 'progress' && !attendanceMode && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-gray-900 rounded-2xl p-4 border border-gray-800 text-center">
                <p className="text-2xl font-bold text-orange-500">{sessions.length}</p>
                <p className="text-xs text-gray-500 mt-1">Total Activities</p>
              </div>
              <div className="bg-gray-900 rounded-2xl p-4 border border-gray-800 text-center">
                <p className="text-2xl font-bold text-orange-500">{totalMinutes}</p>
                <p className="text-xs text-gray-500 mt-1">Total Minutes</p>
              </div>
            </div>
            {renderShare()}
            {!dojo && (() => {
              // Plan adherence: this week's plan and the last 4 weeks (not for dojos: no plans)
              const cur = currentPlan(plans)
              const week = cur ? planAdherence(cur, countSessions) : null
              const four = recentAdherence(plans, countSessions, 4)
              return (
                <div className="bg-gray-900 rounded-2xl px-5 py-4 border border-gray-800 grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs text-gray-500 uppercase tracking-wider">Plan this week</p>
                    {week ? (
                      <p className="mt-1"><span className={`text-2xl font-bold ${pctColor(pct(week))}`}>{week.done} of {week.planned}</span> <span className="text-xs text-gray-500">day{week.planned === 1 ? '' : 's'} done</span></p>
                    ) : (
                      <p className="text-sm text-amber-400 mt-1">{cur ? 'Plan has no clear days' : 'No plan this week'}</p>
                    )}
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 uppercase tracking-wider">Last 4 weeks</p>
                    {four ? (
                      <p className="mt-1"><span className={`text-2xl font-bold ${pctColor(pct(four))}`}>{pct(four)}%</span> <span className="text-xs text-gray-500">{four.done} of {four.planned} day{four.planned === 1 ? '' : 's'}</span></p>
                    ) : (
                      <p className="text-sm text-gray-500 mt-1">No plans yet</p>
                    )}
                  </div>
                </div>
              )
            })()}
            {client?.weight_kg ? (
              <div className="bg-gray-900 rounded-2xl px-5 py-4 border border-gray-800 flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wider">Calories since Mon</p>
                  <p className="text-[11px] text-gray-600 mt-0.5">Estimate from workout type, minutes and {client.weight_kg} kg · last Mon–Sun {kcalText(lastWeekKcal) || '~0 kcal'}</p>
                </div>
                <p className="text-2xl font-bold text-orange-500 shrink-0">{kcalText(weekKcal) || '~0 kcal'}</p>
              </div>
            ) : (
              <p className="text-xs text-gray-500 px-1">Add the client&apos;s weight in Profile to see calorie estimates.</p>
            )}
            {sessions.length === 0 ? (
              <div className="bg-gray-900 rounded-2xl p-10 text-center text-gray-500 border border-gray-800">
                No activities logged yet by this client.
              </div>
            ) : chartData && (
<ProgressCharts labels={chartData.labels} sessionCounts={chartData.sessionCounts} minuteCounts={chartData.minuteCounts} />
            )}
            {/* Weight per exercise (#80): top weight per week (last 8) or month (last 6); hidden with nothing to show */}
            {exerciseLogsOn && <ExerciseProgressChart logs={datedLogs} library={exLibrary} today={localDateIso()} country={country ?? 'IN'} />}
          </div>
        )}
        </>)}

        {/* PROFILE — always for regular member, tab-conditional for PT */}
        {(client?.client_type !== 'pt' || activeTab === 'profile') && (
  <div className="space-y-4">

    {/* Membership card — PT only (regular members see this in stat cards at top) */}
    {client?.client_type === 'pt' && (
      <div className="bg-gray-900 rounded-2xl p-5 border border-gray-800 space-y-3">
        <p className="text-xs text-gray-500 uppercase tracking-wider">Membership</p>
        {memberships.length === 0 ? (
          <p className="text-sm text-gray-600">No membership on record.</p>
        ) : (
          <>
            {(() => {
              const m = memberships[0]
              const days = daysLeftFromDate(m.end_date)
              const pct = elapsedPct(m.start_date, m.end_date)
              const color = days < 0 ? 'text-red-400' : days <= 11 ? 'text-amber-400' : 'text-green-400'
              const barColor = days < 0 ? 'bg-red-500' : days <= 11 ? 'bg-amber-500' : 'bg-green-500'
              return (
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="text-sm font-semibold text-white">{m.plan_type}</p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {formatDate(m.start_date, country, 'medium')}
                        {' → '}
                        {formatDate(m.end_date, country, 'medium')}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className={`text-sm font-bold ${color}`}>{Math.abs(days)} {days < 0 ? 'days overdue' : 'days left'}</p>
                      {!isCoach && <p className="text-xs text-gray-500">{moneyOf(m)}</p>}
                    </div>
                  </div>
                  <div className="w-full bg-gray-700 rounded-full h-1.5">
                    <div className={`h-1.5 rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              )
            })()}
            {memberships.length > 1 && !isCoach && (
              <div className="border-t border-gray-800 pt-3 space-y-2">
                <p className="text-xs text-gray-600 uppercase tracking-wider">History</p>
                {memberships.slice(1).map(m => (
                  <div key={m.id} className="flex justify-between items-center text-xs text-gray-500">
                    <span>{m.plan_type} · {formatDate(m.start_date, country, 'monthYear')} – {formatDate(m.end_date, country, 'monthYear')}</span>
                    <span>{moneyOf(m)}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    )}

    <div className="bg-gray-900 rounded-2xl p-5 border border-gray-800 space-y-4">

      {/* Card header with Edit button */}
      <div className="flex justify-between items-center">
        <h2 className="font-semibold text-white">{dojo ? `${memberWord(dojoType).one} Profile` : 'Client Fitness Profile'}</h2>
        {!isCoach && <button
          onClick={() => {
            if (editingClientProfile) {
              setEditingClientProfile(false)
            } else {
              setClientProfileForm({
                trainer_name: client?.trainer_name || '',
                diet_plan: client?.diet_plan || '',
                goal: client?.goal || '',
                age: client?.age?.toString() || '',
                gender: client?.gender || '',
                height_cm: client?.height_cm?.toString() || '',
                weight_kg: client?.weight_kg?.toString() || '',
                fitness_level: client?.fitness_level || '',
                food_preference: client?.food_preference || '',
                meals_per_day: client?.meals_per_day?.toString() || '',
                available_days: client?.available_days || '',
                medical_conditions: client?.medical_conditions || '',
                emergency_contact_name: client?.emergency_contact_name || '',
                emergency_contact_phone: client?.emergency_contact_phone || '',
                guardian_name: client?.guardian_name || '',
                guardian_phone: displayPhone(client?.guardian_phone, country),
                guardian_relation: client?.guardian_relation || '',
                branch_id: client?.branch_id || '',
                batch_id: client?.batch_id || '',
                rank_id: client?.current_rank_id || '',
                belt_since: client?.rank_achieved_on || '',
              })
              setEditingClientProfile(true)
            }
          }}
          className="text-xs text-orange-500 hover:text-orange-400 border border-orange-900 hover:border-orange-500 px-3 py-1.5 rounded-lg transition">
          {editingClientProfile ? 'Cancel' : 'Edit'}
        </button>}
      </div>

      {editingClientProfile && !isCoach ? (
        <div className="space-y-4">
          {/* Dojo profile: age, gender, medical conditions and parent only (other fields hidden, saved values kept) */}
          {/* Goal */}
          {!dojo && <div>
            <label className="text-xs text-gray-500 mb-1.5 block uppercase tracking-wider">Goal</label>
            <textarea
              placeholder="Client's fitness goal..."
              value={clientProfileForm.goal}
              onChange={e => setClientProfileForm({ ...clientProfileForm, goal: e.target.value })}
              rows={2}
              className="w-full bg-gray-800 text-white rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm resize-none" />
          </div>}

          {/* Belt + since when (belt grading on): a set belt can be changed, not cleared; each change is kept in the history */}
          {beltsOn && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-500 mb-1.5 block uppercase tracking-wider">Belt</label>
                <select value={clientProfileForm.rank_id} aria-label="Belt"
                  onChange={e => setClientProfileForm({ ...clientProfileForm, rank_id: e.target.value })}
                  className="w-full bg-gray-800 text-white rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm">
                  {!client?.current_rank_id && <option value="">Belt not set</option>}
                  {beltOptions(beltRanks, client?.current_rank_id).map(r => <option key={r.id} value={r.id}>{beltLabel(r)}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1.5 block uppercase tracking-wider">Belt since</label>
                <input type="date" aria-label="Belt since"
                  value={clientProfileForm.belt_since}
                  onChange={e => setClientProfileForm({ ...clientProfileForm, belt_since: e.target.value })}
                  className="w-full bg-gray-800 text-white rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm" />
              </div>
            </div>
          )}

          {/* Age + Gender */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500 mb-1.5 block uppercase tracking-wider">Age</label>
              <input type="number" placeholder="e.g. 30"
                value={clientProfileForm.age}
                onChange={e => setClientProfileForm({ ...clientProfileForm, age: e.target.value })}
                className="w-full bg-gray-800 text-white rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm" />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1.5 block uppercase tracking-wider">Gender</label>
              <select
                value={clientProfileForm.gender}
                onChange={e => setClientProfileForm({ ...clientProfileForm, gender: e.target.value })}
                className="w-full bg-gray-800 text-white rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm">
                <option value="">—</option>
                <option>Male</option>
                <option>Female</option>
                <option>Other</option>
              </select>
            </div>
          </div>

          {!dojo && <>
          {/* Height + Weight */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500 mb-1.5 block uppercase tracking-wider">Height (cm)</label>
              <input type="number" placeholder="e.g. 170"
                value={clientProfileForm.height_cm}
                onChange={e => setClientProfileForm({ ...clientProfileForm, height_cm: e.target.value })}
                className="w-full bg-gray-800 text-white rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm" />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1.5 block uppercase tracking-wider">Weight (kg)</label>
              <input type="number" placeholder="e.g. 70"
                value={clientProfileForm.weight_kg}
                onChange={e => setClientProfileForm({ ...clientProfileForm, weight_kg: e.target.value })}
                className="w-full bg-gray-800 text-white rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm" />
            </div>
          </div>

          {/* Fitness Level + Food Preference */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500 mb-1.5 block uppercase tracking-wider">Fitness Level</label>
              <select
                value={clientProfileForm.fitness_level}
                onChange={e => setClientProfileForm({ ...clientProfileForm, fitness_level: e.target.value })}
                className="w-full bg-gray-800 text-white rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm">
                <option value="">—</option>
                <option>Beginner</option>
                <option>Intermediate</option>
                <option>Advanced</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1.5 block uppercase tracking-wider">Food Preference</label>
              <select
                value={clientProfileForm.food_preference}
                onChange={e => setClientProfileForm({ ...clientProfileForm, food_preference: e.target.value })}
                className="w-full bg-gray-800 text-white rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm">
                <option value="">—</option>
                <option>Vegetarian</option>
                <option>Non-Vegetarian</option>
                <option>Vegan</option>
                <option>Eggetarian</option>
                <option>Jain</option>
              </select>
            </div>
          </div>

          {/* Meals per day (used by the AI diet chart) */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500 mb-1.5 block uppercase tracking-wider">Meals per day</label>
              <select
                value={clientProfileForm.meals_per_day}
                onChange={e => setClientProfileForm({ ...clientProfileForm, meals_per_day: e.target.value })}
                className="w-full bg-gray-800 text-white rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm">
                <option value="">—</option>
                <option value="3">3 meals</option>
                <option value="4">4 (3 meals + snack)</option>
                <option value="5">5 (3 meals + 2 snacks)</option>
                <option value="6">6 small meals</option>
              </select>
            </div>
          </div>

          {/* Available Days — toggle buttons */}
          <div>
            <label className="text-xs text-gray-500 mb-2 block uppercase tracking-wider">Available Days</label>
            <div className="flex gap-2 flex-wrap">
              {['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(day => {
                const selected = clientProfileForm.available_days
                  .split(',').map(d => d.trim()).includes(day)
                return (
                  <button key={day} type="button"
                    onClick={() => {
                      const days = clientProfileForm.available_days
                        ? clientProfileForm.available_days.split(',').map(d => d.trim()).filter(Boolean)
                        : []
                      const updated = selected ? days.filter(d => d !== day) : [...days, day]
                      setClientProfileForm({ ...clientProfileForm, available_days: updated.join(',') })
                    }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${selected
                      ? 'bg-orange-500 text-white'
                      : 'bg-gray-800 text-gray-400 border border-gray-700 hover:border-gray-500'}`}>
                    {day}
                  </button>
                )
              })}
            </div>
          </div>

          </>}

          {/* Dojo: branch and home batch (the student can still attend any batch) */}
          {dojo && batchesOn && branchList.length > 0 && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-500 mb-1.5 block uppercase tracking-wider">Branch</label>
                <select value={clientProfileForm.branch_id}
                  onChange={e => setClientProfileForm({ ...clientProfileForm, branch_id: e.target.value, batch_id: '' })}
                  className="w-full bg-gray-800 text-white rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm">
                  <option value="">—</option>
                  {branchList.filter(b => !b.is_archived || b.id === client?.branch_id).map(b => (
                    <option key={b.id} value={b.id}>{b.name}{b.is_archived ? ' (archived)' : ''}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1.5 block uppercase tracking-wider">Home batch</label>
                <select value={clientProfileForm.batch_id}
                  onChange={e => {
                    const batch = batchList.find(b => b.id === e.target.value)
                    setClientProfileForm({ ...clientProfileForm, batch_id: e.target.value, ...(batch ? { branch_id: batch.branch_id } : {}) })
                  }}
                  className="w-full bg-gray-800 text-white rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm">
                  <option value="">—</option>
                  {sortBatches(batchList.filter(b => (!b.is_archived || b.id === client?.batch_id)
                    && (!clientProfileForm.branch_id || b.branch_id === clientProfileForm.branch_id))).map(b => (
                    <option key={b.id} value={b.id}>{b.name}{batchWhen(b, country) ? ` (${batchWhen(b, country)})` : ''}{b.is_archived ? ' (archived)' : ''}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {/* Medical Conditions */}
          <div>
            <label className="text-xs text-gray-500 mb-1.5 block uppercase tracking-wider">Medical Conditions / Injuries</label>
            <textarea
              placeholder="e.g. Knee injury, hypertension..."
              value={clientProfileForm.medical_conditions}
              onChange={e => setClientProfileForm({ ...clientProfileForm, medical_conditions: e.target.value })}
              rows={2}
              className="w-full bg-gray-800 text-white rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm resize-none" />
          </div>

          {/* Emergency Contact (not for dojos: the parent is the contact) */}
          {!dojo && <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500 mb-1.5 block uppercase tracking-wider">Emergency Contact</label>
              <input type="text" placeholder="Name"
                value={clientProfileForm.emergency_contact_name}
                onChange={e => setClientProfileForm({ ...clientProfileForm, emergency_contact_name: e.target.value })}
                className="w-full bg-gray-800 text-white rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm" />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1.5 block uppercase tracking-wider">Emergency Phone</label>
              <input type="tel" placeholder="Phone"
                value={clientProfileForm.emergency_contact_phone}
                onChange={e => setClientProfileForm({ ...clientProfileForm, emergency_contact_phone: e.target.value })}
                className="w-full bg-gray-800 text-white rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm" />
            </div>
          </div>}

          {/* Parent / guardian (once db/2026-11-03-guardian.md has run): fee reminders and progress shares go to this phone */}
          {client && 'guardian_phone' in client && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-500 mb-1.5 block uppercase tracking-wider">Parent / guardian</label>
                <input type="text" placeholder="Name"
                  value={clientProfileForm.guardian_name}
                  onChange={e => setClientProfileForm({ ...clientProfileForm, guardian_name: e.target.value })}
                  className="w-full bg-gray-800 text-white rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm" />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1.5 block uppercase tracking-wider">Relation</label>
                <select value={clientProfileForm.guardian_relation}
                  onChange={e => setClientProfileForm({ ...clientProfileForm, guardian_relation: e.target.value })}
                  className="w-full bg-gray-800 text-white rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm">
                  <option value="">—</option>
                  {GUARDIAN_RELATIONS.map(r => <option key={r}>{r}</option>)}
                </select>
              </div>
              <div className="col-span-2">
                <label className="text-xs text-gray-500 mb-1.5 block uppercase tracking-wider">Parent phone</label>
                <input type="tel" placeholder={`Phone (${phoneHint(phoneCountry(client.country || country))}; another country: start with +)`}
                  value={clientProfileForm.guardian_phone}
                  onChange={e => setClientProfileForm({ ...clientProfileForm, guardian_phone: e.target.value })}
                  className="w-full bg-gray-800 text-white rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm" />
              </div>
            </div>
          )}

          {/* Trainer + Diet (not for dojos: the sensei is picked on the Profile tab, no diet) */}
          {!dojo && <div className={`border-t pt-4 space-y-3 ${client?.client_type === 'pt' ? 'border-purple-800' : 'border-gray-800'}`}>
            <p className="text-xs text-gray-500 uppercase tracking-wider">Trainer & Diet</p>
            <div>
              {!coachCompany && (<>
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">{client?.client_type === 'pt' ? 'Primary coach' : 'Trainer'}</p>
              <p className="text-xs text-gray-400">Pick the coach from the dropdown on the Profile tab (after saving).</p>
              </>)}
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1.5 block uppercase tracking-wider">Diet Plan</label>
              <textarea
                placeholder="e.g. High protein breakfast, avoid sugar..."
                value={clientProfileForm.diet_plan}
                onChange={e => setClientProfileForm({ ...clientProfileForm, diet_plan: e.target.value })}
                rows={4}
                className="w-full bg-gray-800 text-white rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm resize-none" />
            </div>
          </div>}

          {clientProfileMessage && (
            <p className="text-green-400 text-sm">{clientProfileMessage}</p>
          )}
          <button
            onClick={handleSaveClientProfile}
            disabled={savingClientProfile}
            className="w-full bg-orange-500 hover:bg-orange-400 text-white font-semibold py-2.5 rounded-xl transition disabled:opacity-50 text-sm">
            {savingClientProfile ? 'Saving...' : 'Save Profile'}
          </button>
        </div>
      ) : (
        <>
          {/* Goal */}
          {client?.goal && !dojo && (
            <div className="bg-orange-950 border border-orange-900 rounded-xl px-4 py-3">
              <p className="text-xs text-orange-400 uppercase tracking-wider mb-1">Goal</p>
              <p className="text-sm text-orange-200">{client.goal}</p>
            </div>
          )}

          {/* Basic Info */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Age</p>
              <p className="text-sm text-white">{client?.age || '—'}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Gender</p>
              <p className="text-sm text-white">{client?.gender || '—'}</p>
            </div>
            {!dojo && <>
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Height</p>
              <p className="text-sm text-white">{client?.height_cm ? `${client.height_cm} cm` : '—'}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Weight</p>
              <p className="text-sm text-white">{client?.weight_kg ? `${client.weight_kg} kg` : '—'}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Fitness Level</p>
              <p className="text-sm text-white">{client?.fitness_level || '—'}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Food Preference</p>
              <p className="text-sm text-white">{client?.food_preference || '—'}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Meals per day</p>
              <p className="text-sm text-white">{client?.meals_per_day || '—'}</p>
            </div>
            </>}
          </div>

          {/* Available Days */}
          {client?.available_days && !dojo && (
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Available Days</p>
              <div className="flex gap-2 flex-wrap">
                {client.available_days.split(',').map(day => (
                  <span key={day} className="px-3 py-1 bg-orange-500 text-white text-xs rounded-lg">
                    {day}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Dojo: branch and home batch */}
          {dojo && batchesOn && (client?.branch_id || client?.batch_id) && (() => {
            const batch = batchList.find(b => b.id === client?.batch_id)
            const branch = branchList.find(b => b.id === (client?.branch_id || batch?.branch_id))
            return (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Branch</p>
                  <p className="text-sm text-white">{branch ? `${branch.name}${branch.is_archived ? ' (archived)' : ''}` : '—'}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Home batch</p>
                  <p className="text-sm text-white">{batch ? `${batch.name}${batch.is_archived ? ' (archived)' : ''}` : '—'}</p>
                  {batch && batchWhen(batch, country) && <p className="text-xs text-gray-400">{batchWhen(batch, country)}</p>}
                </div>
              </div>
            )
          })()}

          {/* Belt (belt grading on): read-only here, changed with Edit */}
          {beltsOn && client && (() => {
            const rank = beltRanks.find(r => r.id === client.current_rank_id)
            return (
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Belt</p>
                <p className="text-sm text-white">
                  {rank ? beltLabel(rank) : <span className="text-gray-400">Belt not set</span>}
                  {rank && <span className="text-gray-400"> · since {client.rank_achieved_on ? formatDate(client.rank_achieved_on, country, 'medium') : '—'}</span>}
                </p>
              </div>
            )
          })()}

          {/* Medical Conditions */}
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Medical Conditions / Injuries</p>
            <p className="text-sm text-white">{client?.medical_conditions || '—'}</p>
          </div>

          {/* Emergency Contact (not for dojos: the parent is the contact) */}
          {!dojo && <div className="border-t border-gray-800 pt-4">
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Emergency Contact</p>
            <p className="text-sm text-white">{client?.emergency_contact_name || '—'}</p>
            <p className="text-sm text-gray-400">{client?.emergency_contact_phone || ''}</p>
          </div>}

          {/* Parent / guardian (dojo students; fee reminders and progress shares go here). Read-only for coaches too. */}
          {client && (client.guardian_name || client.guardian_phone) && (() => {
            const wa = waDigits(client.guardian_phone, country)
            return (
              <div className="border-t border-gray-800 pt-4">
                <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Parent / guardian</p>
                <p className="text-sm text-white">{client.guardian_name || '—'}{client.guardian_relation ? <span className="text-gray-400"> · {client.guardian_relation}</span> : null}</p>
                {client.guardian_phone && (
                  <p className="text-sm text-gray-400">
                    {displayPhone(client.guardian_phone, country)}
                    {wa && (
                      <a href={`https://wa.me/${wa}`} target="_blank" rel="noopener noreferrer"
                        className="ml-2 text-xs text-green-400 hover:text-green-300">WhatsApp</a>
                    )}
                  </p>
                )}
              </div>
            )
          })()}

          {/* Trainer + Diet Plan */}
          <div className={`border-t pt-4 space-y-3 ${client?.client_type === 'pt' ? 'border-purple-800' : 'border-gray-800'}`}>
            <p className="text-xs text-gray-500 uppercase tracking-wider">{dojo ? sw.one : 'Trainer & Diet'}</p>
            {client && (
              <div>
                {!coachCompany && (<>
                <label htmlFor="primary-coach" className="text-xs text-gray-500 uppercase tracking-wider mb-1 block">{client.client_type === 'pt' || dojo ? `Primary ${sw.one.toLowerCase()}` : 'Trainer'}</label>
                {isCoach ? (
                  <p id="primary-coach" className="text-sm text-white">{client.primary_coach_id ? (staff.find(x => x.id === client.primary_coach_id)?.full_name || sw.one) : `No primary ${sw.one.toLowerCase()}`}</p>
                ) : (
                <select id="primary-coach" value={client.primary_coach_id || ''} disabled={savingPrimaryCoach}
                  onChange={e => handleSavePrimaryCoach(e.target.value)}
                  className="w-full bg-gray-800 text-white rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm disabled:opacity-50">
                  <option value="">{client.client_type === 'pt' || dojo ? `No primary ${sw.one.toLowerCase()}` : 'No trainer'}</option>
                  {staff.filter(x => x.role === 'coach' && (!x.archived_at || x.id === client.primary_coach_id)).map(x => (
                    <option key={x.id} value={x.id}>{x.full_name}{x.archived_at ? ' (login off)' : ''}</option>
                  ))}
                </select>
                )}
                </>)}
                {client.trainer_name && (
                  <p className="text-xs text-gray-500 mt-1.5">Trainer (old typed name): <span className="text-gray-300">{client.trainer_name}</span></p>
                )}
              </div>
            )}
            {/* Diet plan + AI diet chart: not for dojos */}
            {!dojo && <div>
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Diet Plan</p>
              <p className="text-sm text-white whitespace-pre-wrap">{client?.diet_plan || '—'}</p>
            </div>}

            {/* AI diet chart (super admin can turn it off per gym; typed diet plans still work) */}
            {!dojo && !isCoach && (client as { companies?: { ai_diet_enabled?: boolean | null } } | null)?.companies?.ai_diet_enabled !== false && !dietDraft && !dietGenerating && (
              <div className="space-y-2">
                {(!client?.food_preference || !client?.weight_kg) && (
                  <p className="text-xs text-yellow-300">
                    Add {[!client?.food_preference && 'food preference', !client?.weight_kg && 'weight'].filter(Boolean).join(' and ')} (Edit above) for a better diet chart.
                  </p>
                )}
                <button onClick={handleGenerateDiet}
                  className="bg-green-700 hover:bg-green-600 text-white text-xs px-4 py-2 rounded-xl transition font-medium">
                  {client?.diet_plan ? '✨ Create a new diet chart with AI' : '✨ Create diet chart with AI'}
                </button>
              </div>
            )}
            {dietGenerating && (
              <div className="flex items-center gap-3 bg-gray-800/60 border border-green-900 rounded-xl px-4 py-3">
                <div className="w-5 h-5 rounded-full border-2 border-green-400 border-t-transparent animate-spin shrink-0" />
                <p className="text-sm text-gray-200">Creating a diet chart for {client?.full_name?.split(' ')[0] || 'this client'}… usually 10–20 seconds</p>
              </div>
            )}
            {dietError && !dietGenerating && (
              <div className="flex items-start gap-3 bg-red-950 border border-red-900 rounded-xl px-4 py-3">
                <p className="flex-1 text-sm text-red-300">{dietError}</p>
                <button onClick={handleGenerateDiet} className="text-xs text-white bg-red-800 hover:bg-red-700 px-3 py-1.5 rounded-lg">Try again</button>
              </div>
            )}
            {dietDraft && !dojo && (
              <div ref={dietPanelRef} className="scroll-mt-4 bg-gray-800/60 border border-green-800 rounded-xl p-4 space-y-3">
                <p className="text-xs text-green-400 font-medium">✨ AI diet chart: review and edit before saving</p>
                <textarea value={dietDraft} onChange={e => setDietDraft(e.target.value)} rows={14}
                  className="w-full bg-gray-800 text-white rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-green-500 border border-gray-700 text-sm resize-none" />
                {client?.diet_plan && <p className="text-xs text-gray-500">Saving replaces the current diet plan.</p>}
                <div className="flex gap-2">
                  <button onClick={handleSaveDiet} disabled={savingDiet || !dietDraft.trim()}
                    className="flex-1 bg-green-600 hover:bg-green-500 text-white font-semibold py-2.5 rounded-xl transition disabled:opacity-50 text-sm">
                    {savingDiet ? 'Saving...' : 'Save as diet plan'}
                  </button>
                  <button onClick={() => setDietDraft('')}
                    className="flex-1 bg-gray-800 hover:bg-gray-700 text-white text-sm py-2.5 rounded-xl transition">
                    Discard
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Contact */}
          <div className="border-t border-gray-800 pt-4">
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Contact</p>
            <p className="text-sm text-white">{displayPhone(client?.phone, country) || '—'}</p>
            <p className="text-sm text-gray-400">{shownEmail(client?.email)}</p>
            {/* How they log in (the coach is asked "what was my username?") */}
            <p className="text-xs text-gray-500 mt-1">
              {usernameOf(client?.email) ? <>Login: username <span className="text-gray-300">{usernameOf(client?.email)}</span></>
                : isNoLogin(client?.email) ? (isCoach ? 'No login yet' : 'No login yet · ⋯ → Create login')
                : isPhoneLogin(client?.email) ? 'Login: phone number' : client?.email ? 'Login: email' : ''}
            </p>
          </div>
        </>
      )}
    </div>
  </div>
)}
      </div>
      {/* Dojo: Log today's session (no plan) → Sessions tab with the form open */}
      {dojo && !attendanceMode && client?.client_type === 'pt' && trainModule && markKey !== DOJO_LOG_KEY && (
        <div className="fixed inset-x-0 bottom-0 z-40 bg-gray-950/95 backdrop-blur border-t border-gray-800 pb-[env(safe-area-inset-bottom)]">
          <div className="max-w-2xl mx-auto px-4 sm:px-6 py-3">
            <button type="button" onClick={() => { setActiveTab('sessions'); openMarkForm(DOJO_LOG_KEY) }}
              className="w-full min-h-[48px] bg-orange-500 hover:bg-orange-400 text-white text-sm font-semibold rounded-xl transition truncate px-4">
              Log today&apos;s session
            </button>
          </div>
        </div>
      )}
      {/* Log today's session: fixed at the bottom on every tab */}
      {todayLog && (
        <div className="fixed inset-x-0 bottom-0 z-40 bg-gray-950/95 backdrop-blur border-t border-gray-800 pb-[env(safe-area-inset-bottom)]">
          <div className="max-w-2xl mx-auto px-4 sm:px-6 py-3">
            <button type="button" onClick={openTodayLog}
              className="w-full min-h-[48px] bg-orange-500 hover:bg-orange-400 text-white text-sm font-semibold rounded-xl transition truncate px-4">
              {todayLog.label}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
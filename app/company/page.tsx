'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { rememberBranch, rememberedBranch } from '@/lib/branch-memory'
import { type AdherencePlan, type AdherenceSession, type Adherence, planAdherence, currentPlan, recentAdherence, pct, pctColor } from '@/lib/adherence'
import { type TodaySession, missedAndDue, loggerOf, sessionsByLogger } from '@/lib/todays-sessions'
import { type ExercisesDone } from '@/lib/plan-structure'
import { thisWeekMonday } from '@/lib/calories'
import { activityText } from '@/lib/activities'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import { formatMoney, formatMoneyCompact, currencySymbol, groupByCurrency, formatMoneyByCurrency, normalizeCurrency, CURRENCIES } from '@/lib/currency'
import { type Country, COUNTRIES, normalizeCountry, formatDate, loginMethod, phonePlaceholder, daysUntil, localDateIso, parseDate } from '@/lib/locale'
import { type PhoneCountry, validLocalDigits, clientPhoneValue, displayPhone, splitE164, staffLogin, isPhoneLogin, phoneHint, shownEmail, normalizeUsername, usernameProblem, usernameEmail, usernameOf } from '@/lib/phone'
import UsernameField, { type UsernameStatus } from '@/app/username-field'
import CountryCodePicker from '@/app/country-code-picker'
import { isOpen, sourceLabel, leadSummary, type Lead, type LeadStatus, type LeadSummary } from '@/lib/leads'
import { isCovering } from '@/lib/coach-today'
import { isCoachCompany } from '@/lib/company-type'
import { memberWord, isDojo, staffWord, ptWord } from '@/lib/labels'
import { type BeltRank, BELT_RANK_COLUMNS, gradingOn, beltLabel, beltOptions, defaultBeltId, beltsById } from '@/lib/belts'
import BeltChip from '@/app/belt-chip'
import { GUARDIAN_RELATIONS, reminderRecipient, reminderText, feeReminder } from '@/lib/guardian'
import { type Branch, type Batch, BRANCH_COLUMNS, BATCH_COLUMNS, homeBatchLine, sortBatches, batchWhen } from '@/lib/batches'
import { type AttendanceRow, ATTENDANCE_COLUMNS, batchesOn as batchesMeetingOn } from '@/lib/attendance'
import { latestMembership, daysLeft, membershipStatus } from '@/lib/dojo-home'
import DojoHome from './dojo-home'

type Membership = {
  id: string
  plan_type: string
  amount_paid: number
  start_date: string
  end_date: string
  created_at?: string
  currency?: string | null // the currency it was paid in (absent before db/2026-11-01-multi-country.md)
}

type Client = {
  id: string
  full_name: string
  email: string
  phone: string
  created_at: string
  client_type: string | null
  memberships: Membership[]
  archived_at: string | null
  primary_coach_id?: string | null
  country?: string | null  // client's own country / default currency (multi-country gyms)
  currency?: string | null
  // Parent / guardian (db/2026-11-03-guardian.md): undefined before that SQL runs
  guardian_name?: string | null
  guardian_phone?: string | null
  guardian_relation?: string | null
  // Branch and home batch (db/2026-11-03-branches-batches.md): undefined before that SQL runs
  branch_id?: string | null
  batch_id?: string | null
  // Current belt (belt grading, lib/belts.ts)
  current_rank_id?: string | null
}

// Coach logins (ROADMAP #40): PT clients and plans only. Off = archived_at set (never deleted).
type Coach = {
  id: string
  full_name: string
  phone: string | null
  email: string | null
  archived_at: string | null
}

const AVATAR_COLORS = [
  'bg-red-500', 'bg-orange-500', 'bg-amber-500', 'bg-emerald-500',
  'bg-teal-500', 'bg-blue-500', 'bg-indigo-500', 'bg-violet-500', 'bg-pink-500'
]

function avatarColor(index: number) {
  return AVATAR_COLORS[index % AVATAR_COLORS.length]
}

function initials(name: string) {
  return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
}

// latestMembership, daysLeft, membershipStatus: lib/dojo-home.ts (moved there unchanged, shared with the dojo home)

function elapsedPct(m: Membership): number {
  const total = new Date(m.end_date).getTime() - new Date(m.start_date).getTime()
  const elapsed = Date.now() - new Date(m.start_date).getTime()
  return Math.min(Math.max((elapsed / total) * 100, 0), 100)
}

function fmtDate(d: string, country: Country | null) {
  return formatDate(d, country, 'dayMonth')
}

// Gym owners don't edit the logo link; super admin uploads it (lib/branding-upload.ts).
const SHOW_LOGO_URL_SETTING = false

export default function CompanyAdminPage() {
  const router = useRouter()
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [companyName, setCompanyName] = useState('')
  // companies.upi_id (super admin sets it): adds the UPI lines to the dojo fee reminder
  const [upiId, setUpiId] = useState('')
  // Individual coach company (company_type = 'coach'): no coaches, coach assignment or "logged by" names
  const [coachCompany, setCoachCompany] = useState(false)
  // companies.business_type (super admin): martial_arts = a dojo, "Students" instead of "Members" (lib/labels.ts)
  const [businessType, setBusinessType] = useState<string | null>(null)
  const mw = memberWord(businessType)
  // Dojo: "Sensei" for coach logins, every student is a PT client (no PT checkbox / badges), no exercise list
  const sw = staffWord(businessType)
  const dojo = isDojo(businessType)
  // The guardian columns exist on profiles (db/2026-11-03-guardian.md): only then the parent fields show and are sent
  const [guardianColumns, setGuardianColumns] = useState(false)
  // Branches & batches (dojos, db/2026-11-03-branches-batches.md): on once the tables exist. 'all' | branch id | 'none'
  const [batchesOn, setBatchesOn] = useState(false)
  const [branchList, setBranchList] = useState<Branch[]>([])
  const [batchList, setBatchList] = useState<Batch[]>([])
  const [branchFilter, setBranchFilter] = useState<string>('all')
  // Dojo attendance (#78): today's present rows; null = attendance not set up yet (then sessions as before)
  const [attToday, setAttToday] = useState<AttendanceRow[] | null>(null)
  // Dojo: branches / batches / attendance have been asked for (until then a skeleton, not the gym dashboard)
  const [batchesChecked, setBatchesChecked] = useState(false)
  // profiles.role of the person logged in (company_admin = Owner, partner = Partner): shown on the dojo home
  const [myRole, setMyRole] = useState<string | null>(null)
  // Belt grading (companies.grading_enabled, super admin; lib/belts.ts): the gym's belts. Empty = off (Belt fields hidden)
  const [beltRanks, setBeltRanks] = useState<BeltRank[]>([])
  const beltsOn = beltRanks.length > 0
  const beltById = useMemo(() => beltsById(beltRanks), [beltRanks])
  const [currency, setCurrency] = useState<string | null>(null)
  const [country, setCountry] = useState<Country | null>(null)
  // Multi-country gyms (super admin switch): clients have their own country / currency, payments any allowed currency.
  // Off (or before db/2026-11-01-multi-country.md runs): no new fields anywhere.
  const [multiCountry, setMultiCountry] = useState(false)
  const [allowedCurrencies, setAllowedCurrencies] = useState<string[]>([])
  // The multi-country columns exist: memberships get a currency
  const [currencyColumns, setCurrencyColumns] = useState(false)
  const [toast, setToast] = useState<{ text: string; kind: 'success' | 'error' } | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const showToast = (text: string, kind: 'success' | 'error' = 'success') => {
    if (toastTimer.current) clearTimeout(toastTimer.current)
    setToast({ text, kind })
    toastTimer.current = setTimeout(() => setToast(null), 3000)
  }
  const [clientLimit, setClientLimit] = useState<number>(50)
  const [ptLimit, setPtLimit] = useState<number | null>(null)
  const [trialInfo, setTrialInfo] = useState<{ trial_end: string; is_active: boolean; is_trial: boolean } | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [newClient, setNewClient] = useState({
    full_name: '', email: '', password: '', phone: '', trainer_name: '', diet_plan: '', username: '',
    plan_type: '1 Month', amount_paid: '',
    start_date: new Date().toISOString().split('T')[0], end_date: '',
    client_type: 'member', primary_coach_id: '',
    // Multi-country only: the client's country, the phone's country code and the payment currency ('' = home / base)
    country: '', phone_country: '', currency: '',
    // Child with a parent (guardian columns only). child null = the default: ticked for a dojo (martial arts), else not
    child: null as boolean | null, guardian_name: '', guardian_phone: '', guardian_phone_country: '', guardian_relation: 'Mother',
    // Dojo: the short profile on the same screen (age, gender, medical conditions)
    age: '', gender: '', medical_conditions: '',
    // Dojo with branches & batches: branch and home batch ('' = none)
    branch_id: '', batch_id: '',
    // Belt grading on: belt ('' = the first belt, White) and since when (null = the membership start date)
    rank_id: '', belt_since: null as string | null,
  })
  // "Convert to member" from the Leads page (/company?fromLead=<id>): the enquiry the Add Member form was prefilled from
  const [fromLead, setFromLead] = useState<{ id: string; name: string; source: string | null } | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [showSettings, setShowSettings] = useState(false)
  const [passwordData, setPasswordData] = useState({ newPassword: '', confirmPassword: '' })
  const [passwordMessage, setPasswordMessage] = useState('')
  const [logoUrl, setLogoUrl] = useState('')
  const [logoSaved, setLogoSaved] = useState(false)
  const [activeFilter, setActiveFilter] = useState<'all' | 'active' | 'expiring' | 'expired' | 'archived'>('all')
  const [archivedClients, setArchivedClients] = useState<Client[]>([])
  // Archived members load only when that tab is opened; the tab count comes from a cheap count query
  const [archivedCount, setArchivedCount] = useState(0)
  const archivedLoaded = useRef(false)
  // Row the coach just tapped: highlighted with "Opening…" while the client page loads
  const [openingClientId, setOpeningClientId] = useState<string | null>(null)
  const [showSettingsPasswords, setShowSettingsPasswords] = useState(false)
  const [showNewClientPassword, setShowNewClientPassword] = useState(false)
  // Add member: the username box's check (app/username-field.tsx)
  const [newUsernameStatus, setNewUsernameStatus] = useState<UsernameStatus>('empty')
  const [searchQuery, setSearchQuery] = useState('')
  const [showRevenueDrillIn, setShowRevenueDrillIn] = useState(false)
  const [showPlanBreakdown, setShowPlanBreakdown] = useState(false)
  // Train module: PT clients' plans and plan-linked sessions from the last 4 weeks (for adherence)
  const [trainModule, setTrainModule] = useState(false)
  const [training, setTraining] = useState<{ plans: (AdherencePlan & { client_id: string })[]; sessions: AdherenceSession[] } | null>(null)
  // Today's sessions (#41): PT clients' sessions since this week's Monday, and the names of staff who logged them
  const [recent, setRecent] = useState<{ sessions: TodaySession[]; names: Record<string, string> } | null>(null)
  // Coach logins (#40): every coach of the gym, Off ones included (names stay on history)
  const [coaches, setCoaches] = useState<Coach[]>([])
  const [showCoaches, setShowCoaches] = useState(false)
  const [newCoach, setNewCoach] = useState<{ full_name: string; phone: string; email: string; password: string; phone_country: PhoneCountry | '' }>({ full_name: '', phone: '', email: '', password: '', phone_country: '' })
  // Coach being renamed / given a new phone (one at a time)
  const [editCoach, setEditCoach] = useState<{ id: string; full_name: string; phone: string; phoneLogin: boolean } | null>(null)
  const [savingEditCoach, setSavingEditCoach] = useState(false)
  // Coach whose password is being reset (one at a time)
  const [resetCoach, setResetCoach] = useState<{ id: string; password: string; saving: boolean; error: string } | null>(null)
  const [editCoachError, setEditCoachError] = useState('')
  const [savingCoach, setSavingCoach] = useState(false)
  const [coachMessage, setCoachMessage] = useState('')
  // Coach activity (#40): the coach tapped to filter the section (null = all coaches)
  const [activityCoach, setActivityCoach] = useState<string | null>(null)
  const [showActivity, setShowActivity] = useState(false) // Coach activity: collapsed to a one-line summary by default
  // Training card is collapsed by default (Coach assignments sits above it); the coach row opened in Coach assignments
  const [showTraining, setShowTraining] = useState(false)
  const [assignCoach, setAssignCoach] = useState<string | null>(null)
  const [confirmBox, setConfirmBox] = useState<{ title: string; body: string; action: string; onConfirm: () => void } | null>(null)
  // Leads card (#52): numbers from open leads + leads touched this month / added this week; rows = 0 → slim "Track enquiries" card
  const [leadStats, setLeadStats] = useState<{ summary: LeadSummary; rows: number } | null>(null)

  useEffect(() => { initialize() }, [])

  // Auto-calculate end date when plan type or start date changes
  useEffect(() => {
    if (!newClient.start_date) return
    const start = new Date(newClient.start_date)
    const end = new Date(start)
    if (newClient.plan_type === '1 Month') end.setMonth(end.getMonth() + 1)
    else if (newClient.plan_type === '3 Months') end.setMonth(end.getMonth() + 3)
    else if (newClient.plan_type === '6 Months') end.setMonth(end.getMonth() + 6)
    else if (newClient.plan_type === '1 Year') end.setFullYear(end.getFullYear() + 1)
    setNewClient(prev => ({ ...prev, end_date: end.toISOString().split('T')[0] }))
  }, [newClient.plan_type, newClient.start_date])

  const initialize = async () => {
    // getSession reads the saved login locally (the proxy already verified it with Supabase)
    const { data: { session } } = await supabase.auth.getSession()
    const user = session?.user
    if (!user) { router.push('/login'); return }

    // Profile + company in one request
    const { data: profile } = await supabase
      .from('profiles')
      // companies(*) so the company_type column is read without breaking before its SQL runs
      .select('company_id, role, companies:company_id(*)')
      .eq('id', user.id)
      .single()

    if (!profile?.company_id) { router.push('/login'); return }

    setCompanyId(profile.company_id)
    setMyRole((profile as { role?: string | null }).role ?? null)
    // Start loading members straight away, in parallel with setting up the header
    fetchClients(profile.company_id)
    fetchLeadStats(profile.company_id)
    fetchCoaches(profile.company_id)
    // Do the guardian columns exist yet? A column error before db/2026-11-03-guardian.md runs (then the fields stay hidden)
    const guardianProbe = supabase.from('profiles').select('guardian_phone').limit(1)
      .then(({ error }) => { setGuardianColumns(!error); return !error })

    type CompanyRow = {
      name: string | null; logo_url: string | null; trial_end: string | null; is_active: boolean | null
      client_limit: number | null; is_trial: boolean | null; pt_limit: number | null
      currency: string | null; country: string | null; client_module_enabled: boolean | null
      company_type?: string | null
      business_type?: string | null
      multi_country_enabled?: boolean | null; allowed_currencies?: string[] | null // db/2026-11-01-multi-country.md
      upi_id?: string | null // db/2026-11-07-upi-id.md
      grading_enabled?: boolean | null // supabase/migrations/20261110120000_belt_grading.sql
    }
    const company = (profile as unknown as { companies: CompanyRow | null }).companies

    setCompanyName(company?.name || '')
    setUpiId(company?.upi_id || '')
    setCoachCompany(isCoachCompany(company))
    setBusinessType(company?.business_type ?? null)
    if (isDojo(company?.business_type)) fetchBatches(profile.company_id)
    if (gradingOn(company)) fetchBeltRanks(profile.company_id)
    const fromLeadId = new URLSearchParams(window.location.search).get('fromLead')
    if (fromLeadId) openFromLead(fromLeadId, isDojo(company?.business_type), guardianProbe)
    setTrainModule(!!company?.client_module_enabled)
    setCurrency(company?.currency || 'INR')
    setCountry(normalizeCountry(company?.country))
    setCurrencyColumns(!!company && 'allowed_currencies' in company)
    setMultiCountry(!!company?.multi_country_enabled)
    setAllowedCurrencies(company?.allowed_currencies?.length ? company.allowed_currencies : [company?.currency || 'INR'])
    setClientLimit(company?.client_limit || 50)
    setPtLimit(company?.pt_limit ?? null)
    setLogoUrl(company?.logo_url || '')
    setTrialInfo({
      // same values as before; the old untyped query passed these through as-is
      trial_end: company?.trial_end as string,
      is_active: company?.is_active as boolean,
      is_trial: company?.is_trial ?? true
    })
  }

  // Belt grading: the gym's belts, ladder order. An error = no belts yet: the Belt fields stay hidden
  const fetchBeltRanks = async (cId: string) => {
    const { data, error } = await supabase.from('belt_ranks').select(BELT_RANK_COLUMNS).eq('company_id', cId).order('rank_order')
    if (error) { console.error('Belt ranks error:', error); return }
    setBeltRanks((data || []) as BeltRank[])
  }

  // Branches & batches (dojos only for now). An error = the tables don't exist yet: everything stays hidden
  const fetchBatches = async (cId: string) => {
    const [br, ba] = await Promise.all([
      supabase.from('branches').select(BRANCH_COLUMNS).eq('company_id', cId).order('name'),
      supabase.from('batches').select(BATCH_COLUMNS).eq('company_id', cId),
    ])
    if (br.error || ba.error) { setBatchesOn(false); setBatchesChecked(true); return }
    setBranchList((br.data || []) as Branch[])
    setBranchFilter(rememberedBranch((br.data || []) as Branch[]))   // last chip picked on this phone
    setBatchList((ba.data || []) as Batch[])
    setBatchesOn(true)
    const att = await supabase.from('attendance').select(ATTENDANCE_COLUMNS).eq('company_id', cId).eq('class_date', localDateIso()).eq('present', true)
    setAttToday(att.error ? null : (att.data || []) as AttendanceRow[])
    setBatchesChecked(true)
  }

  // Prefill Add Member from an open enquiry, then clean the URL so a refresh doesn't reopen the form
  // In a dojo the enquiry usually comes from a parent: its phone goes into Parent phone (Child starts ticked)
  const openFromLead = async (leadId: string, dojo: boolean, guardianProbe: PromiseLike<boolean>) => {
    const { data: lead, error } = await supabase
      .from('leads')
      .select('id, name, phone, source, interest, status')
      .eq('id', leadId)
      .maybeSingle()
    router.replace('/company')
    if (error || !lead || !isOpen({ status: lead.status as LeadStatus })) {
      if (error) console.error('Lead fetch error:', error)
      return
    }
    const toParent = dojo && await guardianProbe
    setNewClient(prev => ({
      ...prev,
      full_name: lead.name || '',
      phone: toParent ? '' : lead.phone || '',
      guardian_phone: toParent ? lead.phone || '' : '',
      client_type: lead.interest === 'pt' ? 'pt' : 'member',
    }))
    setFromLead({ id: lead.id, name: lead.name, source: lead.source })
    setMessage('')
    setShowForm(true)
  }

  // One light query, in parallel with the member list: open leads, plus leads updated this month or added this week
  const fetchLeadStats = async (cId: string) => {
    const monthStart = new Date()
    monthStart.setDate(1)
    monthStart.setHours(0, 0, 0, 0)
    const weekStart = parseDate(thisWeekMonday())
    const { data, error } = await supabase
      .from('leads')
      .select('id, status, follow_up_date, created_at, updated_at')
      .eq('company_id', cId)
      .or(`status.in.(new,trial),updated_at.gte."${monthStart.toISOString()}",created_at.gte."${weekStart.toISOString()}"`)
    if (error) { console.error('Leads summary fetch error:', error); return }
    const rows = (data || []) as Pick<Lead, 'status' | 'follow_up_date' | 'created_at' | 'updated_at'>[]
    setLeadStats({ summary: leadSummary(rows, localDateIso()), rows: rows.length })
  }

  const fetchClients = async (cId: string) => {
    const [
      { data: profiles },
      { count: archivedTotal },
      { data: memberships, error: membershipsError }
    ] = await Promise.all([
      supabase
        .from('profiles')
        .select('*')
        .eq('company_id', cId)
        .eq('role', 'client')
        .is('archived_at', null)
        .order('created_at', { ascending: false }),
      supabase
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', cId)
        .eq('role', 'client')
        .not('archived_at', 'is', null),
      supabase
        .from('memberships')
        .select('*') // * so memberships.currency is read once it exists
        .eq('company_id', cId)
    ])

    if (membershipsError) console.error('Memberships fetch error:', membershipsError)

    const withMemberships = (list: any[]) => list.map(p => ({
      ...p,
      memberships: (memberships || []).filter((m: any) => m.profile_id === p.id)
    }))

    setClients(withMemberships(profiles || []))
    setArchivedCount(archivedTotal || 0)
    fetchTraining(((profiles || []) as Client[]).filter(p => p.client_type === 'pt').map(p => p.id))
    setLoading(false)
    // Keep the archived list fresh if it has been opened before (e.g. after restore)
    if (archivedLoaded.current) fetchArchived(cId, memberships || [])
  }

  // Plans from the last 4 weeks for PT clients, and the sessions logged against them
  const fetchTraining = async (ptIds: string[]) => {
    if (!ptIds.length) { setTraining({ plans: [], sessions: [] }); setRecent({ sessions: [], names: {} }); return }
    fetchRecent(ptIds)
    const since = new Date()
    since.setDate(since.getDate() - 34) // 4 weeks back, plus the start of a plan still running then
    const sinceIso = `${since.getFullYear()}-${String(since.getMonth() + 1).padStart(2, '0')}-${String(since.getDate()).padStart(2, '0')}`
    const { data: plans, error } = await supabase
      .from('weekly_plans')
      .select('*')
      .in('client_id', ptIds)
      .gte('week_start', sinceIso)
    if (error) { console.error('Training plans fetch error:', error); return }
    const planIds = (plans || []).map(p => p.id)
    let sessions: AdherenceSession[] = []
    if (planIds.length) {
      const { data, error: sErr } = await supabase
        .from('logged_sessions')
        .select('*')
        .in('weekly_plan_id', planIds)
      if (sErr) { console.error('Training sessions fetch error:', sErr); return }
      sessions = data || []
    }
    setTraining({ plans: plans || [], sessions })
  }

  // Every session PT clients logged this week (plan or not), plus one query for who logged them.
  // Goes back at least 7 days (not just to Monday) so Coach activity can spot clients with no session in 7+ days.
  const fetchRecent = async (ptIds: string[]) => {
    const since = [thisWeekMonday(), localDateIso(-6)].sort()[0]
    const { data, error } = await supabase
      .from('logged_sessions')
      .select('*')
      .in('client_id', ptIds)
      .gte('session_date', since)
      .order('created_at', { ascending: true })
    if (error) { console.error('Recent sessions fetch error:', error); return }
    const sessions = (data || []) as TodaySession[]
    const ids = [...new Set(sessions.map(loggerOf).filter(id => id !== 'client'))]
    let names: Record<string, string> = {}
    if (ids.length) {
      const { data: staff } = await supabase.from('profiles').select('id, full_name').in('id', ids)
      names = Object.fromEntries((staff || []).map(p => [p.id, p.full_name || '']))
    }
    setRecent({ sessions, names })
  }

  const fetchCoaches = async (cId: string) => {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, full_name, phone, email, archived_at')
      .eq('company_id', cId)
      .eq('role', 'coach')
      .order('full_name')
    if (error) { console.error('Coaches fetch error:', error); return }
    setCoaches((data || []) as Coach[])
  }

  // Staff login rule (lib/phone.ts staffLogin): India phone (password = phone, like partners);
  // other countries an email + the password the owner sets, or the phone with its country code
  const handleAddCoach = async () => {
    if (!companyId) return
    const name = newCoach.full_name.trim()
    if (!name) { setCoachMessage(`Error: Enter the ${sw.one.toLowerCase()}'s name`); return }
    const login = staffLogin(country, { phoneCountry: newCoach.phone_country || (country ?? 'IN'), phone: newCoach.phone, email: newCoach.email, password: newCoach.password })
    if ('error' in login) { setCoachMessage('Error: ' + login.error); return }
    const { email, password, phone, method } = login
    setSavingCoach(true)
    setCoachMessage('')
    const response = await fetch('/api/create-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, full_name: name, company_id: companyId, role: 'coach', phone: phone || null })
    })
    const result = await response.json()
    setSavingCoach(false)
    if (result.error) { setCoachMessage('Error: ' + result.error); return }
    setNewCoach({ full_name: '', phone: '', email: '', password: '', phone_country: '' })
    setCoachMessage(method === 'email'
      ? `${sw.one} added. They log in with ${email} and the password you set.`
      : `${sw.one} added. Default password = phone number.`)
    showToast(`${sw.one} added ✓`)
    fetchCoaches(companyId)
  }

  const setCoachActive = async (coach: Coach, active: boolean) => {
    const response = await fetch('/api/set-coach-active', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ coachId: coach.id, active })
    })
    const result = await response.json().catch(() => ({ error: 'Network error' }))
    if (!response.ok || result.error) { showToast('Could not save: ' + (result.error || response.status), 'error'); return }
    showToast(active ? `${coach.full_name}'s login is on ✓` : `${coach.full_name}'s login is off`)
    if (companyId) fetchCoaches(companyId)
  }

  const handleSaveCoach = async () => {
    if (!editCoach) return
    const name = editCoach.full_name.trim()
    const phone = editCoach.phone.trim()
    if (!name) { setEditCoachError(`Enter the ${sw.one.toLowerCase()}'s name`); return }
    if (editCoach.phoneLogin && !splitE164(phone, country)) { setEditCoachError(`Enter a valid phone number (${phoneHint(country ?? 'IN')}): they log in with it`); return }
    setSavingEditCoach(true)
    setEditCoachError('')
    const response = await fetch('/api/update-coach', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ coachId: editCoach.id, full_name: name, phone })
    })
    const result = await response.json().catch(() => ({ error: 'Network error' }))
    setSavingEditCoach(false)
    if (!response.ok || result.error) { setEditCoachError("Couldn't save: " + (result.error || response.status)); return }
    const old = coachById[editCoach.id]
    const samePhone = (a: string, b: string) => { const x = splitE164(a, country), y = splitE164(b, country); return x && y ? x.country === y.country && x.local === y.local : a === b }
    const phoneChanged = editCoach.phoneLogin && old && !samePhone(old.phone || '', phone)
    showToast(phoneChanged ? `Saved ✓ ${name.split(' ')[0]} now logs in with ${phone}` : `${sw.one} saved ✓`)
    setEditCoach(null)
    if (companyId) fetchCoaches(companyId)
  }

  // Owner / partner sets a new password for a coach login (api/reset-password allows their own gym's coaches)
  const handleResetCoachPassword = async () => {
    if (!resetCoach) return
    if (resetCoach.password.length < 6) { setResetCoach({ ...resetCoach, error: 'Password must be at least 6 characters' }); return }
    setResetCoach({ ...resetCoach, saving: true, error: '' })
    const response = await fetch('/api/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: resetCoach.id, newPassword: resetCoach.password })
    })
    const result = await response.json().catch(() => ({ error: 'Network error' }))
    if (!response.ok || result.error) { setResetCoach({ ...resetCoach, saving: false, error: "Couldn't reset: " + (result.error || response.status) }); return }
    const name = (coachById[resetCoach.id]?.full_name || sw.one).split(' ')[0]
    showToast(`Password reset ✓ Tell ${name} the new password`)
    setResetCoach(null)
  }

  const handleToggleCoach = (coach: Coach) => {
    if (coach.archived_at) { setCoachActive(coach, true); return }
    setConfirmBox({
      title: `Turn off ${coach.full_name}'s login?`,
      body: 'They can no longer log in. Their past sessions keep showing their name. You can turn the login on again any time.',
      action: 'Turn off',
      onConfirm: () => setCoachActive(coach, false),
    })
  }

  const fetchArchived = async (cId: string, knownMemberships?: unknown[]) => {
    const [{ data: archivedProfiles }, membershipsResult] = await Promise.all([
      supabase
        .from('profiles')
        .select('*')
        .eq('company_id', cId)
        .eq('role', 'client')
        .not('archived_at', 'is', null)
        .order('archived_at', { ascending: false }),
      knownMemberships
        ? Promise.resolve({ data: knownMemberships })
        : supabase
            .from('memberships')
            .select('*') // * so memberships.currency is read once it exists
            .eq('company_id', cId),
    ])
    const ms = (membershipsResult.data || []) as Membership[] & { profile_id?: string }[]
    setArchivedClients((archivedProfiles || []).map((p: Client) => ({
      ...p,
      memberships: (ms as (Membership & { profile_id: string })[]).filter(m => m.profile_id === p.id),
    })))
    archivedLoaded.current = true
  }

  // Open a client: highlight the tapped row immediately, then navigate
  // (query e.g. "?tab=plans&day=today" opens the Plans tab on today's day, for "Mark today")
  const openClient = (id: string, query = '') => {
    if (openingClientId) return
    setOpeningClientId(id)
    router.push(`/company/client/${id}${query}`)
    setTimeout(() => setOpeningClientId(prev => (prev === id ? null : prev)), 10000) // safety reset
  }

  // Load archived members the first time that tab is opened
  useEffect(() => {
    if (activeFilter === 'archived' && companyId && !archivedLoaded.current) fetchArchived(companyId)
  }, [activeFilter, companyId])

  const handleRestoreClient = async (clientId: string) => {
    await supabase.from('profiles').update({ archived_at: null }).eq('id', clientId)
    fetchClients(companyId!)
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  const handleChangePassword = async () => {
    if (passwordData.newPassword !== passwordData.confirmPassword) {
      setPasswordMessage('Passwords do not match')
      return
    }
    if (passwordData.newPassword.length < 6) {
      setPasswordMessage('Password must be at least 6 characters')
      return
    }
    const { error } = await supabase.auth.updateUser({ password: passwordData.newPassword })
    if (error) {
      setPasswordMessage('Error: ' + error.message)
    } else {
      setPasswordMessage('Password changed successfully! ✓')
      showToast('Password changed ✓')
      setPasswordData({ newPassword: '', confirmPassword: '' })
      setTimeout(() => { setShowSettings(false); setPasswordMessage('') }, 2000)
    }
  }

  const handleSaveLogo = async () => {
    // .select() so a save blocked by database rules (0 rows changed) isn't reported as saved
    const { data, error } = await supabase.from('companies').update({ logo_url: logoUrl }).eq('id', companyId!).select('id')
    if (error || !data?.length) {
      showToast(error ? 'Could not save logo: ' + error.message : 'Only the gym owner login can change the logo', 'error')
      return
    }
    setLogoSaved(true)
    showToast('Logo saved ✓')
    setTimeout(() => setLogoSaved(false), 2000)
  }

  // The new member's country, phone code and payment currency. Multi-country off: always the gym's own.
  const baseCurrency = normalizeCurrency(currency)
  const newClientPlace = (): { country: Country; phoneCountry: PhoneCountry; currency: string } => {
    const home = country ?? 'IN'
    if (!multiCountry) return { country: home, phoneCountry: home, currency: baseCurrency }
    const c = normalizeCountry(newClient.country || home)
    return {
      country: c,
      phoneCountry: (newClient.phone_country || c) as PhoneCountry,
      currency: newClient.currency || defaultCurrencyFor(c),
    }
  }
  // A country's own currency when the gym allows it, else the gym's base currency
  const defaultCurrencyFor = (c: Country) => {
    const own = COUNTRIES.find(x => x.code === c)?.currency
    return own && allowedCurrencies.includes(own) ? own : baseCurrency
  }

  // How the new member will log in: a username (every country), an email (outside India only), or not at all
  // (coach-run member, Create login later). The phone is for contact / WhatsApp only: new members never get a phone login.
  // Existing phone logins keep working (lib/phone.ts, login page).
  const newClientLogin = (): { kind: 'email' | 'username'; email: string; shown: string } | { kind: 'none' } | { kind: 'bad-email' } | { kind: 'bad-username'; problem: string } => {
    const place = newClientPlace()
    const u = normalizeUsername(newClient.username)
    if (u) {
      const problem = usernameProblem(u)
      return problem ? { kind: 'bad-username', problem } : { kind: 'username', email: usernameEmail(u), shown: u }
    }
    const entered = loginMethod(place.country) === 'phone' ? '' : newClient.email.trim()
    if (entered) {
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(entered) ? { kind: 'email', email: entered, shown: entered } : { kind: 'bad-email' }
    }
    return { kind: 'none' }
  }

  // Child with parent details (only once the guardian columns exist): ticked by default for a dojo
  const newClientChild = () => guardianColumns && (newClient.child ?? isDojo(businessType))
  const newClientParentCountry = (): PhoneCountry => (newClient.guardian_phone_country || newClientPlace().phoneCountry) as PhoneCountry

  const handleCreateClient = async () => {
    setSaving(true)
    setMessage('')

    // Child: the parent's phone is required (the student's own phone is optional)
    const child = newClientChild()
    if (child && !validLocalDigits(newClientParentCountry(), newClient.guardian_phone)) {
      setMessage(`Error: Enter the parent's phone (${phoneHint(newClientParentCountry())})`)
      setSaving(false)
      return
    }

    const { count } = await supabase
      .from('profiles')
      .select('*', { count: 'exact', head: true })
      .eq('company_id', companyId!)
      .eq('role', 'client')
      .is('archived_at', null)

    if ((count || 0) >= clientLimit) {
      setMessage(`Client limit reached (${clientLimit}). Contact CoachBoard to increase your limit.`)
      setSaving(false)
      return
    }

    // A login is optional: the coach can enter everything and share progress themselves.
    // A username (any country) if given; else, outside India (lib/locale.ts loginMethod), an email if given;
    // else no login (newClientLogin). The phone is for contact only.
    const place = newClientPlace()
    const login = newClientLogin()
    if (login.kind === 'bad-username') {
      setMessage('Error: ' + login.problem)
      setSaving(false)
      return
    }
    if (login.kind === 'username' && (newUsernameStatus === 'taken' || newUsernameStatus === 'checking')) {
      setMessage(newUsernameStatus === 'taken' ? `Error: Username ${login.shown} is taken. Pick one of the suggestions` : 'Checking the username… try again in a second')
      setSaving(false)
      return
    }
    if (login.kind === 'bad-email') {
      setMessage('Error: That email doesn\'t look right. Fix it, or leave it empty to add the ' + mw.one.toLowerCase() + ' without a login')
      setSaving(false)
      return
    }
    if (login.kind !== 'none' && newClient.password.length < 6) {
      setMessage('Error: Temporary password must be at least 6 characters')
      setSaving(false)
      return
    }

    const response = await fetch('/api/create-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...(login.kind === 'none' ? { no_login: true }
          : login.kind === 'username' ? { username: login.shown, password: newClient.password }
          : { email: login.email, password: newClient.password }),
        full_name: newClient.full_name,
        company_id: companyId,
        role: 'client',
        // International format (+919876543210), lib/phone.ts
        phone: clientPhoneValue(place.phoneCountry, newClient.phone),
        trainer_name: newClient.trainer_name,
        diet_plan: dojo ? '' : newClient.diet_plan,
        // Dojo: age, gender and medical conditions are entered here (one screen), not later on the Profile tab
        ...(dojo ? {
          age: newClient.age ? parseInt(newClient.age) : null,
          gender: newClient.gender || null,
          medical_conditions: newClient.medical_conditions.trim() || null,
        } : {}),
        client_type: dojo ? 'pt' : newClient.client_type,
        primary_coach_id: !coachCompany && newClient.primary_coach_id ? newClient.primary_coach_id : null,
        // Dojo with branches & batches: branch and home batch (checked on the server)
        ...(dojo && batchesOn ? { branch_id: newClient.branch_id || null, batch_id: newClient.batch_id || null } : {}),
        // Belt grading on: the belt they join with (default White) and since when (default the start date)
        ...(beltsOn ? {
          current_rank_id: newClient.rank_id || defaultBeltId(beltRanks),
          rank_achieved_on: (newClient.belt_since ?? newClient.start_date) || null,
        } : {}),
        // Parent details (Child ticked, guardian columns only); stored like phone (+<code><digits>)
        ...(child ? {
          guardian_name: newClient.guardian_name.trim(),
          guardian_phone: clientPhoneValue(newClientParentCountry(), newClient.guardian_phone),
          guardian_relation: newClient.guardian_relation,
        } : {}),
        // Once the multi-country SQL has run: the client's country and default currency
        ...(currencyColumns ? { country: place.country, currency: place.currency } : {})
      })
    })

    const result = await response.json()
    if (result.error) {
      setMessage('Error: ' + result.error)
      setSaving(false)
      return
    }

    let membershipSaved = true
    if (newClient.plan_type && newClient.start_date && newClient.end_date) {
      const { error: mError } = await supabase.from('memberships').insert({
        profile_id: result.userId,
        company_id: companyId,
        plan_type: newClient.plan_type,
        amount_paid: parseFloat(newClient.amount_paid) || 0,
        start_date: newClient.start_date,
        end_date: newClient.end_date,
        ...(currencyColumns ? { currency: place.currency } : {})
      })
      if (mError) { console.error('Membership insert error:', mError); membershipSaved = false }
    } else {
      membershipSaved = false
    }

    // Success shows as the green pop-up below; the form's message line is cleared so it isn't still there next time
    setMessage('')
    if (fromLead) {
      // Mark the enquiry Joined; the member is kept even if this fails
      const { data: updated, error: leadError } = await supabase
        .from('leads')
        .update({ status: 'joined', converted_profile_id: result.userId, follow_up_date: null })
        .eq('id', fromLead.id)
        .select('id')
      if (leadError) console.error('Lead update error:', leadError)
      if (leadError || !updated?.length) showToast(`${mw.one} added, but the enquiry wasn't updated`, 'error')
      else { showToast(`${mw.one} added ✓ · enquiry marked Joined`); fetchLeadStats(companyId!) }
      setFromLead(null)
    } else if (!membershipSaved) {
      // Added, but no membership: the list shows "No plan" until one is added (open them → Add membership)
      showToast(`${mw.one} added, but the membership wasn't saved. Open them → ⋯ → Edit → Add membership`, 'error')
    } else {
      showToast(`${mw.one} added ✓`)
    }
    if (result.warning) showToast(`${mw.one} added. ${result.warning}`, 'error')
    setNewClient({
      full_name: '', email: '', password: '', phone: '', trainer_name: '', diet_plan: '', username: '',
      plan_type: '1 Month', amount_paid: '',
      start_date: new Date().toISOString().split('T')[0], end_date: '',
      client_type: 'member', primary_coach_id: '',
      country: '', phone_country: '', currency: '',
      child: null, guardian_name: '', guardian_phone: '', guardian_phone_country: '', guardian_relation: 'Mother',
      age: '', gender: '', medical_conditions: '',
      branch_id: '', batch_id: '',
      rank_id: '', belt_since: null,
    })
    setShowForm(false)
    setSaving(false)
    fetchClients(companyId!)
  }

  const trialDaysLeft = () => {
    // Days left including today (end date is the last full day); null when no end date is set
    const d = daysUntil(trialInfo?.trial_end)
    return d == null ? null : d + 1
  }

  // Dojo branch chips: the list and its tab counts follow the chosen branch ('all' = everyone)
  const inBranch = (c: Client) => !dojo || !batchesOn || branchFilter === 'all'
    || (branchFilter === 'none' ? !c.branch_id : c.branch_id === branchFilter)
  const branchClients = clients.filter(inBranch)
  const statusCounts = {
    active: branchClients.filter(c => membershipStatus(latestMembership(c.memberships)) === 'active').length,
    expiring: branchClients.filter(c => membershipStatus(latestMembership(c.memberships)) === 'expiring').length,
    expired: branchClients.filter(c => membershipStatus(latestMembership(c.memberships)) === 'expired').length,
  }
  const branchById = Object.fromEntries(branchList.map(b => [b.id, b]))
  const batchById = Object.fromEntries(batchList.map(b => [b.id, b]))
  // Dojo with attendance: the Training / Sensei activity cards (logged sessions) give way to the Attendance card
  const attendanceMode = dojo && batchesOn && attToday !== null
  const todaysBatches = attendanceMode
    ? batchesMeetingOn(batchList.filter(b => !branchById[b.branch_id]?.is_archived), localDateIso())
    : []
  const dojoPending = dojo && !batchesChecked

  // The WhatsApp link a row's Remind / Send reminder opens (null = the button opens the member instead).
  // One rule for the table and the dojo home's Fees card, so both open the same message and number.
  const reminderUrl = (client: Client): string | null => {
    const m = latestMembership(client.memberships)
    const status = membershipStatus(m)
    const days = m ? daysLeft(m.end_date) : null
    // Dojos only: fee due today or within 7 days and a parent WhatsApp number → "Send reminder" to the parent
    // (lib/guardian.ts feeReminder). Otherwise the row's usual Remind / Follow Up message.
    const fee = dojo && status === 'expiring' && m
      ? feeReminder({ student: client, dueDate: m.end_date, daysLeft: days, amount: m.amount_paid,
          currency: m.currency || currency, dojoName: companyName, country, upiId })
      : null
    if (fee) return `https://wa.me/${fee.waDigits}?text=${encodeURIComponent(fee.text)}`
    // To the parent when a valid parent phone is set, else the member (lib/guardian.ts). Country code + number
    // for wa.me (+919876543210 or old 9876543210; India and US numbers, lib/phone.ts). No parent: as always.
    const to = reminderRecipient(client, country)
    if ((status === 'expiring' || status === 'expired') && to.waDigits) {
      const msg = reminderText({
        status, memberFirst: client.full_name.split(' ')[0], parentFirst: to.greetName,
        companyName, endDate: m?.end_date, businessType, toParent: to.toParent, country,
      })
      return `https://wa.me/${to.waDigits}?text=${encodeURIComponent(msg)}`
    }
    return null
  }
  // Chips: active branches, plus archived ones that still have students; "No branch" when someone has none
  const branchChips = dojo && batchesOn
    ? branchList.filter(b => !b.is_archived || clients.some(c => c.branch_id === b.id))
    : []
  const noBranchCount = clients.filter(c => !c.branch_id).length

  const expiringSoonClients = clients.filter(c => {
    const m = latestMembership(c.memberships)
    if (!m) return false
    const d = daysLeft(m.end_date)
    return d >= 0 && d <= 7
  })
  const expiringSoonCount = expiringSoonClients.length
  // Money is added up per currency (D3): a membership counts in the currency it was paid in (base currency if not set).
  // Only when more than one currency has amounts is a figure shown as "₹48,000 · AED 3,200"; otherwise exactly as before.
  const amountOf = (m: Membership) => Number(m.amount_paid) || 0
  const currencyOf = (m: Membership) => m.currency
  const byCurrency = (ms: Membership[]) => groupByCurrency(ms, amountOf, currencyOf, currency)
  // The one currency of a figure (the base currency when it has no amounts); null when it has several
  const singleCurrency = (groups: { currency: string }[]) => groups.length > 1 ? null : (groups[0]?.currency ?? baseCurrency)
  const expiringSoonMemberships = expiringSoonClients.map(c => latestMembership(c.memberships)).filter((m): m is Membership => !!m)
  const expiringSoonByCurrency = byCurrency(expiringSoonMemberships)
  const expiringSoonRevenue = expiringSoonMemberships.reduce((sum, m) => sum + amountOf(m), 0)

  const allMemberships = clients.flatMap(c => c.memberships)
  const now = new Date()
  const thisMonth = now.getMonth()
  const thisYear = now.getFullYear()
  const lastMonth = thisMonth === 0 ? 11 : thisMonth - 1
  const lastMonthYear = thisMonth === 0 ? thisYear - 1 : thisYear

  const thisMonthMemberships = allMemberships
    .filter(m => { const d = new Date(m.start_date); return d.getMonth() === thisMonth && d.getFullYear() === thisYear })
  const thisMonthRevenue = thisMonthMemberships.reduce((sum, m) => sum + amountOf(m), 0)
  const thisMonthByCurrency = byCurrency(thisMonthMemberships)

  const lastMonthMemberships = allMemberships
    .filter(m => { const d = new Date(m.start_date); return d.getMonth() === lastMonth && d.getFullYear() === lastMonthYear })
  const lastMonthRevenue = lastMonthMemberships.reduce((sum, m) => sum + amountOf(m), 0)

  // % vs last month only when both months are in the same single currency (amounts in different currencies don't add up)
  const twoMonthCurrency = singleCurrency(byCurrency([...thisMonthMemberships, ...lastMonthMemberships]))
  const revenueChange = lastMonthRevenue === 0 || twoMonthCurrency === null ? null : Math.round(((thisMonthRevenue - lastMonthRevenue) / lastMonthRevenue) * 100)

  const monthlyRevenueTrend = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1)
    const m = d.getMonth()
    const y = d.getFullYear()
    const mems = allMemberships
      .filter(mem => { const md = new Date(mem.start_date); return md.getMonth() === m && md.getFullYear() === y })
    const revenue = mems.reduce((sum, mem) => sum + amountOf(mem), 0)
    return { label: formatDate(d, country, 'month'), revenue, groups: byCurrency(mems), mems, isCurrentMonth: i === 5 }
  })
  // One currency across the 6 months: bars as before. Several: each month's amounts per currency, no bars.
  const trendCurrency = singleCurrency(byCurrency(monthlyRevenueTrend.flatMap(t => t.mems)))
  const maxMonthlyRevenue = Math.max(...monthlyRevenueTrend.map(m => m.revenue), 1)

  const planColors: Record<string, string> = {
    '1 Month': 'bg-blue-500', '3 Months': 'bg-teal-500',
    '6 Months': 'bg-green-500', '1 Year': 'bg-emerald-400'
  }
  const thisMonthByPlan = ['1 Month', '3 Months', '6 Months', '1 Year'].map(plan => {
    const mems = allMemberships.filter(m => {
      const d = new Date(m.start_date)
      return d.getMonth() === thisMonth && d.getFullYear() === thisYear && m.plan_type === plan
    })
    return { plan, revenue: mems.reduce((sum, m) => sum + amountOf(m), 0), groups: byCurrency(mems), count: mems.length }
  }).filter(p => p.revenue > 0)
  const thisMonthCurrency = singleCurrency(thisMonthByCurrency)
  const thisMonthCount = thisMonthByPlan.reduce((sum, p) => sum + p.count, 0)

  const expiredClients = clients.filter(c => membershipStatus(latestMembership(c.memberships)) === 'expired')
  const ptCount = clients.filter(c => c.client_type === 'pt').length

  // Adherence for PT clients: this week's plan per client (null = no plan this week)
  const ptClients = clients.filter(c => c.client_type === 'pt')
  const weekAdherence: Record<string, Adherence | null | 'no-plan'> = {}
  if (training) {
    for (const c of ptClients) {
      const plan = currentPlan(training.plans.filter(p => p.client_id === c.id))
      weekAdherence[c.id] = plan ? planAdherence(plan, training.sessions) : 'no-plan'
    }
  }
  const weekTotals = Object.values(weekAdherence).reduce<Adherence>((t, a) =>
    a && a !== 'no-plan' ? { planned: t.planned + a.planned, done: t.done + a.done } : t, { planned: 0, done: 0 })
  const fourWeeks = training ? recentAdherence(training.plans, training.sessions, 4) : null
  const noPlanClients = ptClients.filter(c => weekAdherence[c.id] === 'no-plan')
  const withPlanCount = ptClients.filter(c => { const a = weekAdherence[c.id]; return a && a !== 'no-plan' }).length
  // Today's sessions (#41): trained today, today's workout not done yet, workout days missed this week
  const todayIso = localDateIso()
  const ptById = Object.fromEntries(ptClients.map(c => [c.id, c]))
  const trainedToday = (recent?.sessions || []).filter(s => s.session_date === todayIso && ptById[s.client_id])
  const trainedTodayIds = new Set(trainedToday.map(s => s.client_id))
  const dueToday: { c: Client; label: string }[] = []
  const missedWeek: { c: Client; days: string[] }[] = []
  if (training) {
    for (const c of ptClients) {
      const plan = currentPlan(training.plans.filter(p => p.client_id === c.id))
      if (!plan) continue
      const r = missedAndDue(plan, training.sessions as TodaySession[], todayIso)
      if (r.dueToday && !trainedToday.some(s => s.client_id === c.id)) dueToday.push({ c, label: r.dueToday.label })
      if (r.missed.length) missedWeek.push({ c, days: r.missed.map(d => d.day) })
    }
    missedWeek.sort((a, b) => b.days.length - a.days.length)
  }
  const byLogger = Object.entries(sessionsByLogger(recent?.sessions || [], thisWeekMonday(), todayIso))
    .sort(([a, x], [b, y]) => (a === 'client' ? 1 : 0) - (b === 'client' ? 1 : 0) || y.today - x.today || y.week - x.week)
  const coachById = Object.fromEntries(coaches.map(c => [c.id, c]))
  const activeCoaches = coaches.filter(c => !c.archived_at)
  const loggerName = (id: string) => {
    if (id === 'client') return 'Clients themselves'
    // A name saved as "Coach Ravi" shouldn't read "Coach Coach"
    const first = (recent?.names[id] || coachById[id]?.full_name || '').trim().replace(/^(coach|sensei)\s+/i, '').split(/\s+/)[0]
    // Only coach / sensei logins read "Coach Ravi"; the owner / a partner shows by name ("by Anand")
    if (!coachById[id]) return first || 'staff'
    return first ? `${sw.one} ${first}` : sw.one
  }
  const loggedByText = (s: TodaySession) => (loggerOf(s) === 'client' ? 'by client' : `by ${loggerName(loggerOf(s))}`)

  // Coach activity (#40): per coach today / since Mon, covering, their clients trained by others, needs attention.
  // Uses data already loaded (PT clients, this week's sessions, memberships, coaches): no query per row.
  const weekMonday = thisWeekMonday()
  const weekSessions = (recent?.sessions || []).filter(s => s.session_date >= weekMonday && s.session_date <= todayIso && ptById[s.client_id])
  const coachActivity = coaches
    .map(coach => {
      const mine = weekSessions.filter(s => s.logged_by === coach.id)
      const todays = mine.filter(s => s.session_date === todayIso)
      const names = (list: TodaySession[]) => [...new Set(list.map(s => s.client_id))].map(id => ptById[id]).filter(Boolean)
      const coveringOf = (list: TodaySession[]) => list.filter(s => isCovering(s, ptById[s.client_id])).length
      // This coach's own clients (primary coach) trained this week by another staff member
      const byOthers = names(weekSessions.filter(s => {
        const c = ptById[s.client_id]
        return c?.primary_coach_id === coach.id && loggerOf(s) !== 'client' && s.logged_by !== coach.id
      }))
      return {
        coach,
        today: { sessions: todays.length, clients: names(todays), covering: coveringOf(todays) },
        week: { sessions: mine.length, clients: names(mine), covering: coveringOf(mine) },
        byOthers,
      }
    })
    .filter(a => !a.coach.archived_at || a.week.sessions > 0)
  const lastSessionOf: Record<string, string> = {}
  for (const s of recent?.sessions || []) if (!lastSessionOf[s.client_id] || s.session_date > lastSessionOf[s.client_id]) lastSessionOf[s.client_id] = s.session_date
  const attentionClients = ptClients.filter(c => !activityCoach || c.primary_coach_id === activityCoach)
  const idleClients = attentionClients.filter(c => !lastSessionOf[c.id]) // nothing in the last 7 days (recent goes back 7 days)
  const noPrimaryClients = activityCoach ? [] : ptClients.filter(c => !c.primary_coach_id || !coachById[c.primary_coach_id])
  const membershipAttention = attentionClients
    .map(c => ({ c, m: latestMembership(c.memberships) }))
    .map(x => ({ ...x, left: x.m ? daysUntil(x.m.end_date) : null }))
    .filter((x): x is { c: Client; m: Membership; left: number } => x.left !== null && x.left <= 7)
    .sort((a, b) => a.left - b.left)
  // Coach assignments: PT clients per primary coach (Off coaches shown only while they still have clients)
  const assignments = coaches
    .map(coach => ({ coach, clients: ptClients.filter(c => c.primary_coach_id === coach.id) }))
    .filter(a => !a.coach.archived_at || a.clients.length > 0)
    .sort((a, b) => b.clients.length - a.clients.length || a.coach.full_name.localeCompare(b.coach.full_name))
  const unassigned = ptClients.filter(c => !c.primary_coach_id || !coachById[c.primary_coach_id])
  const maxAssigned = Math.max(1, ...assignments.map(a => a.clients.length), unassigned.length)

  const filteredClients = (activeFilter === 'archived' ? archivedClients : clients)
    .filter(inBranch)
    .filter(c => activeFilter === 'all' || activeFilter === 'archived' || membershipStatus(latestMembership(c.memberships)) === activeFilter)
    .filter(c => {
      if (!searchQuery.trim()) return true
      const q = searchQuery.toLowerCase()
      const qDigits = q.replace(/\D/g, '')
      return c.full_name.toLowerCase().includes(q) || (c.phone || '').includes(q)
        // Parent name / phone (digits only, so "98765 43210" finds +919876543210)
        || (c.guardian_name || '').toLowerCase().includes(q)
        || (!!qDigits && (c.guardian_phone || '').replace(/\D/g, '').includes(qDigits))
    })

  if (trialInfo && !trialInfo.is_active) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="bg-gray-900 border border-red-800 rounded-2xl px-8 py-12 text-center max-w-md">
          <p className="text-4xl mb-4">🔒</p>
          <h2 className="text-xl font-bold text-red-400 mb-2">Account Deactivated</h2>
          <p className="text-gray-500 text-sm">Please contact CoachBoard to reactivate your account.</p>
        </div>
      </div>
    )
  }

  // Sections shared by the gym dashboard and the dojo home (app/company/dojo-home.tsx): the same JSX, shown unchanged
  const settingsPanel = (
        <div className="mx-4 sm:mx-8 mt-4 mb-0 bg-gray-900 border border-gray-800 rounded-2xl p-5 space-y-5">
          {/* Logo is set by the super admin only (admin edit panel → upload). The raw Supabase Storage
              link isn't shown to the gym; the logo itself still shows in the header above. */}
          {SHOW_LOGO_URL_SETTING && (
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Company Logo URL</p>
            <div className="flex gap-2">
              <input type="text" placeholder="https://yourcompany.com/logo.png"
                value={logoUrl} onChange={e => setLogoUrl(e.target.value)}
                className="flex-1 bg-gray-800 text-white rounded-lg px-4 py-2.5 outline-none focus:ring-2 focus:ring-white border border-gray-700 text-sm placeholder-gray-600" />
              <button onClick={handleSaveLogo}
                className="bg-white hover:bg-gray-100 text-gray-900 px-4 py-2.5 rounded-lg transition text-sm font-medium">
                {logoSaved ? '✓ Saved' : 'Save'}
              </button>
            </div>
          </div>
          )}
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Change Password</p>
            <div className="relative">
              <input type={showSettingsPasswords ? 'text' : 'password'} placeholder="New password"
                value={passwordData.newPassword}
                onChange={e => setPasswordData({ ...passwordData, newPassword: e.target.value })}
                className="w-full bg-gray-800 text-white rounded-lg px-4 py-2.5 pr-10 outline-none focus:ring-2 focus:ring-white border border-gray-700 text-sm mb-2 placeholder-gray-600" />
              <button type="button" onClick={() => setShowSettingsPasswords(!showSettingsPasswords)}
                className="absolute right-3 top-3 text-gray-500 hover:text-gray-300 transition">
                {showSettingsPasswords
                  ? <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" /></svg>
                  : <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                }
              </button>
            </div>
            <input type={showSettingsPasswords ? 'text' : 'password'} placeholder="Confirm new password"
              value={passwordData.confirmPassword}
              onChange={e => setPasswordData({ ...passwordData, confirmPassword: e.target.value })}
              className="w-full bg-gray-800 text-white rounded-lg px-4 py-2.5 outline-none focus:ring-2 focus:ring-white border border-gray-700 text-sm placeholder-gray-600" />
            {passwordMessage && (
              <p className={`text-sm mt-2 ${passwordMessage.includes('✓') ? 'text-green-400' : 'text-red-400'}`}>{passwordMessage}</p>
            )}
            <button onClick={handleChangePassword}
              className="w-full bg-white hover:bg-gray-100 text-gray-900 font-semibold py-2.5 rounded-lg transition text-sm mt-3">
              Update Password
            </button>
          </div>
        </div>
  )
  const subscriptionBanners = (
    <>
      {/* Subscription banners */}
      {trialInfo?.is_active && (trialDaysLeft() ?? 0) > 0 && (trialDaysLeft() ?? 0) <= 20 && (
        <div className="mx-4 sm:mx-8 mt-4 bg-amber-950 border border-amber-800 rounded-xl px-5 py-3">
          <p className="text-amber-400 text-sm">
            {trialInfo.is_trial
              ? `⚠️ Trial ends in ${trialDaysLeft()} day${trialDaysLeft() === 1 ? '' : 's'} (${formatDate(trialInfo.trial_end, country, 'medium')}). Contact CoachBoard to continue.`
              : `📅 Subscription renews in ${trialDaysLeft()} day${trialDaysLeft() === 1 ? '' : 's'} (${formatDate(trialInfo.trial_end, country, 'medium')}). Contact CoachBoard to renew.`}
          </p>
        </div>
      )}
      {/* No end date = nothing to warn about (not "expired") */}
      {trialInfo?.is_active && trialDaysLeft() !== null && (trialDaysLeft() as number) <= 0 && (
        <div className="mx-4 sm:mx-8 mt-4 bg-red-950 border border-red-800 rounded-xl px-5 py-3">
          <p className="text-red-400 text-sm">
            🔒 {trialInfo.is_trial ? 'Your trial has ended.' : 'Your subscription has expired.'} Contact CoachBoard to reactivate.
          </p>
        </div>
      )}

    </>
  )
  const thisMonthCard = (
        <div
          className={`bg-gray-900 border rounded-2xl p-4 cursor-pointer select-none transition ${showRevenueDrillIn ? 'border-green-700' : 'border-green-900/50'}`}
          onClick={() => setShowRevenueDrillIn(!showRevenueDrillIn)}>
          <div className="flex justify-between items-start">
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">This Month</p>
            <span className={`text-gray-500 text-sm transition-transform inline-block ${showRevenueDrillIn ? 'rotate-180' : ''}`}>▾</span>
          </div>
          {thisMonthCurrency !== null ? (
            <p className="text-3xl font-bold text-green-400">
              {formatMoneyCompact(thisMonthRevenue, currency === null ? null : thisMonthCurrency)}
            </p>
          ) : (
            // Several currencies this month: one line each
            <div className="text-green-400 font-bold leading-tight">
              {thisMonthByCurrency.map(g => (
                <p key={g.currency} className="text-xl">{formatMoneyCompact(g.amount, g.currency)}</p>
              ))}
            </div>
          )}
          {revenueChange !== null ? (
            <p className={`text-xs mt-1 font-medium ${revenueChange >= 0 ? 'text-green-500' : 'text-red-400'}`}>
              {revenueChange >= 0 ? '↑' : '↓'} {Math.abs(revenueChange)}% vs last month
            </p>
          ) : (
            <p className="text-xs text-gray-600 mt-1">
              {formatDate(new Date(), country, 'monthLong')}
            </p>
          )}
        </div>
  )
  const revenueDrillIn = (
        <div className="px-4 sm:px-8 pt-3">
          <div className="bg-gray-900 border border-green-900/30 rounded-2xl p-5 space-y-5">

            {/* By plan type */}
            {thisMonthByPlan.length > 0 ? (
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wider mb-3">
                  {formatDate(now, country, 'monthLong')} — by plan
                </p>
                <div className="space-y-2.5">
                  {thisMonthByPlan.map(({ plan, revenue, groups, count }) => {
                    // Several currencies: bar by number of payments (amounts in different currencies don't add up)
                    const pct = thisMonthCurrency === null
                      ? (thisMonthCount > 0 ? Math.round((count / thisMonthCount) * 100) : 0)
                      : thisMonthRevenue > 0 ? Math.round((revenue / thisMonthRevenue) * 100) : 0
                    return (
                      <div key={plan} className="flex items-center gap-3">
                        <p className="text-xs text-gray-400 w-20 flex-shrink-0">{plan}</p>
                        <div className="flex-1 bg-gray-800 rounded-full h-2">
                          <div className={`h-2 rounded-full ${planColors[plan]}`} style={{ width: `${pct}%` }} />
                        </div>
                        <p className={`text-xs text-gray-400 text-right flex-shrink-0 ${groups.length > 1 ? 'w-40' : 'w-28'}`}>
                          {groups.length > 1 ? formatMoneyByCurrency(groups, currency) : formatMoney(revenue, currency === null ? null : singleCurrency(groups))} <span className="text-gray-600">({count})</span>
                        </p>
                      </div>
                    )
                  })}
                </div>
              </div>
            ) : (
              <p className="text-xs text-gray-600">No revenue recorded this month yet.</p>
            )}

            {/* Monthly trend */}
            <div className="border-t border-gray-800 pt-4">
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-3">Last 6 months</p>
              <div className="space-y-2">
                {monthlyRevenueTrend.map(({ label, revenue, groups, isCurrentMonth }) => {
                  const pct = Math.round((revenue / maxMonthlyRevenue) * 100)
                  if (trendCurrency === null) return (
                    <div key={label} className="flex items-center gap-3">
                      <p className={`text-xs w-8 flex-shrink-0 ${isCurrentMonth ? 'text-green-400 font-medium' : 'text-gray-500'}`}>{label}</p>
                      <p className={`text-xs flex-1 ${isCurrentMonth ? 'text-green-400 font-medium' : 'text-gray-500'}`}>
                        {groups.length ? formatMoneyByCurrency(groups, currency, true) : '—'}
                      </p>
                    </div>
                  )
                  return (
                    <div key={label} className="flex items-center gap-3">
                      <p className={`text-xs w-8 flex-shrink-0 ${isCurrentMonth ? 'text-green-400 font-medium' : 'text-gray-500'}`}>{label}</p>
                      <div className="flex-1 bg-gray-800 rounded-full h-2">
                        <div className={`h-2 rounded-full ${isCurrentMonth ? 'bg-green-500' : 'bg-gray-600'}`} style={{ width: `${pct}%` }} />
                      </div>
                      <p className={`text-xs text-right flex-shrink-0 w-20 ${isCurrentMonth ? 'text-green-400 font-medium' : 'text-gray-500'}`}>
                        {revenue > 0
                          ? formatMoneyCompact(revenue, currency === null ? null : trendCurrency)
                          : '—'}
                      </p>
                    </div>
                  )
                })}
              </div>
            </div>

          </div>
        </div>
  )
  const coachesSection = trainModule && !coachCompany ? (
        <div data-testid="coaches-section" className="px-4 sm:px-8 pt-3">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
            <button type="button" onClick={() => setShowCoaches(!showCoaches)} aria-expanded={showCoaches}
              className="w-full flex items-center justify-between text-left">
              <p className="text-xs text-gray-500 uppercase tracking-wider">{sw.many} <span className="normal-case text-gray-600">({activeCoaches.length} active)</span></p>
              <span className={`text-gray-500 text-sm transition-transform inline-block ${showCoaches ? 'rotate-180' : ''}`}>▾</span>
            </button>
            {showCoaches && (
              <div className="mt-3">
                <p className="text-xs text-gray-500 mb-3">{sw.many} see {ptWord(businessType)} and plans only: no payments, leads or settings.</p>
                {coaches.length === 0 ? (
                  <p className="text-sm text-gray-400 mb-3">No {sw.many.toLowerCase()} yet.</p>
                ) : (
                  <ul className="space-y-2 mb-3">
                    {coaches.map(c => {
                      const today = (recent?.sessions || []).filter(s => s.session_date === todayIso && s.logged_by === c.id).length
                      // Phone logins (lib/phone.ts loginEmailFor) vs email logins
                      const phoneLogin = !c.email || isPhoneLogin(c.email)
                      if (editCoach?.id === c.id) return (
                        <li key={c.id} className="bg-gray-800 rounded-xl px-3 py-3 space-y-2">
                          <div className="grid grid-cols-2 gap-2">
                            <input type="text" placeholder={`${sw.one} name`} aria-label={`${sw.one} name`}
                              value={editCoach.full_name}
                              onChange={e => setEditCoach({ ...editCoach, full_name: e.target.value })}
                              className="bg-gray-900 text-white rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-white border border-gray-700 text-sm" />
                            <input type="tel" placeholder={phoneLogin ? `Phone (${phoneHint(country ?? 'IN')})` : 'Phone (optional)'} aria-label="Phone"
                              value={editCoach.phone}
                              onChange={e => setEditCoach({ ...editCoach, phone: e.target.value })}
                              className="bg-gray-900 text-white rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-white border border-gray-700 text-sm" />
                          </div>
                          {phoneLogin && editCoach.phone.trim() !== (c.phone || '') && !!splitE164(editCoach.phone, country) && splitE164(editCoach.phone, country)?.local !== splitE164(c.phone, country)?.local && (
                            <p className="text-[11px] text-amber-300">They log in with their phone: the new number becomes their login. Their password doesn&apos;t change.</p>
                          )}
                          {editCoachError && <p className="text-xs text-red-400">{editCoachError}</p>}
                          <div className="flex gap-2">
                            <button type="button" onClick={handleSaveCoach} disabled={savingEditCoach}
                              className="flex-1 bg-white hover:bg-gray-100 text-gray-900 text-sm font-medium py-2 rounded-lg transition disabled:opacity-50">
                              {savingEditCoach ? 'Saving...' : 'Save'}
                            </button>
                            <button type="button" onClick={() => setEditCoach(null)}
                              className="px-4 border border-gray-700 rounded-lg text-gray-400 hover:bg-gray-700 text-sm transition">
                              Cancel
                            </button>
                          </div>
                        </li>
                      )
                      if (resetCoach?.id === c.id) return (
                        <li key={c.id} className="bg-gray-800 rounded-xl px-3 py-3 space-y-2">
                          <p className="text-sm text-white">New password for {c.full_name}</p>
                          <p className="text-[11px] text-gray-500">
                            They log in with {c.email && !isPhoneLogin(c.email) ? c.email : `their phone ${displayPhone(c.phone, country)}`}. Tell them the new password; they can change it after logging in.
                          </p>
                          <input type="text" placeholder="New password (min 6)" aria-label="New password" autoComplete="new-password"
                            value={resetCoach.password}
                            onChange={e => setResetCoach({ ...resetCoach, password: e.target.value, error: '' })}
                            className="w-full bg-gray-900 text-white rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-white border border-gray-700 text-sm" />
                          {resetCoach.error && <p className="text-xs text-red-400">{resetCoach.error}</p>}
                          <div className="flex gap-2">
                            <button type="button" onClick={handleResetCoachPassword} disabled={resetCoach.saving}
                              className="flex-1 bg-white hover:bg-gray-100 text-gray-900 text-sm font-medium py-2 rounded-lg transition disabled:opacity-50">
                              {resetCoach.saving ? 'Resetting...' : 'Reset password'}
                            </button>
                            <button type="button" onClick={() => setResetCoach(null)}
                              className="px-4 border border-gray-700 rounded-lg text-gray-400 hover:bg-gray-700 text-sm transition">
                              Cancel
                            </button>
                          </div>
                        </li>
                      )
                      return (
                        <li key={c.id} className="flex items-center justify-between gap-3 bg-gray-800 rounded-xl px-3 py-2.5">
                          <div className="min-w-0">
                            <p className={`text-sm truncate ${c.archived_at ? 'text-gray-500' : 'text-white'}`}>{c.full_name}</p>
                            <p className="text-xs text-gray-500 truncate">
                              {c.email && !isPhoneLogin(c.email) ? c.email : displayPhone(c.phone, country)}
                              {/* Not for dojos: senseis tap attendance, nothing to tally */}
                              {!c.archived_at && !dojo && ` · ${today} session${today === 1 ? '' : 's'} today`}
                            </p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <button type="button" onClick={() => { setEditCoachError(''); setResetCoach(null); setEditCoach({ id: c.id, full_name: c.full_name, phone: c.phone || '', phoneLogin }) }}
                              className="text-xs text-orange-400 hover:text-orange-300 transition">
                              Edit
                            </button>
                            {!c.archived_at && (
                              <button type="button" onClick={() => { setEditCoach(null); setResetCoach({ id: c.id, password: '', saving: false, error: '' }) }}
                                className="text-xs text-gray-300 hover:text-white transition">
                                Password
                              </button>
                            )}
                            <span className={`text-[11px] px-2 py-0.5 rounded-full ${c.archived_at ? 'bg-gray-700 text-gray-400' : 'bg-green-950 text-green-400 border border-green-900'}`}>
                              {c.archived_at ? 'Off' : 'Active'}
                            </span>
                            <button type="button" onClick={() => handleToggleCoach(c)}
                              className={`text-xs transition ${c.archived_at ? 'text-green-400 hover:text-green-300' : 'text-red-400 hover:text-red-300'}`}>
                              {c.archived_at ? 'Turn on' : 'Turn off'}
                            </button>
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                )}
                <div className="grid grid-cols-2 gap-2 mb-2">
                  <input type="text" placeholder={`${sw.one} name`}
                    value={newCoach.full_name}
                    onChange={e => setNewCoach({ ...newCoach, full_name: e.target.value })}
                    className="col-span-2 bg-gray-800 text-white rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-white border border-gray-700 text-sm placeholder-gray-600" />
                  {(country ?? 'IN') !== 'IN' && (
                    <>
                      <input type="email" placeholder="Email (or leave empty: phone login)" autoComplete="off"
                        value={newCoach.email}
                        onChange={e => setNewCoach({ ...newCoach, email: e.target.value })}
                        className="col-span-2 bg-gray-800 text-white rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-white border border-gray-700 text-sm placeholder-gray-600" />
                      {newCoach.email.trim() && (
                        <input type="text" placeholder="Password (min 6)" autoComplete="new-password"
                          value={newCoach.password}
                          onChange={e => setNewCoach({ ...newCoach, password: e.target.value })}
                          className="col-span-2 bg-gray-800 text-white rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-white border border-gray-700 text-sm placeholder-gray-600" />
                      )}
                    </>
                  )}
                  {/* Full row: next to the name, the country-code picker left the number box too narrow on phones */}
                  <div className="col-span-2 flex gap-2 min-w-0">
                    <CountryCodePicker value={newCoach.phone_country || (country ?? 'IN')}
                      onChange={c => setNewCoach({ ...newCoach, phone_country: c })} className="py-2" />
                    <input type="tel"
                      placeholder={(country ?? 'IN') !== 'IN' && newCoach.email.trim() ? 'Phone (optional)' : `Phone (${phoneHint(newCoach.phone_country || (country ?? 'IN'))})`}
                      value={newCoach.phone}
                      onChange={e => setNewCoach({ ...newCoach, phone: e.target.value })}
                      className="w-full min-w-0 bg-gray-800 text-white rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-white border border-gray-700 text-sm placeholder-gray-600" />
                  </div>
                </div>
                {coachMessage && (
                  <p className={`text-xs mb-2 ${coachMessage.startsWith('Error') ? 'text-red-400' : 'text-green-400'}`}>{coachMessage}</p>
                )}
                <button type="button" onClick={handleAddCoach} disabled={savingCoach}
                  className="w-full bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm py-2 rounded-xl border border-gray-700 transition disabled:opacity-50">
                  {savingCoach ? 'Adding...' : `+ Add ${sw.one.toLowerCase()}`}
                </button>
                <p className="text-xs text-gray-600 mt-1.5">
                  {(country ?? 'IN') === 'IN'
                    ? `${sw.many} log in with their phone. Default password is their phone number.`
                    : `With an email, ${sw.many.toLowerCase()} log in with it and the password you set. Without one, they log in with their phone (with the country code); default password is their phone number.`}
                </p>
              </div>
            )}
          </div>
        </div>
  ) : null
  const subscriptionStatus = trialInfo?.trial_end ? (
        <div className="px-4 sm:px-8 pt-3">
          {(() => {
            // days left including today; 0 or less means the end date has passed
            const days = trialDaysLeft() ?? 0
            const overdue = days <= 0
            const expiry = formatDate(trialInfo.trial_end, country, 'medium')
            const color = overdue ? 'text-red-400' : days <= 20 ? 'text-amber-400' : 'text-green-400'
            const borderColor = overdue ? 'border-red-900/50' : days <= 20 ? 'border-amber-900/50' : 'border-gray-800'
            return (
              <div className={`bg-gray-900 border ${borderColor} rounded-2xl px-5 py-3.5 flex items-center justify-between`}>
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wider">CoachBoard Plan</p>
                  <p className="text-sm text-white mt-0.5">
                    {trialInfo.is_trial ? 'Trial' : 'Subscription'} · expires {expiry}
                  </p>
                </div>
                <div className="text-right">
                  <p className={`text-2xl font-bold ${color}`}>{overdue ? 1 - days : days}</p>
                  <p className="text-xs text-gray-500">{overdue ? (1 - days === 1 ? 'day overdue' : 'days overdue') : days === 1 ? 'day left (last day)' : 'days left'}</p>
                </div>
              </div>
            )
          })()}
        </div>
  ) : null
  const planBreakdown = (
      <div className="px-4 sm:px-8 pt-3">
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
          {/* Collapsed by default so the member list sits higher on phones */}
          <button type="button" onClick={() => setShowPlanBreakdown(!showPlanBreakdown)} aria-expanded={showPlanBreakdown}
            className="w-full flex items-center justify-between text-left">
            <p className="text-xs text-gray-500 uppercase tracking-wider">Plan Breakdown <span className="normal-case text-gray-600">(active + expiring)</span></p>
            <span className={`text-gray-500 text-sm transition-transform inline-block ${showPlanBreakdown ? 'rotate-180' : ''}`}>▾</span>
          </button>
          {showPlanBreakdown && <div className="mt-3">{(() => {
            const activeMemberships = clients
              .filter(c => ['active', 'expiring'].includes(membershipStatus(latestMembership(c.memberships))))
              .map(c => latestMembership(c.memberships)!)
            const total = activeMemberships.length
            const planOrder = ['1 Month', '3 Months', '6 Months', '1 Year']
            const planColors: Record<string, string> = {
              '1 Month': 'bg-blue-500', '3 Months': 'bg-teal-500',
              '6 Months': 'bg-green-500', '1 Year': 'bg-emerald-400'
            }
            const counts = planOrder.map(plan => ({
              plan,
              count: activeMemberships.filter(m => m.plan_type === plan).length
            })).filter(p => p.count > 0)
            if (total === 0) return <p className="text-xs text-gray-600">No active {mw.many.toLowerCase()} yet.</p>
            return (
              <div className="space-y-2.5">
                {counts.map(({ plan, count }) => {
                  const pct = Math.round((count / total) * 100)
                  return (
                    <div key={plan} className="flex items-center gap-3">
                      <p className="text-xs text-gray-400 w-20 flex-shrink-0">{plan}</p>
                      <div className="flex-1 bg-gray-800 rounded-full h-2">
                        <div className={`h-2 rounded-full ${planColors[plan] || 'bg-gray-500'}`}
                          style={{ width: `${pct}%` }} />
                      </div>
                      <p className="text-xs text-gray-400 w-16 text-right flex-shrink-0">{count} <span className="text-gray-600">({pct}%)</span></p>
                    </div>
                  )
                })}
              </div>
            )
          })()}</div>}
        </div>
      </div>
  )
  const membersTable = (
      <div className="px-4 sm:px-8 py-6">


        {/* Members Table */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">

          {/* Table toolbar */}
          <div className="px-4 sm:px-6 pt-4 pb-3 border-b border-gray-800 space-y-3">
            <div className="flex flex-wrap justify-between items-center gap-3">
              {attendanceMode ? (
                // Dojo home: "Students · 45" and the places used (the slots testid moves here with its attributes)
                <div className="flex items-baseline gap-2">
                  <h2 className="font-semibold text-white text-sm sm:text-base">{mw.many} · {branchClients.length}</h2>
                  <span data-testid="slots" data-used={clients.length} data-limit={clientLimit} className="text-xs text-gray-500">{clients.length} of {clientLimit} places</span>
                </div>
              ) : (
                <h2 className="font-semibold text-white text-sm sm:text-base">{mw.many} — {companyName}</h2>
              )}
              <div className="flex gap-1 flex-wrap">
                {(['all', 'active', 'expiring', 'expired'] as const).map(f => (
                  <button key={f} onClick={() => setActiveFilter(f)}
                    className={`text-xs px-2.5 py-1.5 rounded-lg transition font-medium ${
                      activeFilter === f ? 'bg-white text-gray-900' : 'text-gray-500 hover:bg-gray-800 hover:text-white'
                    }`}>
                    {f.charAt(0).toUpperCase() + f.slice(1)}
                    {f !== 'all' && (
                      <span className="ml-1 text-xs opacity-60">({statusCounts[f]})</span>
                    )}
                  </button>
                ))}
                <button data-testid="members-filter-archived" onClick={() => setActiveFilter('archived')}
                  className={`text-xs px-2.5 py-1.5 rounded-lg transition font-medium ${
                    activeFilter === 'archived' ? 'bg-white text-gray-900' : 'text-gray-500 hover:bg-gray-800 hover:text-white'
                  }`}>
                  Archived
                  {archivedCount > 0 && (
                    <span className="ml-1 text-xs opacity-60">({archivedCount})</span>
                  )}
                </button>
              </div>
            </div>
            {/* Dojo: branch chips (the list and tab counts follow the chosen branch) */}
            {/* (On the dojo home the branch switcher sits in the header instead) */}
            {branchChips.length > 0 && !attendanceMode && (
              <div className="flex gap-1.5 flex-wrap" role="group" aria-label="Branch">
                {[{ id: 'all', label: 'All branches', n: clients.length },
                  ...branchChips.map(b => ({ id: b.id, label: b.name + (b.is_archived ? ' (archived)' : ''), n: clients.filter(c => c.branch_id === b.id).length })),
                  ...(noBranchCount > 0 ? [{ id: 'none', label: 'No branch', n: noBranchCount }] : [])].map(chip => (
                  <button key={chip.id} type="button" onClick={() => { setBranchFilter(chip.id); rememberBranch(chip.id) }} aria-pressed={branchFilter === chip.id}
                    className={`text-xs px-3 py-1.5 rounded-full border transition ${branchFilter === chip.id ? 'bg-orange-500 border-orange-500 text-white' : 'bg-gray-900 border-gray-700 text-gray-300 hover:border-gray-500'}`}>
                    {chip.label} <span className={branchFilter === chip.id ? 'text-orange-100' : 'text-gray-500'}>{chip.n}</span>
                  </button>
                ))}
              </div>
            )}
            <div className="relative">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"
                className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 15.803 7.5 7.5 0 0015.803 15.803z" />
              </svg>
              <input
                type="text"
                placeholder={attendanceMode ? `${mw.one} or parent · name or phone` : isDojo(businessType) ? 'Search students by name or phone...' : 'Search by name or phone...'}
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full bg-gray-800 text-white rounded-lg pl-9 pr-4 py-2 outline-none focus:ring-2 focus:ring-white border border-gray-700 text-sm placeholder-gray-600"
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          </div>

          {loading ? (
            <div className="divide-y divide-gray-800" aria-busy="true">
              <span className="sr-only" role="status">Loading {mw.many.toLowerCase()}…</span>
              {[0, 1, 2, 3, 4].map(i => (
                <div key={i} className="px-4 sm:px-6 py-4 flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-gray-800 animate-pulse shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3.5 w-1/3 rounded bg-gray-800 animate-pulse" />
                    <div className="h-3 w-1/4 rounded bg-gray-800/70 animate-pulse" />
                  </div>
                  <div className="h-6 w-16 rounded-full bg-gray-800 animate-pulse" />
                </div>
              ))}
            </div>
          ) : filteredClients.length === 0 ? (
            <div data-testid="page-company" className="px-6 py-12 text-center text-gray-500 text-sm">
              {activeFilter === 'archived'
                ? `No archived ${mw.many.toLowerCase()}.`
                : clients.length === 0
                ? `No ${mw.many.toLowerCase()} yet. Add your first one!`
                : searchQuery.trim()
                ? `No ${mw.many.toLowerCase()} match "${searchQuery}".`
                : `No ${activeFilter} ${mw.many.toLowerCase()}.`}
            </div>
          ) : (
            <div data-testid="page-company" className="overflow-x-auto">{/* safety net: a long name never pushes Action off screen */}
            <table className="w-full">
              <thead>
                <tr className="text-xs text-gray-500 uppercase tracking-wider border-b border-gray-800">
                  <th className="px-4 sm:px-6 py-3 text-left font-medium">{mw.one}</th>
                  <th className="hidden sm:table-cell px-4 py-3 text-left font-medium">Plan</th>
                  <th className="hidden sm:table-cell px-4 py-3 text-left font-medium">Paid</th>
                  <th className="hidden lg:table-cell px-4 py-3 text-left font-medium">Start → End</th>
                  <th className="hidden sm:table-cell px-4 py-3 text-left font-medium">Status</th>
                  <th className="hidden lg:table-cell px-4 py-3 text-left font-medium">Days Left</th>
                  <th className="px-3 sm:px-4 py-3 text-right sm:text-left font-medium">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {filteredClients.map((client, index) => {
                  const m = latestMembership(client.memberships)
                  const status = membershipStatus(m)
                  const days = m ? daysLeft(m.end_date) : null

                  const statusStyle = {
                    active:   { badge: 'bg-green-900/50 text-green-400',  dot: 'bg-green-500',  bar: 'bg-green-500',  days: 'text-green-400'  },
                    expiring: { badge: 'bg-amber-900/50 text-amber-400',  dot: 'bg-amber-500',  bar: 'bg-amber-500',  days: 'text-amber-400'  },
                    expired:  { badge: 'bg-red-900/50 text-red-400',      dot: 'bg-red-500',    bar: 'bg-red-500',    days: 'text-red-400'    },
                    none:     { badge: 'bg-gray-800 text-gray-500',       dot: 'bg-gray-600',   bar: 'bg-gray-700',   days: 'text-gray-500'   },
                  }[status]

                  const actionStyle = {
                    active:   { label: 'View',      cls: 'border-gray-700 text-gray-400 hover:bg-gray-800'         },
                    expiring: { label: 'Remind',    cls: 'border-amber-700 text-amber-400 hover:bg-amber-900/30'   },
                    expired:  { label: 'Follow Up', cls: 'border-red-800 text-red-400 hover:bg-red-900/30'         },
                    none:     { label: 'View',      cls: 'border-gray-700 text-gray-400 hover:bg-gray-800'         },
                  }[status]

                  // Dojos only: fee due today or within 7 days and a parent WhatsApp number → "Send reminder" to the parent
                  // (lib/guardian.ts feeReminder). Otherwise the row keeps its usual Remind / Follow Up / View button.
                  const fee = dojo && status === 'expiring' && m
                    ? feeReminder({ student: client, dueDate: m.end_date, daysLeft: days, amount: m.amount_paid,
                        currency: m.currency || currency, dojoName: companyName, country, upiId })
                    : null

                  // The link comes from reminderUrl (above): the same one the dojo home's Fees card opens
                  const handleAction = () => {
                    const url = reminderUrl(client)
                    if (url) window.open(url, '_blank')
                    else openClient(client.id)
                  }

                  return (
                    <tr key={client.id}
                      data-testid="member-row" data-name={client.full_name}
                      className={`transition cursor-pointer ${openingClientId === client.id
                        ? 'bg-orange-500/10 outline outline-1 -outline-offset-1 outline-orange-500/60'
                        : openingClientId ? 'opacity-50' : 'hover:bg-gray-800/50 active:bg-gray-800'}`}
                      aria-busy={openingClientId === client.id}
                      onMouseEnter={() => router.prefetch(`/company/client/${client.id}`)}
                      onTouchStart={() => router.prefetch(`/company/client/${client.id}`)}
                      data-nav
                      onClick={() => openClient(client.id)}>
                      <td className="px-4 sm:px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className={`w-8 h-8 sm:w-9 sm:h-9 ${avatarColor(index)} rounded-full flex items-center justify-center flex-shrink-0`}>
                            <span className="text-white text-xs sm:text-sm font-bold">{initials(client.full_name)}</span>
                          </div>
                          <div>
                            <div className="flex flex-wrap items-center gap-1.5">
                              {/* Dojo home: the belt colour dot before the name; its name starts the second line */}
                              {beltsOn && attendanceMode && <BeltChip rank={beltById[client.current_rank_id || '']} dotOnly />}
                              <p className="font-medium text-white text-sm">{client.full_name}</p>
                              {beltsOn && !attendanceMode && <BeltChip rank={beltById[client.current_rank_id || '']} showNone={activeFilter !== 'archived'} />}
                              {client.client_type === 'pt' && !dojo && (
                                <span className="text-xs bg-purple-900/50 text-purple-400 border border-purple-800 px-1.5 py-0.5 rounded-full leading-none">PT</span>
                              )}
                              {!coachCompany && client.primary_coach_id && coachById[client.primary_coach_id] && (
                                <span className="text-[11px] text-gray-500 leading-none">{sw.one}: {coachById[client.primary_coach_id].full_name.trim().replace(/^(coach|sensei)\s+/i, '').split(/\s+/)[0]}</span>
                              )}
                              {/* Phones: status sits here (the Status column shows from tablet width up). No membership saved: "No plan" */}
                              {activeFilter !== 'archived' && (
                                <span className={`sm:hidden inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full leading-none ${statusStyle.badge}`}>
                                  <span className={`w-1.5 h-1.5 rounded-full ${statusStyle.dot}`} />
                                  {m ? status.charAt(0).toUpperCase() + status.slice(1) : 'No plan'}
                                </span>
                              )}

                            </div>
                            {openingClientId === client.id ? (
                              <p className="text-xs text-orange-400 flex items-center gap-1.5" role="status">
                                <span className="inline-block w-3 h-3 rounded-full border-2 border-orange-400 border-t-transparent animate-spin" aria-hidden="true" />
                                Opening…
                              </p>
                            ) : (
                              <>
                              {beltsOn && attendanceMode ? (
                                // Dojo home: the belt in words (text, not colour alone), then the parent
                                <p className="text-xs text-gray-400">
                                  {beltById[client.current_rank_id || ''] ? beltLabel(beltById[client.current_rank_id || '']) : activeFilter !== 'archived' ? <span className="text-gray-600">No belt</span> : null}
                                  {client.guardian_name && <>{beltById[client.current_rank_id || ''] || activeFilter !== 'archived' ? ' · ' : ''}Parent: {client.guardian_name}</>}
                                </p>
                              ) : client.guardian_name && (
                                <p className="text-xs text-gray-400">Parent: {client.guardian_name}</p>
                              )}
                              {dojo && batchesOn && (client.branch_id || client.batch_id) && (
                                <p className="text-xs text-gray-500">{homeBatchLine(branchById[client.branch_id || ''] || (client.batch_id ? branchById[batchById[client.batch_id]?.branch_id || ''] : null), batchById[client.batch_id || ''], country)}</p>
                              )}
                              <p className="text-xs text-gray-500">
                                {displayPhone(client.phone, country) || shownEmail(client.email) || (usernameOf(client.email) ? `Username ${usernameOf(client.email)}` : '')}
                                {/* PT plan progress this week, on the second line so the row stays phone-width */}
                                {trainModule && client.client_type === 'pt' && (() => {
                                  const a = weekAdherence[client.id]
                                  if (!a) return null
                                  if (a === 'no-plan') return dojo ? null : <span className="whitespace-nowrap text-amber-400/80"> · no plan</span>
                                  // "Mark today" lives on the Training card (#44), not on each row
                                  return (
                                    <span className={`whitespace-nowrap font-semibold ${pctColor(pct(a))}`} title={`${a.done} of ${a.planned} workout days done this week`}>
                                      {' '}· {a.done}/{a.planned} this wk
                                    </span>
                                  )
                                })()}
                              </p>
                              </>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="hidden sm:table-cell px-4 py-4 text-sm text-gray-300">{m?.plan_type || '—'}</td>
                      <td className="hidden sm:table-cell px-4 py-4 text-sm font-medium text-white">
                        {m ? formatMoney(Number(m.amount_paid), currency === null ? null : (m.currency || currency)) : '—'}
                      </td>
                      <td className="hidden lg:table-cell px-4 py-4 text-sm text-gray-400">
                        {m ? `${fmtDate(m.start_date, country)} → ${fmtDate(m.end_date, country)}` : '—'}
                      </td>
                      <td className="hidden sm:table-cell px-4 py-4">
                        {activeFilter === 'archived' ? (
                          <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full bg-gray-800 text-gray-400">
                            <span className="w-1.5 h-1.5 rounded-full bg-gray-500" />
                            Archived
                          </span>
                        ) : m ? (
                          <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${statusStyle.badge}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${statusStyle.dot}`} />
                            {status.charAt(0).toUpperCase() + status.slice(1)}
                          </span>
                        ) : (
                          <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${statusStyle.badge}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${statusStyle.dot}`} />
                            No plan
                          </span>
                        )}
                      </td>
                      <td className="hidden lg:table-cell px-4 py-4">
                        {days !== null && m ? (
                          <div>
                            <p className={`text-sm font-semibold mb-1 ${statusStyle.days}`}>
                              {days < 0 ? `${days} days` : `${days} days`}
                            </p>
                            <div className="w-20 bg-gray-700 rounded-full h-1.5">
                              <div className={`h-1.5 rounded-full ${statusStyle.bar}`}
                                style={{ width: `${elapsedPct(m)}%` }} />
                            </div>
                          </div>
                        ) : <span className="text-gray-600 text-sm">—</span>}
                      </td>
                      <td className="px-3 sm:px-4 py-4 text-right sm:text-left whitespace-nowrap" onClick={e => e.stopPropagation()}>
                        {activeFilter === 'archived' ? (
                          <button
                            onClick={() => handleRestoreClient(client.id)}
                            className="text-xs px-3 py-1.5 rounded-lg border transition font-medium border-green-800 text-green-400 hover:bg-green-900/30">
                            Restore
                          </button>
                        ) : (
                          <button
                            onClick={handleAction}
                            className={`text-xs px-3 py-1.5 rounded-lg border transition font-medium ${fee ? 'border-green-700 text-green-400 hover:bg-green-900/30' : actionStyle.cls}`}>
                            {fee ? 'Send reminder' : actionStyle.label}
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            </div>
          )}
        </div>
      </div>
  )

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {toast && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center px-6 pointer-events-none">
          <div role="status"
            className={`min-w-[280px] max-w-sm text-center px-10 py-6 rounded-2xl text-lg font-semibold shadow-2xl ring-1 ring-black/20 ${toast.kind === 'success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'}`}>
            {toast.text}
          </div>
        </div>
      )}

      {confirmBox && (
        <div className="fixed inset-0 z-[55] flex items-center justify-center bg-black/70 px-5" role="dialog" aria-modal="true">
          <div className="w-full max-w-sm bg-gray-900 border border-gray-700 rounded-2xl p-6">
            <p className="text-lg font-semibold text-white">{confirmBox.title}</p>
            <p className="text-sm text-gray-400 mt-2">{confirmBox.body}</p>
            <div className="flex gap-2 mt-6">
              <button autoFocus onClick={() => setConfirmBox(null)}
                className="flex-1 bg-gray-800 hover:bg-gray-700 text-white text-sm py-2.5 rounded-xl transition">
                Cancel
              </button>
              <button onClick={() => { const run = confirmBox.onConfirm; setConfirmBox(null); run() }}
                className="flex-1 bg-red-600 hover:bg-red-500 text-white text-sm font-semibold py-2.5 rounded-xl transition">
                {confirmBox.action}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Dojo with branches, batches and attendance: the dojo home (app/company/dojo-home.tsx). Gyms, solo coaches and a
          dojo before branches keep the dashboard below, section for section */}
      {attendanceMode ? (
        <DojoHome
          companyId={companyId} companyName={companyName} logoUrl={logoUrl}
          roleLabel={myRole === 'partner' ? 'Partner' : myRole === 'company_admin' ? 'Owner' : ''}
          businessType={businessType} country={country} currency={currency}
          loading={loading} students={clients} inBranch={inBranch}
          branches={branchList} batches={batchList} branchFilter={branchFilter}
          onBranchChange={id => { setBranchFilter(id); rememberBranch(id) }}
          todaysBatches={todaysBatches} attToday={attToday || []} beltsOn={beltsOn}
          leadSummary={leadStats?.summary ?? null} monthByCurrency={thisMonthByCurrency}
          reminderUrl={reminderUrl}
          onAddStudent={() => { setShowForm(!showForm); setFromLead(null); setMessage('') }}
          onOpenClient={id => openClient(id)}
          onShowTab={tab => setActiveFilter(tab)}
          onLogout={handleLogout}
          banners={subscriptionBanners}
          studentList={membersTable}
          manage={{
            senseis: coachesSection,
            onOpenSenseis: () => setShowCoaches(true),
            revenue: <><div className="px-4 sm:px-8 pt-3">{thisMonthCard}</div>{showRevenueDrillIn && revenueDrillIn}{planBreakdown}</>,
            onOpenRevenue: () => setShowRevenueDrillIn(true),
            plan: subscriptionStatus,
            settings: settingsPanel,
            settingsOpen: showSettings,
            onToggleSettings: open => setShowSettings(open),
          }}
        />
      ) : dojoPending ? (
        // A dojo whose branches / attendance are still loading: a skeleton, not a flash of the gym dashboard
        <div className="px-4 sm:px-8 pt-4 space-y-3" aria-busy="true">
          <span className="sr-only" role="status">Loading…</span>
          {[0, 1, 2].map(n => <div key={n} className="h-24 rounded-2xl bg-gray-900 border border-gray-800 animate-pulse" />)}
        </div>
      ) : (<>
      {/* Header */}
      <div className="bg-gray-900 border-b border-gray-800 px-4 sm:px-8 py-4">
        <div className="flex flex-wrap justify-between items-center gap-3">
          <div className="flex items-center gap-3">
            {logoUrl && (
              <img
                src={logoUrl}
                alt={companyName}
                className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl object-cover border border-gray-700"
              />
            )}
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h1 className="text-xl sm:text-2xl font-bold text-white">{companyName || 'CoachBoard'}</h1>
              <span className="text-xs text-gray-400 bg-gray-800 border border-gray-700 rounded-full px-2.5 py-1 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 bg-green-500 rounded-full inline-block" />
                {clients.length}
              </span>
            </div>
            <p className="text-xs text-gray-500">Company Admin</p>
          </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setShowSettings(!showSettings)}
              className="text-xs text-gray-400 hover:text-white border border-gray-700 hover:border-gray-500 px-3 py-1.5 rounded-lg transition">
              Settings
            </button>
            <button data-nav onClick={handleLogout}
              className="text-xs text-gray-400 hover:text-white border border-gray-700 hover:border-gray-500 px-3 py-1.5 rounded-lg transition">
              Logout
            </button>
            <button data-testid="add-member-open"
              onClick={() => { setShowForm(!showForm); setFromLead(null); setMessage('') }}
              className="bg-white hover:bg-gray-100 text-gray-900 text-xs sm:text-sm px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg transition font-medium">
              + Add {mw.one}
            </button>
          </div>
        </div>
      </div>

      {/* Settings Panel */}
      {showSettings && settingsPanel}

      {subscriptionBanners}

      {/* Expired members alert */}
      {expiredClients.length > 0 && (
        <div className="mx-4 sm:mx-8 mt-4 bg-amber-950 border border-amber-800 rounded-xl px-5 py-3 flex items-start gap-3">
          <span className="text-amber-500 text-lg mt-0.5">⚠</span>
          <div>
            <p className="text-amber-400 font-semibold text-sm">
              {expiredClients.length} membership{expiredClients.length > 1 ? 's' : ''} expired
            </p>
            <p className="text-amber-500 text-sm">
              {expiredClients.slice(0, 3).map(c => c.full_name.split(' ')[0]).join(', ')}
              {expiredClients.length > 3 ? ` and ${expiredClients.length - 3} more` : ''} — follow up before they leave.
            </p>
          </div>
        </div>
      )}

      {/* Stat cards */}
      <div className="px-4 sm:px-8 pt-5 grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Total {mw.many}</p>
          <p className="text-3xl font-bold text-white">{clients.length}</p>
          <p data-testid="slots" data-used={clients.length} data-limit={clientLimit} className="text-xs text-gray-600 mt-1">{clients.length}/{clientLimit} slots{dojo ? '' : ptLimit !== null ? ` · ${ptCount}/${ptLimit} PT` : ptCount > 0 ? ` · ${ptCount} PT` : ''}</p>
        </div>
        <div className="bg-gray-900 border border-amber-900/50 rounded-2xl p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Expiring Soon</p>
          <p className="text-3xl font-bold text-amber-400">{expiringSoonCount}</p>
          <p className="text-xs text-gray-600 mt-1">Within 7 days</p>
          {expiringSoonRevenue > 0 && (
            <p className="text-xs text-amber-700 mt-0.5">
              {expiringSoonByCurrency.length > 1
                ? formatMoneyByCurrency(expiringSoonByCurrency, currency)
                : formatMoney(expiringSoonRevenue, currency === null ? null : singleCurrency(expiringSoonByCurrency))} at risk
            </p>
          )}
        </div>
        <div className="bg-gray-900 border border-red-900/50 rounded-2xl p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Expired</p>
          <p className="text-3xl font-bold text-red-400">{statusCounts.expired}</p>
          <p className="text-xs text-gray-600 mt-1">Not renewed</p>
        </div>
        {thisMonthCard}
      </div>

      {/* Revenue drill-in */}
      {showRevenueDrillIn && revenueDrillIn}

      {/* Leads (#52): follow-ups due, new this week, this month's joined / lost */}
      <div className="px-4 sm:px-8 pt-3">
        {!leadStats ? (
          <div className="h-12 rounded-2xl bg-gray-900 border border-gray-800 animate-pulse" aria-label="Loading" />
        ) : leadStats.rows === 0 ? (
          <button type="button" data-nav onClick={() => router.push('/company/leads')}
            className="w-full text-left bg-gray-900 border border-gray-800 rounded-2xl px-5 py-3 text-sm text-gray-400 hover:border-gray-600 transition">
            Track enquiries <span className="text-white font-medium">→ Leads</span>
          </button>
        ) : (() => {
          const s = leadStats.summary
          const due = s.dueToday + s.overdue
          return (
            <button type="button" data-nav onClick={() => router.push('/company/leads')}
              className={`w-full text-left bg-gray-900 border rounded-2xl p-4 hover:border-gray-600 transition ${s.overdue ? 'border-red-900/50' : 'border-gray-800'}`}>
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-xs text-gray-500 uppercase tracking-wider">Leads</p>
                <span className="text-gray-500 text-sm">→</span>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1 text-sm text-gray-400">
                <p><span className={`text-lg font-bold ${s.overdue ? 'text-red-400' : due ? 'text-amber-400' : 'text-white'}`}>{due}</span> follow-up{due === 1 ? '' : 's'} due</p>
                <p><span className="text-lg font-bold text-white">{s.newThisWeek}</span> new this week</p>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                This month: <span className="text-green-400 font-semibold">{s.joinedThisMonth}</span> joined · <span className="text-gray-300 font-semibold">{s.lostThisMonth}</span> lost
                {s.conversionPct !== null ? ` · ${s.conversionPct}%` : ''}
              </p>
            </button>
          )
        })()}
      </div>

      {/* Training — PT clients (Train module, #44): Today (trained, due) and This week (plan weeks: %, missed, no plan, per coach) */}
      {/* Coach assignments (#40): how many PT clients each coach is primary coach for, and who has none */}
      {trainModule && !coachCompany && ptCount > 0 && coaches.length > 0 && (
        <div className="px-4 sm:px-8 pt-3">
          <div className="bg-gray-900 border border-purple-900/50 rounded-2xl p-4">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-xs text-gray-500 uppercase tracking-wider">{sw.one} assignments <span className="normal-case text-gray-600">({ptWord(businessType)} by primary {sw.one.toLowerCase()})</span></p>
              <p className="text-xs text-gray-500 shrink-0">{ptCount - unassigned.length} of {ptCount} assigned</p>
            </div>
            <ul className="mt-2 divide-y divide-gray-800">
              {[...assignments.map(a => ({ id: a.coach.id, name: a.coach.full_name, off: !!a.coach.archived_at, clients: a.clients })),
                ...(unassigned.length ? [{ id: 'none', name: `No primary ${sw.one.toLowerCase()}`, off: false, clients: unassigned }] : [])].map(row => {
                const open = assignCoach === row.id
                const trainedToday = row.clients.filter(c => trainedTodayIds.has(c.id)).length
                return (
                  <li key={row.id} className="py-2">
                    <button type="button" onClick={() => setAssignCoach(open ? null : row.id)} aria-expanded={open} disabled={!row.clients.length}
                      className="w-full text-left">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className={`text-sm truncate ${row.id === 'none' ? 'text-amber-300' : row.off ? 'text-gray-500' : 'text-white'}`}>
                          {row.name}{row.off ? ' (login off)' : ''}
                        </span>
                        <span className="text-xs text-gray-400 shrink-0">
                          <span className="text-lg font-bold text-white">{row.clients.length}</span> {dojo ? (row.clients.length === 1 ? 'student' : 'students') : `client${row.clients.length === 1 ? '' : 's'}`}
                          {row.clients.length > 0 && !attendanceMode && <span className="text-gray-500"> · {trainedToday} trained today</span>}
                        </span>
                      </div>
                      <div className="mt-1.5 h-1.5 rounded-full bg-gray-800 overflow-hidden">
                        <div className={`h-full rounded-full ${row.id === 'none' ? 'bg-amber-500' : row.off ? 'bg-gray-600' : 'bg-purple-500'}`}
                          style={{ width: `${Math.round((row.clients.length / maxAssigned) * 100)}%` }} />
                      </div>
                    </button>
                    {open && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {row.clients.map(c => (
                          <button key={c.id} type="button" data-nav onClick={() => openClient(c.id)}
                            className="text-xs px-2.5 py-1 rounded-lg border border-gray-700 bg-gray-800 text-gray-200 hover:border-gray-500">
                            {trainedTodayIds.has(c.id) ? '✓ ' : ''}{c.full_name}
                          </button>
                        ))}
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
            <p className="text-[11px] text-gray-600 mt-2">Set the primary {sw.one.toLowerCase()} on Add {mw.one} or the {mw.one.toLowerCase()}&apos;s Profile tab. Any {sw.one.toLowerCase()} can still train any {mw.one.toLowerCase()}.</p>
          </div>
        </div>
      )}

      {/* Today's schedule: PT sessions by workout time, who trained (read-only). Not for dojos (attendance instead) */}
      {trainModule && ptCount > 0 && !dojo && (
        <div className="px-4 sm:px-8 pt-3">
          <button type="button" data-nav onClick={() => router.push('/company/today')}
            className="w-full text-left bg-gray-900 border border-gray-800 rounded-2xl px-5 py-3 text-sm text-gray-400 hover:border-gray-600 transition">
            {coachCompany ? 'Who you’re training today, by time' : 'PT sessions by time and coach'} <span className="text-white font-medium">→ {coachCompany ? 'My day' : 'Today’s schedule'}</span>
          </button>
        </div>
      )}

      {trainModule && ptCount > 0 && !attendanceMode && (
        <div className="px-4 sm:px-8 pt-3">
          <div className="bg-gray-900 border border-purple-900/50 rounded-2xl p-4">
            {/* Collapsed by default: a one-line summary; tap for Today / This week */}
            <button type="button" onClick={() => setShowTraining(!showTraining)} aria-expanded={showTraining}
              className="w-full flex items-baseline justify-between gap-3 text-left">
              <p className="text-xs text-gray-500 uppercase tracking-wider">Training <span className="normal-case text-gray-600">({ptWord(businessType)}) · {formatDate(new Date(), country, 'weekday')}</span></p>
              <span className="flex items-baseline gap-3 shrink-0">
                {!showTraining && recent && (
                  <span className="text-xs text-gray-500">
                    <span className={`font-semibold ${trainedToday.length ? 'text-green-400' : 'text-gray-400'}`}>{trainedToday.length}</span> trained today
                    {weekTotals.planned > 0 && <> · <span className={`font-semibold ${pctColor(pct(weekTotals))}`}>{pct(weekTotals)}%</span> this week</>}
                  </span>
                )}
                {showTraining && fourWeeks && (
                  <span className="text-xs text-gray-500">Last 4 weeks <span className={`font-semibold ${pctColor(pct(fourWeeks))}`}>{pct(fourWeeks)}%</span></span>
                )}
                <span className={`text-gray-500 text-sm transition-transform inline-block ${showTraining ? 'rotate-180' : ''}`}>▾</span>
              </span>
            </button>
            {!showTraining ? null : !training || !recent ? (
              <div className="mt-3 h-10 rounded-lg bg-gray-800 animate-pulse" aria-label="Loading" />
            ) : (
              <>
                {/* TODAY */}
                <div className="mt-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="text-[11px] text-gray-500 uppercase tracking-wider">Today</p>
                    <p className="text-xs text-gray-500"><span className={`font-semibold ${trainedToday.length ? 'text-green-400' : 'text-gray-400'}`}>{trainedToday.length}</span> trained</p>
                  </div>
                  {trainedToday.length === 0 ? (
                    <p className="text-sm text-gray-400 mt-1">No {dojo ? 'student' : 'PT'} sessions logged yet today.</p>
                  ) : (
                    <ul className="mt-1 divide-y divide-gray-800">
                      {trainedToday.map(s => {
                        const c = ptById[s.client_id]
                        const ex = s.exercises_done as ExercisesDone | null | undefined
                        const what = s.plan_day ? s.plan_day : s.activity ? activityText(s.activity) : 'Session'
                        return (
                          <li key={s.id}>
                            <button type="button" data-nav onClick={() => openClient(c.id, '?tab=sessions')}
                              className="w-full text-left py-2 flex items-baseline justify-between gap-3">
                              <span className="min-w-0">
                                <span className="block text-sm text-white truncate">✓ {c.full_name}</span>
                                <span className="block text-[11px] text-gray-500 truncate">
                                  {what}
                                  {ex && Array.isArray(ex.done) && ex.total ? ` · ${ex.done.length} of ${ex.total} exercises` : ''}
                                  {s.duration_minutes ? ` · ${s.duration_minutes} min` : ''}
                                </span>
                              </span>
                              {!coachCompany && <span className="text-[11px] text-gray-400 shrink-0">{loggedByText(s)}</span>}
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                  {dueToday.length > 0 && (
                    <div className="mt-2">
                      <p className="text-[11px] text-gray-500 mb-1.5">Workout today, not done yet</p>
                      <div className="flex flex-wrap gap-2">
                        {dueToday.map(({ c, label }) => (
                          <button key={c.id} type="button" data-nav onClick={() => openClient(c.id, dojo ? '?tab=sessions&log=today' : '?tab=plans&day=today')}
                            title={label}
                            className="text-xs px-2.5 py-1.5 rounded-lg border border-green-800 bg-gray-800 text-gray-200 hover:border-green-500">
                            {c.full_name.split(' ')[0]} <span className="text-green-300">Mark today</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* THIS WEEK — each client's plan week (7 days from its start) */}
                <div className="mt-3 border-t border-gray-800 pt-3">
                  <p className="text-[11px] text-gray-500 uppercase tracking-wider">This week <span className="normal-case text-gray-600">{dojo ? '(since Monday)' : <>(each client&apos;s plan week)</>}</span></p>
                  {/* Dojo: no plans (attendance replaces them later), so no plan progress, missed days or "no plan" list */}
                  {!dojo && <>
                  {weekTotals.planned === 0 ? (
                    <p className="text-sm text-gray-400 mt-1">No {dojo ? 'student' : 'PT client'} has a plan for this week yet.</p>
                  ) : (
                    <>
                      <div className="flex items-baseline gap-2 mt-1">
                        <p className={`text-3xl font-bold ${pctColor(pct(weekTotals))}`}>{pct(weekTotals)}%</p>
                        <p className="text-sm text-gray-400">{weekTotals.done} of {weekTotals.planned} workout days done so far</p>
                      </div>
                      <div className="mt-2 h-2 rounded-full bg-gray-800 overflow-hidden" role="progressbar" aria-valuenow={pct(weekTotals) ?? 0} aria-valuemin={0} aria-valuemax={100}>
                        <div className="h-full bg-purple-500 rounded-full" style={{ width: `${pct(weekTotals)}%` }} />
                      </div>
                      <p className="text-xs text-gray-500 mt-2">{withPlanCount} of {ptCount} {ptWord(businessType)} have a plan this week</p>
                    </>
                  )}
                  {missedWeek.length > 0 && (
                    <div className="mt-3">
                      <p className="text-[11px] text-gray-500 mb-1.5">Missed (workout days already passed, not done)</p>
                      <div className="flex flex-wrap gap-2">
                        {missedWeek.slice(0, 10).map(({ c, days }) => (
                          <button key={c.id} type="button" data-nav onClick={() => openClient(c.id, '?tab=plans')}
                            className="text-xs px-2.5 py-1.5 rounded-lg border border-red-900 bg-red-950/30 text-red-200 hover:border-red-600">
                            {c.full_name.split(' ')[0]} <span className="text-red-300">{days.join(', ')}</span>
                          </button>
                        ))}
                        {missedWeek.length > 10 && <span className="text-xs text-gray-500 self-center">+{missedWeek.length - 10} more</span>}
                      </div>
                    </div>
                  )}
                  {noPlanClients.length > 0 && (
                    <div className="mt-3">
                      <p className="text-[11px] text-gray-500 mb-1.5">No plan this week</p>
                      <div className="flex flex-wrap gap-2">
                        {noPlanClients.slice(0, 8).map(c => (
                          <button key={c.id} type="button" data-nav onClick={() => openClient(c.id)}
                            className="text-xs px-2.5 py-1.5 rounded-lg border border-amber-900 bg-amber-950/40 text-amber-200 hover:border-amber-600">
                            {c.full_name.split(' ')[0]}
                          </button>
                        ))}
                        {noPlanClients.length > 8 && <span className="text-xs text-gray-500 self-center">+{noPlanClients.length - 8} more</span>}
                      </div>
                    </div>
                  )}
                  </>}
                  {dojo && byLogger.length === 0 && <p className="text-sm text-gray-400 mt-1">No sessions logged yet this week.</p>}
                  {!coachCompany && byLogger.length > 0 && (
                    <div className="mt-3">
                      <p className="text-[11px] text-gray-500 mb-1.5">Logged by · today / since Mon</p>
                      <ul className="space-y-1">
                        {byLogger.map(([id, n]) => (
                          <li key={id} className="flex items-baseline justify-between gap-3 text-sm">
                            <span className="text-gray-200 truncate">{loggerName(id)}</span>
                            <span className="text-gray-400 shrink-0"><span className="text-white font-semibold">{n.today}</span> / {n.week}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Coach activity (#40): who trained whom, covering, and PT clients needing attention.
          Doesn't repeat the Training card (Today / This week / Missed / Per coach). */}
      {trainModule && !coachCompany && ptCount > 0 && coaches.length > 0 && !attendanceMode && (
        <div className="px-4 sm:px-8 pt-3">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
            <div className="flex items-baseline justify-between gap-3">
              <button type="button" onClick={() => setShowActivity(!showActivity)} aria-expanded={showActivity}
                className="flex-1 min-w-0 flex items-baseline justify-between gap-3 text-left">
                <p className="text-xs text-gray-500 uppercase tracking-wider">{sw.one} activity <span className="normal-case text-gray-600">({dojo ? 'students' : 'PT'} · today / since Mon)</span></p>
                <span className="flex items-baseline gap-3 shrink-0">
                  {!showActivity && recent && (() => {
                    const coachSessionsToday = coachActivity.reduce((n, a) => n + a.today.sessions, 0)
                    const attention = new Set([...idleClients, ...noPrimaryClients, ...membershipAttention.map(x => x.c)].map(c => c.id)).size
                    return (
                      <span className="text-xs text-gray-500">
                        <span className="font-semibold text-white">{coachSessionsToday}</span> logged today
                        {attention > 0 && <> · <span className="font-semibold text-amber-400">{attention}</span> need attention</>}
                      </span>
                    )
                  })()}
                  <span className={`text-gray-500 text-sm transition-transform inline-block ${showActivity ? 'rotate-180' : ''}`}>▾</span>
                </span>
              </button>
              {showActivity && activityCoach && (
                <button type="button" onClick={() => setActivityCoach(null)} className="text-xs text-orange-400 hover:text-orange-300 shrink-0">
                  All {sw.many.toLowerCase()}
                </button>
              )}
            </div>
            {!showActivity ? null : !recent ? (
              <div className="mt-3 h-10 rounded-lg bg-gray-800 animate-pulse" aria-label="Loading" />
            ) : (
              <>
                <ul className="mt-2 divide-y divide-gray-800">
                  {coachActivity.filter(a => !activityCoach || a.coach.id === activityCoach).map(a => {
                    const open = activityCoach === a.coach.id
                    const first = a.coach.full_name.trim().split(/\s+/)[0]
                    return (
                      <li key={a.coach.id} className="py-2">
                        <button type="button" onClick={() => setActivityCoach(open ? null : a.coach.id)} aria-expanded={open}
                          className="w-full text-left flex items-baseline justify-between gap-3">
                          <span className={`text-sm truncate ${a.coach.archived_at ? 'text-gray-500' : 'text-white'}`}>{a.coach.full_name}{a.coach.archived_at ? ' (off)' : ''}</span>
                          <span className="text-xs text-gray-400 shrink-0">
                            <span className="text-white font-semibold">{a.today.sessions}</span> / {a.week.sessions} sessions
                            {' · '}{a.today.clients.length} / {a.week.clients.length} {dojo ? 'students' : 'clients'}
                            {a.week.covering > 0 && <span className="text-sky-300"> · {a.today.covering} / {a.week.covering} covering</span>}
                          </span>
                        </button>
                        {a.byOthers.length > 0 && (
                          <p className="text-[11px] text-gray-500 mt-0.5">{first}&apos;s clients: {a.byOthers.length} trained by others</p>
                        )}
                        {open && (
                          <div className="mt-2 space-y-1.5">
                            {([['Today', a.today.clients], ['Since Mon', a.week.clients], [`${first}'s clients trained by others`, a.byOthers]] as const).map(([label, list]) => (
                              list.length > 0 && (
                                <div key={label}>
                                  <p className="text-[11px] text-gray-500 mb-1">{label}</p>
                                  <div className="flex flex-wrap gap-1.5">
                                    {list.map(c => (
                                      <button key={c.id} type="button" data-nav onClick={() => openClient(c.id, '?tab=sessions')}
                                        className="text-xs px-2.5 py-1 rounded-lg border border-gray-700 bg-gray-800 text-gray-200 hover:border-gray-500">
                                        {c.full_name.split(' ')[0]}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              )
                            ))}
                            {a.week.sessions === 0 && <p className="text-xs text-gray-500">No sessions logged since Mon.</p>}
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ul>

                {(idleClients.length > 0 || noPrimaryClients.length > 0 || membershipAttention.length > 0) && (
                  <div className="mt-3 border-t border-gray-800 pt-3 space-y-2.5">
                    <p className="text-[11px] text-gray-500 uppercase tracking-wider">Needs attention</p>
                    {idleClients.length > 0 && (
                      <div>
                        <p className="text-[11px] text-gray-500 mb-1.5">No session in 7+ days</p>
                        <div className="flex flex-wrap gap-1.5">
                          {idleClients.slice(0, 12).map(c => (
                            <button key={c.id} type="button" data-nav onClick={() => openClient(c.id)}
                              className="text-xs px-2.5 py-1 rounded-lg border border-amber-900 bg-amber-950/40 text-amber-200 hover:border-amber-600">
                              {c.full_name.split(' ')[0]}
                            </button>
                          ))}
                          {idleClients.length > 12 && <span className="text-xs text-gray-500 self-center">+{idleClients.length - 12} more</span>}
                        </div>
                      </div>
                    )}
                    {noPrimaryClients.length > 0 && (
                      <div>
                        <p className="text-[11px] text-gray-500 mb-1.5">No primary {sw.one.toLowerCase()} set</p>
                        <div className="flex flex-wrap gap-1.5">
                          {noPrimaryClients.slice(0, 12).map(c => (
                            <button key={c.id} type="button" data-nav onClick={() => openClient(c.id)}
                              className="text-xs px-2.5 py-1 rounded-lg border border-gray-700 bg-gray-800 text-gray-200 hover:border-gray-500">
                              {c.full_name.split(' ')[0]}
                            </button>
                          ))}
                          {noPrimaryClients.length > 12 && <span className="text-xs text-gray-500 self-center">+{noPrimaryClients.length - 12} more</span>}
                        </div>
                      </div>
                    )}
                    {membershipAttention.length > 0 && (
                      <div>
                        <p className="text-[11px] text-gray-500 mb-1.5">Membership ending soon or expired</p>
                        <div className="flex flex-wrap gap-1.5">
                          {membershipAttention.slice(0, 12).map(({ c, m, left }) => (
                            <button key={c.id} type="button" data-nav onClick={() => openClient(c.id)}
                              className={`text-xs px-2.5 py-1 rounded-lg border hover:border-gray-500 ${left < 0 ? 'border-red-900 bg-red-950/30 text-red-200' : 'border-amber-900 bg-amber-950/40 text-amber-200'}`}>
                              {c.full_name.split(' ')[0]} <span className="opacity-80">{left < 0 ? 'expired' : `ends ${fmtDate(m.end_date, country)}`}</span>
                            </button>
                          ))}
                          {membershipAttention.length > 12 && <span className="text-xs text-gray-500 self-center">+{membershipAttention.length - 12} more</span>}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Attendance (dojos, #78): today's batches across branches, each opens its roll call; month view link */}
      {attendanceMode && (
        <div className="px-4 sm:px-8 pt-3">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
            <div className="flex items-baseline justify-between gap-3 mb-2">
              <p className="text-xs text-gray-500 uppercase tracking-wider">Attendance <span className="normal-case text-gray-600">· {formatDate(new Date(), country, 'weekday')}</span></p>
              <span className="flex gap-3">
                <button type="button" data-nav onClick={() => router.push('/company/attendance/today')} className="text-xs text-orange-400 hover:text-orange-300">All of today →</button>
                <button type="button" data-nav onClick={() => router.push('/company/attendance')} className="text-xs text-orange-400 hover:text-orange-300">This month →</button>
              </span>
            </div>
            {todaysBatches.length === 0 ? <p className="text-sm text-gray-500">No batches today.</p> : (
              <div className="flex flex-wrap gap-2">
                {todaysBatches.map(b => {
                  const came = (attToday || []).filter(a => a.batch_id === b.id).length
                  return (
                    <button key={b.id} type="button" data-nav onClick={() => router.push(`/company/attendance/${b.id}`)}
                      className={`text-xs px-3 py-2 rounded-lg border bg-gray-800 hover:border-orange-600 ${came ? 'border-green-800 text-gray-100' : 'border-gray-700 text-gray-300'}`}>
                      {branchList.filter(x => !x.is_archived).length > 1 ? `${branchById[b.branch_id]?.name} · ` : ''}{b.name}
                      <span className="text-gray-500"> {batchWhen(b, country).split(' · ')[1] || ''}</span>
                      <span className={came ? 'text-green-400 font-semibold' : 'text-orange-400'}> · {came ? `${came} came` : 'take attendance'}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Branches & batches (dojos, #77): owner / partner manage them on their own page */}
      {dojo && batchesOn && (
        <div className="px-4 sm:px-8 pt-3">
          <button type="button" data-nav onClick={() => router.push('/company/batches')}
            className="w-full text-left bg-gray-900 border border-gray-800 rounded-2xl px-5 py-3 text-sm text-gray-400 hover:border-gray-600 transition">
            {branchList.some(b => !b.is_archived)
              ? <>{branchList.filter(b => !b.is_archived).length} branch{branchList.filter(b => !b.is_archived).length === 1 ? '' : 'es'} · {batchList.filter(b => !b.is_archived).length} batch{batchList.filter(b => !b.is_archived).length === 1 ? '' : 'es'} <span className="text-white font-medium">→ Branches &amp; batches</span></>
              : <>No branches yet <span className="text-white font-medium">→ Branches &amp; batches</span></>}
          </button>
        </div>
      )}

      {/* Belt grading (grading on + the gym has belts): exams, picking students, results */}
      {beltsOn && (
        <div className="px-4 sm:px-8 pt-3">
          <button type="button" data-nav onClick={() => router.push('/company/grading')} data-testid="grading-link"
            className="w-full text-left bg-gray-900 border border-gray-800 rounded-2xl px-5 py-3 text-sm text-gray-400 hover:border-gray-600 transition">
            Schedule exams, pick {mw.many.toLowerCase()} <span className="text-white font-medium">→ Belt grading</span>
          </button>
        </div>
      )}

      {/* Exercise list: the gym's own exercises for the plan builder (rename / archive). Not shown to dojos */}
      {trainModule && !dojo && (
        <div className="px-4 sm:px-8 pt-3">
          <button type="button" data-nav onClick={() => router.push('/company/exercises')}
            className="w-full text-left bg-gray-900 border border-gray-800 rounded-2xl px-5 py-3 text-sm text-gray-400 hover:border-gray-600 transition">
            Exercises for plans <span className="text-white font-medium">→ Exercise list</span>
          </button>
        </div>
      )}

      {/* Coaches (#40): coach logins, added by the owner or a partner; turned off, never deleted. Gyms only */}
      {coachesSection}

      {/* CoachBoard subscription status */}
      {subscriptionStatus}

      {/* Plan breakdown */}
      {planBreakdown}

      {membersTable}
      </>)}
      {/* Add Member Modal */}
      {showForm && (
        <div data-testid="add-member-form" className="fixed inset-0 z-50 bg-gray-950/95 overflow-y-auto">
          <div className="px-4 py-6 max-w-lg mx-auto">
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
              <div className="flex justify-between items-center mb-4">
                <h3 className="font-semibold text-white">New {mw.one}</h3>
                <button onClick={() => { setShowForm(false); setMessage(''); setFromLead(null) }}
                  className="text-gray-500 hover:text-white transition text-xl leading-none">✕</button>
              </div>
              {fromLead && (
                <p className="mb-3 text-xs text-green-300 bg-green-950/40 border border-green-900 rounded-lg px-3 py-2">
                  From enquiry: {fromLead.name}{fromLead.source ? ` · ${sourceLabel(fromLead.source)}` : ''}
                </p>
              )}
              <div className="grid grid-cols-2 gap-3">
                <input type="text" placeholder="Full name"
                  value={newClient.full_name}
                  onChange={e => setNewClient({ ...newClient, full_name: e.target.value })}
                  className="col-span-2 bg-gray-800 text-white rounded-lg px-4 py-2.5 outline-none focus:ring-2 focus:ring-white border border-gray-700 text-sm placeholder-gray-600" />
                {multiCountry && (
                  // Multi-country gyms: the member's own country (sets the phone code, currency and how they log in)
                  <div className="col-span-2">
                    <label className="text-xs text-gray-500 mb-1 block">Country</label>
                    <select value={newClientPlace().country}
                      onChange={e => setNewClient({ ...newClient, country: normalizeCountry(e.target.value), phone_country: '', currency: '' })}
                      className="w-full bg-gray-800 text-white rounded-lg px-4 py-2.5 outline-none focus:ring-2 focus:ring-white border border-gray-700 text-sm">
                      {COUNTRIES.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}
                    </select>
                  </div>
                )}
                {newClientChild() && (
                  <label className="col-span-2 -mb-2 text-xs text-gray-500">Student&apos;s phone (optional — only if they will log in)</label>
                )}
                {multiCountry ? (
                  <div className="col-span-2 flex gap-2">
                    <CountryCodePicker value={newClientPlace().phoneCountry}
                      onChange={c => setNewClient({ ...newClient, phone_country: c })} className="py-2.5" />
                    <input type="tel" placeholder={`${phonePlaceholder(newClientPlace().phoneCountry)} (optional)`}
                      value={newClient.phone}
                      onChange={e => setNewClient({ ...newClient, phone: e.target.value })}
                      className="w-full min-w-0 bg-gray-800 text-white rounded-lg px-4 py-2.5 outline-none focus:ring-2 focus:ring-white border border-gray-700 text-sm placeholder-gray-600" />
                  </div>
                ) : (
                  <input type="tel" placeholder={`${phonePlaceholder(country ?? 'IN')} (optional)`}
                    value={newClient.phone}
                    onChange={e => setNewClient({ ...newClient, phone: e.target.value })}
                    className={`${loginMethod(newClientPlace().country) === 'phone' ? 'col-span-2 ' : ''}bg-gray-800 text-white rounded-lg px-4 py-2.5 outline-none focus:ring-2 focus:ring-white border border-gray-700 text-sm placeholder-gray-600`} />
                )}
                {/* Email: outside India only, and only as a login when no username is given (India: username or no login) */}
                {loginMethod(newClientPlace().country) !== 'phone' ? (
                  <input type="email" placeholder="Email (optional)"
                    value={newClient.email}
                    onChange={e => setNewClient({ ...newClient, email: e.target.value })}
                    className={`${multiCountry ? 'col-span-2 ' : ''}bg-gray-800 text-white rounded-lg px-4 py-2.5 outline-none focus:ring-2 focus:ring-white border border-gray-700 text-sm placeholder-gray-600`} />
                ) : null}
                {guardianColumns && (
                  // Parent / guardian (any business type; ticked by default only for a dojo). The parent's phone is
                  // contact only, never a login, so siblings can share it.
                  <label className="col-span-2 flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={newClientChild()}
                      onChange={e => {
                        const on = e.target.checked
                        // From an enquiry: carry the phone across to the field that is now in use
                        const move = fromLead && (on ? !newClient.guardian_phone : !newClient.phone)
                        setNewClient({
                          ...newClient, child: on,
                          ...(move && on ? { guardian_phone: newClient.phone, phone: '' } : {}),
                          ...(move && !on ? { phone: newClient.guardian_phone, guardian_phone: '' } : {}),
                        })
                      }}
                      className="w-4 h-4 accent-orange-500" />
                    <span className="text-sm text-gray-300">Child — add parent details</span>
                  </label>
                )}
                {newClientChild() && (
                  <div className="col-span-2 grid grid-cols-2 gap-3 border border-gray-800 rounded-lg p-3">
                    <input type="text" placeholder="Parent name"
                      value={newClient.guardian_name}
                      onChange={e => setNewClient({ ...newClient, guardian_name: e.target.value })}
                      className="bg-gray-800 text-white rounded-lg px-4 py-2.5 outline-none focus:ring-2 focus:ring-white border border-gray-700 text-sm placeholder-gray-600" />
                    <select value={newClient.guardian_relation} aria-label="Relation"
                      onChange={e => setNewClient({ ...newClient, guardian_relation: e.target.value })}
                      className="bg-gray-800 text-white rounded-lg px-4 py-2.5 outline-none focus:ring-2 focus:ring-white border border-gray-700 text-sm">
                      {GUARDIAN_RELATIONS.map(r => <option key={r}>{r}</option>)}
                    </select>
                    <div className="col-span-2 flex gap-2">
                      {multiCountry && (
                        <CountryCodePicker value={newClientParentCountry()}
                          onChange={c => setNewClient({ ...newClient, guardian_phone_country: c })} className="py-2.5" />
                      )}
                      <input type="tel" placeholder={`Parent phone (${phoneHint(newClientParentCountry())})`} aria-label="Parent phone"
                        value={newClient.guardian_phone}
                        onChange={e => setNewClient({ ...newClient, guardian_phone: e.target.value })}
                        className="w-full min-w-0 bg-gray-800 text-white rounded-lg px-4 py-2.5 outline-none focus:ring-2 focus:ring-white border border-gray-700 text-sm placeholder-gray-600" />
                    </div>
                    <p className="col-span-2 -mt-1 text-xs text-gray-500">Fee reminders go to the parent on WhatsApp.</p>
                  </div>
                )}
                {dojo && (
                  // Dojo: the whole student profile on one screen (Age, Gender, Medical); editable later on the Profile tab
                  <>
                    <input type="number" placeholder="Age" min={1} max={120} aria-label="Age"
                      value={newClient.age}
                      onChange={e => setNewClient({ ...newClient, age: e.target.value })}
                      className="bg-gray-800 text-white rounded-lg px-4 py-2.5 outline-none focus:ring-2 focus:ring-white border border-gray-700 text-sm placeholder-gray-600" />
                    <select value={newClient.gender} aria-label="Gender"
                      onChange={e => setNewClient({ ...newClient, gender: e.target.value })}
                      className="bg-gray-800 text-white rounded-lg px-4 py-2.5 outline-none focus:ring-2 focus:ring-white border border-gray-700 text-sm">
                      <option value="">Gender</option>
                      <option>Male</option>
                      <option>Female</option>
                      <option>Other</option>
                    </select>
                    <textarea placeholder="Medical conditions / injuries (optional)"
                      value={newClient.medical_conditions}
                      onChange={e => setNewClient({ ...newClient, medical_conditions: e.target.value })}
                      rows={2}
                      className="col-span-2 bg-gray-800 text-white rounded-lg px-4 py-2.5 outline-none focus:ring-2 focus:ring-white border border-gray-700 text-sm resize-none placeholder-gray-600" />
                    {/* Branch + home batch (once branches exist). Picking a batch sets its branch; the student can attend any batch */}
                    {batchesOn && branchList.some(b => !b.is_archived) && (
                      <>
                        <select value={newClient.branch_id} aria-label="Branch"
                          onChange={e => setNewClient({ ...newClient, branch_id: e.target.value, batch_id: '' })}
                          className="bg-gray-800 text-white rounded-lg px-4 py-2.5 outline-none focus:ring-2 focus:ring-white border border-gray-700 text-sm">
                          <option value="">Branch</option>
                          {branchList.filter(b => !b.is_archived).map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                        </select>
                        <select value={newClient.batch_id} aria-label="Home batch"
                          onChange={e => {
                            const batch = batchList.find(b => b.id === e.target.value)
                            setNewClient({ ...newClient, batch_id: e.target.value, ...(batch ? { branch_id: batch.branch_id } : {}) })
                          }}
                          className="bg-gray-800 text-white rounded-lg px-4 py-2.5 outline-none focus:ring-2 focus:ring-white border border-gray-700 text-sm">
                          <option value="">Home batch</option>
                          {sortBatches(batchList.filter(b => !b.is_archived && (!newClient.branch_id || b.branch_id === newClient.branch_id)
                            && !branchById[b.branch_id]?.is_archived)).map(b => (
                            <option key={b.id} value={b.id}>
                              {newClient.branch_id ? '' : `${branchById[b.branch_id]?.name || ''} · `}{b.name}{batchWhen(b, country) ? ` (${batchWhen(b, country)})` : ''}
                            </option>
                          ))}
                        </select>
                      </>
                    )}
                  </>
                )}
                {beltsOn && (
                  // Belt grading: the belt they join with (White for a beginner) and since when (default the start date below)
                  <>
                    <div>
                      <label className="text-xs text-gray-500 mb-1 block">Belt</label>
                      <select value={newClient.rank_id || defaultBeltId(beltRanks)} aria-label="Belt"
                        onChange={e => setNewClient({ ...newClient, rank_id: e.target.value })}
                        className="w-full bg-gray-800 text-white rounded-lg px-4 py-2.5 outline-none focus:ring-2 focus:ring-white border border-gray-700 text-sm">
                        {beltOptions(beltRanks).map(r => <option key={r.id} value={r.id}>{beltLabel(r)}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 mb-1 block">Belt since</label>
                      <input type="date" aria-label="Belt since"
                        value={newClient.belt_since ?? newClient.start_date}
                        onChange={e => setNewClient({ ...newClient, belt_since: e.target.value })}
                        className="w-full bg-gray-800 text-white rounded-lg px-4 py-2.5 outline-none focus:ring-2 focus:ring-white border border-gray-700 text-sm" />
                    </div>
                  </>
                )}
                <div className="col-span-2">
                  <label className="text-xs text-gray-500 mb-1 block">Login (optional) · username + password</label>
                  <UsernameField value={newClient.username} fullName={newClient.full_name}
                    onChange={v => setNewClient({ ...newClient, username: v })} onStatus={setNewUsernameStatus}
                    placeholder="Username, e.g. anand.k (leave empty for no login)" />
                </div>
                {newClientLogin().kind !== 'none' && <div className="col-span-2 relative">
                  <input type={showNewClientPassword ? 'text' : 'password'} placeholder="Password (min 6)"
                    value={newClient.password}
                    onChange={e => setNewClient({ ...newClient, password: e.target.value })}
                    className="w-full bg-gray-800 text-white rounded-lg px-4 py-2.5 pr-10 outline-none focus:ring-2 focus:ring-white border border-gray-700 text-sm placeholder-gray-600" />
                  <button type="button" onClick={() => setShowNewClientPassword(!showNewClientPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition">
                    {showNewClientPassword
                      ? <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" /></svg>
                      : <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                    }
                  </button>
                </div>}
                <p className="col-span-2 -mt-1 text-xs text-gray-500">
                  {(() => {
                    const l = newClientLogin()
                    if (l.kind === 'username') return <>{mw.one} logs in with username <span className="text-gray-300 font-medium">{l.shown}</span> and this password. Phone is for contact only.</>
                    if (l.kind === 'email') return <>{mw.one} logs in with: <span className="text-gray-300 font-medium">{l.shown}</span></>
                    if (l.kind === 'bad-email') return <span className="text-amber-400">Check the email, or leave it empty</span>
                    if (l.kind === 'bad-username') return null
                    return `No login: you enter their sessions and share progress. Give them a login any time from their page → ⋯ → Create login.`
                  })()}
                </p>
                <select
                  value={newClient.plan_type}
                  onChange={e => setNewClient({ ...newClient, plan_type: e.target.value })}
                  className="bg-gray-800 text-white rounded-lg px-4 py-2.5 outline-none focus:ring-2 focus:ring-white border border-gray-700 text-sm">
                  <option>1 Month</option>
                  <option>3 Months</option>
                  <option>6 Months</option>
                  <option>1 Year</option>
                </select>
                {multiCountry ? (
                  // Currency of this payment (and the member's default), from the gym's allowed currencies
                  <div className="flex gap-2 min-w-0">
                    <select aria-label="Currency" value={newClientPlace().currency}
                      onChange={e => setNewClient({ ...newClient, currency: e.target.value })}
                      className="shrink-0 bg-gray-800 text-white rounded-lg px-2 py-2.5 outline-none focus:ring-2 focus:ring-white border border-gray-700 text-sm">
                      {CURRENCIES.filter(c => allowedCurrencies.includes(c.code)).map(c => <option key={c.code} value={c.code}>{c.code}</option>)}
                    </select>
                    <input type="number" placeholder={`Amount (${currencySymbol(newClientPlace().currency)})`}
                      value={newClient.amount_paid}
                      onChange={e => setNewClient({ ...newClient, amount_paid: e.target.value })}
                      className="w-full min-w-0 bg-gray-800 text-white rounded-lg px-4 py-2.5 outline-none focus:ring-2 focus:ring-white border border-gray-700 text-sm placeholder-gray-600" />
                  </div>
                ) : (
                  <input type="number" placeholder={currency ? `Amount paid (${currencySymbol(currency)})` : 'Amount paid'}
                    value={newClient.amount_paid}
                    onChange={e => setNewClient({ ...newClient, amount_paid: e.target.value })}
                    className="bg-gray-800 text-white rounded-lg px-4 py-2.5 outline-none focus:ring-2 focus:ring-white border border-gray-700 text-sm placeholder-gray-600" />
                )}
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Start Date</label>
                  <input type="date"
                    value={newClient.start_date}
                    onChange={e => setNewClient({ ...newClient, start_date: e.target.value })}
                    className="w-full bg-gray-800 text-white rounded-lg px-4 py-2.5 outline-none focus:ring-2 focus:ring-white border border-gray-700 text-sm" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">End Date (auto-calculated)</label>
                  <input type="date"
                    value={newClient.end_date}
                    onChange={e => setNewClient({ ...newClient, end_date: e.target.value })}
                    className="w-full bg-gray-800 text-white rounded-lg px-4 py-2.5 outline-none focus:ring-2 focus:ring-white border border-gray-700 text-sm" />
                </div>
                {newClient.start_date && (
                  <p className="col-span-2 -mt-1 text-xs text-gray-400">
                    Membership: {formatDate(newClient.start_date, country, 'medium')}
                    {newClient.end_date ? ` → ${formatDate(newClient.end_date, country, 'medium')}` : ''}
                  </p>
                )}
                {/* Dojo: no diet plan, and every student is a PT client (saved as 'pt' below and in create-user) */}
                {!dojo && <textarea placeholder="Diet plan (optional)"
                  value={newClient.diet_plan}
                  onChange={e => setNewClient({ ...newClient, diet_plan: e.target.value })}
                  rows={2}
                  className="col-span-2 bg-gray-800 text-white rounded-lg px-4 py-2.5 outline-none focus:ring-2 focus:ring-white border border-gray-700 text-sm resize-none placeholder-gray-600" />}
                {!dojo && <label className="col-span-2 flex items-center gap-3 cursor-pointer py-1">
                  <input type="checkbox"
                    checked={newClient.client_type === 'pt'}
                    onChange={e => setNewClient({ ...newClient, client_type: e.target.checked ? 'pt' : 'member' })}
                    className="w-4 h-4 rounded border-gray-600 bg-gray-800 accent-purple-500" />
                  <span className="text-sm text-gray-300">Personal Training (PT) member</span>
                </label>}
                {/* Coach for this member: picked from the gym's coaches (no free text). PT: primary coach; regular member: optional */}
                {!coachCompany && activeCoaches.length > 0 && (
                  <div className="col-span-2">
                    <label className="text-xs text-gray-500 mb-1 block">{dojo ? `${sw.one} (optional)` : newClient.client_type === 'pt' ? 'Primary coach' : 'Trainer (optional)'}</label>
                    <select
                      value={newClient.primary_coach_id}
                      onChange={e => setNewClient({ ...newClient, primary_coach_id: e.target.value })}
                      className="w-full bg-gray-800 text-white rounded-lg px-4 py-2.5 outline-none focus:ring-2 focus:ring-white border border-gray-700 text-sm">
                      <option value="">No primary {sw.one.toLowerCase()}</option>
                      {activeCoaches.map(c => <option key={c.id} value={c.id}>{c.full_name}</option>)}
                    </select>
                  </div>
                )}
              </div>
              {message && (
                <p data-testid="add-member-message" className={`text-sm mt-3 ${message.includes('Error') ? 'text-red-400' : 'text-green-400'}`}>{message}</p>
              )}
              <div className="flex gap-2 mt-4">
                <button data-testid="add-member-save" onClick={handleCreateClient} disabled={saving}
                  className="flex-1 bg-white hover:bg-gray-100 text-gray-900 font-semibold py-2.5 rounded-lg transition disabled:opacity-50 text-sm">
                  {saving ? 'Creating...' : `Create ${mw.one}`}
                </button>
                <button onClick={() => { setShowForm(false); setMessage(''); setFromLead(null) }}
                  className="px-4 py-2.5 border border-gray-700 rounded-lg text-gray-400 hover:bg-gray-800 text-sm transition">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}

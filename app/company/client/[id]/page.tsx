'use client'

import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter, useParams } from 'next/navigation'
import { formatMoney, currencySymbol } from '@/lib/currency'
import { type Country, normalizeCountry, formatDate } from '@/lib/locale'
import { weekStatus, dayKey, isRestDay, doneDayKeys, weekEnd } from '@/lib/plan-summary'
import { type PlanJson, planJsonOf, summarizeAny, planToText, cleanPlan, workoutDays, emptyPlan, textToPlan } from '@/lib/plan-structure'
import PlanEditor from '@/app/plan-editor'
import PlanDays from '@/app/plan-days'
import dynamic from 'next/dynamic'

// Charts load only when the Progress view is shown (keeps Chart.js out of the first download)
const ProgressCharts = dynamic(() => import('@/app/progress-charts'), {
  ssr: false,
  loading: () => <p className="text-xs text-gray-500 px-1">Loading charts…</p>,
})

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
}


type Membership = {
  id: string
  plan_type: string
  amount_paid: number
  start_date: string
  end_date: string
  created_at?: string
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

export default function ClientDetailPage() {
  const router = useRouter()
  const params = useParams()
  const clientId = params.id as string

  const [client, setClient] = useState<ClientProfile | null>(null)
  const [plans, setPlans] = useState<Plan[]>([])
  const [sessions, setSessions] = useState<Session[]>([])
  const [feedback, setFeedback] = useState<Feedback[]>([])
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
  // AI diet chart: draft is reviewed/edited by the coach before saving to profiles.diet_plan
  const [dietGenerating, setDietGenerating] = useState(false)
  const [dietDraft, setDietDraft] = useState('')
  const [dietError, setDietError] = useState('')
  const [savingDiet, setSavingDiet] = useState(false)
  const dietPanelRef = useRef<HTMLDivElement | null>(null)
  // Compact plan cards: one expanded at a time; older plans behind "Show older"
  const [expandedPlanId, setExpandedPlanId] = useState<string | null>(null)
  const [showAllPlans, setShowAllPlans] = useState(false)
  const manualFormRef = useRef<HTMLDivElement | null>(null)
  const aiPanelRef = useRef<HTMLDivElement | null>(null)
  const aiWorkingRef = useRef<HTMLDivElement | null>(null)
  const [planError, setPlanError] = useState('')
  const [toast, setToast] = useState<{ text: string; kind: 'success' | 'error' } | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [aiError, setAiError] = useState('')
  const [aiElapsed, setAiElapsed] = useState(0)
  const aiAbort = useRef<AbortController | null>(null)
  const [feedbackText, setFeedbackText] = useState<Record<string, string>>({})
  const [savedFeedback, setSavedFeedback] = useState<Record<string, boolean>>({})
  const [showResetPassword, setShowResetPassword] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [resetMessage, setResetMessage] = useState('')
  const [resetting, setResetting] = useState(false)
  const [showResetPasswordValue, setShowResetPasswordValue] = useState(false)
  const [loading, setLoading] = useState(true)
  const [memberships, setMemberships] = useState<Membership[]>([])
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [showEditClient, setShowEditClient] = useState(false)
  const [editClientForm, setEditClientForm] = useState({
    full_name: '', phone: '',
    plan_type: '1 Month', amount_paid: '',
    start_date: new Date().toISOString().split('T')[0], end_date: '',
    client_type: 'member'
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
    medical_conditions: '', emergency_contact_name: '', emergency_contact_phone: ''
  })
  const [savingClientProfile, setSavingClientProfile] = useState(false)
  const [clientProfileMessage, setClientProfileMessage] = useState('')

  useEffect(() => { initialize() }, [clientId])

  // Seconds counter for the AI "working" panel
  useEffect(() => {
    if (!generatingPlan) return
    setAiElapsed(0)
    const t = setInterval(() => setAiElapsed(s => s + 1), 1000)
    return () => clearInterval(t)
  }, [generatingPlan])

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
    await Promise.all([
      want('client') && (async () => {
        const { data: clientData } = await supabase
          .from('profiles')
          .select('*, companies:company_id(business_type, feedback_enabled, client_module_enabled, currency, country)')
          .eq('id', clientId)
          .single()
        setClient(clientData)
        if (clientData?.company_id) setCompanyId(clientData.company_id)
      })(),
      want('memberships') && (async () => {
        const { data: membershipsData } = await supabase
          .from('memberships')
          .select('id, plan_type, amount_paid, start_date, end_date, created_at')
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
          return
        }
        const { data: sessionsData } = await supabase
          .from('logged_sessions')
          .select('*')
          .eq('client_id', clientId)
          .order('session_date', { ascending: true })
        setSessions(sessionsData || [])
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

  // Shared insert for both the manual form and the AI panel.
  // Only clears/closes the form when the database confirms the save.
  const insertPlan = async (plan: { week_start: string; plan_details: string; workout_time: string; plan_json?: PlanJson | null }) => {
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
      return false
    }
    // Briefly highlight the new card so the coach sees where it went
    if (inserted?.id) {
      setHighlightPlanId(inserted.id)
      setTimeout(() => setHighlightPlanId(null), 2500)
    }
    showToast(`✓ Plan assigned for week of ${formatDate(plan.week_start, country, 'dayMonth')}`)
    loadData(['plans'])
    return true
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
  let { error } = await supabase.from('weekly_plans').update(withJson).eq('id', editingPlan.id)
  // If the plan_json column hasn't been added in Supabase yet, save the text alone
  if (error && /plan_json/i.test(error.message)) {
    ;({ error } = await supabase.from('weekly_plans').update(base).eq('id', editingPlan.id))
  }
  setSaving(false)
  if (error) {
    setPlanError('Could not save changes: ' + error.message)
    return
  }
  setEditingPlan(null)
  setEditingJson(null)
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

    let data: { plan?: string; plan_json?: unknown; error?: string } = {}
    try { data = await response.json() } catch { /* non-JSON, e.g. server timeout page */ }

    if (response.ok && data.plan) {
      setGeneratedPlan(data.plan)
      setGeneratedJson(data.plan_json ? planJsonOf({ plan_json: data.plan_json }) : null)
      setAiPlanMeta(prev => ({ ...prev, week_start: prev.week_start || nextMonday() }))
      setShowGeneratedPlan(true)
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



  const getFeedback = (sessionId: string) => feedback.find(f => f.session_id === sessionId)

  const handleEditClient = async () => {
    setSavingEdit(true)
    setEditMessage('')
    const response = await fetch('/api/update-client', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: clientId, full_name: editClientForm.full_name, phone: editClientForm.phone })
    })
    const result = await response.json()
    if (result.error) {
      setSavingEdit(false)
      setEditMessage('Error: ' + result.error)
      return
    }
    await supabase.from('profiles').update({ client_type: editClientForm.client_type }).eq('id', clientId)
    setSavingEdit(false)
    setEditMessage('Saved! ✓')
    showToast('Member updated ✓')
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
      end_date: editClientForm.end_date
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

  const handleUnarchiveClient = async () => {
    await supabase.from('profiles').update({ archived_at: null }).eq('id', clientId)
    loadData(['client'])
  }

  const getChartData = () => {
    if (sessions.length === 0) return null
    const weekMap: Record<string, { sessions: number, minutes: number }> = {}

    sessions.forEach(session => {
      const parts = session.session_date.split('-')
      const date = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]))
      const weekStart = new Date(date)
      weekStart.setDate(date.getDate() - date.getDay())
      const key = `${weekStart.getFullYear()}-${String(weekStart.getMonth() + 1).padStart(2, '0')}-${String(weekStart.getDate()).padStart(2, '0')}`
      if (!weekMap[key]) weekMap[key] = { sessions: 0, minutes: 0 }
      weekMap[key].sessions += 1
      weekMap[key].minutes += session.duration_minutes || 0
    })

    const sortedWeeks = Object.keys(weekMap).sort()
    const labels = sortedWeeks.map(w => {
      const parts = w.split('-')
      const date = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]))
      return formatDate(date, country, 'dayMonth')
    })

    return {
      labels,
      sessionCounts: sortedWeeks.map(w => weekMap[w].sessions),
      minuteCounts: sortedWeeks.map(w => weekMap[w].minutes)
    }
  }

  // null until the client/company row has loaded, so dates don't flash the wrong format
  const country: Country | null = client ? normalizeCountry((client as { companies?: { country?: string | null } }).companies?.country) : null
  const chartData = getChartData()
  const totalMinutes = sessions.reduce((sum, s) => sum + (s.duration_minutes || 0), 0)
  // null until the client/company row has loaded; INR only if the company's currency is empty
  const currency: string | null = client ? ((client as any).companies?.currency || 'INR') : null

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
    <div className="min-h-screen bg-gray-950 text-white">
      {toast && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center px-6 pointer-events-none">
          <div role="status"
            className={`min-w-[280px] max-w-sm text-center px-10 py-6 rounded-2xl text-lg font-semibold shadow-2xl ring-1 ring-black/20 ${toast.kind === 'success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'}`}>
            {toast.text}
          </div>
        </div>
      )}
      {/* Header */}
      <div className="bg-gray-900 border-b border-gray-800 px-6 py-4 flex justify-between items-center">
        <div className="flex items-center gap-3">
          <button data-nav onClick={() => router.push('/company')}
            className="text-gray-500 hover:text-white border border-gray-700 hover:border-gray-500 px-3 py-1.5 rounded-lg text-xs transition">
            ← Back
          </button>
          <button
            onClick={() => setShowResetPassword(!showResetPassword)}
            className="text-xs text-gray-500 hover:text-white border border-gray-700 hover:border-gray-500 px-3 py-1.5 rounded-lg transition">
            Reset Password
          </button>
          <button
            onClick={() => {
              const latest = memberships[0]
              setEditClientForm({
                full_name: client?.full_name || '',
                phone: client?.phone || '',
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
            }}
            className="text-xs text-orange-500 hover:text-orange-400 border border-orange-900 hover:border-orange-500 px-3 py-1.5 rounded-lg transition">
            Edit
          </button>
          {client?.archived_at ? (
            <button
              onClick={handleUnarchiveClient}
              className="text-xs text-green-500 hover:text-green-400 border border-green-900 hover:border-green-500 px-3 py-1.5 rounded-lg transition">
              Restore
            </button>
          ) : (
            <button
              onClick={handleArchiveClient}
              className="text-xs text-gray-500 hover:text-amber-400 border border-gray-700 hover:border-amber-600 px-3 py-1.5 rounded-lg transition">
              Archive
            </button>
          )}
          <button
            onClick={handleDeleteClient}
            disabled={deletingClient}
            className="text-xs text-gray-500 hover:text-red-400 border border-gray-700 hover:border-red-500 px-3 py-1.5 rounded-lg transition">
            {deletingClient ? 'Deleting...' : 'Delete'}
          </button>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-gray-800 rounded-lg flex items-center justify-center border border-gray-700">
              <span className="text-orange-500 font-bold text-sm">{client?.full_name[0]}</span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-bold text-white">{client?.full_name}</h1>
                {client?.client_type === 'pt' && (
                  <span className="text-xs bg-purple-900/50 text-purple-400 border border-purple-800 px-2 py-0.5 rounded-full">PT</span>
                )}
                {client?.archived_at && (
                  <span className="text-xs bg-gray-800 text-gray-400 border border-gray-700 px-2 py-0.5 rounded-full">Archived</span>
                )}
              </div>
              <p className="text-xs text-gray-400">{client?.email}</p>
              {client?.phone && (
                <p className="text-xs text-gray-400">{client?.phone}</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Edit Client Panel */}
      {showEditClient && (
        <div className="bg-gray-900 border-b border-gray-800 px-6 py-5">
          <div className="max-w-2xl mx-auto space-y-4">

            {/* Client details */}
            <p className="text-xs text-gray-500 uppercase tracking-wider">Client Details</p>
            <input type="text" placeholder="Full name"
              value={editClientForm.full_name}
              onChange={e => setEditClientForm({ ...editClientForm, full_name: e.target.value })}
              className="w-full bg-gray-800 text-white rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm" />
            <input type="tel" placeholder="Phone number"
              value={editClientForm.phone}
              onChange={e => setEditClientForm({ ...editClientForm, phone: e.target.value })}
              className="w-full bg-gray-800 text-white rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm" />
            <label className="flex items-center gap-3 cursor-pointer py-1">
              <input type="checkbox"
                checked={editClientForm.client_type === 'pt'}
                onChange={e => setEditClientForm({ ...editClientForm, client_type: e.target.checked ? 'pt' : 'member' })}
                className="w-4 h-4 rounded border-gray-600 bg-gray-800 accent-purple-500" />
              <span className="text-sm text-gray-300">Personal Training (PT) member</span>
            </label>
            {editMessage && (
              <p className={`text-sm ${editMessage.includes('Error') ? 'text-red-400' : 'text-green-400'}`}>{editMessage}</p>
            )}
            <button
              onClick={handleEditClient}
              disabled={savingEdit}
              className="w-full bg-orange-500 hover:bg-orange-400 text-white font-semibold py-2.5 rounded-xl transition disabled:opacity-50 text-sm">
              {savingEdit ? 'Saving...' : 'Save Name / Phone'}
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
                <input type="number" placeholder={currency ? `Amount paid (${currencySymbol(currency)})` : 'Amount paid'}
                  value={editClientForm.amount_paid}
                  onChange={e => setEditClientForm({ ...editClientForm, amount_paid: e.target.value })}
                  className="bg-gray-800 text-white rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm placeholder-gray-600" />
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

{showResetPassword && (
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

      {/* Stats */}
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
                <p className="text-xs text-gray-600 mt-1">{formatMoney(Number(memberships[0].amount_paid), currency)}</p>
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

      {/* Tabs — PT members only, requires client module */}
      {client?.client_type === 'pt' && (client as any)?.companies?.client_module_enabled && (
        <div className="max-w-2xl mx-auto px-6 mt-4">
          <div className="flex gap-1 bg-gray-900 p-1 rounded-xl border border-gray-800 mb-6">
            {(['profile', 'plans', 'sessions', 'progress'] as const).map(tab => (
              <button key={tab} onClick={() => setActiveTab(tab)}
                className={`flex-1 py-2 text-xs font-medium rounded-lg transition ${activeTab === tab
                  ? 'bg-orange-500 text-white'
                  : 'text-gray-400 hover:text-white'}`}>
                {tab === 'plans' ? 'Plans' : tab === 'sessions' ? 'Sessions' : tab === 'progress' ? 'Progress' : 'Profile'}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="max-w-2xl mx-auto px-6 pb-8">

        {/* PLANS / SESSIONS / PROGRESS — PT members only, requires client module */}
        {client?.client_type === 'pt' && (client as any)?.companies?.client_module_enabled && (<>

        {/* PLANS TAB */}
        {activeTab === 'plans' && (
          <div>
<p className="text-xs text-gray-400 mb-3">
  📅 Today is <span className="text-white font-medium">{formatDate(new Date(), country, 'weekday')}</span>. Each plan covers 7 days from its start date; the client can tick off days only during that week.
</p>
{client?.goal && (
  <div className="bg-orange-950 border border-orange-900 rounded-2xl px-5 py-4 mb-4">
    <p className="text-xs text-orange-400 uppercase tracking-wider mb-1">Client Goal</p>
    <p className="text-sm text-orange-200">{client.goal}</p>
  </div>
)}
{(() => {
  const missing = [
    !client?.goal && 'goal',
    !client?.fitness_level && 'fitness level',
    !client?.available_days && 'available days',
  ].filter(Boolean) as string[]
  if (!missing.length) return null
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
            <div className="mb-4">
              <div className="flex flex-wrap justify-between items-center gap-2">
                <p className="text-xs text-gray-500">{plans.length} plans assigned</p>
                <div className="flex flex-wrap gap-2">
  <button
    onClick={handleGeneratePlan}
    disabled={generatingPlan}
    className="bg-purple-600 hover:bg-purple-500 text-white text-xs px-4 py-2 rounded-xl transition font-medium disabled:opacity-50">
    {generatingPlan ? '⏳ Creating…' : '✨ Create plan with AI'}
  </button>
  <button onClick={() => {
      setPlanError('')
      setAiError('')
      if (!showPlanForm) {
        setShowGeneratedPlan(false)
        setNewPlan(prev => ({ ...prev, week_start: prev.week_start || nextMonday() }))
        // Start from the client's available days as workout days
        setNewPlanJson(prev => prev ?? emptyPlan(client?.available_days))
        setNewPlanTextMode(false)
      }
      setShowPlanForm(!showPlanForm)
    }}
    disabled={generatingPlan}
    className="bg-orange-500 hover:bg-orange-400 text-white text-xs px-4 py-2 rounded-xl transition font-medium disabled:opacity-50">
    {showPlanForm ? 'Close' : '✍️ Write plan manually'}
  </button>
                </div>
              </div>
              <p className="text-xs text-gray-500 mt-2">Create a weekly plan, review it, then pick the week to assign it to the client.</p>
            </div>
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
    <button onClick={handleGeneratePlan}
      className="text-xs text-white bg-red-800 hover:bg-red-700 px-3 py-1.5 rounded-lg transition">
      Try again
    </button>
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
    {generatedJson ? (
      <PlanEditor value={generatedJson} onChange={setGeneratedJson} weekStart={aiPlanMeta.week_start} />
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
                    <PlanEditor value={newPlanJson} onChange={setNewPlanJson} weekStart={newPlan.week_start} />
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

            {plans.length === 0 ? (
              <div className="bg-gray-900 rounded-2xl p-10 text-center text-gray-500 border border-gray-800">
                No plans assigned yet.
              </div>
            ) : (
              <div className="space-y-3">
                {(showAllPlans ? plans : plans.slice(0, 6)).map(plan => (
  <div key={plan.id} className={`bg-gray-900 rounded-2xl p-4 border transition-shadow duration-700 ${highlightPlanId === plan.id ? 'border-green-500 ring-2 ring-green-500' : 'border-gray-800'}`}>
    {editingPlan?.id === plan.id ? (
      // Edit mode
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
          <PlanEditor value={editingJson} onChange={setEditingJson} weekStart={editingPlan.week_start} />
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
    ) : (
      // View mode: compact card, tap to expand
      (() => {
        const summary = summarizeAny(plan, plan.week_start)
        const planJson = planJsonOf(plan)
        const status = weekStatus(plan.week_start)
        const open = expandedPlanId === plan.id
        const done = doneDayKeys(plan.id, sessions)
        const workoutLabels = summary.days.filter(d => !isRestDay(d))
        const doneCount = workoutLabels.filter(d => done.has(dayKey(d))).length
        return (
      <>
        <div className="flex justify-between items-start gap-3">
          <button
            onClick={() => setExpandedPlanId(open ? null : plan.id)}
            aria-expanded={open}
            className="flex-1 min-w-0 text-left rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-gray-500 text-xs w-3" aria-hidden="true">{open ? '▾' : '▸'}</span>
              <p className="font-semibold text-sm">{formatDate(plan.week_start.slice(0, 10), country, 'weekday')} – {formatDate(weekEnd(plan.week_start), country, 'weekday')}</p>
              {status === 'current' && <span className="text-[11px] font-medium text-green-300 bg-green-950 border border-green-800 px-2 py-0.5 rounded-full">This week</span>}
              {status === 'upcoming' && <span className="text-[11px] font-medium text-blue-300 bg-blue-950 border border-blue-800 px-2 py-0.5 rounded-full">Upcoming</span>}
              {status === 'past' && <span className="text-[11px] text-gray-500">Past</span>}
              {plan.workout_time && <span className="text-xs text-orange-400">⏰ {plan.workout_time}</span>}
            </div>
            <div className="pl-5 mt-1.5">
              {summary.days.length > 0 ? (
                <>
                  <p className="text-xs text-gray-400">
                    {summary.workoutDays} workout day{summary.workoutDays === 1 ? '' : 's'}
                    {summary.exercises > 0 ? ` · ${summary.exercises} exercises` : ''}
                    {(doneCount > 0 || status === 'current') && (
                      <span className={doneCount > 0 ? 'text-green-400 font-medium' : 'text-gray-500'}> · {doneCount} of {workoutLabels.length} done</span>
                    )}
                  </p>
                  {!open && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {summary.days.map((d, i) => {
                        const isDone = !isRestDay(d) && done.has(dayKey(d))
                        return (
                          <span key={i} className={`text-[11px] px-2 py-0.5 rounded-md border ${isRestDay(d) ? 'border-gray-800 text-gray-600' : isDone ? 'border-green-700 bg-green-950 text-green-300' : 'border-gray-700 text-gray-300'}`}>
                            {isDone ? '✓ ' : ''}{d}
                          </span>
                        )
                      })}
                    </div>
                  )}
                </>
              ) : (
                !open && <p className="text-xs text-gray-400 line-clamp-2">{summary.fallback.join(' ')}</p>
              )}
            </div>
          </button>
          <div className="flex gap-1.5 shrink-0">
            <button
              onClick={e => { e.stopPropagation(); setPlanError(''); setEditingPlan(plan); setEditingJson(planJsonOf(plan)) }}
              aria-label={`Edit plan for week of ${formatWeekStart(plan.week_start)}`}
              className="w-8 h-8 grid place-items-center text-sm text-gray-400 hover:text-orange-400 border border-gray-700 hover:border-orange-500 rounded-lg transition">
              ✏️
            </button>
            <button
              onClick={e => { e.stopPropagation(); handleDeletePlan(plan.id) }}
              disabled={deletingPlanId === plan.id}
              aria-label={`Delete plan for week of ${formatWeekStart(plan.week_start)}`}
              className="w-8 h-8 grid place-items-center text-sm text-gray-400 hover:text-red-400 border border-gray-700 hover:border-red-500 rounded-lg transition disabled:opacity-50">
              {deletingPlanId === plan.id ? '…' : '🗑'}
            </button>
          </div>
        </div>
        {open && (
          <div className="border-t border-gray-800 pt-3 mt-3">
            {planJson
              ? <PlanDays plan={planJson} weekStart={plan.week_start} done={done} compact />
              : <p className="text-sm text-gray-300 whitespace-pre-wrap leading-relaxed">{plan.plan_details}</p>}
          </div>
        )}
      </>
        )
      })()
    )}
  </div>
))}
                {plans.length > 6 && (
                  <button onClick={() => setShowAllPlans(!showAllPlans)}
                    className="w-full text-xs text-gray-400 hover:text-white border border-gray-800 hover:border-gray-600 py-2.5 rounded-xl transition">
                    {showAllPlans ? 'Show fewer' : `Show older plans (${plans.length - 6})`}
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* SESSIONS TAB */}
        {activeTab === 'sessions' && (
          <div className="space-y-3">
            {sessions.length === 0 ? (
              <div className="bg-gray-900 rounded-2xl p-10 text-center text-gray-500 border border-gray-800">
                No sessions logged yet.
              </div>
            ) : (
              [...sessions].reverse().map(session => {
                const fb = getFeedback(session.id)
                return (
                  <div key={session.id} className="bg-gray-900 rounded-2xl p-5 border border-gray-800">
                    <div className="flex justify-between items-start mb-3">
                      <div>
                        <p className="text-sm font-medium text-white">
                          {formatDate(session.session_date, country, 'weekday')}
                        </p>
                        {session.duration_minutes && (
                          <p className="text-xs text-gray-500 mt-0.5">{session.duration_minutes} mins</p>
                        )}
                        {session.plan_day && (
                          <p className="text-xs text-green-400 mt-1">✓ {session.plan_day}</p>
                        )}
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
                    {(client as any)?.companies?.feedback_enabled !== false && (
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
        {activeTab === 'progress' && (
          <div className="space-y-4">
            {sessions.length === 0 ? (
              <div className="bg-gray-900 rounded-2xl p-10 text-center text-gray-500 border border-gray-800">
                No activities logged yet by this client.
              </div>
            ) : chartData && (
<ProgressCharts labels={chartData.labels} sessionCounts={chartData.sessionCounts} minuteCounts={chartData.minuteCounts} />
            )}
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
                      <p className="text-xs text-gray-500">{formatMoney(Number(m.amount_paid), currency)}</p>
                    </div>
                  </div>
                  <div className="w-full bg-gray-700 rounded-full h-1.5">
                    <div className={`h-1.5 rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              )
            })()}
            {memberships.length > 1 && (
              <div className="border-t border-gray-800 pt-3 space-y-2">
                <p className="text-xs text-gray-600 uppercase tracking-wider">History</p>
                {memberships.slice(1).map(m => (
                  <div key={m.id} className="flex justify-between items-center text-xs text-gray-500">
                    <span>{m.plan_type} · {formatDate(m.start_date, country, 'monthYear')} – {formatDate(m.end_date, country, 'monthYear')}</span>
                    <span>{formatMoney(Number(m.amount_paid), currency)}</span>
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
        <h2 className="font-semibold text-white">Client Fitness Profile</h2>
        <button
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
              })
              setEditingClientProfile(true)
            }
          }}
          className="text-xs text-orange-500 hover:text-orange-400 border border-orange-900 hover:border-orange-500 px-3 py-1.5 rounded-lg transition">
          {editingClientProfile ? 'Cancel' : 'Edit'}
        </button>
      </div>

      {editingClientProfile ? (
        <div className="space-y-4">
          {/* Goal */}
          <div>
            <label className="text-xs text-gray-500 mb-1.5 block uppercase tracking-wider">Goal</label>
            <textarea
              placeholder="Client's fitness goal..."
              value={clientProfileForm.goal}
              onChange={e => setClientProfileForm({ ...clientProfileForm, goal: e.target.value })}
              rows={2}
              className="w-full bg-gray-800 text-white rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm resize-none" />
          </div>

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

          {/* Emergency Contact */}
          <div className="grid grid-cols-2 gap-3">
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
          </div>

          {/* Trainer + Diet */}
          <div className={`border-t pt-4 space-y-3 ${client?.client_type === 'pt' ? 'border-purple-800' : 'border-gray-800'}`}>
            <p className="text-xs text-gray-500 uppercase tracking-wider">Trainer & Diet</p>
            <div>
              <label className="text-xs text-gray-500 mb-1.5 block uppercase tracking-wider">Assigned Trainer</label>
              <input type="text" placeholder="Trainer name"
                value={clientProfileForm.trainer_name}
                onChange={e => setClientProfileForm({ ...clientProfileForm, trainer_name: e.target.value })}
                className="w-full bg-gray-800 text-white rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm" />
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
          </div>

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
          {client?.goal && (
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
          </div>

          {/* Available Days */}
          {client?.available_days && (
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

          {/* Medical Conditions */}
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Medical Conditions / Injuries</p>
            <p className="text-sm text-white">{client?.medical_conditions || '—'}</p>
          </div>

          {/* Emergency Contact */}
          <div className="border-t border-gray-800 pt-4">
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Emergency Contact</p>
            <p className="text-sm text-white">{client?.emergency_contact_name || '—'}</p>
            <p className="text-sm text-gray-400">{client?.emergency_contact_phone || ''}</p>
          </div>

          {/* Trainer + Diet Plan */}
          <div className={`border-t pt-4 space-y-3 ${client?.client_type === 'pt' ? 'border-purple-800' : 'border-gray-800'}`}>
            <p className="text-xs text-gray-500 uppercase tracking-wider">Trainer & Diet</p>
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Assigned Trainer</p>
              <p className="text-sm text-white">{client?.trainer_name || '—'}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Diet Plan</p>
              <p className="text-sm text-white whitespace-pre-wrap">{client?.diet_plan || '—'}</p>
            </div>

            {/* AI diet chart */}
            {!dietDraft && !dietGenerating && (
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
            {dietDraft && (
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
            <p className="text-sm text-white">{client?.phone || '—'}</p>
            <p className="text-sm text-gray-400">{client?.email}</p>
          </div>
        </>
      )}
    </div>
  </div>
)}
      </div>
    </div>
  )
}
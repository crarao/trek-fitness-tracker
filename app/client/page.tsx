'use client'

import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import { type Country, normalizeCountry, formatDate, daysUntil, localDateIso } from '@/lib/locale'
import { weekStatus, dayKey, isRestDay, doneDayKeys, weekEnd } from '@/lib/plan-summary'
import { planJsonOf, summarizeAny, dayLabel, todayWeekday, exercisesDoneFor, tickedFromSaved } from '@/lib/plan-structure'
import PlanDays from '@/app/plan-days'
import SessionForm, { type SessionDraft, emptyDraft } from '@/app/session-form'
import { ACTIVITIES, activityValue, activityText } from '@/lib/activities'
import { estimateKcal, kcalText, thisWeekMonday, doneDayNotes } from '@/lib/calories'
import { weeklyTotals } from '@/lib/weekly-totals'
import dynamic from 'next/dynamic'

// Charts load only when the Progress view is shown (keeps Chart.js out of the first download)
const ProgressCharts = dynamic(() => import('@/app/progress-charts'), {
  ssr: false,
  loading: () => <p className="text-xs text-gray-500 px-1">Loading charts…</p>,
})

type WeeklyPlan = {
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
  weekly_plan_id: string | null
  plan_day?: string | null   // e.g. "Tue · Upper Body Push" when logged from a day chip
  exercises_done?: unknown   // { done: [names], total } when exercises were ticked (needs the column)
  activity?: string | null   // what was done, from the Log tab ("run", "sport:Badminton")
  logged_by?: string | null  // set when the coach logged it for the client (gym PT); null = logged here
}

type Feedback = {
  id: string
  session_id: string
  star_rating: number
  admin_feedback: string
}

export default function ClientPage() {
  const router = useRouter()
  const [profile, setProfile] = useState<any>(null)
  const [plans, setPlans] = useState<WeeklyPlan[]>([])
  const [sessions, setSessions] = useState<Session[]>([])
  // Gym without the client app (companies.client_module_enabled off): a simple membership screen;
  // the coach still logs the training from their side
  const [membership, setMembership] = useState<{ plan_type: string; start_date: string; end_date: string } | null>(null)
  const [feedback, setFeedback] = useState<Feedback[]>([])
  const [activeTab, setActiveTab] = useState<'plan' | 'log' | 'progress' | 'profile'>('plan')
  const [activePlanId, setActivePlanId] = useState<string | null>(null)
  // Full plan text open by default for this week's plan (the one the client trains from)
  const [planOpen, setPlanOpen] = useState(true)
  // Log tab form (same fields and look as Done ✓ on a plan day — app/session-form.tsx)
  const [newSession, setNewSession] = useState<SessionDraft>(() => emptyDraft())
  const [logError, setLogError] = useState('')
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [aiInsight, setAiInsight] = useState<string | null>(null)
  const [loadingInsight, setLoadingInsight] = useState(false)
  // Day-by-day logging from this week's plan: the day chip that's open, and its form
  const [openDay, setOpenDay] = useState<string | null>(null)
  const [dayForm, setDayForm] = useState<SessionDraft>(() => emptyDraft())
  const [savingDay, setSavingDay] = useState(false)
  // Exercises ticked during a workout, per "planId:Day" — kept on this phone until the day is marked Done
  // (Read once on first render; the page shows "Loading..." until data arrives, so server and phone match)
  const [ticks, setTicks] = useState<Record<string, number[]>>(() => {
    if (typeof window === 'undefined') return {}
    try {
      const saved = JSON.parse(localStorage.getItem('cb-ticks') || '{}')
      return saved && typeof saved === 'object' ? saved : {}
    } catch { return {} } // storage unavailable: ticks just won't survive a reload
  })
  const saveTicks = (next: Record<string, number[]>) => {
    setTicks(next)
    try { localStorage.setItem('cb-ticks', JSON.stringify(next)) } catch { /* ignore */ }
  }
  const toggleTick = (planId: string, day: string, i: number) => {
    const key = `${planId}:${day}`
    const cur = ticks[key] || []
    saveTicks({ ...ticks, [key]: cur.includes(i) ? cur.filter(x => x !== i) : [...cur, i] })
  }
  const [dayError, setDayError] = useState('')
  const [toast, setToast] = useState<{ text: string; kind: 'success' | 'error' } | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const showToast = (text: string, kind: 'success' | 'error' = 'success') => {
    if (toastTimer.current) clearTimeout(toastTimer.current)
    setToast({ text, kind })
    toastTimer.current = setTimeout(() => setToast(null), 3000)
  }
  const [showGoalForm, setShowGoalForm] = useState(false)
  const [goalText, setGoalText] = useState('')

const [profileForm, setProfileForm] = useState({
  age: '',
  gender: '',
  height_cm: '',
  weight_kg: '',
  fitness_level: '',
  available_days: [] as string[],
  food_preference: '',
  meals_per_day: '',
  medical_conditions: '',
  emergency_contact_name: '',
  emergency_contact_phone: ''
})
const [savingProfile, setSavingProfile] = useState(false)
const [profileMessage, setProfileMessage] = useState('')

  const [showPasswordForm, setShowPasswordForm] = useState(false)
  const [passwordData, setPasswordData] = useState({ newPassword: '', confirmPassword: '' })
  const [passwordMessage, setPasswordMessage] = useState('')

  // On this week's structured plan, open today's workout (null for rest days and text plans)
  const todaysDayLabel = (plan: WeeklyPlan): string | null => {
    const pj = planJsonOf(plan)
    const today = pj?.days.find(d => d.day === todayWeekday())
    return today && !today.rest ? dayLabel(today) : null
  }

  useEffect(() => { initialize() }, [])

  const initialize = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }

    const { data: prof } = await supabase
      .from('profiles')
      .select('*, companies:company_id(name, logo_url, feedback_enabled, ai_insights_enabled, session_notes_enabled, country, business_type, client_module_enabled)')
      .eq('id', user.id)
      .single()

    setProfile(prof)

    if (prof?.companies && !prof.companies.client_module_enabled) {
      const { data: ms } = await supabase
        .from('memberships')
        .select('plan_type, start_date, end_date')
        .eq('profile_id', user.id)
        .order('start_date', { ascending: false })
        .limit(1)
      setMembership(ms?.[0] ?? null)
      setLoading(false)
      return
    }

if (prof) {
  setProfileForm({
    age: prof.age?.toString() || '',
    gender: prof.gender || '',
    height_cm: prof.height_cm?.toString() || '',
    weight_kg: prof.weight_kg?.toString() || '',
    fitness_level: prof.fitness_level || '',
    available_days: prof.available_days ? prof.available_days.split(',') : [],
    food_preference: prof.food_preference || '',
    meals_per_day: prof.meals_per_day?.toString() || '',
    medical_conditions: prof.medical_conditions || '',
    emergency_contact_name: prof.emergency_contact_name || '',
    emergency_contact_phone: prof.emergency_contact_phone || ''
  })
}

    const { data: plansData } = await supabase
      .from('weekly_plans')
      .select('*')
      .eq('client_id', user.id)
      .order('week_start', { ascending: false })

    setPlans(plansData || [])
    if (plansData?.length) {
      // Start on this week's plan if there is one, otherwise the newest
      const current = plansData.find(p => weekStatus(p.week_start) === 'current')
      setActivePlanId((current || plansData[0]).id)
      setOpenDay(current ? todaysDayLabel(current) : null)
      setPlanOpen(!!current) // full text open only for this week's plan
    }

    const { data: sessionsData } = await supabase
      .from('logged_sessions')
      .select('*')
      .eq('client_id', user.id)
      .order('session_date', { ascending: true })

    setSessions(sessionsData || [])

    const sessionIds = sessionsData?.map(s => s.id) || []
    if (sessionIds.length) {
      const { data: feedbackData } = await supabase
        .from('session_feedback')
        .select('*')
        .in('session_id', sessionIds)
      setFeedback(feedbackData || [])
    }

    setLoading(false)
  }

  const handleSaveGoal = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    await supabase
      .from('profiles')
      .update({ goal: goalText })
      .eq('id', user!.id)
    setShowGoalForm(false)
    setGoalText('')
    initialize()
  }

  const handleSaveProfile = async () => {
  setSavingProfile(true)
  const { data: { user } } = await supabase.auth.getUser()
  
  const { error } = await supabase
    .from('profiles')
    .update({
      age: profileForm.age ? parseInt(profileForm.age) : null,
      gender: profileForm.gender || null,
      height_cm: profileForm.height_cm ? parseFloat(profileForm.height_cm) : null,
      weight_kg: profileForm.weight_kg ? parseFloat(profileForm.weight_kg) : null,
      fitness_level: profileForm.fitness_level || null,
      available_days: profileForm.available_days.join(','),
      food_preference: profileForm.food_preference || null,
      meals_per_day: profileForm.meals_per_day ? parseInt(profileForm.meals_per_day) : null,
      medical_conditions: profileForm.medical_conditions || null,
      emergency_contact_name: profileForm.emergency_contact_name || null,
      emergency_contact_phone: profileForm.emergency_contact_phone || null,
    })
    .eq('id', user!.id)

  if (error) {
    setProfileMessage('Error saving profile')
  } else {
    setProfileMessage('Profile saved successfully! ✓')
    setTimeout(() => setProfileMessage(''), 3000)
    initialize()
  }
  setSavingProfile(false)
}

const toggleDay = (day: string) => {
  setProfileForm(prev => ({
    ...prev,
    available_days: prev.available_days.includes(day)
      ? prev.available_days.filter(d => d !== day)
      : [...prev.available_days, day]
  }))
}

const fetchAiInsight = async () => {
  setLoadingInsight(true)
  try {
    const recentSessions = [...sessions].slice(-10)
    const response = await fetch('/api/ai-insights', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessions: recentSessions,
        goal: profile?.goal,
        clientName: profile?.full_name
      })
    })
    const data = await response.json()
    console.log('AI response:', data)
    setAiInsight(data.insight || 'AI insights coming soon! Your coach will be able to generate personalized feedback based on your activity history.')
  } catch (error) {
    console.error('AI error:', error)
    setAiInsight('Unable to generate insights right now. Please try again.')
  }
  setLoadingInsight(false)
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
  const { error } = await supabase.auth.updateUser({
    password: passwordData.newPassword
  })
  if (error) {
    setPasswordMessage('Error: ' + error.message)
  } else {
    setPasswordMessage('Password changed successfully! ✓')
    setPasswordData({ newPassword: '', confirmPassword: '' })
    setTimeout(() => {
      setShowPasswordForm(false)
      setPasswordMessage('')
    }, 2000)
  }
}


  // Log tab: any activity, optionally linked to a plan week
  const handleLogSession = async () => {
    setLogError('')
    const chosen = ACTIVITIES.find(a => a.key === newSession.activity)
    const minutes = parseInt(newSession.duration_minutes)
    if (!chosen) { setLogError('Pick what you did'); return }
    if (chosen.askName && !newSession.activity_name.trim()) { setLogError(chosen.askName.split(' e.g.')[0]); return }
    if (!minutes || minutes <= 0) { setLogError('Enter how many minutes'); return }
    if (!newSession.session_date) { setLogError('Pick the date'); return }
    setSaving(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setSaving(false); router.push('/login'); return }
    const activity = activityValue(chosen.key, newSession.activity_name)
    const row: Record<string, unknown> = {
      client_id: user.id,
      weekly_plan_id: newSession.weekly_plan_id || null,
      session_date: newSession.session_date,
      duration_minutes: minutes,
      notes: newSession.notes,
      activity,
    }
    let { data: session, error } = await supabase.from('logged_sessions').insert(row).select().single()
    // If the activity column is missing in Supabase, save without it
    if (error && /activity/i.test(error.message)) {
      delete row.activity
      ;({ data: session, error } = await supabase.from('logged_sessions').insert(row).select().single())
    }
    if (error || !session) {
      setSaving(false)
      setLogError('Could not save: ' + (error?.message || 'please try again'))
      return
    }
    if (newSession.star_rating > 0) {
      await supabase.from('session_feedback').insert({ session_id: session.id, star_rating: newSession.star_rating, admin_feedback: null })
    }
    setSaving(false)
    setNewSession(emptyDraft())
    const kcal = estimateKcal({ minutes, weightKg: profile?.weight_kg, activity, businessType: profile?.companies?.business_type })
    showToast(`✓ ${activityText(activity)} saved${kcal ? ` — ${kcalText(kcal)} (estimate)` : ''}`)
    initialize()
    setActiveTab('progress')
  }

  // "Done ✓" on a day of this week's plan: saves a normal session linked to the plan and the day
  const handleLogDay = async (planId: string, label: string) => {
    setDayError('')
    const minutes = parseInt(dayForm.duration_minutes)
    if (!minutes || minutes <= 0) { setDayError('Enter how many minutes you trained'); return }
    if (!dayForm.session_date) { setDayError('Pick the date'); return }
    setSavingDay(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setSavingDay(false); router.push('/login'); return }
    // Ticked exercises for this day (structured plans only)
    const plan = plans.find(p => p.id === planId)
    const planDay = plan ? planJsonOf(plan)?.days.find(d => d.day === dayKey(label)) : undefined
    const tickKey = `${planId}:${dayKey(label)}`
    const ticked = ticks[tickKey] || []
    const row: Record<string, unknown> = {
      client_id: user.id,
      weekly_plan_id: planId,
      session_date: dayForm.session_date,
      duration_minutes: minutes,
      notes: dayForm.notes,
      plan_day: label,
      ...(planDay && ticked.length ? { exercises_done: exercisesDoneFor(planDay, ticked) } : {}),
    }
    let { data: session, error } = await supabase.from('logged_sessions').insert(row).select().single()
    // Columns added later in Supabase (exercises_done, plan_day): if one is missing, save without it
    for (const col of ['exercises_done', 'plan_day']) {
      if (error && col in row && new RegExp(col, 'i').test(error.message)) {
        delete row[col]
        ;({ data: session, error } = await supabase.from('logged_sessions').insert(row).select().single())
      }
    }
    if (error || !session) {
      setSavingDay(false)
      setDayError('Could not save: ' + (error?.message || 'please try again'))
      return
    }
    if (dayForm.star_rating > 0) {
      await supabase.from('session_feedback').insert({ session_id: session.id, star_rating: dayForm.star_rating, admin_feedback: null })
    }
    setSavingDay(false)
    setOpenDay(null)
    setDayForm(emptyDraft())
    if (ticks[tickKey]) { const rest = { ...ticks }; delete rest[tickKey]; saveTicks(rest) } // saved with the session now
    const kcal = estimateKcal({ minutes, weightKg: profile?.weight_kg, label, businessType: profile?.companies?.business_type })
    showToast(`✓ ${dayKey(label)} done — nice work!${kcal ? ` ${kcalText(kcal)} (estimate)` : ''}`)
    initialize()
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

  // Company country drives date format; null until the profile has loaded
  const country: Country | null = profile ? normalizeCountry(profile.companies?.country) : null
  const chartData = getChartData()
  const totalMinutes = sessions.reduce((sum, s) => sum + (s.duration_minutes || 0), 0)
  const currentStreak = (() => {
    let streak = 0
    const today = new Date()
    const sortedDesc = [...sessions].sort((a, b) =>
      new Date(b.session_date).getTime() - new Date(a.session_date).getTime()
    )
    for (const session of sortedDesc) {
      const diff = Math.floor((today.getTime() - new Date(session.session_date).getTime()) / (1000 * 60 * 60 * 24))
      if (diff <= streak + 1) streak++
      else break
    }
    return streak
  })()

  const activePlan = plans.find(p => p.id === activePlanId)
  // Calorie estimate per session (null without weight or minutes) and this week's total (from Monday)
  const sessionKcal = (s: Session) =>
    estimateKcal({ minutes: s.duration_minutes, weightKg: profile?.weight_kg, label: s.plan_day, activity: s.activity, businessType: profile?.companies?.business_type })
  const weekStartIso = thisWeekMonday()
  const weekKcal = sessions.filter(s => s.session_date >= weekStartIso).reduce((n, s) => n + (sessionKcal(s) || 0), 0)
  const getFeedback = (sessionId: string) => feedback.find(f => f.session_id === sessionId)
  const byCoach = (s: Session) => !!s.logged_by && s.logged_by !== profile?.id

  if (loading) return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <p className="text-gray-400">Loading...</p>
    </div>
  )

  if (profile?.companies && !profile.companies.client_module_enabled) {
    const left = daysUntil(membership?.end_date)
    return (
      <div className="min-h-screen bg-gray-950 text-white">
        <div className="bg-gray-900 border-b border-gray-800 px-6 py-4 flex justify-between items-center">
          <div className="flex items-center gap-3">
            {profile.companies.logo_url ? (
              <img src={profile.companies.logo_url} alt={profile.companies.name} className="w-8 h-8 rounded-lg object-cover" />
            ) : (
              <div className="w-8 h-8 bg-orange-500 rounded-lg flex items-center justify-center">
                <span className="text-white text-sm font-bold">{profile.companies.name?.[0] || 'C'}</span>
              </div>
            )}
            <div>
              <h1 className="text-base font-bold text-white">{profile.companies.name || 'CoachBoard'}</h1>
              <p className="text-xs text-gray-500">{profile.full_name}</p>
            </div>
          </div>
          <button data-nav onClick={() => { supabase.auth.signOut(); router.push('/login') }}
            className="text-xs text-gray-500 hover:text-white border border-gray-700 hover:border-gray-500 px-3 py-1.5 rounded-lg transition">
            Logout
          </button>
        </div>
        <div className="max-w-2xl mx-auto px-4 py-5 space-y-4">
          <div className="bg-gray-900 rounded-2xl p-5 border border-gray-800">
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">My Membership</p>
            {membership ? (
              <>
                <p className="text-lg font-semibold">{membership.plan_type}</p>
                <p className="text-sm text-gray-400 mt-1">
                  {formatDate(membership.start_date, country, 'medium')} → {formatDate(membership.end_date, country, 'medium')}
                </p>
                {left !== null && (
                  <p className={`text-sm font-medium mt-2 ${left < 0 ? 'text-red-400' : left <= 11 ? 'text-amber-400' : 'text-green-400'}`}>
                    {left < 0 ? `Expired ${Math.abs(left)} day${Math.abs(left) === 1 ? '' : 's'} ago` : `${left} day${left === 1 ? '' : 's'} left`}
                  </p>
                )}
              </>
            ) : (
              <p className="text-sm text-gray-500 italic">No membership on record yet. Please ask at the front desk.</p>
            )}
          </div>
          <p className="text-xs text-gray-500 px-1">Your coach keeps track of your training. Talk to them about your plan.</p>
        </div>
      </div>
    )
  }

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
          {profile?.companies?.logo_url ? (
  <img
    src={profile.companies.logo_url}
    alt={profile?.companies?.name}
    className="w-8 h-8 rounded-lg object-cover"
  />
) : (
  <div className="w-8 h-8 bg-orange-500 rounded-lg flex items-center justify-center">
    <span className="text-white text-sm font-bold">
      {profile?.companies?.name?.[0] || 'C'}
    </span>
  </div>
)}
          <div>
            <h1 className="text-base font-bold text-white">
              {profile?.companies?.name || 'CoachBoard'}
            </h1>
            <p className="text-xs text-gray-500">{profile?.full_name}</p>
          </div>
        </div>
        <div className="flex gap-2">
  <button
    onClick={() => setShowPasswordForm(!showPasswordForm)}
    className="text-xs text-gray-500 hover:text-white border border-gray-700 hover:border-gray-500 px-3 py-1.5 rounded-lg transition">
    Settings
  </button>
  <button data-nav onClick={() => { supabase.auth.signOut(); router.push('/login') }}
    className="text-xs text-gray-500 hover:text-white border border-gray-700 hover:border-gray-500 px-3 py-1.5 rounded-lg transition">
    Logout
  </button>
</div>
      </div>


{/* Password Change Panel */}
{showPasswordForm && (
  <div className="bg-gray-900 border-b border-gray-800 px-6 py-4">
    <div className="max-w-2xl mx-auto space-y-3">
      <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Change Password</p>
      <input
        type="password"
        placeholder="New password"
        value={passwordData.newPassword}
        onChange={e => setPasswordData({ ...passwordData, newPassword: e.target.value })}
        className="w-full bg-gray-800 text-white rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm" />
      <input
        type="password"
        placeholder="Confirm new password"
        value={passwordData.confirmPassword}
        onChange={e => setPasswordData({ ...passwordData, confirmPassword: e.target.value })}
        className="w-full bg-gray-800 text-white rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm" />
      {passwordMessage && (
        <p className={`text-sm ${passwordMessage.includes('✓') ? 'text-green-400' : 'text-red-400'}`}>
          {passwordMessage}
        </p>
      )}
      <button
        onClick={handleChangePassword}
        className="w-full bg-orange-500 hover:bg-orange-400 text-white font-semibold py-2.5 rounded-xl transition text-sm">
        Update Password
      </button>
    </div>
  </div>
)}

      {/* Tabs */}
      <div className="flex border-b border-gray-800">
  {(['plan', 'log', 'progress', 'profile'] as const).map(tab => (
    <button key={tab} onClick={() => setActiveTab(tab)}
      className={`flex-1 py-3 text-xs font-medium transition ${activeTab === tab
        ? 'text-orange-500 border-b-2 border-orange-500'
        : 'text-gray-500 hover:text-white'}`}>
      {tab === 'plan' ? 'My Plan' : tab === 'log' ? 'Log' : tab === 'progress' ? 'Progress' : 'Profile'}
    </button>
  ))}
</div>

      <div className="max-w-2xl mx-auto px-4 py-5">

        {/* MY PLAN TAB */}
        {activeTab === 'plan' && (
          <div>
            {/* Goal Section */}
            <div className="bg-gray-900 rounded-2xl p-5 border border-gray-800 mb-4">
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">My Goal</p>
                  {profile?.goal ? (
                    <p className="text-sm text-white">{profile.goal}</p>
                  ) : (
                    <p className="text-sm text-gray-500 italic">No goal set yet</p>
                  )}
                </div>
                <button
                  onClick={() => {
                    setGoalText(profile?.goal || '')
                    setShowGoalForm(!showGoalForm)
                  }}
                  className="text-xs text-orange-500 hover:text-orange-400 border border-orange-900 hover:border-orange-500 px-3 py-1.5 rounded-lg transition ml-4">
                  {profile?.goal ? 'Edit' : 'Set Goal'}
                </button>
              </div>

              {showGoalForm && (
                <div className="mt-4 space-y-3 border-t border-gray-800 pt-4">
                  <textarea
                    placeholder="e.g. Complete EBC trek by October 2026"
                    value={goalText}
                    onChange={e => setGoalText(e.target.value)}
                    rows={2}
                    className="w-full bg-gray-800 text-white rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm resize-none" />
                  <button
                    onClick={handleSaveGoal}
                    className="w-full bg-orange-500 hover:bg-orange-400 text-white font-semibold py-2.5 rounded-xl transition text-sm">
                    Save Goal
                  </button>
                </div>
              )}
            </div>

            {plans.length === 0 ? (
              <div className="bg-gray-900 rounded-2xl p-10 text-center text-gray-500 border border-gray-800">
                <p className="text-lg mb-1">No plan yet</p>
                <p className="text-sm">Your coach will assign a plan soon!</p>
              </div>
            ) : (
              <>
                <div className="flex gap-2 flex-wrap mb-4">
                  {plans.map(plan => (
                    <button key={plan.id} onClick={() => { setActivePlanId(plan.id); setOpenDay(weekStatus(plan.week_start) === 'current' ? todaysDayLabel(plan) : null); setPlanOpen(weekStatus(plan.week_start) === 'current') }}
                      className={`text-xs px-3 py-1.5 rounded-full border transition ${activePlanId === plan.id
                        ? 'bg-orange-500 border-orange-500 text-white'
                        : 'border-gray-700 text-gray-400 hover:text-white hover:border-gray-500'}`}>
                      {formatDate(plan.week_start, country, 'dayMonth')}
                    </button>
                  ))}
                </div>

                {activePlan && (
                  <div className="bg-gray-900 rounded-2xl p-5 border border-gray-800">
                    <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Week of</p>
                    <p className="text-base font-semibold">
                      {formatDate(activePlan.week_start, country, 'long')}
                    </p>
                    <p className="text-xs text-gray-400 mb-2">
                      {formatDate(activePlan.week_start, country, 'weekday')} – {formatDate(weekEnd(activePlan.week_start), country, 'weekday')}
                      <span className="text-gray-500"> · today is {formatDate(new Date(), country, 'weekday')}</span>
                    </p>
                    {weekStatus(activePlan.week_start) === 'current' && (
                      <span className="inline-block text-[11px] font-medium text-green-300 bg-green-950 border border-green-800 px-2 py-0.5 rounded-full mb-2">This week</span>
                    )}
                    {weekStatus(activePlan.week_start) === 'upcoming' && (
                      <p className="mb-2">
                        <span className="inline-block text-[11px] font-medium text-blue-300 bg-blue-950 border border-blue-800 px-2 py-0.5 rounded-full">Upcoming</span>
                        <span className="text-xs text-gray-500"> · you can tick off days from {formatDate(activePlan.week_start, country, 'weekday')}</span>
                      </p>
                    )}
                    {activePlan.workout_time && (
                      <p className="text-xs text-orange-400 mb-3">⏰ Workout time: {activePlan.workout_time}</p>
                    )}
                    {(() => {
                      const planJson = planJsonOf(activePlan)
                      const summary = summarizeAny(activePlan, activePlan.week_start)
                      const isCurrent = weekStatus(activePlan.week_start) === 'current'
                      const done = doneDayKeys(activePlan.id, sessions)
                      const workoutLabels = summary.days.filter(d => !isRestDay(d))
                      const doneCount = workoutLabels.filter(d => done.has(dayKey(d))).length
                      // Done ✓ form for a day, or what was logged if it's already done
                      const renderDayPanel = (label: string, inRow: boolean) => {
                            const logged = sessions.filter(s => s.weekly_plan_id === activePlan.id && dayKey(s.plan_day) === dayKey(label))
                            if (logged.length) return (
                              <div className={`${inRow ? '' : 'mt-3 '}rounded-xl border border-green-800 bg-green-950/40 p-4 space-y-2`}>
                                {!inRow && <p className="text-sm font-semibold text-green-300">✓ {label}</p>}
                                {logged.map(s => {
                                  const fb = getFeedback(s.id)
                                  return (
                                    <div key={s.id} className="text-xs text-gray-300 space-y-1">
                                      <p>Done {formatDate(s.session_date, country, 'weekday')}{s.duration_minutes ? ` · ${s.duration_minutes} min` : ''}{sessionKcal(s) ? ` · ${kcalText(sessionKcal(s))} (est.)` : ''}{byCoach(s) ? ' · Logged by your coach' : ''}</p>
                                      {s.notes && <p className="text-gray-400 bg-gray-900 rounded-lg px-3 py-2">{s.notes}</p>}
                                      {fb?.admin_feedback && (
                                        <p className="text-orange-200 bg-orange-950/60 border border-orange-900 rounded-lg px-3 py-2">💬 Coach: {fb.admin_feedback}</p>
                                      )}
                                    </div>
                                  )
                                })}
                                <button type="button" onClick={() => setOpenDay(null)} className="text-xs text-gray-400 hover:text-white">Close</button>
                              </div>
                            )
                            return (
                              <div className={inRow ? 'border-t border-gray-800 pt-3' : 'mt-3 rounded-xl border border-orange-800 bg-gray-950 p-4'}>
                                <SessionForm mode="day" idPrefix="day" value={dayForm} onChange={setDayForm}
                                  country={country} notesEnabled={profile?.companies?.session_notes_enabled !== false}
                                  error={dayError} saving={savingDay} submitLabel="Done ✓"
                                  onSubmit={() => handleLogDay(activePlan.id, label)} onCancel={() => setOpenDay(null)}
                                  heading={inRow ? (
                                    <p className="text-xs font-semibold text-green-400">
                                      Done this workout?
                                      {(() => {
                                        const n = (ticks[`${activePlan.id}:${dayKey(label)}`] || []).length
                                        return n ? <span className="font-normal text-gray-400"> · {n} exercise{n === 1 ? '' : 's'} ticked</span> : <span className="font-normal text-gray-500"> · tick exercises above as you go</span>
                                      })()}
                                    </p>
                                  ) : <p className="text-sm font-semibold text-white">{label}</p>} />
                              </div>
                            )
                      }
                      // This week's days as tappable chips: tap → Done ✓ panel, or what was logged
                      const dayPicker = (
                        <div className="mb-1">
                          <div className="flex items-baseline justify-between gap-2">
                            <p className="text-xs text-gray-400">Tap a day when you&apos;ve done it</p>
                            <p className={`text-xs font-medium ${doneCount > 0 ? 'text-green-400' : 'text-gray-500'}`}>
                              {doneCount} of {workoutLabels.length} done
                            </p>
                          </div>
                          <div className="flex flex-wrap gap-2 mt-2">
                            {summary.days.map((d, i) => {
                              const rest = isRestDay(d)
                              const isDone = done.has(dayKey(d))
                              const selected = openDay === d
                              if (rest) return (
                                <span key={i} className="text-xs px-3 py-2 rounded-lg border border-gray-800 text-gray-600">{d}</span>
                              )
                              return (
                                <button key={i} type="button" aria-expanded={selected}
                                  onClick={() => { setDayError(''); setOpenDay(selected ? null : d) }}
                                  className={`text-xs px-3 py-2 rounded-lg border font-medium ${selected
                                    ? 'border-orange-500 bg-orange-950 text-orange-200'
                                    : isDone
                                      ? 'border-green-700 bg-green-950 text-green-300'
                                      : 'border-gray-600 bg-gray-800 text-gray-200 hover:border-gray-400'}`}>
                                  {isDone ? '✓ ' : ''}{d}
                                </button>
                              )
                            })}
                          </div>
                          {openDay && summary.days.includes(openDay) && renderDayPanel(openDay, false)}
                        </div>
                      )
                      // Ticks to show per day: saved with the session for done days, else this phone's ticks
                      const dayTicks: Record<string, number[]> = {}
                      if (planJson) for (const d of planJson.days) {
                        const saved = sessions.filter(x => x.weekly_plan_id === activePlan.id && dayKey(x.plan_day) === d.day && x.exercises_done)
                        const fromSaved = saved.length ? tickedFromSaved(d, saved[saved.length - 1].exercises_done) : []
                        const local = done.has(d.day) ? [] : ticks[`${activePlan.id}:${d.day}`] || []
                        const list = fromSaved.length ? fromSaved : local
                        if (list.length) dayTicks[d.day] = list
                      }
                      if (planJson) return (
                        <div className="border-t border-gray-800 pt-4">
                          <div className="flex items-baseline justify-between gap-2 mb-2">
                            <p className="text-xs text-gray-400">
                              {isCurrent ? 'Tap a day to see it and tick it off' : `${summary.workoutDays} workout day${summary.workoutDays === 1 ? '' : 's'} · ${summary.exercises} exercises`}
                            </p>
                            {isCurrent && (
                              <p className={`text-xs font-medium ${doneCount > 0 ? 'text-green-400' : 'text-gray-500'}`}>{doneCount} of {workoutLabels.length} done</p>
                            )}
                          </div>
                          <PlanDays plan={planJson} weekStart={activePlan.week_start} done={done}
                            doneNote={doneDayNotes(activePlan.id, sessions, sessionKcal)}
                            ticks={dayTicks}
                            onTick={isCurrent ? (d, i) => { if (!done.has(d)) toggleTick(activePlan.id, d, i) } : undefined}
                            openDay={openDay ? dayKey(openDay) : null}
                            onToggle={d => {
                              setDayError('')
                              const day = planJson.days.find(x => x.day === d)
                              setOpenDay(day ? dayLabel(day) : null)
                            }}
                            renderOpen={isCurrent ? (day, label) => (day.rest ? null : renderDayPanel(label, true)) : undefined} />
                        </div>
                      )
                      return (
                        <div className="border-t border-gray-800 pt-4">
                          {summary.days.length > 0 && isCurrent && (
                            dayPicker
                          )}
                          {summary.days.length > 0 && !isCurrent && (
                            <>
                              <p className="text-xs text-gray-400">
                                {summary.workoutDays} workout day{summary.workoutDays === 1 ? '' : 's'}
                                {summary.exercises > 0 ? ` · ${summary.exercises} exercises` : ''}
                              </p>
                              {!planOpen && (
                                <div className="flex flex-wrap gap-1.5 mt-2">
                                  {summary.days.map((d, i) => (
                                    <span key={i} className={`text-[11px] px-2 py-0.5 rounded-md border ${d.endsWith('Rest') ? 'border-gray-800 text-gray-600' : 'border-gray-700 text-gray-300'}`}>{d}</span>
                                  ))}
                                </div>
                              )}
                            </>
                          )}
                          {planOpen && (
                            <p className="text-gray-300 whitespace-pre-wrap leading-relaxed text-sm mt-3">{activePlan.plan_details}</p>
                          )}
                          <button onClick={() => setPlanOpen(!planOpen)} aria-expanded={planOpen}
                            className="mt-3 text-xs text-orange-400 hover:text-orange-300">
                            {planOpen ? 'Hide full plan ▴' : 'Show full plan ▾'}
                          </button>
                        </div>
                      )
                    })()}
                    {profile?.diet_plan && (
                      <div className="border-t border-gray-800 pt-4 mt-4">
                        <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Diet Plan</p>
                        <p className="text-gray-300 whitespace-pre-wrap leading-relaxed text-sm">{profile.diet_plan}</p>
                      </div>
                    )}
                    <button
                      onClick={() => { setActiveTab('log'); setNewSession(prev => ({ ...prev, weekly_plan_id: activePlan.id })) }}
                      className="mt-5 w-full bg-orange-500 hover:bg-orange-400 text-white py-2.5 rounded-xl text-sm font-medium transition">
                      Log an Activity for This Week
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* LOG ACTIVITY TAB — same form as Done ✓ on a plan day, plus "What did you do?" */}
        {activeTab === 'log' && (
          <div className="bg-gray-900 rounded-2xl p-5 border border-gray-800">
            <SessionForm mode="log" idPrefix="log" value={newSession} onChange={setNewSession}
              country={country} notesEnabled={profile?.companies?.session_notes_enabled !== false}
              plans={plans} error={logError} saving={saving} submitLabel="Save activity ✓" onSubmit={handleLogSession}
              heading={
                <div>
                  <h2 className="font-semibold text-white">Log an activity</h2>
                  <p className="text-xs text-gray-500 mt-0.5">For workouts outside your plan. Plan days are ticked off on My Plan.</p>
                </div>
              } />
          </div>
        )}

        {/* PROGRESS TAB */}
        {activeTab === 'progress' && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-gray-900 rounded-2xl p-4 border border-gray-800 text-center">
                <p className="text-2xl font-bold text-orange-500">{sessions.length}</p>
                <p className="text-xs text-gray-500 mt-1">Activities</p>
              </div>
              <div className="bg-gray-900 rounded-2xl p-4 border border-gray-800 text-center">
                <p className="text-2xl font-bold text-orange-500">{totalMinutes}</p>
                <p className="text-xs text-gray-500 mt-1">Minutes</p>
              </div>
              <div className="bg-gray-900 rounded-2xl p-4 border border-gray-800 text-center">
                <p className="text-2xl font-bold text-orange-500">{currentStreak}</p>
                <p className="text-xs text-gray-500 mt-1">Day Streak</p>
              </div>
            </div>

            {/* Calories: an estimate from effort × weight × minutes */}
            {profile?.weight_kg ? (
              <div className="bg-gray-900 rounded-2xl px-5 py-4 border border-gray-800 flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wider">Calories since Mon</p>
                  <p className="text-[11px] text-gray-600 mt-0.5">Estimate from workout type, minutes and your weight</p>
                </div>
                <p className="text-2xl font-bold text-orange-500 shrink-0">{kcalText(weekKcal) || '~0 kcal'}</p>
              </div>
            ) : (
              <p className="text-xs text-gray-500 px-1">Add your weight in Profile to see calorie estimates.</p>
            )}

{/* AI Insights */}
{profile?.companies?.ai_insights_enabled !== false && (
<div className="bg-gray-900 rounded-2xl p-5 border border-gray-800">
  <div className="flex justify-between items-center mb-3">
    <div>
      <p className="text-xs text-gray-500 uppercase tracking-wider">Coach AI Insights</p>
    </div>
    <button
      onClick={fetchAiInsight}
      disabled={loadingInsight}
      className="text-xs bg-orange-500 hover:bg-orange-400 text-white px-3 py-1.5 rounded-lg transition disabled:opacity-50">
      {loadingInsight ? 'Analysing...' : 'Get Insights'}
    </button>
  </div>
  {aiInsight ? (
    <p className="text-sm text-gray-300 leading-relaxed">{aiInsight}</p>
  ) : (
    <p className="text-sm text-gray-500 italic">
      Click "Get Insights" to get AI-powered coaching feedback based on your activity history.
    </p>
  )}
</div>
)}


            {chartData && chartData.labels.length >= 1 && (
<ProgressCharts labels={chartData.labels} sessionCounts={chartData.sessionCounts} minuteCounts={chartData.minuteCounts} />
            )}

            <p className="text-xs text-gray-500 uppercase tracking-wider">Activity History</p>
            {sessions.length === 0 ? (
              <div className="bg-gray-900 rounded-2xl p-10 text-center text-gray-500 border border-gray-800">
                No activities logged yet. Start training!
              </div>
            ) : (
              [...sessions].reverse().map(session => {
                const fb = getFeedback(session.id)
                return (
                  <div key={session.id} className="bg-gray-900 rounded-2xl p-4 border border-gray-800">
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <p className="text-sm font-medium text-white">
                          {formatDate(session.session_date, country, 'weekday')}
                        </p>
                        {session.duration_minutes && (
                          <p className="text-xs text-gray-500 mt-0.5">{session.activity ? <span className="text-gray-300">{activityText(session.activity)} · </span> : null}{session.duration_minutes} minutes{sessionKcal(session) ? ` · ${kcalText(sessionKcal(session))} (est.)` : ''}</p>
                        )}
                        {session.plan_day && (
                          <p className="text-xs text-green-400 mt-1">✓ {session.plan_day}</p>
                        )}
                        {byCoach(session) && (
                          <p className="text-xs text-gray-400 mt-1">Logged by your coach</p>
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
                      <p className="text-xs text-gray-400 bg-gray-800 rounded-lg px-3 py-2 mt-2">{session.notes}</p>
                    )}
                    {profile?.companies?.feedback_enabled !== false && fb?.admin_feedback && (
                      <div className="mt-3 bg-orange-950 border border-orange-900 rounded-xl px-3 py-2">
                        <p className="text-xs text-orange-400 font-medium mb-0.5 uppercase tracking-wider">Coach feedback</p>
                        <p className="text-xs text-orange-200">{fb.admin_feedback}</p>
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </div>
        )}

        {/* PROFILE TAB */}
{activeTab === 'profile' && (
  <div className="space-y-4 mt-4">
    <div className="bg-gray-900 rounded-2xl p-5 border border-gray-800 space-y-4">
      <h2 className="font-semibold text-white">My Fitness Profile</h2>

      {/* Row 1 - Age and Gender */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-gray-500 mb-1.5 block uppercase tracking-wider">Age</label>
          <input type="number" placeholder="e.g. 28"
            value={profileForm.age}
            onChange={e => setProfileForm({ ...profileForm, age: e.target.value })}
            className="w-full bg-gray-800 text-white rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm" />
        </div>
        <div>
          <label className="text-xs text-gray-500 mb-1.5 block uppercase tracking-wider">Gender</label>
          <select value={profileForm.gender}
            onChange={e => setProfileForm({ ...profileForm, gender: e.target.value })}
            className="w-full bg-gray-800 text-white rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm">
            <option value="">Select</option>
            <option value="Male">Male</option>
            <option value="Female">Female</option>
            <option value="Prefer not to say">Prefer not to say</option>
          </select>
        </div>
      </div>

      {/* Row 2 - Height and Weight */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-gray-500 mb-1.5 block uppercase tracking-wider">Height (cm)</label>
          <input type="number" placeholder="e.g. 172"
            value={profileForm.height_cm}
            onChange={e => setProfileForm({ ...profileForm, height_cm: e.target.value })}
            className="w-full bg-gray-800 text-white rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm" />
        </div>
        <div>
          <label className="text-xs text-gray-500 mb-1.5 block uppercase tracking-wider">Weight (kg)</label>
          <input type="number" placeholder="e.g. 75"
            value={profileForm.weight_kg}
            onChange={e => setProfileForm({ ...profileForm, weight_kg: e.target.value })}
            className="w-full bg-gray-800 text-white rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm" />
        </div>
      </div>

      {/* Fitness Level */}
      <div>
        <label className="text-xs text-gray-500 mb-1.5 block uppercase tracking-wider">Fitness Level</label>
        <select value={profileForm.fitness_level}
          onChange={e => setProfileForm({ ...profileForm, fitness_level: e.target.value })}
          className="w-full bg-gray-800 text-white rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm">
          <option value="">Select</option>
          <option value="Beginner">Beginner</option>
          <option value="Intermediate">Intermediate</option>
          <option value="Advanced">Advanced</option>
        </select>
      </div>

      {/* Food Preference */}
      <div>
        <label className="text-xs text-gray-500 mb-1.5 block uppercase tracking-wider">Food Preference</label>
        <select value={profileForm.food_preference}
          onChange={e => setProfileForm({ ...profileForm, food_preference: e.target.value })}
          className="w-full bg-gray-800 text-white rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm">
          <option value="">Select</option>
          <option value="Vegetarian">Vegetarian</option>
          <option value="Non-Vegetarian">Non-Vegetarian</option>
          <option value="Eggetarian">Eggetarian</option>
          <option value="Vegan">Vegan</option>
          <option value="Jain">Jain</option>
        </select>
      </div>

      {/* Meals per day */}
      <div>
        <label className="text-xs text-gray-500 mb-1.5 block uppercase tracking-wider">Meals per day</label>
        <select value={profileForm.meals_per_day}
          onChange={e => setProfileForm({ ...profileForm, meals_per_day: e.target.value })}
          className="w-full bg-gray-800 text-white rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm">
          <option value="">Select</option>
          <option value="3">3 meals</option>
          <option value="4">4 (3 meals + snack)</option>
          <option value="5">5 (3 meals + 2 snacks)</option>
          <option value="6">6 small meals</option>
        </select>
      </div>

      {/* Available Days */}
      <div>
        <label className="text-xs text-gray-500 mb-2 block uppercase tracking-wider">Available Training Days</label>
        <div className="flex gap-2 flex-wrap">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => (
            <button key={day}
              onClick={() => toggleDay(day)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition ${
                profileForm.available_days.includes(day)
                  ? 'bg-orange-500 border-orange-500 text-white'
                  : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-500'
              }`}>
              {day}
            </button>
          ))}
        </div>
      </div>

      {/* Medical Conditions */}
      <div>
        <label className="text-xs text-gray-500 mb-1.5 block uppercase tracking-wider">Medical Conditions / Injuries</label>
        <textarea
          placeholder="e.g. Lower back pain, knee injury, diabetes... or None"
          value={profileForm.medical_conditions}
          onChange={e => setProfileForm({ ...profileForm, medical_conditions: e.target.value })}
          rows={2}
          className="w-full bg-gray-800 text-white rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm resize-none" />
      </div>

      {/* Emergency Contact */}
      <div className="border-t border-gray-800 pt-4">
        <p className="text-xs text-gray-500 uppercase tracking-wider mb-3">Emergency Contact</p>
        <div className="grid grid-cols-2 gap-3">
          <input type="text" placeholder="Contact name"
            value={profileForm.emergency_contact_name}
            onChange={e => setProfileForm({ ...profileForm, emergency_contact_name: e.target.value })}
            className="w-full bg-gray-800 text-white rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm" />
          <input type="tel" placeholder="Phone number"
            value={profileForm.emergency_contact_phone}
            onChange={e => setProfileForm({ ...profileForm, emergency_contact_phone: e.target.value })}
            className="w-full bg-gray-800 text-white rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm" />
        </div>
      </div>

      {profileMessage && (
        <div className="bg-green-950 border border-green-800 rounded-xl px-4 py-3">
          <p className="text-green-400 text-sm">{profileMessage}</p>
        </div>
      )}

      <button onClick={handleSaveProfile} disabled={savingProfile}
        className="w-full bg-orange-500 hover:bg-orange-400 text-white font-semibold py-3 rounded-xl transition disabled:opacity-50 text-sm">
        {savingProfile ? 'Saving...' : 'Save Profile'}
      </button>
    </div>
  </div>
)}
      </div>
      
    </div>
  )
}
'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  Title,
  Tooltip,
  Legend
} from 'chart.js'
import { Bar, Line } from 'react-chartjs-2'

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  Title,
  Tooltip,
  Legend
)

type WeeklyPlan = {
  id: string
  week_start: string
  plan_details: string
  workout_time: string | null
}

type Session = {
  id: string
  session_date: string
  duration_minutes: number
  notes: string
  weekly_plan_id: string | null
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
  const [feedback, setFeedback] = useState<Feedback[]>([])
  const [activeTab, setActiveTab] = useState<'plan' | 'log' | 'progress' | 'profile'>('plan')
  const [activePlanId, setActivePlanId] = useState<string | null>(null)
  const [newSession, setNewSession] = useState({
    session_date: new Date().toISOString().split('T')[0],
    duration_minutes: '',
    notes: '',
    star_rating: 0,
    weekly_plan_id: ''
  })
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [aiInsight, setAiInsight] = useState<string | null>(null)
  const [loadingInsight, setLoadingInsight] = useState(false)
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
  medical_conditions: '',
  emergency_contact_name: '',
  emergency_contact_phone: ''
})
const [savingProfile, setSavingProfile] = useState(false)
const [profileMessage, setProfileMessage] = useState('')

  const [showPasswordForm, setShowPasswordForm] = useState(false)
  const [passwordData, setPasswordData] = useState({ newPassword: '', confirmPassword: '' })
  const [passwordMessage, setPasswordMessage] = useState('')

  useEffect(() => { initialize() }, [])

  const initialize = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }

    const { data: prof } = await supabase
      .from('profiles')
      .select('*, companies:company_id(name, logo_url)')
      .eq('id', user.id)
      .single()

    setProfile(prof)

if (prof) {
  setProfileForm({
    age: prof.age?.toString() || '',
    gender: prof.gender || '',
    height_cm: prof.height_cm?.toString() || '',
    weight_kg: prof.weight_kg?.toString() || '',
    fitness_level: prof.fitness_level || '',
    available_days: prof.available_days ? prof.available_days.split(',') : [],
    food_preference: prof.food_preference || '',
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
    if (plansData?.length) setActivePlanId(plansData[0].id)

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


  const handleLogSession = async () => {
    setSaving(true)
    const { data: { user } } = await supabase.auth.getUser()

    const { data: session, error } = await supabase
      .from('logged_sessions')
      .insert({
        client_id: user!.id,
        weekly_plan_id: newSession.weekly_plan_id || null,
        session_date: newSession.session_date,
        duration_minutes: parseInt(newSession.duration_minutes as string) || null,
        notes: newSession.notes
      })
      .select()
      .single()

    if (!error && session && newSession.star_rating > 0) {
      await supabase.from('session_feedback').insert({
        session_id: session.id,
        star_rating: newSession.star_rating,
        admin_feedback: null
      })
    }

    setNewSession({
      session_date: new Date().toISOString().split('T')[0],
      duration_minutes: '',
      notes: '',
      star_rating: 0,
      weekly_plan_id: ''
    })
    setSaving(false)
    setMessage('Activity saved successfully! ✓')
    setTimeout(() => setMessage(''), 3000)
    initialize()
    setActiveTab('progress')
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
      return date.toLocaleDateString('en', { month: 'short', day: 'numeric' })
    })

    return {
      labels,
      sessionCounts: sortedWeeks.map(w => weekMap[w].sessions),
      minuteCounts: sortedWeeks.map(w => weekMap[w].minutes)
    }
  }

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
  const getFeedback = (sessionId: string) => feedback.find(f => f.session_id === sessionId)

  if (loading) return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <p className="text-gray-400">Loading...</p>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-950 text-white">
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
  <button onClick={() => { supabase.auth.signOut(); router.push('/login') }}
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
                    <button key={plan.id} onClick={() => setActivePlanId(plan.id)}
                      className={`text-xs px-3 py-1.5 rounded-full border transition ${activePlanId === plan.id
                        ? 'bg-orange-500 border-orange-500 text-white'
                        : 'border-gray-700 text-gray-400 hover:text-white hover:border-gray-500'}`}>
                      {new Date(plan.week_start).toLocaleDateString('en', { month: 'short', day: 'numeric' })}
                    </button>
                  ))}
                </div>

                {activePlan && (
                  <div className="bg-gray-900 rounded-2xl p-5 border border-gray-800">
                    <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Week of</p>
                    <p className="text-base font-semibold mb-1">
                      {new Date(activePlan.week_start).toLocaleDateString('en', { month: 'long', day: 'numeric', year: 'numeric' })}
                    </p>
                    {activePlan.workout_time && (
                      <p className="text-xs text-orange-400 mb-4">⏰ Workout time: {activePlan.workout_time}</p>
                    )}
                    <div className="border-t border-gray-800 pt-4">
                      <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Plan Details</p>
                      <p className="text-gray-300 whitespace-pre-wrap leading-relaxed text-sm">{activePlan.plan_details}</p>
                    </div>
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

        {/* LOG ACTIVITY TAB */}
        {activeTab === 'log' && (
          <div className="bg-gray-900 rounded-2xl p-5 border border-gray-800 space-y-4">
            <h2 className="font-semibold text-white">Log an Activity</h2>

            <div>
              <label className="text-xs text-gray-500 mb-1.5 block uppercase tracking-wider">Date</label>
              <input type="date" value={newSession.session_date}
                onChange={e => setNewSession({ ...newSession, session_date: e.target.value })}
                className="w-full bg-gray-800 text-white rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm" />
            </div>

            <div>
              <label className="text-xs text-gray-500 mb-1.5 block uppercase tracking-wider">Duration (minutes)</label>
              <input type="number" placeholder="e.g. 45"
                value={newSession.duration_minutes}
                onChange={e => setNewSession({ ...newSession, duration_minutes: e.target.value })}
                className="w-full bg-gray-800 text-white rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm" />
            </div>

            <div>
              <label className="text-xs text-gray-500 mb-1.5 block uppercase tracking-wider">Link to plan (optional)</label>
              <select value={newSession.weekly_plan_id}
                onChange={e => setNewSession({ ...newSession, weekly_plan_id: e.target.value })}
                className="w-full bg-gray-800 text-white rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm">
                <option value="">— None —</option>
                {plans.map(p => (
                  <option key={p.id} value={p.id}>
                    Week of {new Date(p.week_start).toLocaleDateString('en', { month: 'short', day: 'numeric' })}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs text-gray-500 mb-1.5 block uppercase tracking-wider">Notes</label>
              <textarea placeholder="How did it go? Any observations..."
                value={newSession.notes}
                onChange={e => setNewSession({ ...newSession, notes: e.target.value })}
                rows={3}
                className="w-full bg-gray-800 text-white rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm resize-none" />
            </div>

            <div>
              <label className="text-xs text-gray-500 mb-2 block uppercase tracking-wider">How did you feel?</label>
              <div className="flex gap-2">
                {[
                  { rating: 1, emoji: '😓', label: 'Tough' },
                  { rating: 2, emoji: '😐', label: 'Okay' },
                  { rating: 3, emoji: '🙂', label: 'Good' },
                  { rating: 4, emoji: '😄', label: 'Great' },
                  { rating: 5, emoji: '🔥', label: 'Best' },
                ].map(({ rating, emoji, label }) => (
                  <button key={rating}
                    onClick={() => setNewSession({ ...newSession, star_rating: rating })}
                    className={`flex-1 py-2.5 rounded-xl border text-center transition ${newSession.star_rating === rating
                      ? 'border-orange-500 bg-orange-950'
                      : 'border-gray-700 bg-gray-800 hover:border-gray-500'}`}>
                    <div className="text-lg">{emoji}</div>
                    <div className="text-xs text-gray-400 mt-0.5">{label}</div>
                  </button>
                ))}
              </div>
            </div>

            {message && (
              <div className="bg-green-950 border border-green-800 rounded-xl px-4 py-3">
                <p className="text-green-400 text-sm">{message}</p>
              </div>
            )}

            <button onClick={handleLogSession} disabled={saving}
              className="w-full bg-orange-500 hover:bg-orange-400 text-white font-semibold py-3 rounded-xl transition disabled:opacity-50 text-sm">
              {saving ? 'Saving...' : 'Save Activity'}
            </button>
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

{/* AI Insights */}
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



            {chartData && chartData.labels.length >= 1 && (
              <>
                <div className="bg-gray-900 rounded-2xl p-5 border border-gray-800">
                  <p className="text-xs text-gray-500 uppercase tracking-wider mb-4">Activities per Week</p>
                  <Bar
                    data={{
                      labels: chartData.labels,
                      datasets: [{
                        label: 'Activities',
                        data: chartData.sessionCounts,
                        backgroundColor: 'rgba(249, 115, 22, 0.7)',
                        borderColor: 'rgba(249, 115, 22, 1)',
                        borderWidth: 1,
                        borderRadius: 4,
                      }]
                    }}
                    options={{
                      responsive: true,
                      plugins: { legend: { display: false } },
                      scales: {
                        x: { ticks: { color: '#6b7280', font: { size: 11 } }, grid: { color: '#1f2937' } },
                        y: { ticks: { color: '#6b7280', font: { size: 11 } }, grid: { color: '#1f2937' }, beginAtZero: true }
                      }
                    }}
                  />
                </div>

                <div className="bg-gray-900 rounded-2xl p-5 border border-gray-800">
                  <p className="text-xs text-gray-500 uppercase tracking-wider mb-4">Minutes per Week</p>
                  <Line
                    data={{
                      labels: chartData.labels,
                      datasets: [{
                        label: 'Minutes',
                        data: chartData.minuteCounts,
                        borderColor: 'rgba(249, 115, 22, 1)',
                        backgroundColor: 'rgba(249, 115, 22, 0.1)',
                        borderWidth: 2,
                        pointBackgroundColor: 'rgba(249, 115, 22, 1)',
                        tension: 0.3,
                        fill: true,
                      }]
                    }}
                    options={{
                      responsive: true,
                      plugins: { legend: { display: false } },
                      scales: {
                        x: { ticks: { color: '#6b7280', font: { size: 11 } }, grid: { color: '#1f2937' } },
                        y: { ticks: { color: '#6b7280', font: { size: 11 } }, grid: { color: '#1f2937' }, beginAtZero: true }
                      }
                    }}
                  />
                </div>
              </>
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
                          {new Date(session.session_date).toLocaleDateString('en', { weekday: 'short', month: 'short', day: 'numeric' })}
                        </p>
                        {session.duration_minutes && (
                          <p className="text-xs text-gray-500 mt-0.5">{session.duration_minutes} minutes</p>
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
                    {fb?.admin_feedback && (
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
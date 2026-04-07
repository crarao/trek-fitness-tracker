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
  const [activeTab, setActiveTab] = useState<'plan' | 'log' | 'progress'>('plan')
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

  useEffect(() => { initialize() }, [])

  const initialize = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }

    const { data: prof } = await supabase
      .from('profiles')
      .select('*, companies:company_id(name)')
      .eq('id', user.id)
      .single()

    console.log('Profile data:', JSON.stringify(prof))
    setProfile(prof)

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
    setMessage('Session saved successfully! ✓')
    setTimeout(() => setMessage(''), 3000)
    initialize()
    setActiveTab('progress')
  }

  // Chart data preparation
  const getWeekLabel = (dateStr: string) => {
    const date = new Date(dateStr)
    return `${date.toLocaleDateString('en', { month: 'short', day: 'numeric' })}`
  }

  const getChartData = () => {
    if (sessions.length === 0) return null

    const weekMap: Record<string, { sessions: number, minutes: number }> = {}

    sessions.forEach(session => {
      const date = new Date(session.session_date)
      const weekStart = new Date(date)
      weekStart.setDate(date.getDate() - date.getDay())
      const key = weekStart.toISOString().split('T')[0]

      if (!weekMap[key]) weekMap[key] = { sessions: 0, minutes: 0 }
      weekMap[key].sessions += 1
      weekMap[key].minutes += session.duration_minutes || 0
    })

    const sortedWeeks = Object.keys(weekMap).sort()
    const labels = sortedWeeks.map(getWeekLabel)
    const sessionCounts = sortedWeeks.map(w => weekMap[w].sessions)
    const minuteCounts = sortedWeeks.map(w => weekMap[w].minutes)

    return { labels, sessionCounts, minuteCounts }
  }

  const chartData = getChartData()

  const activePlan = plans.find(p => p.id === activePlanId)
  const getFeedback = (sessionId: string) => feedback.find(f => f.session_id === sessionId)

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

  if (loading) return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <p className="text-white">Loading...</p>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Header */}
      <div className="bg-gray-900 border-b border-gray-800 px-4 py-4 flex justify-between items-center">
        <div>
          <h1 className="text-lg font-bold text-orange-500">
            {profile?.companies?.name || 'CoachBoard'}
          </h1>
          <p className="text-xs text-gray-400">{profile?.full_name}</p>
        </div>
        <button onClick={() => { supabase.auth.signOut(); router.push('/login') }}
          className="text-sm text-gray-400 hover:text-white">Logout</button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-800">
        {(['plan', 'log', 'progress'] as const).map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={`flex-1 py-3 text-sm font-medium capitalize transition ${activeTab === tab
              ? 'text-orange-500 border-b-2 border-orange-500'
              : 'text-gray-400 hover:text-white'}`}>
            {tab === 'plan' ? 'My Plan' : tab === 'log' ? 'Log Activity' : 'Progress'}
          </button>
        ))}
      </div>

      <div className="max-w-2xl mx-auto p-4">

        {/* MY PLAN TAB */}
        {activeTab === 'plan' && (
          <div>
            {plans.length === 0 ? (
              <div className="bg-gray-900 rounded-xl p-8 text-center text-gray-400 mt-4">
                No weekly plan assigned yet. Your coach will add one soon!
              </div>
            ) : (
              <>
                <div className="flex gap-2 flex-wrap mb-4 mt-2">
                  {plans.map(plan => (
                    <button key={plan.id} onClick={() => setActivePlanId(plan.id)}
                      className={`text-xs px-3 py-1.5 rounded-full border transition ${activePlanId === plan.id
                        ? 'bg-orange-900 border-orange-500 text-orange-300'
                        : 'border-gray-700 text-gray-400 hover:text-white'}`}>
                      {new Date(plan.week_start).toLocaleDateString('en', { month: 'short', day: 'numeric' })}
                    </button>
                  ))}
                </div>

                {activePlan && (
                  <div className="bg-gray-900 rounded-xl p-5 border border-gray-800">
                    <p className="text-xs text-gray-500 mb-1 uppercase tracking-widest">Week of</p>
                    <p className="text-lg font-semibold mb-3">
                      {new Date(activePlan.week_start).toLocaleDateString('en', { month: 'long', day: 'numeric', year: 'numeric' })}
                    </p>
                    <div className="border-t border-gray-800 pt-3">
                      <p className="text-xs text-gray-500 uppercase tracking-widest mb-2">Plan Details</p>
                      <p className="text-gray-300 whitespace-pre-wrap leading-relaxed">{activePlan.plan_details}</p>
                    </div>
                    <button onClick={() => { setActiveTab('log'); setNewSession(prev => ({ ...prev, weekly_plan_id: activePlan.id })) }}
                      className="mt-4 w-full bg-orange-500 hover:bg-orange-600 text-white py-2.5 rounded-lg text-sm font-medium transition">
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
          <div className="mt-4 space-y-4">
            <div className="bg-gray-900 rounded-xl p-5 border border-gray-800 space-y-4">
              <h2 className="font-semibold">Log an Activity</h2>

              <div>
                <label className="text-xs text-gray-400 mb-1 block">Date</label>
                <input type="date" value={newSession.session_date}
                  onChange={e => setNewSession({ ...newSession, session_date: e.target.value })}
                  className="w-full bg-gray-800 text-white rounded-lg px-4 py-2.5 outline-none focus:ring-2 focus:ring-orange-500 text-sm" />
              </div>

              <div>
                <label className="text-xs text-gray-400 mb-1 block">Duration (minutes)</label>
                <input type="number" placeholder="e.g. 45"
                  value={newSession.duration_minutes}
                  onChange={e => setNewSession({ ...newSession, duration_minutes: e.target.value })}
                  className="w-full bg-gray-800 text-white rounded-lg px-4 py-2.5 outline-none focus:ring-2 focus:ring-orange-500 text-sm" />
              </div>

              <div>
                <label className="text-xs text-gray-400 mb-1 block">Link to plan (optional)</label>
                <select value={newSession.weekly_plan_id}
                  onChange={e => setNewSession({ ...newSession, weekly_plan_id: e.target.value })}
                  className="w-full bg-gray-800 text-white rounded-lg px-4 py-2.5 outline-none focus:ring-2 focus:ring-orange-500 text-sm">
                  <option value="">— None —</option>
                  {plans.map(p => (
                    <option key={p.id} value={p.id}>
                      Week of {new Date(p.week_start).toLocaleDateString('en', { month: 'short', day: 'numeric' })}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs text-gray-400 mb-1 block">Notes</label>
                <textarea placeholder="How did it go? Any observations..."
                  value={newSession.notes}
                  onChange={e => setNewSession({ ...newSession, notes: e.target.value })}
                  rows={3}
                  className="w-full bg-gray-800 text-white rounded-lg px-4 py-2.5 outline-none focus:ring-2 focus:ring-orange-500 text-sm resize-none" />
              </div>

              <div>
                <label className="text-xs text-gray-400 mb-2 block">How did you feel?</label>
                <div className="flex gap-2">
                  {[
                    { rating: 1, emoji: '😓', label: 'Tough' },
                    { rating: 2, emoji: '😐', label: 'Okay' },
                    { rating: 3, emoji: '🙂', label: 'Good' },
                    { rating: 4, emoji: '😄', label: 'Great' },
                    { rating: 5, emoji: '🔥', label: 'Best' },
                  ].map(({ rating, emoji, label }) => (
                    <button key={rating} onClick={() => setNewSession({ ...newSession, star_rating: rating })}
                      className={`flex-1 py-2 rounded-lg border text-center transition ${newSession.star_rating === rating
                        ? 'border-orange-500 bg-orange-900'
                        : 'border-gray-700 bg-gray-800 hover:border-gray-500'}`}>
                      <div className="text-xl">{emoji}</div>
                      <div className="text-xs text-gray-400 mt-0.5">{label}</div>
                    </button>
                  ))}
                </div>
              </div>

              {message && (
                <div className="bg-green-900 border border-green-700 text-green-300 rounded-lg px-4 py-3 text-sm">
                  {message}
                </div>
              )}

              <button onClick={handleLogSession} disabled={saving}
                className="w-full bg-orange-500 hover:bg-orange-600 text-white font-semibold py-3 rounded-lg transition disabled:opacity-50">
                {saving ? 'Saving...' : 'Save Activity'}
              </button>
            </div>
          </div>
        )}

        {/* PROGRESS TAB */}
        {activeTab === 'progress' && (
          <div className="mt-4 space-y-4">
            {/* Stats row */}
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-gray-900 rounded-xl p-4 border border-gray-800 text-center">
                <p className="text-2xl font-bold text-orange-500">{sessions.length}</p>
                <p className="text-xs text-gray-400 mt-1">Total Activities</p>
              </div>
              <div className="bg-gray-900 rounded-xl p-4 border border-gray-800 text-center">
                <p className="text-2xl font-bold text-orange-500">{totalMinutes}</p>
                <p className="text-xs text-gray-400 mt-1">Total Minutes</p>
              </div>
              <div className="bg-gray-900 rounded-xl p-4 border border-gray-800 text-center">
                <p className="text-2xl font-bold text-orange-500">{currentStreak}</p>
                <p className="text-xs text-gray-400 mt-1">Day Streak</p>
              </div>
            </div>

            {/* Charts */}
            {chartData && chartData.labels.length > 1 && (
              <>
                <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
                  <p className="text-xs text-gray-400 uppercase tracking-widest mb-3">Activities per Week</p>
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

                <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
                  <p className="text-xs text-gray-400 uppercase tracking-widest mb-3">Minutes per Week</p>
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

            {/* Session history */}
            <p className="text-xs text-gray-500 uppercase tracking-widest">Activity History</p>
            {sessions.length === 0 ? (
              <div className="bg-gray-900 rounded-xl p-8 text-center text-gray-400">
                No activities logged yet. Start training!
              </div>
            ) : (
              [...sessions].reverse().map(session => {
                const fb = getFeedback(session.id)
                return (
                  <div key={session.id} className="bg-gray-900 rounded-xl p-4 border border-gray-800">
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <p className="text-sm font-medium">
                          {new Date(session.session_date).toLocaleDateString('en', { weekday: 'short', month: 'short', day: 'numeric' })}
                        </p>
                        {session.duration_minutes && (
                          <p className="text-xs text-gray-400">{session.duration_minutes} minutes</p>
                        )}
                      </div>
                      {fb?.star_rating && (
                        <div className="flex gap-0.5">
                          {[1,2,3,4,5].map(s => (
                            <span key={s} className={s <= fb.star_rating ? 'text-orange-400' : 'text-gray-700'}>★</span>
                          ))}
                        </div>
                      )}
                    </div>
                    {session.notes && <p className="text-xs text-gray-400 mt-1">{session.notes}</p>}
                    {fb?.admin_feedback && (
                      <div className="mt-2 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2">
                        <p className="text-xs text-orange-400 font-medium mb-0.5">Coach feedback</p>
                        <p className="text-xs text-gray-300">{fb.admin_feedback}</p>
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </div>
        )}
      </div>
    </div>
  )
}
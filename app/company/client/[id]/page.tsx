'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter, useParams } from 'next/navigation'

type Plan = {
  id: string
  week_start: string
  plan_details: string
}

type Session = {
  id: string
  session_date: string
  duration_minutes: number
  notes: string
}

type Feedback = {
  id: string
  session_id: string
  star_rating: number
  admin_feedback: string
}

export default function ClientDetailPage() {
  const router = useRouter()
  const params = useParams()
  const clientId = params.id as string

  const [client, setClient] = useState<any>(null)
  const [plans, setPlans] = useState<Plan[]>([])
  const [sessions, setSessions] = useState<Session[]>([])
  const [feedback, setFeedback] = useState<Feedback[]>([])
  const [activeTab, setActiveTab] = useState<'plans' | 'sessions'>('plans')
  const [showPlanForm, setShowPlanForm] = useState(false)
  const [newPlan, setNewPlan] = useState({ week_start: '', plan_details: '' })
  const [saving, setSaving] = useState(false)
  const [feedbackText, setFeedbackText] = useState<Record<string, string>>({})
  const [savedFeedback, setSavedFeedback] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => { initialize() }, [clientId])

  const initialize = async () => {
    const { data: clientData } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', clientId)
      .single()
    setClient(clientData)

    const { data: plansData } = await supabase
      .from('weekly_plans')
      .select('*')
      .eq('client_id', clientId)
      .order('week_start', { ascending: false })
    setPlans(plansData || [])

    const { data: sessionsData } = await supabase
      .from('logged_sessions')
      .select('*')
      .eq('client_id', clientId)
      .order('session_date', { ascending: false })
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

  const handleAddPlan = async () => {
    setSaving(true)
    await supabase.from('weekly_plans').insert({
      client_id: clientId,
      week_start: newPlan.week_start,
      plan_details: newPlan.plan_details
    })
    setNewPlan({ week_start: '', plan_details: '' })
    setShowPlanForm(false)
    setSaving(false)
    initialize()
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
  initialize()
}

  const getFeedback = (sessionId: string) => feedback.find(f => f.session_id === sessionId)

  if (loading) return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <p className="text-white">Loading...</p>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Header */}
      <div className="bg-gray-900 border-b border-gray-800 px-4 py-4 flex justify-between items-center">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push('/company')}
            className="text-gray-400 hover:text-white text-sm">← Back</button>
          <div>
            <h1 className="text-lg font-bold text-white">{client?.full_name}</h1>
            <p className="text-xs text-gray-400">{client?.email}</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-800">
        {(['plans', 'sessions'] as const).map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={`flex-1 py-3 text-sm font-medium capitalize transition ${activeTab === tab
              ? 'text-orange-500 border-b-2 border-orange-500'
              : 'text-gray-400 hover:text-white'}`}>
            {tab === 'plans' ? 'Weekly Plans' : 'Sessions & Feedback'}
          </button>
        ))}
      </div>

      <div className="max-w-2xl mx-auto p-4">

        {/* PLANS TAB */}
        {activeTab === 'plans' && (
          <div className="mt-2">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-sm font-medium text-gray-400">{plans.length} plans assigned</h2>
              <button onClick={() => setShowPlanForm(!showPlanForm)}
                className="bg-orange-500 hover:bg-orange-600 text-white text-sm px-4 py-2 rounded-lg transition">
                + Assign Plan
              </button>
            </div>

            {showPlanForm && (
              <div className="bg-gray-900 rounded-xl p-5 border border-gray-800 space-y-4 mb-4">
                <h3 className="font-semibold">New Weekly Plan</h3>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Week starting</label>
                  <input type="date" value={newPlan.week_start}
                    onChange={e => setNewPlan({ ...newPlan, week_start: e.target.value })}
                    className="w-full bg-gray-800 text-white rounded-lg px-4 py-2.5 outline-none focus:ring-2 focus:ring-orange-500 text-sm" />
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Plan details</label>
                  <textarea
                    placeholder="e.g. Mon: 5km run, Tue: Rest, Wed: Gym - squats 3x10..."
                    value={newPlan.plan_details}
                    onChange={e => setNewPlan({ ...newPlan, plan_details: e.target.value })}
                    rows={5}
                    className="w-full bg-gray-800 text-white rounded-lg px-4 py-2.5 outline-none focus:ring-2 focus:ring-orange-500 text-sm resize-none" />
                </div>
                <button onClick={handleAddPlan} disabled={saving}
                  className="w-full bg-orange-500 hover:bg-orange-600 text-white font-semibold py-3 rounded-lg transition disabled:opacity-50">
                  {saving ? 'Saving...' : 'Save Plan'}
                </button>
              </div>
            )}

            {plans.length === 0 ? (
              <div className="bg-gray-900 rounded-xl p-8 text-center text-gray-400">
                No plans assigned yet.
              </div>
            ) : (
              <div className="space-y-3">
                {plans.map(plan => (
                  <div key={plan.id} className="bg-gray-900 rounded-xl p-4 border border-gray-800">
                    <p className="text-xs text-gray-500 mb-1">Week of</p>
                    <p className="font-semibold mb-2">
                      {new Date(plan.week_start).toLocaleDateString('en', { month: 'long', day: 'numeric', year: 'numeric' })}
                    </p>
                    <p className="text-sm text-gray-300 whitespace-pre-wrap">{plan.plan_details}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* SESSIONS TAB */}
        {activeTab === 'sessions' && (
          <div className="mt-2 space-y-3">
            {sessions.length === 0 ? (
              <div className="bg-gray-900 rounded-xl p-8 text-center text-gray-400">
                No sessions logged yet.
              </div>
            ) : (
              sessions.map(session => {
                const fb = getFeedback(session.id)
                return (
                  <div key={session.id} className="bg-gray-900 rounded-xl p-4 border border-gray-800">
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <p className="text-sm font-medium">
                          {new Date(session.session_date).toLocaleDateString('en', { weekday: 'short', month: 'short', day: 'numeric' })}
                        </p>
                        {session.duration_minutes && (
                          <p className="text-xs text-gray-400">{session.duration_minutes} mins</p>
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
                    {session.notes && <p className="text-xs text-gray-400 mb-3">{session.notes}</p>}

                    {/* Admin feedback */}
                    <div className="mt-2">
                      <label className="text-xs text-gray-500 mb-1 block">Your feedback</label>
                      <textarea
                        placeholder="Add coaching feedback..."
                        defaultValue={fb?.admin_feedback || ''}
                        onChange={e => setFeedbackText({ ...feedbackText, [session.id]: e.target.value })}
                        rows={2}
                        className="w-full bg-gray-800 text-white rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-purple-500 text-xs resize-none" />
                      <button
  onClick={() => handleSaveFeedback(session.id)}
  className="mt-1.5 bg-purple-700 hover:bg-purple-600 text-white text-xs px-4 py-1.5 rounded-lg transition">
  {savedFeedback[session.id] ? '✓ Saved!' : 'Save Feedback'}
</button>
                    </div>
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
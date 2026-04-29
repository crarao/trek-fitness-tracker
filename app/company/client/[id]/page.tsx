'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter, useParams } from 'next/navigation'
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
}

type Plan = {
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
  const [showGeneratedPlan, setShowGeneratedPlan] = useState(false)
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
  const [deletingClient, setDeletingClient] = useState(false)
  const [editingClientProfile, setEditingClientProfile] = useState(false)
  const [clientProfileForm, setClientProfileForm] = useState({
    trainer_name: '', diet_plan: '',
    goal: '', age: '', gender: '', height_cm: '', weight_kg: '',
    fitness_level: '', food_preference: '', available_days: '',
    medical_conditions: '', emergency_contact_name: '', emergency_contact_phone: ''
  })
  const [savingClientProfile, setSavingClientProfile] = useState(false)
  const [clientProfileMessage, setClientProfileMessage] = useState('')

  useEffect(() => { initialize() }, [clientId])

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

  const initialize = async () => {
    const { data: clientData } = await supabase
      .from('profiles')
      .select('*, companies:company_id(business_type, feedback_enabled, client_module_enabled)')
      .eq('id', clientId)
      .single()
    setClient(clientData)
    if (clientData?.company_id) setCompanyId(clientData.company_id)

    const { data: membershipsData } = await supabase
      .from('memberships')
      .select('*')
      .eq('profile_id', clientId)
      .order('start_date', { ascending: false })
    setMemberships(membershipsData || [])

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

  const handleAddPlan = async () => {
    setSaving(true)
    await supabase.from('weekly_plans').insert({
      client_id: clientId,
      week_start: newPlan.week_start,
      plan_details: newPlan.plan_details,
      workout_time: newPlan.workout_time || null
    })
    setNewPlan({ week_start: '', plan_details: '', workout_time: '' })
    setShowPlanForm(false)
    setSaving(false)
    initialize()
  }

const handleUpdatePlan = async () => {
  if (!editingPlan) return
  setSaving(true)
  await supabase
    .from('weekly_plans')
    .update({
      week_start: editingPlan.week_start,
      plan_details: editingPlan.plan_details,
      workout_time: editingPlan.workout_time || null
    })
    .eq('id', editingPlan.id)
  setEditingPlan(null)
  setSaving(false)
  initialize()
}

const handleDeletePlan = async (planId: string) => {
  if (!confirm('Delete this plan? This cannot be undone.')) return
  setDeletingPlanId(planId)
  await supabase
    .from('weekly_plans')
    .delete()
    .eq('id', planId)
  setDeletingPlanId(null)
  initialize()
}


const handleSaveClientProfile = async () => {
  setSavingClientProfile(true)
  await supabase
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
      available_days: clientProfileForm.available_days || null,
      medical_conditions: clientProfileForm.medical_conditions || null,
      emergency_contact_name: clientProfileForm.emergency_contact_name || null,
      emergency_contact_phone: clientProfileForm.emergency_contact_phone || null,
    })
    .eq('id', clientId)
  setClientProfileMessage('Saved! ✓')
  setSavingClientProfile(false)
  setEditingClientProfile(false)
  setTimeout(() => setClientProfileMessage(''), 3000)
  initialize()
}

const handleGeneratePlan = async () => {
  setGeneratingPlan(true)
  setShowGeneratedPlan(false)
  setGeneratedPlan('')

const response = await fetch('/api/generate-plan', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ 
    profile: {
      ...client,
      business_type: (client as any)?.companies?.business_type || 'gym'
    }
  })
})

  const data = await response.json()
  if (data.plan) {
    setGeneratedPlan(data.plan)
    setShowGeneratedPlan(true)
    setNewPlan(prev => ({ ...prev, plan_details: data.plan }))
  }
  setGeneratingPlan(false)
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
    initialize()
    setTimeout(() => { setShowEditClient(false); setEditMessage('') }, 1000)
  }

  const handleRenewMembership = async () => {
    if (!companyId) return
    setSavingMembership(true)
    await supabase.from('memberships').insert({
      profile_id: clientId,
      company_id: companyId,
      plan_type: editClientForm.plan_type,
      amount_paid: parseFloat(editClientForm.amount_paid) || 0,
      start_date: editClientForm.start_date,
      end_date: editClientForm.end_date
    })
    if (client?.archived_at) {
      await supabase.from('profiles').update({ archived_at: null }).eq('id', clientId)
    }
    setMembershipMessage('Membership renewed! ✓')
    setSavingMembership(false)
    setTimeout(() => setMembershipMessage(''), 3000)
    initialize()
  }

  const handleCorrectMembership = async () => {
    const latest = memberships[0]
    if (!latest) return
    setSavingMembership(true)
    await supabase.from('memberships').update({
      plan_type: editClientForm.plan_type,
      amount_paid: parseFloat(editClientForm.amount_paid) || 0,
      start_date: editClientForm.start_date,
      end_date: editClientForm.end_date
    }).eq('id', latest.id)
    setMembershipMessage('Membership corrected! ✓')
    setSavingMembership(false)
    setTimeout(() => setMembershipMessage(''), 3000)
    initialize()
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
    initialize()
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
          <button onClick={() => router.push('/company')}
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
                start_date: latest?.start_date || new Date().toISOString().split('T')[0],
                end_date: latest?.end_date || '',
                client_type: client?.client_type || 'member'
              })
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
                    Current: {memberships[0].plan_type} · ends {new Date(memberships[0].end_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </span>
                )}
              </div>
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
                <input type="number" placeholder="Amount paid (₹)"
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
              </div>
              {membershipMessage && (
                <p className="text-green-400 text-sm">{membershipMessage}</p>
              )}
              <div className="flex gap-2">
                <button
                  onClick={handleRenewMembership}
                  disabled={savingMembership}
                  className="flex-1 bg-orange-500 hover:bg-orange-400 text-white font-semibold py-2.5 rounded-xl transition disabled:opacity-50 text-sm">
                  {savingMembership ? 'Saving...' : 'Renew Membership'}
                </button>
                {memberships[0] && (
                  <button
                    onClick={handleCorrectMembership}
                    disabled={savingMembership}
                    className="flex-1 bg-gray-700 hover:bg-gray-600 text-white py-2.5 rounded-xl transition disabled:opacity-50 text-sm">
                    Correct Current
                  </button>
                )}
              </div>
              <p className="text-xs text-gray-600">Renew adds a new entry (keeps history). Correct updates the current entry (for fixing mistakes).</p>
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
                <p className="text-xs text-gray-600 mt-1">₹{Number(memberships[0].amount_paid).toLocaleString('en-IN')}</p>
              )}
              {memberships[0] && (
                <p className="text-xs text-gray-600 mt-1">
                  {new Date(memberships[0].start_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                  {' → '}
                  {new Date(memberships[0].end_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
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
{client?.goal && (
  <div className="bg-orange-950 border border-orange-900 rounded-2xl px-5 py-4 mb-4">
    <p className="text-xs text-orange-400 uppercase tracking-wider mb-1">Client Goal</p>
    <p className="text-sm text-orange-200">{client.goal}</p>
  </div>
)}
            <div className="flex justify-between items-center mb-4">
              <p className="text-xs text-gray-500">{plans.length} plans assigned</p>
              <div className="flex gap-2">
  <button
    onClick={handleGeneratePlan}
    disabled={generatingPlan}
    className="bg-purple-600 hover:bg-purple-500 text-white text-xs px-4 py-2 rounded-xl transition font-medium disabled:opacity-50">
    {generatingPlan ? '⏳ Generating...' : '✨ Generate with AI'}
  </button>
  <button onClick={() => setShowPlanForm(!showPlanForm)}
    className="bg-orange-500 hover:bg-orange-400 text-white text-xs px-4 py-2 rounded-xl transition font-medium">
    + Assign Plan
  </button>
</div>
            </div>
{showGeneratedPlan && generatedPlan && (
  <div className="bg-gray-900 rounded-2xl p-5 border border-purple-800 space-y-4 mb-4">
    <div className="flex justify-between items-center">
      <p className="text-xs text-purple-400 uppercase tracking-wider font-medium">✨ AI Generated Plan</p>
      <button
        onClick={() => setShowGeneratedPlan(false)}
        className="text-xs text-gray-500 hover:text-white">
        Dismiss
      </button>
    </div>
    <textarea
  value={generatedPlan}
  onChange={e => {
    setGeneratedPlan(e.target.value)
    setNewPlan(prev => ({ ...prev, plan_details: e.target.value }))
  }}
  rows={15}
  className="w-full bg-gray-800 text-white rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-purple-500 border border-gray-700 text-sm resize-none" />
    <div className="border-t border-gray-800 pt-4">
      <p className="text-xs text-gray-500 mb-3">Select week to assign this plan:</p>
      <input type="date" value={newPlan.week_start}
        onChange={e => setNewPlan({ ...newPlan, week_start: e.target.value })}
        className="w-full bg-gray-800 text-white rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-purple-500 border border-gray-700 text-sm mb-3" />
      <button
        onClick={handleAddPlan}
        disabled={saving || !newPlan.week_start}
        className="w-full bg-purple-600 hover:bg-purple-500 text-white font-semibold py-2.5 rounded-xl transition disabled:opacity-50 text-sm">
        {saving ? 'Assigning...' : 'Assign This Plan to Client'}
      </button>
    </div>
  </div>
)}
            {showPlanForm && (
              <div className="bg-gray-900 rounded-2xl p-5 border border-gray-800 space-y-4 mb-4">
                <h3 className="font-semibold text-sm">New Weekly Plan</h3>
                <div>
                  <label className="text-xs text-gray-500 mb-1.5 block uppercase tracking-wider">Week starting</label>
                  <input type="date" value={newPlan.week_start}
                    onChange={e => setNewPlan({ ...newPlan, week_start: e.target.value })}
                    className="w-full bg-gray-800 text-white rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1.5 block uppercase tracking-wider">Workout Time</label>
                  <input type="time" value={newPlan.workout_time}
                    onChange={e => setNewPlan({ ...newPlan, workout_time: e.target.value })}
                    className="w-full bg-gray-800 text-white rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1.5 block uppercase tracking-wider">Plan details</label>
                  <textarea
                    placeholder="Mon: 5km run&#10;Tue: Rest&#10;Wed: Gym - squats 3x10..."
                    value={newPlan.plan_details}
                    onChange={e => setNewPlan({ ...newPlan, plan_details: e.target.value })}
                    rows={6}
                    className="w-full bg-gray-800 text-white rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm resize-none" />
                </div>
                <button onClick={handleAddPlan} disabled={saving}
                  className="w-full bg-orange-500 hover:bg-orange-400 text-white font-semibold py-2.5 rounded-xl transition disabled:opacity-50 text-sm">
                  {saving ? 'Saving...' : 'Save Plan'}
                </button>
              </div>
            )}

            {plans.length === 0 ? (
              <div className="bg-gray-900 rounded-2xl p-10 text-center text-gray-500 border border-gray-800">
                No plans assigned yet.
              </div>
            ) : (
              <div className="space-y-3">
                {plans.map(plan => (
  <div key={plan.id} className="bg-gray-900 rounded-2xl p-5 border border-gray-800">
    {editingPlan?.id === plan.id ? (
      // Edit mode
      <div className="space-y-3">
        <p className="text-xs text-gray-500 uppercase tracking-wider">Editing Plan</p>
        <input type="date"
          value={editingPlan.week_start}
          onChange={e => setEditingPlan({ ...editingPlan, week_start: e.target.value })}
          className="w-full bg-gray-800 text-white rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm" />
        <div>
          <label className="text-xs text-gray-500 mb-1.5 block uppercase tracking-wider">Workout Time</label>
          <input type="time" value={editingPlan.workout_time || ''}
            onChange={e => setEditingPlan({ ...editingPlan, workout_time: e.target.value })}
            className="w-full bg-gray-800 text-white rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm" />
        </div>
        <textarea
          value={editingPlan.plan_details}
          onChange={e => setEditingPlan({ ...editingPlan, plan_details: e.target.value })}
          rows={10}
          className="w-full bg-gray-800 text-white rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm resize-none" />
        <div className="flex gap-2">
          <button onClick={handleUpdatePlan} disabled={saving}
            className="flex-1 bg-orange-500 hover:bg-orange-400 text-white text-sm py-2.5 rounded-xl transition disabled:opacity-50 font-medium">
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
          <button onClick={() => setEditingPlan(null)}
            className="flex-1 bg-gray-800 hover:bg-gray-700 text-white text-sm py-2.5 rounded-xl transition">
            Cancel
          </button>
        </div>
      </div>
    ) : (
      // View mode
      <>
        <div className="flex justify-between items-start mb-3">
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Week of</p>
            <p className="font-semibold text-sm">
              {new Date(plan.week_start).toLocaleDateString('en', { month: 'long', day: 'numeric', year: 'numeric' })}
            </p>
            {plan.workout_time && (
              <p className="text-xs text-orange-400 mt-1">⏰ {plan.workout_time}</p>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setEditingPlan(plan)}
              className="text-xs text-gray-400 hover:text-orange-400 border border-gray-700 hover:border-orange-500 px-3 py-1.5 rounded-lg transition">
              Edit
            </button>
            <button
              onClick={() => handleDeletePlan(plan.id)}
              disabled={deletingPlanId === plan.id}
              className="text-xs text-gray-400 hover:text-red-400 border border-gray-700 hover:border-red-500 px-3 py-1.5 rounded-lg transition">
              {deletingPlanId === plan.id ? 'Deleting...' : 'Delete'}
            </button>
          </div>
        </div>
        <div className="border-t border-gray-800 pt-3">
          <p className="text-sm text-gray-300 whitespace-pre-wrap leading-relaxed">{plan.plan_details}</p>
        </div>
      </>
    )}
  </div>
))}
              
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
                          {new Date(session.session_date).toLocaleDateString('en', { weekday: 'short', month: 'short', day: 'numeric' })}
                        </p>
                        {session.duration_minutes && (
                          <p className="text-xs text-gray-500 mt-0.5">{session.duration_minutes} mins</p>
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
                        {new Date(m.start_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                        {' → '}
                        {new Date(m.end_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className={`text-sm font-bold ${color}`}>{Math.abs(days)} {days < 0 ? 'days overdue' : 'days left'}</p>
                      <p className="text-xs text-gray-500">₹{Number(m.amount_paid).toLocaleString('en-IN')}</p>
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
                    <span>{m.plan_type} · {new Date(m.start_date).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })} – {new Date(m.end_date).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}</span>
                    <span>₹{Number(m.amount_paid).toLocaleString('en-IN')}</span>
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
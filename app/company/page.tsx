'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'

type Membership = {
  id: string
  plan_type: string
  amount_paid: number
  start_date: string
  end_date: string
}

type Client = {
  id: string
  full_name: string
  email: string
  phone: string
  created_at: string
  memberships: Membership[]
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

function latestMembership(memberships: Membership[]): Membership | null {
  if (!memberships?.length) return null
  return [...memberships].sort((a, b) => new Date(b.start_date).getTime() - new Date(a.start_date).getTime())[0]
}

function daysLeft(endDate: string): number {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const end = new Date(endDate)
  return Math.ceil((end.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
}

function membershipStatus(m: Membership | null): 'active' | 'expiring' | 'expired' | 'none' {
  if (!m) return 'none'
  const d = daysLeft(m.end_date)
  if (d < 0) return 'expired'
  if (d <= 11) return 'expiring'
  return 'active'
}

function elapsedPct(m: Membership): number {
  const total = new Date(m.end_date).getTime() - new Date(m.start_date).getTime()
  const elapsed = Date.now() - new Date(m.start_date).getTime()
  return Math.min(Math.max((elapsed / total) * 100, 0), 100)
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

export default function CompanyAdminPage() {
  const router = useRouter()
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [companyName, setCompanyName] = useState('')
  const [clientLimit, setClientLimit] = useState<number>(50)
  const [trialInfo, setTrialInfo] = useState<{ trial_end: string; is_active: boolean; is_trial: boolean } | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [newClient, setNewClient] = useState({
    full_name: '', email: '', password: '', phone: '', trainer_name: '', diet_plan: '',
    plan_type: '1 Month', amount_paid: '',
    start_date: new Date().toISOString().split('T')[0], end_date: ''
  })
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [showSettings, setShowSettings] = useState(false)
  const [passwordData, setPasswordData] = useState({ newPassword: '', confirmPassword: '' })
  const [passwordMessage, setPasswordMessage] = useState('')
  const [logoUrl, setLogoUrl] = useState('')
  const [logoSaved, setLogoSaved] = useState(false)
  const [activeFilter, setActiveFilter] = useState<'all' | 'active' | 'expiring' | 'expired'>('all')

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
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }

    const { data: profile } = await supabase
      .from('profiles')
      .select('company_id')
      .eq('id', user.id)
      .single()

    if (!profile?.company_id) { router.push('/login'); return }

    setCompanyId(profile.company_id)

    const { data: company } = await supabase
      .from('companies')
      .select('name, logo_url, trial_end, is_active, client_limit, is_trial')
      .eq('id', profile.company_id)
      .single()

    setCompanyName(company?.name || '')
    setClientLimit(company?.client_limit || 50)
    setLogoUrl(company?.logo_url || '')
    setTrialInfo({
      trial_end: company?.trial_end,
      is_active: company?.is_active,
      is_trial: company?.is_trial ?? true
    })

    fetchClients(profile.company_id)
  }

  const fetchClients = async (cId: string) => {
    const [{ data: profiles }, { data: memberships }] = await Promise.all([
      supabase
        .from('profiles')
        .select('*')
        .eq('company_id', cId)
        .eq('role', 'client')
        .order('created_at', { ascending: false }),
      supabase
        .from('memberships')
        .select('*')
        .eq('company_id', cId)
    ])

    const clientsWithMemberships: Client[] = (profiles || []).map(p => ({
      ...p,
      memberships: (memberships || []).filter(m => m.profile_id === p.id)
    }))

    setClients(clientsWithMemberships)
    setLoading(false)
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
      setPasswordData({ newPassword: '', confirmPassword: '' })
      setTimeout(() => { setShowSettings(false); setPasswordMessage('') }, 2000)
    }
  }

  const handleSaveLogo = async () => {
    await supabase.from('companies').update({ logo_url: logoUrl }).eq('id', companyId!)
    setLogoSaved(true)
    setTimeout(() => setLogoSaved(false), 2000)
  }

  const handleCreateClient = async () => {
    setSaving(true)
    setMessage('')

    const { count } = await supabase
      .from('profiles')
      .select('*', { count: 'exact', head: true })
      .eq('company_id', companyId!)
      .eq('role', 'client')

    if ((count || 0) >= clientLimit) {
      setMessage(`Client limit reached (${clientLimit}). Contact CoachBoard to increase your limit.`)
      setSaving(false)
      return
    }

    const resolvedEmail = newClient.email
      ? newClient.email
      : /^\d{10}$/.test(newClient.phone.trim())
        ? `${newClient.phone.trim()}@getcoachboard.in`
        : ''

    if (!resolvedEmail) {
      setMessage('Error: Enter a valid email or 10-digit phone number')
      setSaving(false)
      return
    }

    const response = await fetch('/api/create-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: resolvedEmail,
        password: newClient.password,
        full_name: newClient.full_name,
        company_id: companyId,
        role: 'client',
        phone: newClient.phone,
        trainer_name: newClient.trainer_name,
        diet_plan: newClient.diet_plan
      })
    })

    const result = await response.json()
    if (result.error) {
      setMessage('Error: ' + result.error)
      setSaving(false)
      return
    }

    if (newClient.plan_type && newClient.start_date && newClient.end_date) {
      const { error: mError } = await supabase.from('memberships').insert({
        profile_id: result.userId,
        company_id: companyId,
        plan_type: newClient.plan_type,
        amount_paid: parseFloat(newClient.amount_paid) || 0,
        start_date: newClient.start_date,
        end_date: newClient.end_date
      })
      if (mError) console.error('Membership insert error:', mError)
    }

    setMessage('Member created successfully!')
    setNewClient({
      full_name: '', email: '', password: '', phone: '', trainer_name: '', diet_plan: '',
      plan_type: '1 Month', amount_paid: '',
      start_date: new Date().toISOString().split('T')[0], end_date: ''
    })
    setShowForm(false)
    setSaving(false)
    fetchClients(companyId!)
  }

  const trialDaysLeft = () => {
    if (!trialInfo?.trial_end) return null
    return Math.ceil((new Date(trialInfo.trial_end).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
  }

  const statusCounts = {
    active: clients.filter(c => membershipStatus(latestMembership(c.memberships)) === 'active').length,
    expiring: clients.filter(c => membershipStatus(latestMembership(c.memberships)) === 'expiring').length,
    expired: clients.filter(c => membershipStatus(latestMembership(c.memberships)) === 'expired').length,
  }

  const expiredClients = clients.filter(c => membershipStatus(latestMembership(c.memberships)) === 'expired')

  const filteredClients = activeFilter === 'all'
    ? clients
    : clients.filter(c => membershipStatus(latestMembership(c.memberships)) === activeFilter)

  if (trialInfo && !trialInfo.is_active) {
    return (
      <div className="min-h-screen bg-stone-100 flex items-center justify-center">
        <div className="bg-white border border-red-200 rounded-2xl px-8 py-12 text-center max-w-md">
          <p className="text-4xl mb-4">🔒</p>
          <h2 className="text-xl font-bold text-red-600 mb-2">Account Deactivated</h2>
          <p className="text-gray-500 text-sm">Please contact CoachBoard to reactivate your account.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-stone-100">

      {/* Header */}
      <div className="px-8 pt-8 pb-4">
        <div className="flex justify-between items-start">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h1 className="text-3xl font-bold text-gray-900">{companyName || 'CoachBoard'}</h1>
              <span className="text-sm text-gray-600 bg-white border border-gray-200 rounded-full px-3 py-1 flex items-center gap-1.5">
                <span className="w-2 h-2 bg-green-500 rounded-full inline-block" />
                {clients.length} members
              </span>
            </div>
            <p className="text-sm text-gray-400">Company Admin</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowSettings(!showSettings)}
              className="text-sm text-gray-500 hover:text-gray-800 border border-gray-300 bg-white px-3 py-1.5 rounded-lg transition">
              Settings
            </button>
            <button onClick={handleLogout}
              className="text-sm text-gray-500 hover:text-gray-800 border border-gray-300 bg-white px-3 py-1.5 rounded-lg transition">
              Logout
            </button>
            <button
              onClick={() => setShowForm(!showForm)}
              className="bg-gray-900 hover:bg-gray-700 text-white text-sm px-4 py-2 rounded-lg transition font-medium">
              + Add Member
            </button>
          </div>
        </div>
      </div>

      {/* Settings Panel */}
      {showSettings && (
        <div className="mx-8 mb-4 bg-white border border-gray-200 rounded-2xl p-5 space-y-5">
          <div>
            <p className="text-xs text-gray-400 uppercase tracking-wider mb-2">Company Logo URL</p>
            <div className="flex gap-2">
              <input type="text" placeholder="https://yourcompany.com/logo.png"
                value={logoUrl} onChange={e => setLogoUrl(e.target.value)}
                className="flex-1 bg-gray-50 text-gray-900 rounded-lg px-4 py-2.5 outline-none focus:ring-2 focus:ring-gray-900 border border-gray-200 text-sm" />
              <button onClick={handleSaveLogo}
                className="bg-gray-900 hover:bg-gray-700 text-white px-4 py-2.5 rounded-lg transition text-sm font-medium">
                {logoSaved ? '✓ Saved' : 'Save'}
              </button>
            </div>
          </div>
          <div>
            <p className="text-xs text-gray-400 uppercase tracking-wider mb-2">Change Password</p>
            <input type="password" placeholder="New password"
              value={passwordData.newPassword}
              onChange={e => setPasswordData({ ...passwordData, newPassword: e.target.value })}
              className="w-full bg-gray-50 text-gray-900 rounded-lg px-4 py-2.5 outline-none focus:ring-2 focus:ring-gray-900 border border-gray-200 text-sm mb-2" />
            <input type="password" placeholder="Confirm new password"
              value={passwordData.confirmPassword}
              onChange={e => setPasswordData({ ...passwordData, confirmPassword: e.target.value })}
              className="w-full bg-gray-50 text-gray-900 rounded-lg px-4 py-2.5 outline-none focus:ring-2 focus:ring-gray-900 border border-gray-200 text-sm" />
            {passwordMessage && (
              <p className={`text-sm mt-2 ${passwordMessage.includes('✓') ? 'text-green-600' : 'text-red-500'}`}>{passwordMessage}</p>
            )}
            <button onClick={handleChangePassword}
              className="w-full bg-gray-900 hover:bg-gray-700 text-white font-semibold py-2.5 rounded-lg transition text-sm mt-3">
              Update Password
            </button>
          </div>
        </div>
      )}

      {/* Subscription banners */}
      {trialInfo?.is_active && (trialDaysLeft() ?? 0) > 0 && (trialDaysLeft() ?? 0) <= 20 && (
        <div className="mx-8 mb-4 bg-amber-50 border border-amber-200 rounded-xl px-5 py-3">
          <p className="text-amber-700 text-sm">
            {trialInfo.is_trial
              ? `⚠️ Trial ends in ${trialDaysLeft()} day${trialDaysLeft() === 1 ? '' : 's'} (${new Date(trialInfo.trial_end).toLocaleDateString()}). Contact CoachBoard to continue.`
              : `📅 Subscription renews in ${trialDaysLeft()} day${trialDaysLeft() === 1 ? '' : 's'} (${new Date(trialInfo.trial_end).toLocaleDateString()}). Contact CoachBoard to renew.`}
          </p>
        </div>
      )}
      {trialInfo?.is_active && (trialDaysLeft() ?? 0) <= 0 && (
        <div className="mx-8 mb-4 bg-red-50 border border-red-200 rounded-xl px-5 py-3">
          <p className="text-red-600 text-sm">
            🔒 {trialInfo.is_trial ? 'Your trial has ended.' : 'Your subscription has expired.'} Contact CoachBoard to reactivate.
          </p>
        </div>
      )}

      {/* Expired members alert */}
      {expiredClients.length > 0 && (
        <div className="mx-8 mb-4 bg-amber-50 border border-amber-200 rounded-xl px-5 py-3 flex items-start gap-3">
          <span className="text-amber-500 text-lg mt-0.5">⚠</span>
          <div>
            <p className="text-amber-800 font-semibold text-sm">
              {expiredClients.length} membership{expiredClients.length > 1 ? 's' : ''} expired
            </p>
            <p className="text-amber-600 text-sm">
              {expiredClients.slice(0, 3).map(c => c.full_name.split(' ')[0]).join(', ')}
              {expiredClients.length > 3 ? ` and ${expiredClients.length - 3} more` : ''} — follow up before they leave.
            </p>
          </div>
        </div>
      )}

      <div className="px-8 pb-8">

        {/* Add Member Form */}
        {showForm && (
          <div className="bg-white border border-gray-200 rounded-2xl p-6 mb-6">
            <h3 className="font-semibold text-gray-900 mb-4">New Member</h3>
            <div className="grid grid-cols-2 gap-3">
              <input type="text" placeholder="Full name"
                value={newClient.full_name}
                onChange={e => setNewClient({ ...newClient, full_name: e.target.value })}
                className="col-span-2 bg-gray-50 text-gray-900 rounded-lg px-4 py-2.5 outline-none focus:ring-2 focus:ring-gray-900 border border-gray-200 text-sm" />
              <input type="tel" placeholder="Phone number (10 digits)"
                value={newClient.phone}
                onChange={e => setNewClient({ ...newClient, phone: e.target.value })}
                className="bg-gray-50 text-gray-900 rounded-lg px-4 py-2.5 outline-none focus:ring-2 focus:ring-gray-900 border border-gray-200 text-sm" />
              <input type="email" placeholder="Email (optional)"
                value={newClient.email}
                onChange={e => setNewClient({ ...newClient, email: e.target.value })}
                className="bg-gray-50 text-gray-900 rounded-lg px-4 py-2.5 outline-none focus:ring-2 focus:ring-gray-900 border border-gray-200 text-sm" />
              <input type="password" placeholder="Temporary password"
                value={newClient.password}
                onChange={e => setNewClient({ ...newClient, password: e.target.value })}
                className="col-span-2 bg-gray-50 text-gray-900 rounded-lg px-4 py-2.5 outline-none focus:ring-2 focus:ring-gray-900 border border-gray-200 text-sm" />
              <select
                value={newClient.plan_type}
                onChange={e => setNewClient({ ...newClient, plan_type: e.target.value })}
                className="bg-gray-50 text-gray-900 rounded-lg px-4 py-2.5 outline-none focus:ring-2 focus:ring-gray-900 border border-gray-200 text-sm">
                <option>1 Month</option>
                <option>3 Months</option>
                <option>6 Months</option>
                <option>1 Year</option>
              </select>
              <input type="number" placeholder="Amount paid (₹)"
                value={newClient.amount_paid}
                onChange={e => setNewClient({ ...newClient, amount_paid: e.target.value })}
                className="bg-gray-50 text-gray-900 rounded-lg px-4 py-2.5 outline-none focus:ring-2 focus:ring-gray-900 border border-gray-200 text-sm" />
              <div>
                <label className="text-xs text-gray-400 mb-1 block">Start Date</label>
                <input type="date"
                  value={newClient.start_date}
                  onChange={e => setNewClient({ ...newClient, start_date: e.target.value })}
                  className="w-full bg-gray-50 text-gray-900 rounded-lg px-4 py-2.5 outline-none focus:ring-2 focus:ring-gray-900 border border-gray-200 text-sm" />
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1 block">End Date (auto-calculated)</label>
                <input type="date"
                  value={newClient.end_date}
                  onChange={e => setNewClient({ ...newClient, end_date: e.target.value })}
                  className="w-full bg-gray-50 text-gray-900 rounded-lg px-4 py-2.5 outline-none focus:ring-2 focus:ring-gray-900 border border-gray-200 text-sm" />
              </div>
              <input type="text" placeholder="Trainer name (optional)"
                value={newClient.trainer_name}
                onChange={e => setNewClient({ ...newClient, trainer_name: e.target.value })}
                className="bg-gray-50 text-gray-900 rounded-lg px-4 py-2.5 outline-none focus:ring-2 focus:ring-gray-900 border border-gray-200 text-sm" />
              <textarea placeholder="Diet plan (optional)"
                value={newClient.diet_plan}
                onChange={e => setNewClient({ ...newClient, diet_plan: e.target.value })}
                rows={2}
                className="col-span-2 bg-gray-50 text-gray-900 rounded-lg px-4 py-2.5 outline-none focus:ring-2 focus:ring-gray-900 border border-gray-200 text-sm resize-none" />
            </div>
            {message && (
              <p className={`text-sm mt-3 ${message.includes('Error') ? 'text-red-500' : 'text-green-600'}`}>{message}</p>
            )}
            <div className="flex gap-2 mt-4">
              <button onClick={handleCreateClient} disabled={saving}
                className="flex-1 bg-gray-900 hover:bg-gray-700 text-white font-semibold py-2.5 rounded-lg transition disabled:opacity-50 text-sm">
                {saving ? 'Creating...' : 'Create Member'}
              </button>
              <button onClick={() => { setShowForm(false); setMessage('') }}
                className="px-4 py-2.5 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 text-sm transition">
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Members Table */}
        <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">

          {/* Table toolbar */}
          <div className="px-6 py-4 flex justify-between items-center border-b border-gray-100">
            <h2 className="font-semibold text-gray-900">Members — {companyName}</h2>
            <div className="flex gap-1">
              {(['all', 'active', 'expiring', 'expired'] as const).map(f => (
                <button key={f} onClick={() => setActiveFilter(f)}
                  className={`text-sm px-3 py-1.5 rounded-lg transition font-medium ${
                    activeFilter === f ? 'bg-gray-900 text-white' : 'text-gray-500 hover:bg-gray-100'
                  }`}>
                  {f.charAt(0).toUpperCase() + f.slice(1)}
                  {f !== 'all' && (
                    <span className="ml-1 text-xs opacity-60">({statusCounts[f]})</span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <div className="px-6 py-12 text-center text-gray-400 text-sm">Loading...</div>
          ) : filteredClients.length === 0 ? (
            <div className="px-6 py-12 text-center text-gray-400 text-sm">
              {clients.length === 0 ? 'No members yet. Add your first one!' : `No ${activeFilter} members.`}
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="text-xs text-gray-400 uppercase tracking-wider border-b border-gray-100">
                  <th className="px-6 py-3 text-left font-medium">Member</th>
                  <th className="px-4 py-3 text-left font-medium">Plan</th>
                  <th className="px-4 py-3 text-left font-medium">Paid</th>
                  <th className="px-4 py-3 text-left font-medium">Start → End</th>
                  <th className="px-4 py-3 text-left font-medium">Status</th>
                  <th className="px-4 py-3 text-left font-medium">Days Left</th>
                  <th className="px-4 py-3 text-left font-medium">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filteredClients.map((client, index) => {
                  const m = latestMembership(client.memberships)
                  const status = membershipStatus(m)
                  const days = m ? daysLeft(m.end_date) : null

                  const statusStyle = {
                    active:   { badge: 'bg-green-100 text-green-700',  dot: 'bg-green-500',  bar: 'bg-green-500',  days: 'text-green-700'  },
                    expiring: { badge: 'bg-amber-100 text-amber-700',  dot: 'bg-amber-500',  bar: 'bg-amber-500',  days: 'text-amber-700'  },
                    expired:  { badge: 'bg-red-100 text-red-600',      dot: 'bg-red-500',    bar: 'bg-red-500',    days: 'text-red-600'    },
                    none:     { badge: 'bg-gray-100 text-gray-400',    dot: 'bg-gray-300',   bar: 'bg-gray-200',   days: 'text-gray-400'   },
                  }[status]

                  const actionStyle = {
                    active:   { label: 'View',      cls: 'border-gray-200 text-gray-600 hover:bg-gray-50'      },
                    expiring: { label: 'Remind',    cls: 'border-amber-200 text-amber-700 hover:bg-amber-50'   },
                    expired:  { label: 'Follow Up', cls: 'border-red-200 text-red-600 hover:bg-red-50'         },
                    none:     { label: 'View',      cls: 'border-gray-200 text-gray-600 hover:bg-gray-50'      },
                  }[status]

                  return (
                    <tr key={client.id}
                      className="hover:bg-gray-50 transition cursor-pointer"
                      onClick={() => router.push(`/company/client/${client.id}`)}>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className={`w-9 h-9 ${avatarColor(index)} rounded-full flex items-center justify-center flex-shrink-0`}>
                            <span className="text-white text-sm font-bold">{initials(client.full_name)}</span>
                          </div>
                          <div>
                            <p className="font-medium text-gray-900 text-sm">{client.full_name}</p>
                            <p className="text-xs text-gray-400">{client.phone || client.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-4 text-sm text-gray-700">{m?.plan_type || '—'}</td>
                      <td className="px-4 py-4 text-sm font-medium text-gray-900">
                        {m ? `₹${Number(m.amount_paid).toLocaleString('en-IN')}` : '—'}
                      </td>
                      <td className="px-4 py-4 text-sm text-gray-500">
                        {m ? `${fmtDate(m.start_date)} → ${fmtDate(m.end_date)}` : '—'}
                      </td>
                      <td className="px-4 py-4">
                        {m ? (
                          <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${statusStyle.badge}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${statusStyle.dot}`} />
                            {status.charAt(0).toUpperCase() + status.slice(1)}
                          </span>
                        ) : <span className="text-gray-300 text-sm">—</span>}
                      </td>
                      <td className="px-4 py-4">
                        {days !== null && m ? (
                          <div>
                            <p className={`text-sm font-semibold mb-1 ${statusStyle.days}`}>
                              {days < 0 ? `${days} days` : `${days} days`}
                            </p>
                            <div className="w-20 bg-gray-100 rounded-full h-1.5">
                              <div className={`h-1.5 rounded-full ${statusStyle.bar}`}
                                style={{ width: `${elapsedPct(m)}%` }} />
                            </div>
                          </div>
                        ) : <span className="text-gray-300 text-sm">—</span>}
                      </td>
                      <td className="px-4 py-4" onClick={e => e.stopPropagation()}>
                        <button
                          onClick={() => router.push(`/company/client/${client.id}`)}
                          className={`text-xs px-3 py-1.5 rounded-lg border transition font-medium ${actionStyle.cls}`}>
                          {actionStyle.label}
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}

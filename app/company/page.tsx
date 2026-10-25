'use client'

import { useEffect, useRef, useState } from 'react'
import { type AdherencePlan, type AdherenceSession, type Adherence, planAdherence, currentPlan, recentAdherence, pct, pctColor } from '@/lib/adherence'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import { formatMoney, formatMoneyCompact, currencySymbol } from '@/lib/currency'
import { type Country, normalizeCountry, formatDate, dialCode, loginMethod, phonePlaceholder, daysUntil } from '@/lib/locale'

type Membership = {
  id: string
  plan_type: string
  amount_paid: number
  start_date: string
  end_date: string
  created_at?: string
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
  // Latest start date wins; if two start the same day, the most recently created one is current
  return [...memberships].sort((a, b) =>
    (b.start_date.localeCompare(a.start_date)) || ((b.created_at || '').localeCompare(a.created_at || ''))
  )[0]
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

function fmtDate(d: string, country: Country | null) {
  return formatDate(d, country, 'dayMonth')
}

export default function CompanyAdminPage() {
  const router = useRouter()
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [companyName, setCompanyName] = useState('')
  const [currency, setCurrency] = useState<string | null>(null)
  const [country, setCountry] = useState<Country | null>(null)
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
    full_name: '', email: '', password: '', phone: '', trainer_name: '', diet_plan: '',
    plan_type: '1 Month', amount_paid: '',
    start_date: new Date().toISOString().split('T')[0], end_date: '',
    client_type: 'member'
  })
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
  const [searchQuery, setSearchQuery] = useState('')
  const [showRevenueDrillIn, setShowRevenueDrillIn] = useState(false)
  // Train module: PT clients' plans and plan-linked sessions from the last 4 weeks (for adherence)
  const [trainModule, setTrainModule] = useState(false)
  const [training, setTraining] = useState<{ plans: (AdherencePlan & { client_id: string })[]; sessions: AdherenceSession[] } | null>(null)

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
      .select('company_id, companies:company_id(name, logo_url, trial_end, is_active, client_limit, is_trial, pt_limit, currency, country, client_module_enabled)')
      .eq('id', user.id)
      .single()

    if (!profile?.company_id) { router.push('/login'); return }

    setCompanyId(profile.company_id)
    // Start loading members straight away, in parallel with setting up the header
    fetchClients(profile.company_id)

    type CompanyRow = {
      name: string | null; logo_url: string | null; trial_end: string | null; is_active: boolean | null
      client_limit: number | null; is_trial: boolean | null; pt_limit: number | null
      currency: string | null; country: string | null; client_module_enabled: boolean | null
    }
    const company = (profile as unknown as { companies: CompanyRow | null }).companies

    setCompanyName(company?.name || '')
    setTrainModule(!!company?.client_module_enabled)
    setCurrency(company?.currency || 'INR')
    setCountry(normalizeCountry(company?.country))
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
        .select('id, profile_id, plan_type, amount_paid, start_date, end_date, created_at')
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
    if (!ptIds.length) { setTraining({ plans: [], sessions: [] }); return }
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
            .select('id, profile_id, plan_type, amount_paid, start_date, end_date, created_at')
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
  const openClient = (id: string) => {
    if (openingClientId) return
    setOpeningClientId(id)
    router.push(`/company/client/${id}`)
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

  const handleCreateClient = async () => {
    setSaving(true)
    setMessage('')

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

    // Login rule comes from the company's country (lib/locale.ts):
    // India → email if given, else 10-digit phone ({phone}@getcoachboard.in)
    // US → email only; phone is saved for contact, never used as a login
    const method = loginMethod(country ?? 'IN')
    const enteredEmail = newClient.email.trim()
    const resolvedEmail = method === 'email'
      ? (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(enteredEmail) ? enteredEmail : '')
      : enteredEmail
        ? enteredEmail
        : /^\d{10}$/.test(newClient.phone.trim())
          ? `${newClient.phone.trim()}@getcoachboard.in`
          : ''

    if (!resolvedEmail) {
      setMessage(method === 'email'
        ? 'Error: Enter the client\'s email — US clients log in with email'
        : 'Error: Enter a valid email or 10-digit phone number')
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
        diet_plan: newClient.diet_plan,
        client_type: newClient.client_type
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
    showToast('Member added ✓')
    setNewClient({
      full_name: '', email: '', password: '', phone: '', trainer_name: '', diet_plan: '',
      plan_type: '1 Month', amount_paid: '',
      start_date: new Date().toISOString().split('T')[0], end_date: '',
      client_type: 'member'
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

  const statusCounts = {
    active: clients.filter(c => membershipStatus(latestMembership(c.memberships)) === 'active').length,
    expiring: clients.filter(c => membershipStatus(latestMembership(c.memberships)) === 'expiring').length,
    expired: clients.filter(c => membershipStatus(latestMembership(c.memberships)) === 'expired').length,
  }

  const expiringSoonClients = clients.filter(c => {
    const m = latestMembership(c.memberships)
    if (!m) return false
    const d = daysLeft(m.end_date)
    return d >= 0 && d <= 7
  })
  const expiringSoonCount = expiringSoonClients.length
  const expiringSoonRevenue = expiringSoonClients.reduce((sum, c) => {
    const m = latestMembership(c.memberships)
    return sum + (m ? Number(m.amount_paid) || 0 : 0)
  }, 0)

  const allMemberships = clients.flatMap(c => c.memberships)
  const now = new Date()
  const thisMonth = now.getMonth()
  const thisYear = now.getFullYear()
  const lastMonth = thisMonth === 0 ? 11 : thisMonth - 1
  const lastMonthYear = thisMonth === 0 ? thisYear - 1 : thisYear

  const thisMonthRevenue = allMemberships
    .filter(m => { const d = new Date(m.start_date); return d.getMonth() === thisMonth && d.getFullYear() === thisYear })
    .reduce((sum, m) => sum + (Number(m.amount_paid) || 0), 0)

  const lastMonthRevenue = allMemberships
    .filter(m => { const d = new Date(m.start_date); return d.getMonth() === lastMonth && d.getFullYear() === lastMonthYear })
    .reduce((sum, m) => sum + (Number(m.amount_paid) || 0), 0)

  const revenueChange = lastMonthRevenue === 0 ? null : Math.round(((thisMonthRevenue - lastMonthRevenue) / lastMonthRevenue) * 100)

  const monthlyRevenueTrend = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1)
    const m = d.getMonth()
    const y = d.getFullYear()
    const revenue = allMemberships
      .filter(mem => { const md = new Date(mem.start_date); return md.getMonth() === m && md.getFullYear() === y })
      .reduce((sum, mem) => sum + (Number(mem.amount_paid) || 0), 0)
    return { label: formatDate(d, country, 'month'), revenue, isCurrentMonth: i === 5 }
  })
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
    return { plan, revenue: mems.reduce((sum, m) => sum + (Number(m.amount_paid) || 0), 0), count: mems.length }
  }).filter(p => p.revenue > 0)

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
  // Furthest behind first (most workout days still to do this week)
  const behindClients = ptClients
    .map(c => ({ c, a: weekAdherence[c.id] }))
    .filter((x): x is { c: Client; a: Adherence } => !!x.a && x.a !== 'no-plan' && x.a.done < x.a.planned)
    .sort((x, y) => (y.a.planned - y.a.done) - (x.a.planned - x.a.done) || x.a.done / x.a.planned - y.a.done / y.a.planned)

  const filteredClients = (activeFilter === 'archived' ? archivedClients : clients)
    .filter(c => activeFilter === 'all' || activeFilter === 'archived' || membershipStatus(latestMembership(c.memberships)) === activeFilter)
    .filter(c => {
      if (!searchQuery.trim()) return true
      const q = searchQuery.toLowerCase()
      return c.full_name.toLowerCase().includes(q) || (c.phone || '').includes(q)
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
            <button
              onClick={() => setShowForm(!showForm)}
              className="bg-white hover:bg-gray-100 text-gray-900 text-xs sm:text-sm px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg transition font-medium">
              + Add Member
            </button>
          </div>
        </div>
      </div>

      {/* Settings Panel */}
      {showSettings && (
        <div className="mx-4 sm:mx-8 mt-4 mb-0 bg-gray-900 border border-gray-800 rounded-2xl p-5 space-y-5">
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
      )}

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
          <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Total Members</p>
          <p className="text-3xl font-bold text-white">{clients.length}</p>
          <p className="text-xs text-gray-600 mt-1">{clients.length}/{clientLimit} slots{ptLimit !== null ? ` · ${ptCount}/${ptLimit} PT` : ptCount > 0 ? ` · ${ptCount} PT` : ''}</p>
        </div>
        <div className="bg-gray-900 border border-amber-900/50 rounded-2xl p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Expiring Soon</p>
          <p className="text-3xl font-bold text-amber-400">{expiringSoonCount}</p>
          <p className="text-xs text-gray-600 mt-1">Within 7 days</p>
          {expiringSoonRevenue > 0 && (
            <p className="text-xs text-amber-700 mt-0.5">{formatMoney(expiringSoonRevenue, currency)} at risk</p>
          )}
        </div>
        <div className="bg-gray-900 border border-red-900/50 rounded-2xl p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Expired</p>
          <p className="text-3xl font-bold text-red-400">{statusCounts.expired}</p>
          <p className="text-xs text-gray-600 mt-1">Not renewed</p>
        </div>
        <div
          className={`bg-gray-900 border rounded-2xl p-4 cursor-pointer select-none transition ${showRevenueDrillIn ? 'border-green-700' : 'border-green-900/50'}`}
          onClick={() => setShowRevenueDrillIn(!showRevenueDrillIn)}>
          <div className="flex justify-between items-start">
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">This Month</p>
            <span className={`text-gray-500 text-sm transition-transform inline-block ${showRevenueDrillIn ? 'rotate-180' : ''}`}>▾</span>
          </div>
          <p className="text-3xl font-bold text-green-400">
            {formatMoneyCompact(thisMonthRevenue, currency)}
          </p>
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
      </div>

      {/* Revenue drill-in */}
      {showRevenueDrillIn && (
        <div className="px-4 sm:px-8 pt-3">
          <div className="bg-gray-900 border border-green-900/30 rounded-2xl p-5 space-y-5">

            {/* By plan type */}
            {thisMonthByPlan.length > 0 ? (
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wider mb-3">
                  {formatDate(now, country, 'monthLong')} — by plan
                </p>
                <div className="space-y-2.5">
                  {thisMonthByPlan.map(({ plan, revenue, count }) => {
                    const pct = thisMonthRevenue > 0 ? Math.round((revenue / thisMonthRevenue) * 100) : 0
                    return (
                      <div key={plan} className="flex items-center gap-3">
                        <p className="text-xs text-gray-400 w-20 flex-shrink-0">{plan}</p>
                        <div className="flex-1 bg-gray-800 rounded-full h-2">
                          <div className={`h-2 rounded-full ${planColors[plan]}`} style={{ width: `${pct}%` }} />
                        </div>
                        <p className="text-xs text-gray-400 text-right flex-shrink-0 w-28">
                          {formatMoney(revenue, currency)} <span className="text-gray-600">({count})</span>
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
                {monthlyRevenueTrend.map(({ label, revenue, isCurrentMonth }) => {
                  const pct = Math.round((revenue / maxMonthlyRevenue) * 100)
                  return (
                    <div key={label} className="flex items-center gap-3">
                      <p className={`text-xs w-8 flex-shrink-0 ${isCurrentMonth ? 'text-green-400 font-medium' : 'text-gray-500'}`}>{label}</p>
                      <div className="flex-1 bg-gray-800 rounded-full h-2">
                        <div className={`h-2 rounded-full ${isCurrentMonth ? 'bg-green-500' : 'bg-gray-600'}`} style={{ width: `${pct}%` }} />
                      </div>
                      <p className={`text-xs text-right flex-shrink-0 w-20 ${isCurrentMonth ? 'text-green-400 font-medium' : 'text-gray-500'}`}>
                        {revenue > 0
                          ? formatMoneyCompact(revenue, currency)
                          : '—'}
                      </p>
                    </div>
                  )
                })}
              </div>
            </div>

          </div>
        </div>
      )}

      {/* CoachBoard subscription status */}
      {trialInfo?.trial_end && (
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
      )}

      {/* Training this week — PT clients' plan adherence (Train module) */}
      {trainModule && ptCount > 0 && (
        <div className="px-4 sm:px-8 pt-3">
          <div className="bg-gray-900 border border-purple-900/50 rounded-2xl p-4">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-xs text-gray-500 uppercase tracking-wider">Training this week <span className="normal-case text-gray-600">(PT clients)</span></p>
              {fourWeeks && (
                <p className="text-xs text-gray-500 shrink-0">Last 4 weeks <span className={`font-semibold ${pctColor(pct(fourWeeks))}`}>{pct(fourWeeks)}%</span></p>
              )}
            </div>
            {!training ? (
              <div className="mt-3 h-10 rounded-lg bg-gray-800 animate-pulse" aria-label="Loading" />
            ) : weekTotals.planned === 0 ? (
              <p className="text-sm text-gray-400 mt-2">No PT client has a plan for this week yet.</p>
            ) : (
              <>
                <div className="flex items-baseline gap-2 mt-2">
                  <p className={`text-3xl font-bold ${pctColor(pct(weekTotals))}`}>{pct(weekTotals)}%</p>
                  <p className="text-sm text-gray-400">{weekTotals.done} of {weekTotals.planned} workout days done so far</p>
                </div>
                <div className="mt-2 h-2 rounded-full bg-gray-800 overflow-hidden" role="progressbar" aria-valuenow={pct(weekTotals) ?? 0} aria-valuemin={0} aria-valuemax={100}>
                  <div className="h-full bg-purple-500 rounded-full" style={{ width: `${pct(weekTotals)}%` }} />
                </div>
                <p className="text-xs text-gray-500 mt-2">{withPlanCount} of {ptCount} PT clients have a plan this week</p>
              </>
            )}
            {training && behindClients.length > 0 && (
              <div className="mt-3 border-t border-gray-800 pt-3">
                <p className="text-[11px] text-gray-500 uppercase tracking-wider mb-2">Most days left</p>
                <div className="flex flex-wrap gap-2">
                  {behindClients.slice(0, 6).map(({ c, a }) => (
                    <button key={c.id} type="button" data-nav onClick={() => openClient(c.id)}
                      className="text-xs px-2.5 py-1.5 rounded-lg border border-gray-700 bg-gray-800 text-gray-200 hover:border-gray-500">
                      {c.full_name.split(' ')[0]} <span className={pctColor(pct(a))}>{a.done}/{a.planned}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {training && noPlanClients.length > 0 && (
              <div className="mt-3 border-t border-gray-800 pt-3">
                <p className="text-[11px] text-gray-500 uppercase tracking-wider mb-2">No plan this week</p>
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
          </div>
        </div>
      )}

      {/* Plan breakdown */}
      <div className="px-4 sm:px-8 pt-3">
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wider mb-3">Plan Breakdown <span className="normal-case text-gray-600">(active + expiring)</span></p>
          {(() => {
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

            if (total === 0) return <p className="text-xs text-gray-600">No active members yet.</p>

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
          })()}
        </div>
      </div>

      <div className="px-4 sm:px-8 py-6">


        {/* Members Table */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">

          {/* Table toolbar */}
          <div className="px-4 sm:px-6 pt-4 pb-3 border-b border-gray-800 space-y-3">
            <div className="flex flex-wrap justify-between items-center gap-3">
              <h2 className="font-semibold text-white text-sm sm:text-base">Members — {companyName}</h2>
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
                <button onClick={() => setActiveFilter('archived')}
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
            <div className="relative">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"
                className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 15.803 7.5 7.5 0 0015.803 15.803z" />
              </svg>
              <input
                type="text"
                placeholder="Search by name or phone..."
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
              <span className="sr-only" role="status">Loading members…</span>
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
            <div className="px-6 py-12 text-center text-gray-500 text-sm">
              {activeFilter === 'archived'
                ? 'No archived members.'
                : clients.length === 0
                ? 'No members yet. Add your first one!'
                : searchQuery.trim()
                ? `No members match "${searchQuery}".`
                : `No ${activeFilter} members.`}
            </div>
          ) : (
            <div className="overflow-x-auto">{/* safety net: a long name never pushes Action off screen */}
            <table className="w-full">
              <thead>
                <tr className="text-xs text-gray-500 uppercase tracking-wider border-b border-gray-800">
                  <th className="px-4 sm:px-6 py-3 text-left font-medium">Member</th>
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

                  const handleAction = () => {
                    const phone = client.phone?.replace(/\D/g, '')
                    if (status === 'expiring' && phone?.length === 10) {
                      const msg = `Hi ${client.full_name.split(' ')[0]}, your membership at ${companyName} expires on ${m ? formatDate(m.end_date, country, 'dayMonth') : ''}. Renew now to keep going! 💪`
                      window.open(`https://wa.me/${dialCode(country ?? 'IN')}${phone}?text=${encodeURIComponent(msg)}`, '_blank')
                    } else if (status === 'expired' && phone?.length === 10) {
                      const msg = `Hi ${client.full_name.split(' ')[0]}, your membership at ${companyName} has expired. We'd love to have you back — reach out to renew! 💪`
                      window.open(`https://wa.me/${dialCode(country ?? 'IN')}${phone}?text=${encodeURIComponent(msg)}`, '_blank')
                    } else {
                      openClient(client.id)
                    }
                  }

                  return (
                    <tr key={client.id}
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
                              <p className="font-medium text-white text-sm">{client.full_name}</p>
                              {client.client_type === 'pt' && (
                                <span className="text-xs bg-purple-900/50 text-purple-400 border border-purple-800 px-1.5 py-0.5 rounded-full leading-none">PT</span>
                              )}
                              {/* Phones: status sits here (the Status column shows from tablet width up) */}
                              {activeFilter !== 'archived' && m && (
                                <span className={`sm:hidden inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full leading-none ${statusStyle.badge}`}>
                                  <span className={`w-1.5 h-1.5 rounded-full ${statusStyle.dot}`} />
                                  {status.charAt(0).toUpperCase() + status.slice(1)}
                                </span>
                              )}

                            </div>
                            {openingClientId === client.id ? (
                              <p className="text-xs text-orange-400 flex items-center gap-1.5" role="status">
                                <span className="inline-block w-3 h-3 rounded-full border-2 border-orange-400 border-t-transparent animate-spin" aria-hidden="true" />
                                Opening…
                              </p>
                            ) : (
                              <p className="text-xs text-gray-500">
                                {client.phone || client.email}
                                {/* PT plan progress this week, on the second line so the row stays phone-width */}
                                {trainModule && client.client_type === 'pt' && (() => {
                                  const a = weekAdherence[client.id]
                                  if (!a) return null
                                  if (a === 'no-plan') return <span className="whitespace-nowrap text-amber-400/80"> · no plan</span>
                                  return (
                                    <span className={`whitespace-nowrap font-semibold ${pctColor(pct(a))}`} title={`${a.done} of ${a.planned} workout days done this week`}>
                                      {' '}· {a.done}/{a.planned} this wk
                                    </span>
                                  )
                                })()}
                              </p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="hidden sm:table-cell px-4 py-4 text-sm text-gray-300">{m?.plan_type || '—'}</td>
                      <td className="hidden sm:table-cell px-4 py-4 text-sm font-medium text-white">
                        {m ? formatMoney(Number(m.amount_paid), currency) : '—'}
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
                        ) : <span className="text-gray-600 text-sm">—</span>}
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
                            className={`text-xs px-3 py-1.5 rounded-lg border transition font-medium ${actionStyle.cls}`}>
                            {actionStyle.label}
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
      {/* Add Member Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 bg-gray-950/95 overflow-y-auto">
          <div className="px-4 py-6 max-w-lg mx-auto">
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
              <div className="flex justify-between items-center mb-4">
                <h3 className="font-semibold text-white">New Member</h3>
                <button onClick={() => { setShowForm(false); setMessage('') }}
                  className="text-gray-500 hover:text-white transition text-xl leading-none">✕</button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <input type="text" placeholder="Full name"
                  value={newClient.full_name}
                  onChange={e => setNewClient({ ...newClient, full_name: e.target.value })}
                  className="col-span-2 bg-gray-800 text-white rounded-lg px-4 py-2.5 outline-none focus:ring-2 focus:ring-white border border-gray-700 text-sm placeholder-gray-600" />
                <input type="tel" placeholder={phonePlaceholder(country ?? 'IN')}
                  value={newClient.phone}
                  onChange={e => setNewClient({ ...newClient, phone: e.target.value })}
                  className="bg-gray-800 text-white rounded-lg px-4 py-2.5 outline-none focus:ring-2 focus:ring-white border border-gray-700 text-sm placeholder-gray-600" />
                <input type="email" placeholder={loginMethod(country ?? 'IN') === 'email' ? 'Email (required — used to log in)' : 'Email (optional)'}
                  value={newClient.email}
                  onChange={e => setNewClient({ ...newClient, email: e.target.value })}
                  className="bg-gray-800 text-white rounded-lg px-4 py-2.5 outline-none focus:ring-2 focus:ring-white border border-gray-700 text-sm placeholder-gray-600" />
                <div className="col-span-2 relative">
                  <input type={showNewClientPassword ? 'text' : 'password'} placeholder="Temporary password"
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
                </div>
                <p className="col-span-2 -mt-1 text-xs text-gray-500">
                  {newClient.email.trim()
                    ? <>Client logs in with: <span className="text-gray-300 font-medium">{newClient.email.trim()}</span></>
                    : loginMethod(country ?? 'IN') === 'email'
                      ? 'Client logs in with email — required for US clients. Phone is for contact only.'
                      : /^\d{10}$/.test(newClient.phone.trim())
                      ? <>Client logs in with: <span className="text-gray-300 font-medium">{newClient.phone.trim()}</span></>
                      : 'Client logs in with phone (10 digits) or email'}
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
                <input type="number" placeholder={currency ? `Amount paid (${currencySymbol(currency)})` : 'Amount paid'}
                  value={newClient.amount_paid}
                  onChange={e => setNewClient({ ...newClient, amount_paid: e.target.value })}
                  className="bg-gray-800 text-white rounded-lg px-4 py-2.5 outline-none focus:ring-2 focus:ring-white border border-gray-700 text-sm placeholder-gray-600" />
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
                <input type="text" placeholder="Trainer name (optional)"
                  value={newClient.trainer_name}
                  onChange={e => setNewClient({ ...newClient, trainer_name: e.target.value })}
                  className="bg-gray-800 text-white rounded-lg px-4 py-2.5 outline-none focus:ring-2 focus:ring-white border border-gray-700 text-sm placeholder-gray-600" />
                <textarea placeholder="Diet plan (optional)"
                  value={newClient.diet_plan}
                  onChange={e => setNewClient({ ...newClient, diet_plan: e.target.value })}
                  rows={2}
                  className="col-span-2 bg-gray-800 text-white rounded-lg px-4 py-2.5 outline-none focus:ring-2 focus:ring-white border border-gray-700 text-sm resize-none placeholder-gray-600" />
                <label className="col-span-2 flex items-center gap-3 cursor-pointer py-1">
                  <input type="checkbox"
                    checked={newClient.client_type === 'pt'}
                    onChange={e => setNewClient({ ...newClient, client_type: e.target.checked ? 'pt' : 'member' })}
                    className="w-4 h-4 rounded border-gray-600 bg-gray-800 accent-purple-500" />
                  <span className="text-sm text-gray-300">Personal Training (PT) member</span>
                </label>
              </div>
              {message && (
                <p className={`text-sm mt-3 ${message.includes('Error') ? 'text-red-400' : 'text-green-400'}`}>{message}</p>
              )}
              <div className="flex gap-2 mt-4">
                <button onClick={handleCreateClient} disabled={saving}
                  className="flex-1 bg-white hover:bg-gray-100 text-gray-900 font-semibold py-2.5 rounded-lg transition disabled:opacity-50 text-sm">
                  {saving ? 'Creating...' : 'Create Member'}
                </button>
                <button onClick={() => { setShowForm(false); setMessage('') }}
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

'use client'

import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import { type Country, COUNTRIES, normalizeCountry, currencyForCountry, formatDate, loginMethod, localDateIso, daysUntil } from '@/lib/locale'
import { AI_FEATURES, AI_COST_ALERT_INR, USD_TO_INR, inr } from '@/lib/ai-pricing'
import { type CompanyType, COMPANY_TYPES, companyType, isCoachCompany, companyTypeLabel } from '@/lib/company-type'
import { slugFromName, cleanSlugInput, slugProblem, slugTaken, slugTakenMessage, isSlugConflict, loginLinkPreview } from '@/lib/company-slug'
import { gymAddress } from '@/lib/tenant'
import { type BrandingKind, uploadBranding } from '@/lib/branding-upload'
import { bannerFor, taglineFor } from '@/lib/login-branding'
import { type UsagePlan, type UsageMembership, type Health, type CompanyUsage, companyUsage, actionsFor, sortActions, sortUsage } from '@/lib/platform-usage'

type Company = {
  id: string
  name: string
  email: string
  phone: string
  trial_start: string
  trial_end: string
  is_active: boolean
  created_at: string
  feedback_enabled: boolean
  ai_insights_enabled: boolean
  ai_diet_enabled?: boolean | null   // AI diet chart on/off (column added 25 Oct; absent before the SQL)
  ai_plans_enabled?: boolean | null  // AI weekly plans on/off (column added 26 Oct; absent before the SQL)
  session_notes_enabled: boolean
  client_limit: number
  is_trial: boolean
  notes: string | null
  client_module_enabled: boolean
  pt_limit: number | null
  partner_limit?: number | null   // owner-level partner logins allowed (column added 30 Oct, default 2)
  country: string | null
  is_test?: boolean | null   // test account: left out of the Dashboard (column added 25 Oct; absent before the SQL)
  company_type?: string | null   // 'gym' | 'coach' (individual coach). lib/company-type.ts; absent before the SQL
  slug?: string | null   // branded login link getcoachboard.com/login/<slug>, lib/company-slug.ts
  logo_url?: string | null     // gym logo / login banner (uploaded in the edit panel, lib/branding-upload.ts)
  banner_url?: string | null
  business_type?: string | null
}

type ContactRequest = {
  id: string
  created_at: string
  name: string
  email: string
  phone: string | null
  business: string | null
  message: string | null
  status: 'new' | 'contacted'
}

type Client = {
  id: string
  full_name: string
  email: string
  phone?: string | null
  company_id: string
  company_name?: string
  created_at: string
  archived_at: string | null
  client_type: string | null
}

type AdminMembership = UsageMembership & { start_date: string; end_date: string; plan_type?: string | null }

const HEALTH_STYLE: Record<Health, { dot: string; label: string; text: string }> = {
  active: { dot: 'bg-green-500', label: 'Active', text: 'text-green-400' },
  quiet: { dot: 'bg-amber-400', label: 'Quiet', text: 'text-amber-400' },
  dormant: { dot: 'bg-red-500', label: 'Dormant', text: 'text-red-400' },
}

// Latest membership's state for a client (same rule as the coach dashboard: expiring = 7 days or less)
function membershipState(ms: AdminMembership[]): 'active' | 'expiring' | 'expired' | 'none' {
  if (!ms.length) return 'none'
  const latest = [...ms].sort((a, b) => b.start_date.localeCompare(a.start_date) || (b.created_at || '').localeCompare(a.created_at || ''))[0]
  const left = daysUntil(latest.end_date)
  if (left == null) return 'none'
  return left < 0 ? 'expired' : left <= 7 ? 'expiring' : 'active'
}

type Partner = {
  id: string
  full_name: string
  phone: string
  email?: string | null
  archived_at?: string | null
}

export default function AdminPage() {
  const router = useRouter()
  const [companies, setCompanies] = useState<Company[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'dashboard' | 'companies' | 'clients' | 'requests'>('dashboard')
  // Dashboard + Clients tab data: all memberships (super admin can read them) and plans assigned per company
  const [memberships, setMemberships] = useState<AdminMembership[]>([])
  const [planRows, setPlanRows] = useState<UsagePlan[] | null>(null)
  const [planLoadError, setPlanLoadError] = useState('')
  // AI cost rows (this + last month) and estimated data stored, per gym — from /api/admin/costs
  const [costs, setCosts] = useState<{
    aiReady: boolean
    ai: { company_id: string | null; client_id?: string | null; feature: string; cost_usd: number; created_at: string }[]
    storage: Record<string, { rows: number; bytes: number }>
  } | null>(null)
  const [costsError, setCostsError] = useState('')
  // Clients tab: grouped by company
  const [clientSearch, setClientSearch] = useState('')
  const [clientFilter, setClientFilter] = useState<'all' | 'pt' | 'expired'>('all')
  const [showTestClients, setShowTestClients] = useState(false)
  // Dashboard: include test companies (for trying features, e.g. checking AI cost recording)
  const [dashIncludeTest, setDashIncludeTest] = useState(false)
  // Dashboard AI card: tap to see this month's AI cost by gym, then by member
  const [aiBreakdownOpen, setAiBreakdownOpen] = useState(false)
  const [aiOpenGym, setAiOpenGym] = useState<string | null>(null)
  const [collapsedCompanies, setCollapsedCompanies] = useState<Set<string>>(new Set())
  const [requests, setRequests] = useState<ContactRequest[]>([])
  const [showForm, setShowForm] = useState(false)
  const [newCompany, setNewCompany] = useState({ 
  name: '', 
  email: '', 
  adminPassword: '', 
  phone: '',
  country: 'IN' as Country,
  company_type: 'gym' as CompanyType,
  slug: '',
  slugEdited: false, // admin typed in the slug field: stop following the company name
  trial_start: localDateIso(),
  trial_end: localDateIso(7)
})
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  // Company row saved but its admin login failed: retry reuses this row instead of creating a duplicate
  const [pendingCompanyId, setPendingCompanyId] = useState<string | null>(null)
  // Inline slug errors ("already used") for the create form and the edit panel
  const [newSlugError, setNewSlugError] = useState('')
  const [editSlugError, setEditSlugError] = useState('')
  const [showPasswordForm, setShowPasswordForm] = useState(false)
  const [passwordData, setPasswordData] = useState({ newPassword: '', confirmPassword: '' })
  const [passwordMessage, setPasswordMessage] = useState('')
  const [editingCompany, setEditingCompany] = useState<Company | null>(null)
  const [savingCompany, setSavingCompany] = useState(false)
  const [editMessage, setEditMessage] = useState('')
  const [companyPartners, setCompanyPartners] = useState<Partner[]>([])
  // Active coach logins of the company being edited (for the note when switching it to Individual coach)
  const [companyCoachCount, setCompanyCoachCount] = useState(0)
  // India: name + phone (phone is the login and default password). US: name + email login + password, phone optional
  const [newPartner, setNewPartner] = useState({ full_name: '', phone: '', email: '', password: '' })
  const [savingPartner, setSavingPartner] = useState(false)
  const [partnerMessage, setPartnerMessage] = useState('')
  const [partnerLimitInput, setPartnerLimitInput] = useState('')
  const [savingPartnerLimit, setSavingPartnerLimit] = useState(false)

  // Big centred messages (same style as the coach screens)
  const [toast, setToast] = useState<{ text: string; kind: 'success' | 'error' } | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const showToast = (text: string, kind: 'success' | 'error' = 'success') => {
    if (toastTimer.current) clearTimeout(toastTimer.current)
    setToast({ text, kind })
    toastTimer.current = setTimeout(() => setToast(null), 3000)
  }

  // In-app confirm box (browser confirm() pop-ups don't show in many in-app browsers)
  const [confirmBox, setConfirmBox] = useState<{ title: string; body: string; action: string; onConfirm: () => void } | null>(null)

  // Limit boxes keep raw text so they can be cleared while typing
  const [limitInput, setLimitInput] = useState('')
  const [ptLimitInput, setPtLimitInput] = useState('')

  // Password reset for the company admin and partner logins
  const [companyAdmins, setCompanyAdmins] = useState<Partner[]>([])
  const [resetTarget, setResetTarget] = useState<{ id: string; name: string } | null>(null)
  const [resetPasswordValue, setResetPasswordValue] = useState('')
  const [resettingPassword, setResettingPassword] = useState(false)
  // Logo / banner upload in the edit panel
  const [brandingBusy, setBrandingBusy] = useState<BrandingKind | null>(null)
  const [brandingError, setBrandingError] = useState('')
  const logoInput = useRef<HTMLInputElement>(null)
  const bannerInput = useRef<HTMLInputElement>(null)


  useEffect(() => { fetchAll() }, [])

  useEffect(() => {
    setEditSlugError('')
    setBrandingError('')
    if (!editingCompany) { setCompanyPartners([]); setCompanyAdmins([]); setResetTarget(null); return }
    supabase.from('profiles').select('id, full_name, phone, email, archived_at')
      .eq('company_id', editingCompany.id).eq('role', 'partner')
      .then(({ data }) => setCompanyPartners(data || []))
    supabase.from('profiles').select('id, full_name, phone')
      .eq('company_id', editingCompany.id).eq('role', 'company_admin')
      .then(({ data }) => setCompanyAdmins(data || []))
    supabase.from('profiles').select('id', { count: 'exact', head: true })
      .eq('company_id', editingCompany.id).eq('role', 'coach').is('archived_at', null)
      .then(({ count }) => setCompanyCoachCount(count ?? 0))
    setLimitInput(editingCompany.client_limit ? String(editingCompany.client_limit) : '')
    setPtLimitInput(editingCompany.pt_limit != null ? String(editingCompany.pt_limit) : '')
    setPartnerLimitInput(String(editingCompany.partner_limit ?? 2))
    setResetTarget(null)
    setResetPasswordValue('')
  }, [editingCompany?.id])

  // From the Dashboard: open that company's edit panel on the Companies tab
  const openCompany = (id: string) => {
    const c = companies.find(x => x.id === id)
    if (!c) return
    setActiveTab('companies')
    setEditingCompany(c)
    setTimeout(() => document.getElementById(`company-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80)
  }

  const fetchAll = async () => {
    const { data: companiesData } = await supabase
      .from('companies')
      .select('*')
      .order('created_at', { ascending: false })
    setCompanies(companiesData || [])

    const { data: clientsData } = await supabase
      .from('profiles')
      .select('*, companies:company_id(name)')
      .eq('role', 'client')
      .order('created_at', { ascending: false })

    const mapped = (clientsData || []).map((c: any) => ({
      ...c,
      company_name: c.companies?.name || 'Unknown'
    }))
    setClients(mapped)

    // Memberships across all gyms (for usage + client status) and plans assigned (server route)
    const { data: membershipsData } = await supabase
      .from('memberships')
      .select('profile_id, company_id, created_at, start_date, end_date, plan_type')
    setMemberships((membershipsData as AdminMembership[]) || [])
    fetch('/api/admin/plan-activity')
      .then(async r => {
        const body = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`)
        setPlanRows(body.plans || [])
        setPlanLoadError('')
      })
      .catch(e => { setPlanRows([]); setPlanLoadError('Plans assigned could not be loaded (' + e.message + ')') })
    fetch('/api/admin/costs')
      .then(async r => {
        const body = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`)
        setCosts(body)
        setCostsError('')
      })
      .catch(e => setCostsError('Costs could not be loaded (' + e.message + ')'))

    // Landing page contact form submissions (super admin only, via RLS)
    const { data: requestsData } = await supabase
      .from('contact_requests')
      .select('*')
      .order('created_at', { ascending: false })
    setRequests((requestsData as ContactRequest[]) || [])

    setLoading(false)
  }

  const toggleRequestStatus = async (r: ContactRequest) => {
    const status = r.status === 'new' ? 'contacted' : 'new'
    const { error } = await supabase.from('contact_requests').update({ status }).eq('id', r.id)
    if (!error) setRequests(prev => prev.map(x => (x.id === r.id ? { ...x, status } : x)))
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

const handleToggleActive = async (companyId: string, currentStatus: boolean) => {
  await supabase
    .from('companies')
    .update({ is_active: !currentStatus })
    .eq('id', companyId)
  fetchAll()
}

  const handleCreateCompany = async () => {
    setSaving(true)
    setMessage('')

    // Admin Login field accepts an email or a 10-digit phone
    const loginInput = newCompany.email.trim()
    const resolvedEmail = loginInput
      ? (/^\d{10}$/.test(loginInput) ? `${loginInput}@getcoachboard.in` : loginInput)
      : /^\d{10}$/.test(newCompany.phone.trim())
        ? `${newCompany.phone.trim()}@getcoachboard.in`
        : ''

    // Check everything BEFORE saving, so a bad input can't leave a company without a login
    const problem = !newCompany.name.trim()
      ? 'Enter the company name'
      : !resolvedEmail
        ? 'Enter a valid email or 10-digit phone number for the admin login'
        : newCompany.adminPassword.length < 6
          ? 'Admin password must be at least 6 characters'
          : !newCompany.trial_start || !newCompany.trial_end
            ? 'Pick the trial start and end dates'
            : newCompany.trial_end < newCompany.trial_start
              ? 'Trial end must be on or after the start date'
              : slugProblem(newCompany.slug)
    if (problem) {
      setMessage('Error: ' + problem)
      setSaving(false)
      return
    }

    // Slug must be free (a retry of a half-created company may keep its own slug)
    try {
      if (await slugTaken(supabase, newCompany.slug, pendingCompanyId)) {
        setNewSlugError(slugTakenMessage(newCompany.slug))
        setSaving(false)
        return
      }
    } catch (e) {
      setMessage('Error: could not check the slug (' + (e as Error).message + ')')
      setSaving(false)
      return
    }

    // Trial dates were shown on the form but not saved before (#33), so new companies looked expired
    const companyFields = {
      name: newCompany.name, email: resolvedEmail, phone: newCompany.phone,
      country: newCompany.country, currency: currencyForCountry(newCompany.country),
      trial_start: newCompany.trial_start, trial_end: newCompany.trial_end, is_trial: true, is_active: true,
      slug: newCompany.slug,
      // Sent once the company_type column exists (or when it's an individual coach; the SQL must run first then)
      ...(newCompany.company_type === 'coach' || companies.some(c => 'company_type' in c) ? { company_type: newCompany.company_type } : {}),
    }
    const { data: company, error: companyError } = pendingCompanyId
      ? await supabase.from('companies').update(companyFields).eq('id', pendingCompanyId).select().single()
      : await supabase.from('companies').insert(companyFields).select().single()

    if (companyError) {
      if (isSlugConflict(companyError)) setNewSlugError(slugTakenMessage(newCompany.slug))
      else setMessage('Error: ' + companyError.message)
      setSaving(false)
      return
    }

    const response = await fetch('/api/create-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: resolvedEmail,
        password: newCompany.adminPassword,
        full_name: newCompany.name + ' Admin',
        company_id: company.id,
        role: 'company_admin'
      })
    })

    const result = await response.json()
    if (result.error) {
      setPendingCompanyId(company.id)
      setMessage('Error: Company saved, but the admin login could not be created (' + result.error + '). Fix it and tap Create again — it will reuse the same company, not make a new one.')
      setSaving(false)
      fetchAll()
      return
    }

    setPendingCompanyId(null)
    setMessage('Company created successfully!')
    showToast('Company created ✓')
    setNewCompany({ 
  name: '', 
  email: '', 
  adminPassword: '', 
  phone: '',
  country: 'IN' as Country,
  company_type: 'gym' as CompanyType,
  slug: '',
  slugEdited: false, // admin typed in the slug field: stop following the company name
  trial_start: localDateIso(),
  trial_end: localDateIso(7)
})
    setShowForm(false)
    setSaving(false)
    fetchAll()
  }

  const handleDeleteCompany = (companyId: string, companyName: string) => {
    setConfirmBox({
      title: `Delete "${companyName}"?`,
      body: 'This deletes the company, all its members and their logins. It cannot be undone.',
      action: 'Delete company',
      onConfirm: async () => {
        const response = await fetch('/api/delete-company', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ company_id: companyId })
        })
        const result = await response.json().catch(() => ({}))
        if (!response.ok || result.error) {
          showToast('Could not delete: ' + (result.error || 'server error'), 'error')
        } else {
          showToast(`${companyName} deleted`)
        }
        fetchAll()
      }
    })
  }

  const handleSaveCompany = async () => {
    if (!editingCompany) return
    const clientLimit = parseInt(limitInput, 10)
    if (!Number.isInteger(clientLimit) || clientLimit < 1) {
      showToast('Client limit must be a number, 1 or more', 'error')
      return
    }
    const ptLimit = ptLimitInput.trim() === '' ? null : parseInt(ptLimitInput, 10)
    if (ptLimit !== null && (!Number.isInteger(ptLimit) || ptLimit < 0)) {
      showToast('PT limit must be a number, or leave it empty for no limit', 'error')
      return
    }
    // Slug: may stay empty only if it was never set (companies made before slugs); otherwise same rules as create
    const slug = editingCompany.slug || ''
    const savedSlug = companies.find(c => c.id === editingCompany.id)?.slug || ''
    if (slug || savedSlug) {
      const problem = slugProblem(slug)
      if (problem) { setEditSlugError(problem); return }
      if (slug !== savedSlug) {
        try {
          if (await slugTaken(supabase, slug, editingCompany.id)) { setEditSlugError(slugTakenMessage(slug)); return }
        } catch (e) {
          showToast('Could not check the slug: ' + (e as Error).message, 'error')
          return
        }
      }
    }
    setSavingCompany(true)
    const { error } = await supabase
      .from('companies')
      .update({
        name: editingCompany.name,
        email: editingCompany.email,
        phone: editingCompany.phone,
        trial_start: editingCompany.trial_start || null,
        trial_end: editingCompany.trial_end || null,
        is_active: editingCompany.is_active,
        feedback_enabled: editingCompany.feedback_enabled,
        ai_insights_enabled: editingCompany.ai_insights_enabled,
        // Only once the ai_diet_enabled column exists (its value then comes back with the company)
        ...('ai_diet_enabled' in editingCompany ? { ai_diet_enabled: editingCompany.ai_diet_enabled !== false } : {}),
        ...('ai_plans_enabled' in editingCompany ? { ai_plans_enabled: editingCompany.ai_plans_enabled !== false } : {}),
        session_notes_enabled: editingCompany.session_notes_enabled,
        client_module_enabled: editingCompany.client_module_enabled,
        pt_limit: ptLimit,
        client_limit: clientLimit,
        is_trial: editingCompany.is_trial,
        notes: editingCompany.notes || null,
        country: normalizeCountry(editingCompany.country),
        currency: currencyForCountry(normalizeCountry(editingCompany.country)),
        // Only once the is_test column exists (its value then comes back with the company)
        ...('is_test' in editingCompany ? { is_test: !!editingCompany.is_test } : {}),
        // Only once the company_type column exists
        ...('company_type' in editingCompany ? { company_type: companyType(editingCompany) } : {}),
        slug: slug || null,
      })
      .eq('id', editingCompany.id)
    setSavingCompany(false)
    if (isSlugConflict(error)) {
      setEditSlugError(slugTakenMessage(slug))
      return
    }
    if (error) {
      showToast('Could not save: ' + error.message, 'error')
      return
    }
    setEditMessage('Saved! ✓')
    showToast('Company saved ✓')
    setTimeout(() => {
      setEditMessage('')
      setEditingCompany(null)
    }, 1500)
    fetchAll()
  }

  // Logo / banner: saved straight away (not with the panel's Save), so an upload is never lost
  const saveBranding = async (kind: BrandingKind, url: string | null) => {
    if (!editingCompany) return
    const id = editingCompany.id
    const column = kind === 'logo' ? 'logo_url' : 'banner_url'
    const { data, error } = await supabase.from('companies').update({ [column]: url }).eq('id', id).select('id')
    if (error || !data?.length) throw new Error(error?.message || 'Could not save it on the company')
    setEditingCompany(c => (c && c.id === id ? { ...c, [column]: url } : c))
    setCompanies(cs => cs.map(c => (c.id === id ? { ...c, [column]: url } : c)))
  }

  const handleBrandingFile = async (kind: BrandingKind, file: File | undefined) => {
    if (!editingCompany || !file) return
    setBrandingBusy(kind)
    setBrandingError('')
    try {
      const url = await uploadBranding(supabase, editingCompany.id, kind, file)
      await saveBranding(kind, url)
      showToast(kind === 'logo' ? 'Logo updated ✓' : 'Banner updated ✓')
    } catch (e) {
      setBrandingError((e as Error).message)
    } finally {
      setBrandingBusy(null)
    }
  }

  // Clears the link on the company; the file stays in storage
  const handleBrandingRemove = async (kind: BrandingKind) => {
    setBrandingBusy(kind)
    setBrandingError('')
    try {
      await saveBranding(kind, null)
      showToast(kind === 'logo' ? 'Logo removed' : 'Banner removed: the stock photo shows')
    } catch (e) {
      setBrandingError((e as Error).message)
    } finally {
      setBrandingBusy(null)
    }
  }

  const handleRemoveTrial = async () => {
    if (!editingCompany) return
    setEditingCompany({ ...editingCompany, trial_start: '', trial_end: '', is_trial: false })
  }

  // Owner-level partner logins in use vs allowed (companies.partner_limit, default 2)
  const activePartnerCount = companyPartners.filter(p => !p.archived_at).length
  const partnerLimit = editingCompany?.partner_limit ?? 2
  const partnerLimitReached = activePartnerCount >= partnerLimit

  const handleAddPartner = async () => {
    if (!editingCompany) return
    const name = newPartner.full_name.trim()
    const phone = newPartner.phone.trim()
    // Login rule follows the company's country (lib/locale.ts), same as clients
    const method = loginMethod(normalizeCountry(editingCompany.country))
    let email = '', password = ''
    if (!name) { setPartnerMessage('Enter the partner\'s name'); return }
    if (method === 'email') {
      email = newPartner.email.trim().toLowerCase()
      password = newPartner.password
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setPartnerMessage('Enter a valid email: US partners log in with email'); return }
      if (password.length < 6) { setPartnerMessage('Password must be at least 6 characters'); return }
    } else {
      if (!/^\d{10}$/.test(phone)) { setPartnerMessage('Enter a valid 10-digit phone number'); return }
      email = `${phone}@getcoachboard.in`
      password = phone
    }
    setSavingPartner(true)
    const response = await fetch('/api/create-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        password,
        full_name: name,
        company_id: editingCompany.id,
        role: 'partner',
        phone: phone || null
      })
    })
    const result = await response.json()
    if (result.error) { setPartnerMessage('Error: ' + result.error); setSavingPartner(false); return }
    setNewPartner({ full_name: '', phone: '', email: '', password: '' })
    setPartnerMessage(method === 'email'
      ? `Partner added! They log in with ${email} and the password you set.`
      : 'Partner added! Default password = phone number.')
    showToast('Partner added ✓')
    const { data } = await supabase.from('profiles').select('id, full_name, phone, email, archived_at')
      .eq('company_id', editingCompany.id).eq('role', 'partner')
    setCompanyPartners(data || [])
    setSavingPartner(false)
    setTimeout(() => setPartnerMessage(''), 3000)
  }

  // Partner limit saves on its own (Add partner unlocks straight away); create-user enforces it too
  const handleSavePartnerLimit = async () => {
    if (!editingCompany) return
    const limit = parseInt(partnerLimitInput, 10)
    if (!Number.isInteger(limit) || limit < 0 || limit > 20) {
      showToast('Partner limit must be a number from 0 to 20', 'error')
      return
    }
    setSavingPartnerLimit(true)
    const { data, error } = await supabase.from('companies')
      .update({ partner_limit: limit }).eq('id', editingCompany.id).select('id')
    setSavingPartnerLimit(false)
    if (error || !data?.length) { showToast('Could not save: ' + (error?.message ?? 'not allowed by database rules'), 'error'); return }
    setEditingCompany({ ...editingCompany, partner_limit: limit })
    setCompanies(prev => prev.map(c => c.id === editingCompany.id ? { ...c, partner_limit: limit } : c))
    showToast(`Partner limit set to ${limit} ✓`)
  }

  const handleRemovePartner = (partnerId: string, partnerName: string) => {
    setConfirmBox({
      title: `Remove partner "${partnerName}"?`,
      body: 'They will no longer be able to log in to this company.',
      action: 'Remove partner',
      onConfirm: async () => {
        // .select() so a delete blocked by database rules (0 rows) isn't reported as done
        const { data, error } = await supabase.from('profiles').delete().eq('id', partnerId).select('id')
        if (error || !data?.length) { showToast(error ? 'Could not remove: ' + error.message : 'Could not remove: not allowed by database rules', 'error'); return }
        setCompanyPartners(prev => prev.filter(p => p.id !== partnerId))
        showToast(`${partnerName} removed`)
      }
    })
  }

  const handleResetLoginPassword = async () => {
    if (!resetTarget) return
    if (resetPasswordValue.length < 6) { showToast('Password must be at least 6 characters', 'error'); return }
    setResettingPassword(true)
    const response = await fetch('/api/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: resetTarget.id, newPassword: resetPasswordValue })
    })
    const result = await response.json().catch(() => ({}))
    setResettingPassword(false)
    if (!response.ok || result.error) {
      showToast('Could not reset: ' + (result.error || 'server error'), 'error')
      return
    }
    showToast(`Password reset for ${resetTarget.name} ✓`)
    setResetTarget(null)
    setResetPasswordValue('')
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
      {/* Header */}
      <div className="bg-gray-900 border-b border-gray-800 px-6 py-4 flex justify-between items-center">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-orange-500 rounded-lg flex items-center justify-center">
            <span className="text-white text-sm font-bold">C</span>
          </div>
          <div>
            <h1 className="text-base font-bold text-white">CoachBoard</h1>
            <p className="text-xs text-gray-500">Super Admin</p>
          </div>
        </div>
<div className="flex gap-2">
  <button
    onClick={() => setShowPasswordForm(!showPasswordForm)}
    className="text-xs text-gray-500 hover:text-white border border-gray-700 hover:border-gray-500 px-3 py-1.5 rounded-lg transition">
    Settings
  </button>
  <button data-nav onClick={handleLogout}
    className="text-xs text-gray-500 hover:text-white border border-gray-700 hover:border-gray-500 px-3 py-1.5 rounded-lg transition">
    Logout
  </button>
</div>
      </div>

{showPasswordForm && (
  <div className="bg-gray-900 border-b border-gray-800 px-6 py-4">
    <div className="max-w-4xl mx-auto space-y-3">
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

      <div className="max-w-4xl mx-auto px-6 py-6">
        {/* Stats */}
        <div className="grid grid-cols-2 gap-4 mb-8">
          <div className="bg-gray-900 rounded-2xl p-5 border border-gray-800">
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Total Companies</p>
            <p className="text-4xl font-bold text-orange-500">{companies.length}</p>
          </div>
          <div className="bg-gray-900 rounded-2xl p-5 border border-gray-800">
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Total Clients</p>
            <p className="text-4xl font-bold text-orange-500">{clients.length}</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex flex-wrap gap-1 bg-gray-900 p-1 rounded-xl border border-gray-800 mb-6 w-fit max-w-full">
          {(['dashboard', 'companies', 'clients', 'requests'] as const).map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={`px-5 py-2 text-sm font-medium rounded-lg transition ${activeTab === tab
                ? 'bg-orange-500 text-white'
                : 'text-gray-400 hover:text-white'}`}>
              {tab === 'dashboard'
                ? 'Dashboard'
                : tab === 'companies'
                ? `Companies (${companies.length})`
                : tab === 'clients'
                  ? `Clients (${clients.length})`
                  : `Requests${requests.filter(r => r.status === 'new').length ? ` (${requests.filter(r => r.status === 'new').length} new)` : ''}`}
            </button>
          ))}
        </div>

        {/* DASHBOARD TAB — real (non-test) companies: are they using it, and what to do next */}
        {activeTab === 'dashboard' && (() => {
          if (loading) return <p className="text-gray-500 text-sm">Loading...</p>
          const real = companies.filter(c => dashIncludeTest || !c.is_test)
          const usage: CompanyUsage[] = real.map(c => companyUsage(c, clients, memberships, planRows || []))
          // AI cost this calendar month and last, per gym (USD; shown in ₹ at a fixed rate)
          const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()
          const aiThis: Record<string, { usd: number; calls: number }> = {}
          const aiByFeature: Record<string, { usd: number; calls: number }> = {}
          // gym → member ('' = not recorded) → cost, uses, features
          const aiByGymMember: Record<string, Record<string, { usd: number; calls: number; features: Record<string, number> }>> = {}
          let aiLastUsd = 0
          for (const r of costs?.ai || []) {
            if (!r.company_id || (!dashIncludeTest && companies.find(c => c.id === r.company_id)?.is_test)) continue
            if (r.created_at >= monthStart) {
              const a = (aiThis[r.company_id] ??= { usd: 0, calls: 0 }); a.usd += Number(r.cost_usd); a.calls += 1
              const f = (aiByFeature[r.feature] ??= { usd: 0, calls: 0 }); f.usd += Number(r.cost_usd); f.calls += 1
              const gm = (aiByGymMember[r.company_id] ??= {})
              const m = (gm[r.client_id || ''] ??= { usd: 0, calls: 0, features: {} })
              m.usd += Number(r.cost_usd); m.calls += 1; m.features[r.feature] = (m.features[r.feature] || 0) + 1
            } else aiLastUsd += Number(r.cost_usd)
          }
          const aiTotal = Object.values(aiThis).reduce((t, a) => ({ usd: t.usd + a.usd, calls: t.calls + a.calls }), { usd: 0, calls: 0 })
          const storageBytes = real.reduce((n, c) => n + (costs?.storage[c.id]?.bytes || 0), 0)
          const mb = (b: number) => b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`
          const actions = sortActions([
            ...usage.flatMap(actionsFor),
            // AI cost high: no price per gym is stored yet, so a fixed ₹ line (lib/ai-pricing.ts)
            ...usage.filter(u => u.company.is_active && (aiThis[u.company.id]?.usd || 0) * USD_TO_INR > AI_COST_ALERT_INR).map(u => ({
              kind: 'ai-cost' as const, usage: u, tone: 'warn' as const, action: 'Review AI use',
              reason: `AI this month ${inr(aiThis[u.company.id].usd)} · ${aiThis[u.company.id].calls} uses (over ₹${AI_COST_ALERT_INR})`,
            })),
          ])
          const live = usage.filter(u => u.company.is_active)
          const paying = live.filter(u => u.status === 'paid' && (u.daysLeft == null || u.daysLeft > 0)).length
          const trials = live.filter(u => u.status === 'trial' && (u.daysLeft == null || u.daysLeft > 0)).length
          const members = usage.reduce((n, u) => n + u.members, 0)
          const testCount = companies.filter(c => c.is_test).length
          const toneCls = { good: 'border-green-800 bg-green-950/30', warn: 'border-amber-800 bg-amber-950/20', bad: 'border-red-900 bg-red-950/30' }
          const actionCls = { good: 'bg-green-600 text-white', warn: 'bg-amber-500 text-gray-950', bad: 'bg-red-600 text-white' }
          return (
            <div className="space-y-6">
              {testCount > 0 && (
                <label className={`flex items-center gap-2 text-xs w-fit px-3 py-1.5 rounded-lg border ${dashIncludeTest ? 'border-amber-700 bg-amber-950/40 text-amber-200' : 'border-gray-800 text-gray-400'}`}>
                  <input type="checkbox" checked={dashIncludeTest} onChange={e => setDashIncludeTest(e.target.checked)} className="accent-orange-500" />
                  Include test accounts ({testCount}){dashIncludeTest ? ': numbers below include them' : ''}
                </label>
              )}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: 'Paying gyms', value: paying, cls: 'text-green-400' },
                  { label: 'On trial', value: trials, cls: 'text-blue-400' },
                  { label: 'Members', value: members, cls: 'text-white' },
                  { label: 'Actions waiting', value: actions.length, cls: actions.length ? 'text-orange-400' : 'text-gray-500' },
                ].map(k => (
                  <div key={k.label} className="bg-gray-900 rounded-2xl p-4 border border-gray-800">
                    <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">{k.label}</p>
                    <p className={`text-3xl font-bold ${k.cls}`}>{k.value}</p>
                  </div>
                ))}
              </div>

              <div>
                <h2 className="text-sm font-medium text-gray-400 uppercase tracking-wider mb-3">Actions</h2>
                {actions.length === 0 ? (
                  <div className="bg-gray-900 rounded-2xl p-6 text-center text-sm text-gray-500 border border-gray-800">Nothing needs you right now.</div>
                ) : (
                  <div className="space-y-2">
                    {actions.map((a, i) => (
                      <button key={i} type="button" onClick={() => openCompany(a.usage.company.id)}
                        className={`w-full text-left rounded-2xl border px-4 py-3 flex items-center gap-3 ${toneCls[a.tone]}`}>
                        <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${HEALTH_STYLE[a.usage.health].dot}`} title={HEALTH_STYLE[a.usage.health].label} />
                        <span className="flex-1 min-w-0">
                          <span className="block text-sm font-medium text-white truncate">{a.usage.company.name}{a.usage.company.is_test && <span className="ml-1.5 text-[9px] font-semibold tracking-wider text-gray-300 bg-gray-700 px-1 py-0.5 rounded align-middle">TEST</span>}</span>
                          <span className="block text-xs text-gray-400">{a.reason}</span>
                        </span>
                        <span className={`shrink-0 text-xs font-semibold px-2.5 py-1.5 rounded-lg ${actionCls[a.tone]}`}>{a.action}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <h2 className="text-sm font-medium text-gray-400 uppercase tracking-wider mb-3">Running costs this month</h2>
                {!costs ? (
                  <div className="bg-gray-900 rounded-2xl p-4 border border-gray-800 text-sm text-gray-500">{costsError || 'Loading costs…'}</div>
                ) : (
                  <div className="grid sm:grid-cols-2 gap-3">
                    <div className={`bg-gray-900 rounded-2xl border border-gray-800 ${aiBreakdownOpen ? 'sm:col-span-2' : ''}`}>
                      <button type="button" aria-expanded={aiBreakdownOpen} disabled={!costs.aiReady || aiTotal.calls === 0}
                        onClick={() => setAiBreakdownOpen(o => !o)}
                        className="w-full text-left p-4 rounded-2xl">
                        <span className="flex items-center justify-between">
                          <span className="text-xs text-gray-500 uppercase tracking-wider">AI</span>
                          {costs.aiReady && aiTotal.calls > 0 && <span className="text-xs text-orange-400">{aiBreakdownOpen ? 'Hide ▴' : 'By gym and member ▾'}</span>}
                        </span>
                        {!costs.aiReady ? (
                          <span className="block text-sm text-amber-300 mt-1">Not recording yet: run the SQL in db/2026-10-25-ai-usage.md</span>
                        ) : (
                          <>
                            <span className="block mt-1"><span className="text-2xl font-bold text-white">{inr(aiTotal.usd)}</span> <span className="text-xs text-gray-500">{aiTotal.calls} uses · ${aiTotal.usd.toFixed(2)} · last month {inr(aiLastUsd)}</span></span>
                            <span className="block text-xs text-gray-500 mt-1">
                              {Object.entries(aiByFeature).length === 0 ? 'No AI use yet this month.' : Object.entries(aiByFeature)
                                .sort((a, b) => b[1].usd - a[1].usd)
                                .map(([f, v]) => `${AI_FEATURES[f] || f} ${inr(v.usd)} (${v.calls})`).join(' · ')}
                            </span>
                          </>
                        )}
                      </button>
                      {aiBreakdownOpen && (
                        <div className="border-t border-gray-800 divide-y divide-gray-800">
                          {Object.entries(aiThis).sort((a, b) => b[1].usd - a[1].usd).map(([gymId, g]) => {
                            const gym = companies.find(c => c.id === gymId)
                            const open = aiOpenGym === gymId
                            const members = Object.entries(aiByGymMember[gymId] || {}).sort((a, b) => b[1].usd - a[1].usd)
                            return (
                              <div key={gymId}>
                                <button type="button" aria-expanded={open} onClick={() => setAiOpenGym(open ? null : gymId)}
                                  className="w-full text-left px-4 py-2.5 flex items-center gap-3 hover:bg-gray-800/50">
                                  <span className="text-gray-500 text-xs w-3" aria-hidden="true">{open ? '▾' : '▸'}</span>
                                  <span className="flex-1 min-w-0 text-sm text-white truncate">
                                    {gym?.name || 'Unknown gym'}
                                    {gym?.is_test && <span className="ml-1.5 text-[9px] font-semibold tracking-wider text-gray-300 bg-gray-700 px-1 py-0.5 rounded align-middle">TEST</span>}
                                  </span>
                                  <span className="text-sm font-semibold text-white shrink-0">{inr(g.usd)}</span>
                                  <span className="text-xs text-gray-500 shrink-0 w-14 text-right">{g.calls} use{g.calls === 1 ? '' : 's'}</span>
                                </button>
                                {open && (
                                  <div className="pb-2">
                                    {members.map(([memberId, m]) => {
                                      const who = memberId ? clients.find(c => c.id === memberId)?.full_name || 'Removed member' : 'Member not recorded'
                                      return (
                                        <div key={memberId || 'none'} className="pl-10 pr-4 py-1.5 flex items-center gap-3">
                                          <span className="flex-1 min-w-0">
                                            <span className={`block text-xs truncate ${memberId ? 'text-gray-200' : 'text-gray-500 italic'}`}>{who}</span>
                                            <span className="block text-[11px] text-gray-500">
                                              {Object.entries(m.features).map(([f, n]) => `${AI_FEATURES[f] || f} ${n}`).join(' · ')}
                                            </span>
                                          </span>
                                          <span className="text-xs text-white shrink-0">{inr(m.usd)}</span>
                                          <span className="text-[11px] text-gray-500 shrink-0 w-14 text-right">{m.calls} use{m.calls === 1 ? '' : 's'}</span>
                                        </div>
                                      )
                                    })}
                                    {members.some(([id]) => !id) && (
                                      <p className="pl-10 pr-4 pt-1 text-[11px] text-gray-500">&quot;Member not recorded&quot; = AI use before the member column was added (db/2026-10-26-ai-usage-client.md).</p>
                                    )}
                                  </div>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                    <div className="bg-gray-900 rounded-2xl p-4 border border-gray-800">
                      <p className="text-xs text-gray-500 uppercase tracking-wider">Data stored (estimate)</p>
                      <p className="mt-1"><span className="text-2xl font-bold text-white">≈ {mb(storageBytes)}</span> <span className="text-xs text-gray-500">of 8 GB included in the Supabase plan</span></p>
                      <p className="text-xs text-gray-500 mt-1">₹0 extra per gym until the 8 GB is used. No files are stored yet (logos are links).</p>
                    </div>
                  </div>
                )}
              </div>

              <div>
                <div className="flex items-baseline justify-between gap-3 mb-3">
                  <h2 className="text-sm font-medium text-gray-400 uppercase tracking-wider">Companies</h2>
                  <p className="text-[11px] text-gray-500">
                    <span className="text-green-400">●</span> work in 7 days · <span className="text-amber-400">●</span> 8–15 days · <span className="text-red-400">●</span> over 15 days
                  </p>
                </div>
                {usage.length === 0 ? (
                  <div className="bg-gray-900 rounded-2xl p-6 text-center text-sm text-gray-500 border border-gray-800">No real companies yet.</div>
                ) : (
                  <div className="bg-gray-900 rounded-2xl border border-gray-800 divide-y divide-gray-800">
                    {sortUsage(usage).map(u => {
                      const h = HEALTH_STYLE[u.health]
                      const plan = !u.company.is_active ? 'Inactive'
                        : u.daysLeft == null ? (u.status === 'trial' ? 'Trial' : 'Paid')
                        : u.daysLeft <= 0 ? `${u.status === 'trial' ? 'Trial' : 'Paid'} · ended`
                        : `${u.status === 'trial' ? 'Trial' : 'Paid'} · ${u.daysLeft}d left`
                      return (
                        <button key={u.company.id} type="button" onClick={() => openCompany(u.company.id)}
                          className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-gray-800/50">
                          <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${h.dot}`} />
                          <span className="flex-1 min-w-0">
                            <span className="flex items-baseline justify-between gap-2">
                              <span className="text-sm font-medium text-white truncate">{u.company.name}{u.company.is_test && <span className="ml-1.5 text-[9px] font-semibold tracking-wider text-gray-300 bg-gray-700 px-1 py-0.5 rounded align-middle">TEST</span>}</span>
                              <span className={`text-[11px] shrink-0 ${u.daysLeft != null && u.daysLeft <= 0 ? 'text-red-400' : u.status === 'trial' ? 'text-blue-300' : 'text-gray-400'}`}>{plan}</span>
                            </span>
                            <span className="block text-xs text-gray-500 mt-0.5">
                              {u.members}{u.company.client_limit ? ` / ${u.company.client_limit}` : ''} members{u.pt ? ` · ${u.pt} PT` : ''}
                              <span className="text-gray-600"> · 30d: </span>
                              {u.membersAdded30} added · {u.renewals30} renewed · {planRows ? `${u.plans30} plans` : '… plans'}
                              <span className={h.text}> · {u.lastWorkDays == null ? 'no activity yet' : u.lastWorkDays === 0 ? 'active today' : `last ${u.lastWorkDays}d ago`}</span>
                            </span>
                            {costs && (
                              <span className="block text-[11px] text-gray-500 mt-0.5">
                                {costs.aiReady ? <>AI {inr(aiThis[u.company.id]?.usd || 0)} this month ({aiThis[u.company.id]?.calls || 0})</> : 'AI not recording yet'}
                                {' · '}data ≈ {mb(costs.storage[u.company.id]?.bytes || 0)}
                              </span>
                            )}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                )}
                <p className="text-[11px] text-gray-500 mt-2">
                  Activity = members added, memberships recorded and plans assigned by the gym&apos;s staff.
                  {testCount > 0 ? (dashIncludeTest ? ` Including ${testCount} test ${testCount === 1 ? 'company' : 'companies'}.` : ` ${testCount} test ${testCount === 1 ? 'company is' : 'companies are'} left out.`) : ' Mark test companies in their edit panel to leave them out.'}
                  {planLoadError ? ` ${planLoadError}.` : ''}
                </p>
              </div>
            </div>
          )
        })()}

        {/* COMPANIES TAB */}
        {activeTab === 'companies' && (
          <div>
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-sm font-medium text-gray-400 uppercase tracking-wider">Companies</h2>
              <button onClick={() => setShowForm(!showForm)}
                className="bg-orange-500 hover:bg-orange-400 text-white text-sm px-4 py-2 rounded-xl transition font-medium">
                + Add Company
              </button>
            </div>

            {showForm && (
              <div className="bg-gray-900 rounded-2xl p-6 mb-6 space-y-4 border border-gray-800">
                <h3 className="font-semibold text-white">New Company</h3>
                <input type="text" placeholder="Company name"
                  value={newCompany.name}
                  onChange={(e) => {
                    setNewCompany({ ...newCompany, name: e.target.value, ...(newCompany.slugEdited ? {} : { slug: slugFromName(e.target.value) }) })
                    if (!newCompany.slugEdited) setNewSlugError('')
                  }}
                  className="w-full bg-gray-800 text-white rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm" />
                <div>
                  <label className="text-xs text-gray-500 mb-1.5 block uppercase tracking-wider">Slug <span className="normal-case text-gray-600">— short name in the login link, filled from the company name</span></label>
                  <input type="text" placeholder="e.g. syedfitness" autoCapitalize="none" autoCorrect="off" spellCheck={false}
                    value={newCompany.slug}
                    onChange={(e) => {
                      const slug = cleanSlugInput(e.target.value)
                      // Cleared: go back to following the company name
                      setNewCompany({ ...newCompany, slug, slugEdited: slug !== '' })
                      setNewSlugError('')
                    }}
                    className={`w-full bg-gray-800 text-white rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-orange-500 border text-sm ${newSlugError || (newCompany.slug && slugProblem(newCompany.slug)) ? 'border-red-500' : 'border-gray-700'}`} />
                  <p className="text-xs text-gray-500 mt-1.5">Gym address: <span className="text-gray-300">{gymAddress(newCompany.slug)}</span> · also {loginLinkPreview(newCompany.slug)}</p>
                  {(newSlugError || (newCompany.slug && slugProblem(newCompany.slug))) && (
                    <p className="text-xs text-red-400 mt-1">{newSlugError || slugProblem(newCompany.slug)}</p>
                  )}
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1.5 block uppercase tracking-wider">Company type <span className="normal-case text-gray-600">— an individual coach has no coach or partner logins</span></label>
                  <select value={newCompany.company_type} required
                    onChange={(e) => setNewCompany({ ...newCompany, company_type: companyType({ company_type: e.target.value }) })}
                    className="w-full bg-gray-800 text-white rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm">
                    {COMPANY_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1.5 block uppercase tracking-wider">Country <span className="normal-case text-gray-600">— sets currency, date format and how clients log in</span></label>
                  <select value={newCompany.country}
                    onChange={(e) => setNewCompany({ ...newCompany, country: normalizeCountry(e.target.value) })}
                    className="w-full bg-gray-800 text-white rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm">
                    {COUNTRIES.map(c => <option key={c.code} value={c.code}>{c.label} ({c.currency})</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1.5 block uppercase tracking-wider">Admin Login <span className="normal-case text-gray-600">— email or 10-digit phone, this becomes the login credential</span></label>
                  <input type="text" placeholder="Email or phone number"
                    value={newCompany.email}
                    onChange={(e) => setNewCompany({ ...newCompany, email: e.target.value })}
                    className="w-full bg-gray-800 text-white rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1.5 block uppercase tracking-wider">Contact Phone <span className="normal-case text-gray-600">— for records only, not a login</span></label>
                  <input type="tel" placeholder="10-digit phone (optional)"
                    value={newCompany.phone}
                    onChange={(e) => setNewCompany({ ...newCompany, phone: e.target.value })}
                    className="w-full bg-gray-800 text-white rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm" />
                </div>
<div className="grid grid-cols-2 gap-3">
  <div>
    <label className="text-xs text-gray-500 mb-1.5 block uppercase tracking-wider">Trial Start</label>
    <input type="date"
      value={newCompany.trial_start}
      onChange={(e) => setNewCompany({ ...newCompany, trial_start: e.target.value })}
      className="w-full bg-gray-800 text-white rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm" />
  </div>
  <div>
    <label className="text-xs text-gray-500 mb-1.5 block uppercase tracking-wider">Trial End</label>
    <input type="date"
      value={newCompany.trial_end}
      onChange={(e) => setNewCompany({ ...newCompany, trial_end: e.target.value })}
      className="w-full bg-gray-800 text-white rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm" />
  </div>
</div>

                <input type="password" placeholder="Admin password"
                  value={newCompany.adminPassword}
                  onChange={(e) => setNewCompany({ ...newCompany, adminPassword: e.target.value })}
                  className="w-full bg-gray-800 text-white rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm" />
                {message && (
                  <div className="bg-green-950 border border-green-800 rounded-xl px-4 py-3">
                    <p className="text-green-400 text-sm">{message}</p>
                  </div>
                )}
                <button onClick={handleCreateCompany} disabled={saving}
                  className="w-full bg-orange-500 hover:bg-orange-400 text-white font-semibold py-3 rounded-xl transition disabled:opacity-50 text-sm">
                  {saving ? 'Creating...' : 'Create Company'}
                </button>
              </div>
            )}

            {loading ? (
              <p className="text-gray-500 text-sm">Loading...</p>
            ) : companies.length === 0 ? (
              <div className="bg-gray-900 rounded-2xl p-10 text-center text-gray-500 border border-gray-800">
                No companies yet. Add your first one!
              </div>
            ) : (
              <div className="space-y-2">
                {companies.map((company) => (
                  <div key={company.id} id={`company-${company.id}`} className="scroll-mt-4 bg-gray-900 rounded-2xl border border-gray-800 hover:border-gray-700 transition overflow-hidden">
                    {/* Company Row */}
                    <div className="px-4 sm:px-5 py-4 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
                      <div className="flex items-start gap-3 min-w-0">
                        <div className="w-9 h-9 shrink-0 bg-gray-800 rounded-xl flex items-center justify-center border border-gray-700">
                          <span className="text-orange-500 font-bold text-sm">{company.name[0]}</span>
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium text-white text-sm">
                            {company.name}
                            {company.is_test && <span className="ml-2 align-middle text-[10px] font-semibold tracking-wider text-gray-300 bg-gray-700 px-1.5 py-0.5 rounded">TEST</span>}
                            <span className={`ml-2 align-middle text-[10px] font-semibold tracking-wider px-1.5 py-0.5 rounded ${isCoachCompany(company) ? 'text-sky-300 bg-sky-950 border border-sky-900' : 'text-gray-400 bg-gray-800 border border-gray-700'}`}>{companyTypeLabel(company).toUpperCase()}</span>
                          </p>
                          <p className="text-sm text-gray-400 mt-0.5 break-all">{company.email}</p>
                          {company.phone && (
                            <p className="text-xs text-gray-500 mt-0.5">{company.phone}</p>
                          )}
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5">
                            <span className={`text-xs whitespace-nowrap ${company.is_active ? 'text-green-400' : 'text-red-400'}`}>
                              {company.is_active ? '● Active' : '● Inactive'}
                            </span>
                            {company.trial_end && (
                              <span className="text-xs whitespace-nowrap" style={{
                                color: (daysUntil(company.trial_end) ?? 0) < 0 ? '#f87171' : '#34d399'
                              }}>
                                · {(daysUntil(company.trial_end) ?? 0) < 0
                                  ? company.is_trial ? 'Trial expired' : 'Subscription expired'
                                  : company.is_trial
                                    ? `Trial ends ${formatDate(company.trial_end, normalizeCountry(company.country), 'medium')}`
                                    : `Subscription until ${formatDate(company.trial_end, normalizeCountry(company.country), 'medium')}`}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 shrink-0 pl-12 sm:pl-0">
                        <p className="text-xs text-gray-600 whitespace-nowrap mr-auto sm:mr-0">Added {formatDate(company.created_at, normalizeCountry(company.country), 'medium')}</p>
                        <button
                          onClick={() => setEditingCompany(editingCompany?.id === company.id ? null : { ...company })}
                          className="text-xs text-orange-500 hover:text-orange-400 border border-orange-900 hover:border-orange-500 px-3 py-1.5 rounded-lg transition">
                          {editingCompany?.id === company.id ? 'Close' : 'Edit'}
                        </button>
                        <button
                          onClick={() => handleDeleteCompany(company.id, company.name)}
                          className="text-xs text-gray-600 hover:text-red-400 transition">
                          Delete
                        </button>
                      </div>
                    </div>

                    {/* Edit Panel */}
                    {editingCompany?.id === company.id && (
                      <div className="border-t border-gray-800 px-5 py-5 space-y-4">
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="text-xs text-gray-500 mb-1.5 block uppercase tracking-wider">Company Name</label>
                            <input type="text" value={editingCompany.name}
                              onChange={e => setEditingCompany({ ...editingCompany, name: e.target.value })}
                              className="w-full bg-gray-800 text-white rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm" />
                          </div>
                          <div>
                            <label className="text-xs text-gray-500 mb-1.5 block uppercase tracking-wider">Email</label>
                            <input type="email" value={editingCompany.email}
                              onChange={e => setEditingCompany({ ...editingCompany, email: e.target.value })}
                              className="w-full bg-gray-800 text-white rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm" />
                          </div>
                        </div>

                        <div>
                          <label className="text-xs text-gray-500 mb-1.5 block uppercase tracking-wider">Phone</label>
                          <input type="tel" value={editingCompany.phone || ''}
                            onChange={e => setEditingCompany({ ...editingCompany, phone: e.target.value })}
                            className="w-full bg-gray-800 text-white rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm" />
                        </div>

                        {(() => {
                          const slug = editingCompany.slug || ''
                          const savedSlug = company.slug || ''
                          const slugError = editSlugError || ((slug || savedSlug) ? slugProblem(slug) : '')
                          return (
                            <div>
                              <label className="text-xs text-gray-500 mb-1.5 block uppercase tracking-wider">Slug <span className="normal-case text-gray-600">— short name in the login link</span></label>
                              <input type="text" placeholder="e.g. syedfitness" autoCapitalize="none" autoCorrect="off" spellCheck={false}
                                value={slug}
                                onChange={e => { setEditingCompany({ ...editingCompany, slug: cleanSlugInput(e.target.value) }); setEditSlugError('') }}
                                className={`w-full bg-gray-800 text-white rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-orange-500 border text-sm ${slugError ? 'border-red-500' : 'border-gray-700'}`} />
                              <p className="text-xs text-gray-500 mt-1.5">Gym address: <span className="text-gray-300">{gymAddress(slug)}</span> · also {loginLinkPreview(slug)}</p>
                              {slugError && <p className="text-xs text-red-400 mt-1">{slugError}</p>}
                              {savedSlug && slug !== savedSlug && (
                                <p className="text-xs text-amber-400 mt-1">⚠ Changing the slug breaks the old address ({gymAddress(savedSlug)}) and login link: members and installed apps on it stop working. Send the company the new address.</p>
                              )}
                              {!savedSlug && !slug && (
                                <p className="text-xs text-gray-600 mt-1">No slug yet, so this company has no branded login link.</p>
                              )}
                            </div>
                          )
                        })()}

                        {/* Logo + banner, with a preview of the phone login */}
                        <div>
                          <label className="text-xs text-gray-500 mb-1.5 block uppercase tracking-wider">Logo & banner <span className="normal-case text-gray-600">— how the login looks on a phone</span></label>
                          <div className="rounded-2xl overflow-hidden border border-gray-700 max-w-sm bg-gray-950">
                            <div className="relative h-40 bg-gray-900"
                              style={{ backgroundImage: `url('${bannerFor(editingCompany)}')`, backgroundSize: 'cover', backgroundPosition: 'center' }}>
                              <div className="absolute inset-0 bg-gradient-to-t from-gray-950 via-black/60 to-black/30" />
                              <div className="relative z-10 h-full flex flex-col justify-end px-4 pb-3 text-white">
                                {editingCompany.logo_url
                                  ? <img src={editingCompany.logo_url} alt="" className="h-10 max-w-[60%] object-contain self-start mb-2" />
                                  : <div className="w-10 h-10 bg-orange-500 rounded-xl flex items-center justify-center font-bold mb-2">{(editingCompany.name?.trim()[0] || 'C').toUpperCase()}</div>}
                                <p className="text-lg font-bold leading-tight">{editingCompany.name || 'Company name'}</p>
                                <p className="text-xs text-gray-300">{taglineFor(editingCompany)}</p>
                              </div>
                            </div>
                            <div className="px-4 py-2 text-[11px] text-gray-500">Sign in to your account…</div>
                          </div>

                          <div className="grid grid-cols-2 gap-3 mt-3 max-w-sm">
                            {(['logo', 'banner'] as const).map(kind => {
                              const has = kind === 'logo' ? !!editingCompany.logo_url : !!editingCompany.banner_url
                              const busy = brandingBusy === kind
                              return (
                                <div key={kind} className="space-y-1.5">
                                  <button type="button" disabled={!!brandingBusy}
                                    onClick={() => (kind === 'logo' ? logoInput : bannerInput).current?.click()}
                                    className="w-full bg-gray-800 hover:bg-gray-700 border border-gray-700 text-white text-sm rounded-xl px-3 py-2.5 transition disabled:opacity-50">
                                    {busy ? 'Uploading…' : `${has ? 'Change' : 'Upload'} ${kind}`}
                                  </button>
                                  {has && (
                                    <button type="button" disabled={!!brandingBusy} onClick={() => handleBrandingRemove(kind)}
                                      className="w-full text-xs text-gray-500 hover:text-red-400 transition disabled:opacity-50">
                                      {kind === 'logo' ? 'Remove logo' : 'Use the stock photo'}
                                    </button>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                          <input ref={logoInput} type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
                            onChange={e => { handleBrandingFile('logo', e.target.files?.[0]); e.target.value = '' }} />
                          <input ref={bannerInput} type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
                            onChange={e => { handleBrandingFile('banner', e.target.files?.[0]); e.target.value = '' }} />
                          {brandingError && <p className="text-xs text-red-400 mt-2">{brandingError}</p>}
                          <p className="text-xs text-gray-600 mt-2">
                            Logo: a square PNG with a transparent background looks best. Banner: a wide (landscape) photo; the middle shows on phones.
                            Both save straight away{editingCompany.banner_url ? '' : '. No banner yet, so a stock photo for the business type shows'}.
                          </p>
                        </div>

                        <div>
                          <label className="text-xs text-gray-500 mb-1.5 block uppercase tracking-wider">Company type</label>
                          <select value={companyType(editingCompany)} disabled={!('company_type' in editingCompany)}
                            onChange={e => setEditingCompany({ ...editingCompany, company_type: companyType({ company_type: e.target.value }) })}
                            className="w-full bg-gray-800 text-white rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm disabled:opacity-40">
                            {COMPANY_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                          </select>
                          {!('company_type' in editingCompany) && (
                            <p className="text-xs text-gray-600 mt-1">Needs the company_type SQL first (db/2026-10-30-company-type.md)</p>
                          )}
                          {isCoachCompany(editingCompany) && (
                            <p className="text-xs text-amber-400 mt-1">Individual coach: coach / partner screens are hidden and no new ones can be added. Existing logins are kept, not deleted{companyCoachCount + activePartnerCount > 0 ? ` (${companyCoachCount} coach, ${activePartnerCount} partner active now: turn coaches off or remove partners if they shouldn't log in)` : ''}.</p>
                          )}
                        </div>

                        <div>
                          <label className="text-xs text-gray-500 mb-1.5 block uppercase tracking-wider">Country <span className="normal-case text-gray-600">— also sets currency</span></label>
                          <select value={normalizeCountry(editingCompany.country)}
                            onChange={e => setEditingCompany({ ...editingCompany, country: e.target.value })}
                            className="w-full bg-gray-800 text-white rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm">
                            {COUNTRIES.map(c => <option key={c.code} value={c.code}>{c.label} ({c.currency})</option>)}
                          </select>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="text-xs text-gray-500 mb-1.5 block uppercase tracking-wider">Trial Start</label>
                            <input type="date" value={editingCompany.trial_start || ''}
                              onChange={e => setEditingCompany({ ...editingCompany, trial_start: e.target.value })}
                              className="w-full bg-gray-800 text-white rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm" />
                          </div>
                          <div>
                            <label className="text-xs text-gray-500 mb-1.5 block uppercase tracking-wider">Trial End</label>
                            <input type="date" value={editingCompany.trial_end || ''}
                              onChange={e => setEditingCompany({ ...editingCompany, trial_end: e.target.value })}
                              className="w-full bg-gray-800 text-white rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm" />
                          </div>
                        </div>

                        <button
                          onClick={handleRemoveTrial}
                          className="text-xs text-yellow-500 hover:text-yellow-400 border border-yellow-900 hover:border-yellow-500 px-3 py-1.5 rounded-lg transition">
                          Remove Trial (Paid Customer)
                        </button>

                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="text-xs text-gray-500 mb-1.5 block uppercase tracking-wider">Client Limit <span className="normal-case text-gray-600">(Manage)</span></label>
                            <input type="number" inputMode="numeric" min={1} value={limitInput}
                              onChange={e => setLimitInput(e.target.value)}
                              className="w-full bg-gray-800 text-white rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm" />
                          </div>
                          <div>
                            <label className="text-xs text-gray-500 mb-1.5 block uppercase tracking-wider">PT Limit <span className="normal-case text-gray-600">(Train/Bundle)</span></label>
                            <input type="number" placeholder="None"
                              inputMode="numeric" min={0} value={ptLimitInput}
                              onChange={e => setPtLimitInput(e.target.value)}
                              className="w-full bg-gray-800 text-white rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm placeholder-gray-600" />
                          </div>
                        </div>

                        {/* Toggles */}
                        <div className="border-t border-gray-800 pt-4 space-y-3">
                          <p className="text-xs text-gray-500 uppercase tracking-wider">Feature Toggles</p>
                          <div className="flex justify-between items-center bg-gray-800/50 rounded-xl px-3 py-2.5">
                            <div>
                              <p className="text-sm text-white">Test account</p>
                              <p className="text-xs text-gray-500">
                                {'is_test' in editingCompany
                                  ? 'Leave out of the Dashboard and the Clients tab'
                                  : 'Needs one SQL line first (db/2026-10-25-company-is-test.md)'}
                              </p>
                            </div>
                            <button type="button" disabled={!('is_test' in editingCompany)}
                              onClick={() => setEditingCompany({ ...editingCompany, is_test: !editingCompany.is_test })}
                              className={`px-4 py-1.5 rounded-lg text-xs font-medium transition border disabled:opacity-40 ${editingCompany.is_test
                                ? 'bg-amber-950 border-amber-700 text-amber-300'
                                : 'bg-gray-800 border-gray-700 text-gray-500'}`}>
                              {editingCompany.is_test ? 'TEST' : 'REAL'}
                            </button>
                          </div>
                          <div className="flex justify-between items-center bg-gray-800/50 rounded-xl px-3 py-2.5">
                            <div>
                              <p className="text-sm text-white">Client Training Module</p>
                              <p className="text-xs text-gray-500">Plans, sessions, progress tabs for PT members</p>
                            </div>
                            <button
                              onClick={() => setEditingCompany({ ...editingCompany, client_module_enabled: !editingCompany.client_module_enabled })}
                              className={`px-4 py-1.5 rounded-lg text-xs font-medium transition border ${editingCompany.client_module_enabled
                                ? 'bg-green-950 border-green-700 text-green-400'
                                : 'bg-gray-800 border-gray-700 text-gray-500'}`}>
                              {editingCompany.client_module_enabled ? 'ON' : 'OFF'}
                            </button>
                          </div>
                          <div className="flex justify-between items-center">
                            <div>
                              <p className="text-sm text-white">Client Feedback</p>
                              <p className="text-xs text-gray-500">Allow coaches to give session feedback</p>
                            </div>
                            <button
                              onClick={() => setEditingCompany({ ...editingCompany, feedback_enabled: !editingCompany.feedback_enabled })}
                              className={`px-4 py-1.5 rounded-lg text-xs font-medium transition border ${editingCompany.feedback_enabled
                                ? 'bg-green-950 border-green-700 text-green-400'
                                : 'bg-gray-800 border-gray-700 text-gray-500'}`}>
                              {editingCompany.feedback_enabled ? 'ON' : 'OFF'}
                            </button>
                          </div>
                          <div className="flex justify-between items-center">
                            <div>
                              <p className="text-sm text-white">AI Insights</p>
                              <p className="text-xs text-gray-500">Show AI coaching insights to clients</p>
                            </div>
                            <button
                              onClick={() => setEditingCompany({ ...editingCompany, ai_insights_enabled: !editingCompany.ai_insights_enabled })}
                              className={`px-4 py-1.5 rounded-lg text-xs font-medium transition border ${editingCompany.ai_insights_enabled
                                ? 'bg-green-950 border-green-700 text-green-400'
                                : 'bg-gray-800 border-gray-700 text-gray-500'}`}>
                              {editingCompany.ai_insights_enabled ? 'ON' : 'OFF'}
                            </button>
                          </div>
                          <div className="flex justify-between items-center">
                            <div>
                              <p className="text-sm text-white">AI Plans</p>
                              <p className="text-xs text-gray-500">
                                {'ai_plans_enabled' in editingCompany
                                  ? 'Coaches can create weekly plans with AI (hand-written plans always work)'
                                  : 'Needs one SQL line first (db/2026-10-26-ai-plans-toggle.md)'}
                              </p>
                            </div>
                            <button type="button" disabled={!('ai_plans_enabled' in editingCompany)}
                              onClick={() => setEditingCompany({ ...editingCompany, ai_plans_enabled: editingCompany.ai_plans_enabled === false })}
                              className={`px-4 py-1.5 rounded-lg text-xs font-medium transition border disabled:opacity-40 ${editingCompany.ai_plans_enabled !== false
                                ? 'bg-green-950 border-green-700 text-green-400'
                                : 'bg-gray-800 border-gray-700 text-gray-500'}`}>
                              {editingCompany.ai_plans_enabled !== false ? 'ON' : 'OFF'}
                            </button>
                          </div>
                          <div className="flex justify-between items-center">
                            <div>
                              <p className="text-sm text-white">AI Diet Chart</p>
                              <p className="text-xs text-gray-500">
                                {'ai_diet_enabled' in editingCompany
                                  ? 'Coaches can create diet charts with AI (typed diet plans always work)'
                                  : 'Needs one SQL line first (db/2026-10-25-ai-diet-toggle.md)'}
                              </p>
                            </div>
                            <button type="button" disabled={!('ai_diet_enabled' in editingCompany)}
                              onClick={() => setEditingCompany({ ...editingCompany, ai_diet_enabled: editingCompany.ai_diet_enabled === false })}
                              className={`px-4 py-1.5 rounded-lg text-xs font-medium transition border disabled:opacity-40 ${editingCompany.ai_diet_enabled !== false
                                ? 'bg-green-950 border-green-700 text-green-400'
                                : 'bg-gray-800 border-gray-700 text-gray-500'}`}>
                              {editingCompany.ai_diet_enabled !== false ? 'ON' : 'OFF'}
                            </button>
                          <div className="flex justify-between items-center">
                            <div>
                              <p className="text-sm text-white">Session Notes</p>
                              <p className="text-xs text-gray-500">Allow clients to add notes when logging</p>
                            </div>
                            <button
                              onClick={() => setEditingCompany({ ...editingCompany, session_notes_enabled: !editingCompany.session_notes_enabled })}
                              className={`px-4 py-1.5 rounded-lg text-xs font-medium transition border ${editingCompany.session_notes_enabled
                                ? 'bg-green-950 border-green-700 text-green-400'
                                : 'bg-gray-800 border-gray-700 text-gray-500'}`}>
                              {editingCompany.session_notes_enabled ? 'ON' : 'OFF'}
                            </button>
                          </div>
                        </div>
                        </div>

                        {/* Active/Inactive */}
                        <div className="border-t border-gray-800 pt-4 flex justify-between items-center">
                          <div>
                            <p className="text-sm text-white">Account Status</p>
                            <p className="text-xs text-gray-500">Activate or deactivate this company</p>
                          </div>
                          <button
                            onClick={() => setEditingCompany({ ...editingCompany, is_active: !editingCompany.is_active })}
                            className={`px-4 py-1.5 rounded-lg text-xs font-medium transition border ${editingCompany.is_active
                              ? 'bg-green-950 border-green-700 text-green-400'
                              : 'bg-red-950 border-red-700 text-red-400'}`}>
                            {editingCompany.is_active ? 'Active' : 'Inactive'}
                          </button>
                        </div>

                        {/* Notes */}
                        <div className="border-t border-gray-800 pt-4">
                          <label className="text-xs text-gray-500 mb-1.5 block uppercase tracking-wider">Internal Notes</label>
                          <textarea
                            placeholder="e.g. Paid via UPI on 12 Apr, 50 clients, ₹2500/month..."
                            value={editingCompany.notes || ''}
                            onChange={e => setEditingCompany({ ...editingCompany, notes: e.target.value })}
                            rows={3}
                            className="w-full bg-gray-800 text-white rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm resize-none" />
                        </div>

                        {/* Company admin login: reset password */}
                        <div className="border-t border-gray-800 pt-4">
                          <p className="text-xs text-gray-500 uppercase tracking-wider mb-3">Admin Login</p>
                          {companyAdmins.length === 0 ? (
                            <p className="text-xs text-gray-600 mb-3">No admin login found for this company.</p>
                          ) : (
                            <div className="space-y-2 mb-3">
                              {companyAdmins.map(a => (
                                <div key={a.id} className="flex justify-between items-center gap-3 bg-gray-800 rounded-xl px-3 py-2.5">
                                  <div className="min-w-0">
                                    <p className="text-sm text-white">{a.full_name}</p>
                                    <p className="text-xs text-gray-500 break-all">{editingCompany.email}</p>
                                  </div>
                                  <button onClick={() => { setResetTarget({ id: a.id, name: a.full_name }); setResetPasswordValue('') }}
                                    className="text-xs text-orange-400 hover:text-orange-300 border border-orange-900 px-3 py-1.5 rounded-lg shrink-0 transition">
                                    Reset password
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                          {resetTarget && (
                            <div className="bg-gray-800/60 border border-gray-700 rounded-xl p-3 mb-3 space-y-2">
                              <p className="text-xs text-gray-400">New password for <span className="text-white">{resetTarget.name}</span> (6+ characters)</p>
                              <input type="text" autoComplete="new-password" placeholder="New password"
                                value={resetPasswordValue}
                                onChange={e => setResetPasswordValue(e.target.value)}
                                className="w-full bg-gray-800 text-white rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm placeholder-gray-600" />
                              <div className="flex gap-2">
                                <button onClick={handleResetLoginPassword} disabled={resettingPassword || resetPasswordValue.length < 6}
                                  className="flex-1 bg-orange-500 hover:bg-orange-400 text-white text-sm py-2 rounded-xl transition disabled:opacity-50">
                                  {resettingPassword ? 'Resetting...' : 'Reset password'}
                                </button>
                                <button onClick={() => { setResetTarget(null); setResetPasswordValue('') }}
                                  className="flex-1 bg-gray-800 hover:bg-gray-700 text-white text-sm py-2 rounded-xl transition">
                                  Cancel
                                </button>
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Partner Logins */}
                        <div className="border-t border-gray-800 pt-4">
                          <div className="flex items-center justify-between gap-2 mb-3">
                            <p className="text-xs text-gray-500 uppercase tracking-wider">Partner Logins</p>
                            <p className="text-xs text-gray-400">Partners: {activePartnerCount} of {partnerLimit}</p>
                          </div>
                          {isCoachCompany(editingCompany) && (
                            <p className="text-xs text-gray-500 mb-3">Individual coach: no partner logins. Existing ones (if any) are listed below and kept.</p>
                          )}
                          {!isCoachCompany(editingCompany) && (<>
                          <div className="flex items-center gap-2 mb-3">
                            <label className="text-xs text-gray-500 shrink-0">Partner limit</label>
                            <input type="number" inputMode="numeric" min={0} max={20} value={partnerLimitInput}
                              onChange={e => setPartnerLimitInput(e.target.value)}
                              className="w-20 bg-gray-800 text-white rounded-xl px-3 py-1.5 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm" />
                            <button onClick={handleSavePartnerLimit}
                              disabled={savingPartnerLimit || partnerLimitInput === String(partnerLimit)}
                              className="text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 px-3 py-1.5 rounded-xl border border-gray-700 transition disabled:opacity-40">
                              {savingPartnerLimit ? 'Saving...' : 'Save limit'}
                            </button>
                          </div>
                          </>)}
                          {companyPartners.length === 0 ? (
                            <p className="text-xs text-gray-600 mb-3">No partners yet.</p>
                          ) : (
                            <div className="space-y-2 mb-3">
                              {companyPartners.map(p => (
                                <div key={p.id} className="flex justify-between items-center bg-gray-800 rounded-xl px-3 py-2.5">
                                  <div>
                                    <p className="text-sm text-white">{p.full_name}</p>
                                    <p className="text-xs text-gray-500">
                                      {/* Shows what they log in with: email for US-style logins, else phone */}
                                      {p.email && !p.email.endsWith('@getcoachboard.in') ? p.email : p.phone}
                                      {p.email && !p.email.endsWith('@getcoachboard.in') && p.phone ? ` · ${p.phone}` : ''}
                                    </p>
                                  </div>
                                  <div className="flex items-center gap-3 shrink-0">
                                    <button onClick={() => { setResetTarget({ id: p.id, name: p.full_name }); setResetPasswordValue('') }}
                                      className="text-xs text-orange-400 hover:text-orange-300 transition">
                                      Reset password
                                    </button>
                                    <button
                                      onClick={() => handleRemovePartner(p.id, p.full_name)}
                                      className="text-xs text-red-500 hover:text-red-400 transition">
                                      Remove
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                          {!isCoachCompany(editingCompany) && (<>
                          {loginMethod(normalizeCountry(editingCompany.country)) === 'email' ? (
                            <div className="grid grid-cols-2 gap-2 mb-2">
                              <input type="text" placeholder="Partner name"
                                value={newPartner.full_name}
                                onChange={e => setNewPartner({ ...newPartner, full_name: e.target.value })}
                                className="col-span-2 bg-gray-800 text-white rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm placeholder-gray-600" />
                              <input type="email" placeholder="Email (used to log in)" autoComplete="off"
                                value={newPartner.email}
                                onChange={e => setNewPartner({ ...newPartner, email: e.target.value })}
                                className="col-span-2 bg-gray-800 text-white rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm placeholder-gray-600" />
                              <input type="text" placeholder="Password (min 6)" autoComplete="new-password"
                                value={newPartner.password}
                                onChange={e => setNewPartner({ ...newPartner, password: e.target.value })}
                                className="bg-gray-800 text-white rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm placeholder-gray-600" />
                              <input type="tel" placeholder="Phone (optional)"
                                value={newPartner.phone}
                                onChange={e => setNewPartner({ ...newPartner, phone: e.target.value })}
                                className="bg-gray-800 text-white rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm placeholder-gray-600" />
                            </div>
                          ) : (
                          <div className="grid grid-cols-2 gap-2 mb-2">
                              <input type="text" placeholder="Partner name"
                                value={newPartner.full_name}
                                onChange={e => setNewPartner({ ...newPartner, full_name: e.target.value })}
                                className="bg-gray-800 text-white rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm placeholder-gray-600" />
                              <input type="tel" placeholder="Phone (10 digits)"
                                value={newPartner.phone}
                                onChange={e => setNewPartner({ ...newPartner, phone: e.target.value })}
                                className="bg-gray-800 text-white rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm placeholder-gray-600" />
                            </div>
                          )}
                          {partnerMessage && (
                            <p className={`text-xs mb-2 ${partnerMessage.includes('Error') ? 'text-red-400' : 'text-green-400'}`}>
                              {partnerMessage}
                            </p>
                          )}
                          <button onClick={handleAddPartner} disabled={savingPartner || partnerLimitReached}
                            className="w-full bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm py-2 rounded-xl border border-gray-700 transition disabled:opacity-50">
                            {savingPartner ? 'Adding...' : '+ Add Partner Login'}
                          </button>
                          {partnerLimitReached && (
                            <p className="text-xs text-amber-400 mt-1.5">Limit reached: raise the partner limit to add more</p>
                          )}
                          <p className="text-xs text-gray-600 mt-1.5">
                            {loginMethod(normalizeCountry(editingCompany.country)) === 'email'
                              ? 'US company: partners log in with their email and the password you set. They can change it in Settings.'
                              : 'Default password is their phone number. They can change it after first login via Settings.'}
                          </p>
                          </>)}
                        </div>

                        {editMessage && (
                          <p className="text-green-400 text-sm">{editMessage}</p>
                        )}
                        <button
                          onClick={handleSaveCompany}
                          disabled={savingCompany}
                          className="w-full bg-orange-500 hover:bg-orange-400 text-white font-semibold py-2.5 rounded-xl transition disabled:opacity-50 text-sm">
                          {savingCompany ? 'Saving...' : 'Save Changes'}
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ALL CLIENTS TAB */}
        {activeTab === 'requests' && (
          <div>
            <h2 className="text-sm font-medium text-gray-400 mb-4">Contact form requests from getcoachboard.com</h2>
            {loading ? (
              <p className="text-gray-500 text-sm">Loading...</p>
            ) : requests.length === 0 ? (
              <div className="bg-gray-900 rounded-2xl p-10 text-center text-gray-500 border border-gray-800">
                No requests yet. They appear here when someone fills the form on the home page.
              </div>
            ) : (
              <div className="space-y-3">
                {requests.map(r => (
                  <div key={r.id} className={`bg-gray-900 rounded-2xl border px-4 sm:px-5 py-4 ${r.status === 'new' ? 'border-orange-800' : 'border-gray-800'}`}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium text-white text-sm">
                          {r.name}{r.business ? <span className="text-gray-400 font-normal">, {r.business}</span> : null}
                        </p>
                        <a href={`mailto:${r.email}`} className="text-sm text-orange-400 hover:underline break-all">{r.email}</a>
                        {r.phone && <p className="text-xs text-gray-500 mt-0.5">{r.phone}</p>}
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <p className="text-xs text-gray-600 whitespace-nowrap">{formatDate(r.created_at, 'IN', 'medium')}</p>
                        <button onClick={() => toggleRequestStatus(r)}
                          className={`text-xs px-3 py-1.5 rounded-lg border transition ${r.status === 'new'
                            ? 'text-orange-400 border-orange-900 hover:border-orange-500'
                            : 'text-gray-500 border-gray-700 hover:border-gray-500'}`}>
                          {r.status === 'new' ? 'Mark contacted' : 'Contacted ✓'}
                        </button>
                      </div>
                    </div>
                    {r.message && <p className="mt-3 text-sm text-gray-300 whitespace-pre-wrap">{r.message}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* CLIENTS TAB — grouped by company */}
        {activeTab === 'clients' && (() => {
          if (loading) return <p className="text-gray-500 text-sm">Loading...</p>
          const q = clientSearch.trim().toLowerCase()
          const testIds = new Set(companies.filter(c => c.is_test).map(c => c.id))
          const msBy = new Map<string, AdminMembership[]>()
          for (const m of memberships) msBy.set(m.profile_id, [...(msBy.get(m.profile_id) || []), m])
          const rows = clients
            .filter(c => !c.archived_at)
            .filter(c => showTestClients || !testIds.has(c.company_id))
            .map(c => ({ c, state: membershipState(msBy.get(c.id) || []) }))
          const shown = rows
            .filter(r => clientFilter === 'all' || (clientFilter === 'pt' ? r.c.client_type === 'pt' : r.state === 'expired'))
            .filter(r => !q || r.c.full_name.toLowerCase().includes(q) || (r.c.phone || '').includes(q) || (r.c.email || '').toLowerCase().includes(q) || (r.c.company_name || '').toLowerCase().includes(q))
          const groups = companies
            .filter(co => showTestClients || !co.is_test)
            .map(co => ({ co, all: rows.filter(r => r.c.company_id === co.id), list: shown.filter(r => r.c.company_id === co.id) }))
            .filter(g => g.list.length > 0)
            .sort((a, b) => b.all.length - a.all.length)
          const stateCls = { active: 'text-green-400', expiring: 'text-amber-400', expired: 'text-red-400', none: 'text-gray-500' }
          const stateLabel = { active: 'Active', expiring: 'Expiring', expired: 'Expired', none: 'No membership' }
          const testClientCount = clients.filter(c => !c.archived_at && testIds.has(c.company_id)).length
          return (
            <div className="space-y-4">
              <div className="space-y-2">
                <input value={clientSearch} onChange={e => setClientSearch(e.target.value)} placeholder="Search name, phone, email or gym…"
                  className="w-full bg-gray-900 text-white rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-800 text-sm" />
                <div className="flex flex-wrap items-center gap-2">
                  {([['all', 'All'], ['pt', 'PT'], ['expired', 'Expired']] as const).map(([k, label]) => (
                    <button key={k} type="button" onClick={() => setClientFilter(k)}
                      className={`text-xs px-3 py-1.5 rounded-lg border ${clientFilter === k ? 'bg-orange-500 border-orange-500 text-white' : 'border-gray-700 text-gray-400'}`}>
                      {label}
                    </button>
                  ))}
                  {testClientCount > 0 && (
                    <label className="ml-auto flex items-center gap-2 text-xs text-gray-400">
                      <input type="checkbox" checked={showTestClients} onChange={e => setShowTestClients(e.target.checked)} className="accent-orange-500" />
                      Show test accounts ({testClientCount})
                    </label>
                  )}
                </div>
              </div>

              {groups.length === 0 ? (
                <div className="bg-gray-900 rounded-2xl p-10 text-center text-gray-500 border border-gray-800">
                  {clients.length === 0 ? 'No clients yet across any company.' : 'No clients match.'}
                </div>
              ) : groups.map(({ co, all, list }) => {
                const open = !collapsedCompanies.has(co.id) || !!q
                const pt = all.filter(r => r.c.client_type === 'pt').length
                const expired = all.filter(r => r.state === 'expired').length
                return (
                  <div key={co.id} className="bg-gray-900 rounded-2xl border border-gray-800 overflow-hidden">
                    <button type="button" aria-expanded={open}
                      onClick={() => setCollapsedCompanies(prev => { const n = new Set(prev); if (n.has(co.id)) n.delete(co.id); else n.add(co.id); return n })}
                      className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-gray-800/50">
                      <span className="text-gray-500 text-xs w-3" aria-hidden="true">{open ? '▾' : '▸'}</span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm font-semibold text-white truncate">
                          {co.name}
                          {co.is_test && <span className="ml-2 align-middle text-[10px] font-semibold tracking-wider text-gray-300 bg-gray-700 px-1.5 py-0.5 rounded">TEST</span>}
                        </span>
                        <span className="block text-xs text-gray-500">
                          {all.length} member{all.length === 1 ? '' : 's'}{pt ? ` · ${pt} PT` : ''}{expired ? <span className="text-red-400"> · {expired} expired</span> : null}
                          {list.length !== all.length ? ` · showing ${list.length}` : ''}
                        </span>
                      </span>
                    </button>
                    {open && (
                      <div className="divide-y divide-gray-800 border-t border-gray-800">
                        {list.map(({ c, state }) => (
                          <div key={c.id} className="px-4 py-2.5 flex items-center gap-3">
                            <div className="w-8 h-8 shrink-0 bg-gray-800 rounded-lg flex items-center justify-center border border-gray-700">
                              <span className="text-orange-500 font-bold text-xs">{c.full_name[0]}</span>
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm text-white truncate">
                                {c.full_name}
                                {c.client_type === 'pt' && <span className="ml-1.5 text-[10px] bg-purple-900/50 text-purple-400 border border-purple-800 px-1.5 py-0.5 rounded-full align-middle">PT</span>}
                              </p>
                              <p className="text-xs text-gray-500 truncate">{c.email && !c.email.endsWith('@getcoachboard.in') ? c.email : c.phone || c.email}</p>
                            </div>
                            <span className={`text-xs shrink-0 ${stateCls[state]}`}>● {stateLabel[state]}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
              <p className="text-[11px] text-gray-500">Archived clients aren&apos;t listed. Expiring = membership ends within 7 days.</p>
            </div>
          )
        })()}
      </div>
    </div>
  )
}
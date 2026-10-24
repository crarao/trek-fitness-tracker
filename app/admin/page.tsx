'use client'

import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import { type Country, COUNTRIES, normalizeCountry, currencyForCountry, formatDate } from '@/lib/locale'

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
  session_notes_enabled: boolean
  client_limit: number
  is_trial: boolean
  notes: string | null
  client_module_enabled: boolean
  pt_limit: number | null
  country: string | null
}

type Client = {
  id: string
  full_name: string
  email: string
  company_id: string
  company_name?: string
}

type Partner = {
  id: string
  full_name: string
  phone: string
}

export default function AdminPage() {
  const router = useRouter()
  const [companies, setCompanies] = useState<Company[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'companies' | 'clients'>('companies')
  const [showForm, setShowForm] = useState(false)
  const [newCompany, setNewCompany] = useState({ 
  name: '', 
  email: '', 
  adminPassword: '', 
  phone: '',
  country: 'IN' as Country,
  trial_start: new Date().toISOString().split('T')[0],
  trial_end: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
})
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  // Company row saved but its admin login failed: retry reuses this row instead of creating a duplicate
  const [pendingCompanyId, setPendingCompanyId] = useState<string | null>(null)
  const [showPasswordForm, setShowPasswordForm] = useState(false)
  const [passwordData, setPasswordData] = useState({ newPassword: '', confirmPassword: '' })
  const [passwordMessage, setPasswordMessage] = useState('')
  const [editingCompany, setEditingCompany] = useState<Company | null>(null)
  const [savingCompany, setSavingCompany] = useState(false)
  const [editMessage, setEditMessage] = useState('')
  const [companyPartners, setCompanyPartners] = useState<Partner[]>([])
  const [newPartner, setNewPartner] = useState({ full_name: '', phone: '' })
  const [savingPartner, setSavingPartner] = useState(false)
  const [partnerMessage, setPartnerMessage] = useState('')

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


  useEffect(() => { fetchAll() }, [])

  useEffect(() => {
    if (!editingCompany) { setCompanyPartners([]); setCompanyAdmins([]); setResetTarget(null); return }
    supabase.from('profiles').select('id, full_name, phone')
      .eq('company_id', editingCompany.id).eq('role', 'partner')
      .then(({ data }) => setCompanyPartners(data || []))
    supabase.from('profiles').select('id, full_name, phone')
      .eq('company_id', editingCompany.id).eq('role', 'company_admin')
      .then(({ data }) => setCompanyAdmins(data || []))
    setLimitInput(editingCompany.client_limit ? String(editingCompany.client_limit) : '')
    setPtLimitInput(editingCompany.pt_limit != null ? String(editingCompany.pt_limit) : '')
    setResetTarget(null)
    setResetPasswordValue('')
  }, [editingCompany?.id])

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
          : ''
    if (problem) {
      setMessage('Error: ' + problem)
      setSaving(false)
      return
    }

    const companyFields = { name: newCompany.name, email: resolvedEmail, phone: newCompany.phone, country: newCompany.country, currency: currencyForCountry(newCompany.country) }
    const { data: company, error: companyError } = pendingCompanyId
      ? await supabase.from('companies').update(companyFields).eq('id', pendingCompanyId).select().single()
      : await supabase.from('companies').insert(companyFields).select().single()

    if (companyError) {
      setMessage('Error: ' + companyError.message)
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
  trial_start: new Date().toISOString().split('T')[0],
  trial_end: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
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
        session_notes_enabled: editingCompany.session_notes_enabled,
        client_module_enabled: editingCompany.client_module_enabled,
        pt_limit: ptLimit,
        client_limit: clientLimit,
        is_trial: editingCompany.is_trial,
        notes: editingCompany.notes || null,
        country: normalizeCountry(editingCompany.country),
        currency: currencyForCountry(normalizeCountry(editingCompany.country))
      })
      .eq('id', editingCompany.id)
    setSavingCompany(false)
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

  const handleRemoveTrial = async () => {
    if (!editingCompany) return
    setEditingCompany({ ...editingCompany, trial_start: '', trial_end: '', is_trial: false })
  }

  const handleAddPartner = async () => {
    if (!editingCompany || !newPartner.full_name || !newPartner.phone) return
    const phone = newPartner.phone.trim()
    if (!/^\d{10}$/.test(phone)) { setPartnerMessage('Enter a valid 10-digit phone number'); return }
    setSavingPartner(true)
    const response = await fetch('/api/create-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: `${phone}@getcoachboard.in`,
        password: phone,
        full_name: newPartner.full_name,
        company_id: editingCompany.id,
        role: 'partner',
        phone
      })
    })
    const result = await response.json()
    if (result.error) { setPartnerMessage('Error: ' + result.error); setSavingPartner(false); return }
    setNewPartner({ full_name: '', phone: '' })
    setPartnerMessage('Partner added! Default password = phone number.')
    const { data } = await supabase.from('profiles').select('id, full_name, phone')
      .eq('company_id', editingCompany.id).eq('role', 'partner')
    setCompanyPartners(data || [])
    setSavingPartner(false)
    setTimeout(() => setPartnerMessage(''), 3000)
  }

  const handleRemovePartner = (partnerId: string, partnerName: string) => {
    setConfirmBox({
      title: `Remove partner "${partnerName}"?`,
      body: 'They will no longer be able to log in to this company.',
      action: 'Remove partner',
      onConfirm: async () => {
        const { error } = await supabase.from('profiles').delete().eq('id', partnerId)
        if (error) { showToast('Could not remove: ' + error.message, 'error'); return }
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
  <button onClick={handleLogout}
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
        <div className="flex gap-1 bg-gray-900 p-1 rounded-xl border border-gray-800 mb-6 w-fit">
          {(['companies', 'clients'] as const).map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={`px-5 py-2 text-sm font-medium rounded-lg transition ${activeTab === tab
                ? 'bg-orange-500 text-white'
                : 'text-gray-400 hover:text-white'}`}>
              {tab === 'companies' ? `Companies (${companies.length})` : `All Clients (${clients.length})`}
            </button>
          ))}
        </div>

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
                  onChange={(e) => setNewCompany({ ...newCompany, name: e.target.value })}
                  className="w-full bg-gray-800 text-white rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm" />
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
                  <div key={company.id} className="bg-gray-900 rounded-2xl border border-gray-800 hover:border-gray-700 transition overflow-hidden">
                    {/* Company Row */}
                    <div className="px-4 sm:px-5 py-4 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
                      <div className="flex items-start gap-3 min-w-0">
                        <div className="w-9 h-9 shrink-0 bg-gray-800 rounded-xl flex items-center justify-center border border-gray-700">
                          <span className="text-orange-500 font-bold text-sm">{company.name[0]}</span>
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium text-white text-sm">{company.name}</p>
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
                                color: new Date(company.trial_end) < new Date() ? '#f87171' : '#34d399'
                              }}>
                                · {new Date(company.trial_end) < new Date()
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
                          <p className="text-xs text-gray-500 uppercase tracking-wider mb-3">Partner Logins</p>
                          {companyPartners.length === 0 ? (
                            <p className="text-xs text-gray-600 mb-3">No partners yet.</p>
                          ) : (
                            <div className="space-y-2 mb-3">
                              {companyPartners.map(p => (
                                <div key={p.id} className="flex justify-between items-center bg-gray-800 rounded-xl px-3 py-2.5">
                                  <div>
                                    <p className="text-sm text-white">{p.full_name}</p>
                                    <p className="text-xs text-gray-500">{p.phone}</p>
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
                          {partnerMessage && (
                            <p className={`text-xs mb-2 ${partnerMessage.includes('Error') ? 'text-red-400' : 'text-green-400'}`}>
                              {partnerMessage}
                            </p>
                          )}
                          <button onClick={handleAddPartner} disabled={savingPartner}
                            className="w-full bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm py-2 rounded-xl border border-gray-700 transition disabled:opacity-50">
                            {savingPartner ? 'Adding...' : '+ Add Partner Login'}
                          </button>
                          <p className="text-xs text-gray-600 mt-1.5">Default password is their phone number. They can change it after first login via Settings.</p>
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
        {activeTab === 'clients' && (
          <div>
            <h2 className="text-sm font-medium text-gray-400 uppercase tracking-wider mb-4">All Clients</h2>
            {loading ? (
              <p className="text-gray-500 text-sm">Loading...</p>
            ) : clients.length === 0 ? (
              <div className="bg-gray-900 rounded-2xl p-10 text-center text-gray-500 border border-gray-800">
                No clients yet across any company.
              </div>
            ) : (
              <div className="space-y-2">
                {clients.map((client) => (
                  <div key={client.id} className="bg-gray-900 rounded-2xl px-5 py-4 flex justify-between items-center border border-gray-800 hover:border-gray-700 transition">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 bg-gray-800 rounded-xl flex items-center justify-center border border-gray-700">
                        <span className="text-orange-500 font-bold text-sm">{client.full_name[0]}</span>
                      </div>
                      <div>
                        <p className="font-medium text-white text-sm">{client.full_name}</p>
                        <p className="text-xs text-gray-500">{client.email}</p>
                      </div>
                    </div>
                    <div className="bg-gray-800 border border-gray-700 px-3 py-1 rounded-lg">
                      <p className="text-xs text-orange-400 font-medium">{client.company_name}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
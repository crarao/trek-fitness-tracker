'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'

type Client = {
  id: string
  full_name: string
  email: string
  created_at: string
}

export default function CompanyAdminPage() {
  const router = useRouter()
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [companyName, setCompanyName] = useState('')
  const [company, setCompany] = useState<any>(null)
  const [showForm, setShowForm] = useState(false)
  const [newClient, setNewClient] = useState({ full_name: '', email: '', password: '', phone: '' })
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [showPasswordForm, setShowPasswordForm] = useState(false)
  const [passwordData, setPasswordData] = useState({ newPassword: '', confirmPassword: '' })
  const [passwordMessage, setPasswordMessage] = useState('')
  const [logoUrl, setLogoUrl] = useState('')
  const [logoSaved, setLogoSaved] = useState(false)

  useEffect(() => { initialize() }, [])

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
      .select('name, logo_url')
      .eq('id', profile.company_id)
      .single()

    setCompanyName(company?.name || '')
    setCompany(company)
    fetchClients(profile.company_id)
  }

  const fetchClients = async (cId: string) => {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('company_id', cId)
      .eq('role', 'client')
      .order('created_at', { ascending: false })

    setClients(data || [])
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


const handleSaveLogo = async () => {
  const { error } = await supabase
    .from('companies')
    .update({ logo_url: logoUrl })
    .eq('id', companyId!)
  console.log('Logo save error:', error, 'companyId:', companyId, 'logoUrl:', logoUrl)
  setLogoSaved(true)
  setTimeout(() => setLogoSaved(false), 2000)
  initialize()
}

  const handleCreateClient = async () => {
    setSaving(true)
    setMessage('')

    const response = await fetch('/api/create-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
  email: newClient.email,
  password: newClient.password,
  full_name: newClient.full_name,
  company_id: companyId,
  role: 'client',
  phone: newClient.phone
})
    })


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


    const result = await response.json()
    if (result.error) {
      setMessage('Error: ' + result.error)
      setSaving(false)
      return
    }

    setMessage('Client created successfully!')
    setNewClient({ full_name: '', email: '', password: '', phone: '' })
    setShowForm(false)
    setSaving(false)
    fetchClients(companyId!)
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Header */}
      <div className="bg-gray-900 border-b border-gray-800 px-6 py-4 flex justify-between items-center">
        <div className="flex items-center gap-3">
          {company?.logo_url ? (
  <img
    src={company.logo_url}
    alt={companyName}
    className="w-8 h-8 rounded-lg object-cover"
  />
) : (
  <div className="w-8 h-8 bg-orange-500 rounded-lg flex items-center justify-center">
    <span className="text-white text-sm font-bold">
      {companyName ? companyName[0] : 'C'}
    </span>
  </div>
)}
          <div>
            <h1 className="text-base font-bold text-white">{companyName || 'CoachBoard'}</h1>
            <p className="text-xs text-gray-500">Company Admin</p>
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
    <div className="max-w-3xl mx-auto space-y-6">

      {/* Logo URL */}
      <div>
        <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Company Logo URL</p>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="https://yourcompany.com/logo.png"
            value={logoUrl}
            onChange={e => setLogoUrl(e.target.value)}
            className="flex-1 bg-gray-800 text-white rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm" />
          <button
            onClick={handleSaveLogo}
            className="bg-orange-500 hover:bg-orange-400 text-white px-4 py-2.5 rounded-xl transition text-sm font-medium">
            {logoSaved ? '✓ Saved!' : 'Save'}
          </button>
        </div>
      </div>

      {/* Password Change */}
      <div>
        <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Change Password</p>
        <input
          type="password"
          placeholder="New password"
          value={passwordData.newPassword}
          onChange={e => setPasswordData({ ...passwordData, newPassword: e.target.value })}
          className="w-full bg-gray-800 text-white rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm mb-3" />
        <input
          type="password"
          placeholder="Confirm new password"
          value={passwordData.confirmPassword}
          onChange={e => setPasswordData({ ...passwordData, confirmPassword: e.target.value })}
          className="w-full bg-gray-800 text-white rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm" />
        {passwordMessage && (
          <p className={`text-sm mt-2 ${passwordMessage.includes('✓') ? 'text-green-400' : 'text-red-400'}`}>
            {passwordMessage}
          </p>
        )}
        <button
          onClick={handleChangePassword}
          className="w-full bg-orange-500 hover:bg-orange-400 text-white font-semibold py-2.5 rounded-xl transition text-sm mt-3">
          Update Password
        </button>
      </div>

    </div>
  </div>
)}

      <div className="max-w-3xl mx-auto px-6 py-6">
        {/* Stats */}
        <div className="bg-gray-900 rounded-2xl p-5 border border-gray-800 mb-8">
          <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Total Clients</p>
          <p className="text-4xl font-bold text-orange-500">{clients.length}</p>
        </div>

        {/* Header row */}
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-sm font-medium text-gray-400 uppercase tracking-wider">Clients</h2>
          <button onClick={() => setShowForm(!showForm)}
            className="bg-orange-500 hover:bg-orange-400 text-white text-sm px-4 py-2 rounded-xl transition font-medium">
            + Add Client
          </button>
        </div>

        {/* Add Client Form */}
        {showForm && (
          <div className="bg-gray-900 rounded-2xl p-6 mb-6 space-y-4 border border-gray-800">
            <h3 className="font-semibold text-white">New Client</h3>
            <input type="text" placeholder="Full name"
              value={newClient.full_name}
              onChange={(e) => setNewClient({ ...newClient, full_name: e.target.value })}
              className="w-full bg-gray-800 text-white rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm" />
            <input type="email" placeholder="Email address"
              value={newClient.email}
              onChange={(e) => setNewClient({ ...newClient, email: e.target.value })}
              className="w-full bg-gray-800 text-white rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm" />

	<input type="tel" placeholder="Phone number"
		  value={newClient.phone}
		  onChange={(e) => setNewClient({ ...newClient, phone: e.target.value })}
		  className="w-full bg-gray-800 text-white rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm" />

            <input type="password" placeholder="Temporary password"
              value={newClient.password}
              onChange={(e) => setNewClient({ ...newClient, password: e.target.value })}
              className="w-full bg-gray-800 text-white rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm" />
            {message && (
              <div className="bg-green-950 border border-green-800 rounded-xl px-4 py-3">
                <p className="text-green-400 text-sm">{message}</p>
              </div>
            )}
            <button onClick={handleCreateClient} disabled={saving}
              className="w-full bg-orange-500 hover:bg-orange-400 text-white font-semibold py-3 rounded-xl transition disabled:opacity-50 text-sm">
              {saving ? 'Creating...' : 'Create Client'}
            </button>
          </div>
        )}

        {/* Clients List */}
        {loading ? (
          <p className="text-gray-500 text-sm">Loading...</p>
        ) : clients.length === 0 ? (
          <div className="bg-gray-900 rounded-2xl p-10 text-center text-gray-500 border border-gray-800">
            No clients yet. Add your first one!
          </div>
        ) : (
          <div className="space-y-2">
            {clients.map((client) => (
              <div
                key={client.id}
                onClick={() => router.push(`/company/client/${client.id}`)}
                className="bg-gray-900 rounded-2xl px-5 py-4 flex justify-between items-center border border-gray-800 hover:border-orange-500 cursor-pointer transition group">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 bg-gray-800 rounded-xl flex items-center justify-center border border-gray-700 group-hover:border-orange-500 transition">
                    <span className="text-orange-500 font-bold text-sm">{client.full_name[0]}</span>
                  </div>
                  <div>
                    <p className="font-medium text-white text-sm">{client.full_name}</p>
                    <p className="text-xs text-gray-500">{client.email}</p>
                  </div>
                </div>
                <span className="text-orange-500 text-sm opacity-0 group-hover:opacity-100 transition">View →</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
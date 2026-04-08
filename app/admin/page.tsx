'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'

type Company = {
  id: string
  name: string
  email: string
  created_at: string
}

type Client = {
  id: string
  full_name: string
  email: string
  company_id: string
  company_name?: string
}

export default function AdminPage() {
  const router = useRouter()
  const [companies, setCompanies] = useState<Company[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'companies' | 'clients'>('companies')
  const [showForm, setShowForm] = useState(false)
  const [newCompany, setNewCompany] = useState({ name: '', email: '', adminPassword: '' })
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [showPasswordForm, setShowPasswordForm] = useState(false)
  const [passwordData, setPasswordData] = useState({ newPassword: '', confirmPassword: '' })
  const [passwordMessage, setPasswordMessage] = useState('')


  useEffect(() => { fetchAll() }, [])

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


  const handleCreateCompany = async () => {
    setSaving(true)
    setMessage('')

    const { data: company, error: companyError } = await supabase
      .from('companies')
      .insert({ name: newCompany.name, email: newCompany.email })
      .select()
      .single()

    if (companyError) {
      setMessage('Error: ' + companyError.message)
      setSaving(false)
      return
    }

    const response = await fetch('/api/create-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: newCompany.email,
        password: newCompany.adminPassword,
        full_name: newCompany.name + ' Admin',
        company_id: company.id,
        role: 'company_admin'
      })
    })

    const result = await response.json()
    if (result.error) {
      setMessage('Error: ' + result.error)
      setSaving(false)
      return
    }

    setMessage('Company created successfully!')
    setNewCompany({ name: '', email: '', adminPassword: '' })
    setShowForm(false)
    setSaving(false)
    fetchAll()
  }

  const handleDeleteCompany = async (companyId: string, companyName: string) => {
    if (!confirm(`Delete "${companyName}" and all its data? This cannot be undone.`)) return
    await supabase.from('profiles').delete().eq('company_id', companyId)
    await supabase.from('companies').delete().eq('id', companyId)
    fetchAll()
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
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
                <input type="email" placeholder="Admin email"
                  value={newCompany.email}
                  onChange={(e) => setNewCompany({ ...newCompany, email: e.target.value })}
                  className="w-full bg-gray-800 text-white rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm" />
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
                  <div key={company.id} className="bg-gray-900 rounded-2xl px-5 py-4 flex justify-between items-center border border-gray-800 hover:border-gray-700 transition">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 bg-gray-800 rounded-xl flex items-center justify-center border border-gray-700">
                        <span className="text-orange-500 font-bold text-sm">{company.name[0]}</span>
                      </div>
                      <div>
                        <p className="font-medium text-white text-sm">{company.name}</p>
                        <p className="text-xs text-gray-500">{company.email}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <p className="text-xs text-gray-600">
                        {new Date(company.created_at).toLocaleDateString()}
                      </p>
                      <button
                        onClick={() => handleDeleteCompany(company.id, company.name)}
                        className="text-xs text-gray-600 hover:text-red-400 transition">
                        Delete
                      </button>
                    </div>
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
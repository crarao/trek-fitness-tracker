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

  useEffect(() => {
    fetchAll()
  }, [])

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

  const handleCreateCompany = async () => {
    setSaving(true)
    setMessage('')

    const { data: company, error: companyError } = await supabase
      .from('companies')
      .insert({ name: newCompany.name, email: newCompany.email })
      .select()
      .single()

    if (companyError) {
      setMessage('Error creating company: ' + companyError.message)
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
      setMessage('Error creating admin user: ' + result.error)
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
        <div>
          <h1 className="text-xl font-bold text-orange-500">CoachBoard</h1>
          <p className="text-xs text-gray-400">Super Admin</p>
        </div>
        <button onClick={handleLogout} className="text-sm text-gray-400 hover:text-white transition">
          Logout
        </button>
      </div>

      {/* Stats */}
      <div className="max-w-4xl mx-auto px-6 pt-6 grid grid-cols-2 gap-4 mb-6">
        <div className="bg-gray-900 rounded-xl p-5 border border-gray-800 text-center">
          <p className="text-4xl font-bold text-orange-500">{companies.length}</p>
          <p className="text-sm text-gray-400 mt-1">Total Companies</p>
        </div>
        <div className="bg-gray-900 rounded-xl p-5 border border-gray-800 text-center">
          <p className="text-4xl font-bold text-orange-500">{clients.length}</p>
          <p className="text-sm text-gray-400 mt-1">Total Clients</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="max-w-4xl mx-auto px-6">
        <div className="flex border-b border-gray-800 mb-6">
          {(['companies', 'clients'] as const).map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={`px-6 py-3 text-sm font-medium capitalize transition ${activeTab === tab
                ? 'text-orange-500 border-b-2 border-orange-500'
                : 'text-gray-400 hover:text-white'}`}>
              {tab === 'companies' ? `Companies (${companies.length})` : `All Clients (${clients.length})`}
            </button>
          ))}
        </div>

        {/* COMPANIES TAB */}
        {activeTab === 'companies' && (
          <div>
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-semibold">Companies</h2>
              <button
                onClick={() => setShowForm(!showForm)}
                className="bg-orange-500 hover:bg-orange-600 text-white text-sm px-4 py-2 rounded-lg transition">
                + Add Company
              </button>
            </div>

            {showForm && (
              <div className="bg-gray-900 rounded-xl p-6 mb-6 space-y-4 border border-gray-800">
                <h3 className="font-semibold">New Company</h3>
                <input type="text" placeholder="Company name"
                  value={newCompany.name}
                  onChange={(e) => setNewCompany({ ...newCompany, name: e.target.value })}
                  className="w-full bg-gray-800 text-white rounded-lg px-4 py-3 outline-none focus:ring-2 focus:ring-orange-500" />
                <input type="email" placeholder="Admin email"
                  value={newCompany.email}
                  onChange={(e) => setNewCompany({ ...newCompany, email: e.target.value })}
                  className="w-full bg-gray-800 text-white rounded-lg px-4 py-3 outline-none focus:ring-2 focus:ring-orange-500" />
                <input type="password" placeholder="Admin password"
                  value={newCompany.adminPassword}
                  onChange={(e) => setNewCompany({ ...newCompany, adminPassword: e.target.value })}
                  className="w-full bg-gray-800 text-white rounded-lg px-4 py-3 outline-none focus:ring-2 focus:ring-orange-500" />
                {message && <p className="text-sm text-orange-400">{message}</p>}
                <button onClick={handleCreateCompany} disabled={saving}
                  className="w-full bg-orange-500 hover:bg-orange-600 text-white font-semibold py-3 rounded-lg transition disabled:opacity-50">
                  {saving ? 'Creating...' : 'Create Company'}
                </button>
              </div>
            )}

            {loading ? (
              <p className="text-gray-400">Loading...</p>
            ) : companies.length === 0 ? (
              <div className="bg-gray-900 rounded-xl p-8 text-center text-gray-400">
                No companies yet. Add your first one!
              </div>
            ) : (
              <div className="space-y-3">
                {companies.map((company) => (
                  <div key={company.id} className="bg-gray-900 rounded-xl px-6 py-4 flex justify-between items-center border border-gray-800">
                    <div>
                      <p className="font-semibold">{company.name}</p>
                      <p className="text-sm text-gray-400">{company.email}</p>
                    </div>
                    <div className="flex items-center gap-4">
                      <p className="text-xs text-gray-500">
                        {new Date(company.created_at).toLocaleDateString()}
                      </p>
                      <button
                        onClick={() => handleDeleteCompany(company.id, company.name)}
                        className="text-xs text-red-400 hover:text-red-300 transition">
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
            <h2 className="text-lg font-semibold mb-4">All Clients</h2>
            {loading ? (
              <p className="text-gray-400">Loading...</p>
            ) : clients.length === 0 ? (
              <div className="bg-gray-900 rounded-xl p-8 text-center text-gray-400">
                No clients yet across any company.
              </div>
            ) : (
              <div className="space-y-3">
                {clients.map((client) => (
                  <div key={client.id} className="bg-gray-900 rounded-xl px-6 py-4 flex justify-between items-center border border-gray-800">
                    <div>
                      <p className="font-semibold">{client.full_name}</p>
                      <p className="text-sm text-gray-400">{client.email}</p>
                    </div>
                    <div className="bg-gray-800 px-3 py-1 rounded-full">
                      <p className="text-xs text-orange-400">{client.company_name}</p>
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
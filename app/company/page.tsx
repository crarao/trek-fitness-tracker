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
  const [showForm, setShowForm] = useState(false)
  const [newClient, setNewClient] = useState({ full_name: '', email: '', password: '' })
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    initialize()
  }, [])

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
      .select('name')
      .eq('id', profile.company_id)
      .single()

    setCompanyName(company?.name || '')
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
        role: 'client'
      })
    })

    const result = await response.json()
    if (result.error) {
      setMessage('Error: ' + result.error)
      setSaving(false)
      return
    }

    setMessage('Client created successfully!')
    setNewClient({ full_name: '', email: '', password: '' })
    setShowForm(false)
    setSaving(false)
    fetchClients(companyId!)
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Header */}
      <div className="bg-gray-900 border-b border-gray-800 px-6 py-4 flex justify-between items-center">
        <div>
          <h1 className="text-xl font-bold text-orange-500">{companyName}</h1>
          <p className="text-xs text-gray-400">Company Admin</p>
        </div>
        <button onClick={handleLogout} className="text-sm text-gray-400 hover:text-white transition">
          Logout
        </button>
      </div>

      <div className="max-w-4xl mx-auto p-6">
        {/* Stats */}
        <div className="bg-gray-900 rounded-xl p-6 mb-6">
          <p className="text-gray-400 text-sm">Total Clients</p>
          <p className="text-4xl font-bold text-orange-500">{clients.length}</p>
        </div>

        {/* Clients List */}
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold">Clients</h2>
          <button
            onClick={() => setShowForm(!showForm)}
            className="bg-orange-500 hover:bg-orange-600 text-white text-sm px-4 py-2 rounded-lg transition"
          >
            + Add Client
          </button>
        </div>

        {/* Add Client Form */}
        {showForm && (
          <div className="bg-gray-900 rounded-xl p-6 mb-6 space-y-4">
            <h3 className="font-semibold">New Client</h3>
            <input
              type="text"
              placeholder="Full name"
              value={newClient.full_name}
              onChange={(e) => setNewClient({ ...newClient, full_name: e.target.value })}
              className="w-full bg-gray-800 text-white rounded-lg px-4 py-3 outline-none focus:ring-2 focus:ring-orange-500"
            />
            <input
              type="email"
              placeholder="Email"
              value={newClient.email}
              onChange={(e) => setNewClient({ ...newClient, email: e.target.value })}
              className="w-full bg-gray-800 text-white rounded-lg px-4 py-3 outline-none focus:ring-2 focus:ring-orange-500"
            />
            <input
              type="password"
              placeholder="Temporary password"
              value={newClient.password}
              onChange={(e) => setNewClient({ ...newClient, password: e.target.value })}
              className="w-full bg-gray-800 text-white rounded-lg px-4 py-3 outline-none focus:ring-2 focus:ring-orange-500"
            />
            {message && <p className="text-sm text-orange-400">{message}</p>}
            <button
              onClick={handleCreateClient}
              disabled={saving}
              className="w-full bg-orange-500 hover:bg-orange-600 text-white font-semibold py-3 rounded-lg transition disabled:opacity-50"
            >
              {saving ? 'Creating...' : 'Create Client'}
            </button>
          </div>
        )}

        {/* Clients Table */}
        {loading ? (
          <p className="text-gray-400">Loading...</p>
        ) : clients.length === 0 ? (
          <div className="bg-gray-900 rounded-xl p-8 text-center text-gray-400">
            No clients yet. Add your first one!
          </div>
        ) : (
          <div className="space-y-3">
            {clients.map((client) => (
              <div
                key={client.id}
                onClick={() => router.push(`/company/client/${client.id}`)}
                className="bg-gray-900 rounded-xl px-6 py-4 flex justify-between items-center cursor-pointer hover:bg-gray-800 transition"
              >
                <div>
                  <p className="font-semibold">{client.full_name}</p>
                  <p className="text-sm text-gray-400">{client.email}</p>
                </div>
                <p className="text-orange-500 text-sm">View →</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
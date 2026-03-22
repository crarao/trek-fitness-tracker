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

export default function AdminPage() {
  const router = useRouter()
  const [companies, setCompanies] = useState<Company[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [newCompany, setNewCompany] = useState({ name: '', email: '', adminPassword: '' })
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    fetchCompanies()
  }, [])

  const fetchCompanies = async () => {
    const { data } = await supabase.from('companies').select('*').order('created_at', { ascending: false })
    setCompanies(data || [])
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
    fetchCompanies()
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <div className="bg-gray-900 border-b border-gray-800 px-6 py-4 flex justify-between items-center">
        <div>
          <h1 className="text-xl font-bold text-orange-500">Trek Fitness</h1>
          <p className="text-xs text-gray-400">Super Admin</p>
        </div>
        <button onClick={handleLogout} className="text-sm text-gray-400 hover:text-white transition">
          Logout
        </button>
      </div>

      <div className="max-w-4xl mx-auto p-6">
        <div className="bg-gray-900 rounded-xl p-6 mb-6">
          <p className="text-gray-400 text-sm">Total Companies</p>
          <p className="text-4xl font-bold text-orange-500">{companies.length}</p>
        </div>

        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold">Companies</h2>
          <button
            onClick={() => setShowForm(!showForm)}
            className="bg-orange-500 hover:bg-orange-600 text-white text-sm px-4 py-2 rounded-lg transition"
          >
            + Add Company
          </button>
        </div>

        {showForm && (
          <div className="bg-gray-900 rounded-xl p-6 mb-6 space-y-4">
            <h3 className="font-semibold text-white">New Company</h3>
            <input
              type="text"
              placeholder="Company name"
              value={newCompany.name}
              onChange={(e) => setNewCompany({ ...newCompany, name: e.target.value })}
              className="w-full bg-gray-800 text-white rounded-lg px-4 py-3 outline-none focus:ring-2 focus:ring-orange-500"
            />
            <input
              type="email"
              placeholder="Admin email"
              value={newCompany.email}
              onChange={(e) => setNewCompany({ ...newCompany, email: e.target.value })}
              className="w-full bg-gray-800 text-white rounded-lg px-4 py-3 outline-none focus:ring-2 focus:ring-orange-500"
            />
            <input
              type="password"
              placeholder="Admin password"
              value={newCompany.adminPassword}
              onChange={(e) => setNewCompany({ ...newCompany, adminPassword: e.target.value })}
              className="w-full bg-gray-800 text-white rounded-lg px-4 py-3 outline-none focus:ring-2 focus:ring-orange-500"
            />
            {message && <p className="text-sm text-orange-400">{message}</p>}
            <button
              onClick={handleCreateCompany}
              disabled={saving}
              className="w-full bg-orange-500 hover:bg-orange-600 text-white font-semibold py-3 rounded-lg transition disabled:opacity-50"
            >
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
              <div key={company.id} className="bg-gray-900 rounded-xl px-6 py-4 flex justify-between items-center">
                <div>
                  <p className="font-semibold">{company.name}</p>
                  <p className="text-sm text-gray-400">{company.email}</p>
                </div>
                <p className="text-xs text-gray-500">
                  {new Date(company.created_at).toLocaleDateString()}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
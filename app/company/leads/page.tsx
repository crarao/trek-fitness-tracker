'use client'

// Leads / enquiry tracking (ROADMAP #52): walk-ins and DMs, followed up on WhatsApp, converted to members.
// Leads are never deleted (CLAUDE.md Rule #1, no delete permission on the table): they end as Joined or Lost.

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { type Country, normalizeCountry, formatDate, localDateIso } from '@/lib/locale'
import { type Lead, followUpState, isOpen, sourceLabel, interestLabel, normalizePhone } from '@/lib/leads'

const LEAD_COLUMNS = 'id, company_id, name, phone, source, interest, status, follow_up_date, last_contacted_at, lost_reason, notes, converted_profile_id, created_at, updated_at'

type Member = { id: string; full_name: string; phone: string | null }
type Filter = 'due' | 'new' | 'trial' | 'open' | 'closed'

const STATUS_STYLE: Record<Lead['status'], { label: string; cls: string }> = {
  new:    { label: 'New',    cls: 'bg-blue-900/50 text-blue-300' },
  trial:  { label: 'Trial',  cls: 'bg-purple-900/50 text-purple-300' },
  joined: { label: 'Joined', cls: 'bg-green-900/50 text-green-400' },
  lost:   { label: 'Lost',   cls: 'bg-gray-800 text-gray-400' },
}

export default function LeadsPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [companyName, setCompanyName] = useState('')
  const [country, setCountry] = useState<Country | null>(null)
  const [businessType, setBusinessType] = useState<string | null>(null)
  const [leads, setLeads] = useState<Lead[]>([])
  const [members, setMembers] = useState<Member[]>([])
  const [filter, setFilter] = useState<Filter>('due')
  const [searchQuery, setSearchQuery] = useState('')
  const [toast, setToast] = useState<{ text: string; kind: 'success' | 'error' } | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const showToast = (text: string, kind: 'success' | 'error' = 'success') => {
    if (toastTimer.current) clearTimeout(toastTimer.current)
    setToast({ text, kind })
    toastTimer.current = setTimeout(() => setToast(null), 3000)
  }

  useEffect(() => { initialize() }, [])

  const initialize = async () => {
    const { data: { session } } = await supabase.auth.getSession()
    const user = session?.user
    if (!user) { router.push('/login'); return }

    const { data: profile } = await supabase
      .from('profiles')
      .select('company_id, companies:company_id(name, country, business_type)')
      .eq('id', user.id)
      .single()
    if (!profile?.company_id) { router.push('/login'); return }

    type CompanyRow = { name: string | null; country: string | null; business_type: string | null }
    const company = (profile as unknown as { companies: CompanyRow | null }).companies
    setCompanyId(profile.company_id)
    setCompanyName(company?.name || '')
    setCountry(normalizeCountry(company?.country))
    setBusinessType(company?.business_type || null)

    // Leads and members' phones (for the duplicate check) in parallel
    const [{ data: leadRows, error: leadsError }, { data: memberRows }] = await Promise.all([
      supabase.from('leads').select(LEAD_COLUMNS).eq('company_id', profile.company_id).order('created_at', { ascending: false }),
      supabase.from('profiles').select('id, full_name, phone').eq('company_id', profile.company_id).eq('role', 'client'),
    ])
    if (leadsError) {
      console.error('Leads fetch error:', leadsError)
      showToast("Couldn't load leads", 'error')
    }
    setLeads((leadRows || []) as Lead[])
    setMembers((memberRows || []) as Member[])
    setLoading(false)
  }

  const todayIso = localDateIso()
  const openLeads = leads.filter(isOpen)
  const dueLeads = openLeads
    .filter(l => { const s = followUpState(l, todayIso); return s === 'overdue' || s === 'today' })
    .sort((a, b) => (a.follow_up_date || '').localeCompare(b.follow_up_date || ''))  // overdue (earlier dates) first
  const closedLeads = leads
    .filter(l => !isOpen(l))
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))

  const byFilter: Record<Filter, Lead[]> = {
    due: dueLeads,
    new: openLeads.filter(l => l.status === 'new'),
    trial: openLeads.filter(l => l.status === 'trial'),
    open: openLeads,
    closed: closedLeads,
  }
  const FILTERS: { key: Filter; label: string }[] = [
    { key: 'due', label: 'Due' }, { key: 'new', label: 'New' }, { key: 'trial', label: 'Trial' },
    { key: 'open', label: 'All open' }, { key: 'closed', label: 'Closed' },
  ]

  const q = searchQuery.trim().toLowerCase()
  const qDigits = q.replace(/\D/g, '')
  const visible = byFilter[filter].filter(l =>
    !q || l.name.toLowerCase().includes(q) || (!!qDigits && (l.phone || '').includes(qDigits)))

  const openLead = (lead: Lead) => {
    // Task 3: opens the edit panel
    void lead
  }

  const followUpText = (lead: Lead) => {
    const state = followUpState(lead, todayIso)
    if (state === 'overdue') return <span className="text-red-400 font-medium">Overdue · {formatDate(lead.follow_up_date, country, 'dayMonth')}</span>
    if (state === 'today') return <span className="text-amber-400 font-medium">Today</span>
    if (state === 'upcoming') return <span className="text-gray-500">{formatDate(lead.follow_up_date, country, 'dayMonth')}</span>
    return null
  }

  const emptyText = leads.length === 0
    ? 'No enquiries yet. Add the first one when someone walks in or DMs you.'
    : q ? `No enquiries match "${searchQuery.trim()}".`
    : filter === 'due' ? 'No follow-ups due. 🎉'
    : filter === 'closed' ? 'No closed enquiries yet.'
    : filter === 'open' ? 'No open enquiries.'
    : `No ${filter} enquiries.`

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
        <div className="flex justify-between items-center gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <button data-nav onClick={() => router.push('/company')}
              className="text-xs text-gray-400 hover:text-white border border-gray-700 hover:border-gray-500 px-3 py-1.5 rounded-lg transition shrink-0">
              ← Back
            </button>
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl font-bold text-white">Leads</h1>
              {companyName && <p className="text-xs text-gray-500 truncate">{companyName}</p>}
            </div>
          </div>
          <button onClick={() => { /* Task 3: add panel */ }}
            className="bg-white hover:bg-gray-100 text-gray-900 text-xs sm:text-sm px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg transition font-medium shrink-0">
            + Add enquiry
          </button>
        </div>
      </div>

      <div className="px-4 sm:px-8 py-5 max-w-3xl mx-auto">
        <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
          {/* Filter chips + search */}
          <div className="px-4 sm:px-6 pt-4 pb-3 border-b border-gray-800 space-y-3">
            <div className="flex gap-1 flex-wrap">
              {FILTERS.map(f => (
                <button key={f.key} onClick={() => setFilter(f.key)}
                  className={`text-xs px-2.5 py-1.5 rounded-lg transition font-medium ${
                    filter === f.key ? 'bg-white text-gray-900' : 'text-gray-500 hover:bg-gray-800 hover:text-white'}`}>
                  {f.label}
                  {!loading && <span className="ml-1 text-xs opacity-60">({byFilter[f.key].length})</span>}
                </button>
              ))}
            </div>
            <input type="text" placeholder="Search by name or phone..."
              value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
              className="w-full bg-gray-800 text-white rounded-lg px-4 py-2 outline-none focus:ring-2 focus:ring-white border border-gray-700 text-sm placeholder-gray-600" />
          </div>

          {loading ? (
            <div className="divide-y divide-gray-800" aria-busy="true">
              <span className="sr-only" role="status">Loading leads…</span>
              {[0, 1, 2, 3].map(i => (
                <div key={i} className="px-4 sm:px-6 py-4 flex items-center gap-3">
                  <div className="flex-1 space-y-2">
                    <div className="h-3.5 w-1/3 rounded bg-gray-800 animate-pulse" />
                    <div className="h-3 w-1/2 rounded bg-gray-800/70 animate-pulse" />
                  </div>
                  <div className="h-6 w-14 rounded-full bg-gray-800 animate-pulse" />
                </div>
              ))}
            </div>
          ) : visible.length === 0 ? (
            <div className="px-6 py-12 text-center text-gray-500 text-sm">{emptyText}</div>
          ) : (
            <ul className="divide-y divide-gray-800">
              {visible.map(lead => {
                const st = STATUS_STYLE[lead.status]
                const details = [sourceLabel(lead.source), interestLabel(lead.interest)].filter(Boolean).join(' · ')
                const fu = followUpText(lead)
                return (
                  <li key={lead.id}>
                    <button type="button" onClick={() => openLead(lead)}
                      className="w-full text-left px-4 sm:px-6 py-3.5 hover:bg-gray-800/50 active:bg-gray-800 transition flex items-start justify-between gap-3">
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-white truncate">{lead.name}</span>
                        <span className="block text-xs text-gray-500 truncate">
                          {details}
                          {details && fu ? ' · ' : ''}
                          {fu}
                        </span>
                        {lead.notes?.trim() && (
                          <span className="block text-xs text-gray-600 truncate mt-0.5">{lead.notes.trim().split('\n')[0]}</span>
                        )}
                      </span>
                      <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full shrink-0 ${st.cls}`}>{st.label}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

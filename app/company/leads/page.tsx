'use client'

// Leads / enquiry tracking (ROADMAP #52): walk-ins and DMs, followed up on WhatsApp, converted to members.
// Leads are never deleted (CLAUDE.md Rule #1, no delete permission on the table): they end as Joined or Lost.

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { type Country, normalizeCountry, formatDate, localDateIso, phonePlaceholder, dialCode } from '@/lib/locale'
import {
  type Lead, followUpState, isOpen, isGymType, SOURCES, INTERESTS, LOST_REASONS,
  sourceLabel, interestLabel, normalizePhone, leadMessage, localDayOf,
} from '@/lib/leads'

const LEAD_COLUMNS = 'id, company_id, name, phone, source, interest, status, follow_up_date, last_contacted_at, lost_reason, notes, converted_profile_id, created_at, updated_at'

type Member = { id: string; full_name: string; phone: string | null }
type Filter = 'due' | 'new' | 'trial' | 'open' | 'closed'
type LeadForm = { name: string; phone: string; source: string; interest: string; follow_up_date: string; notes: string }

const INPUT = 'w-full bg-gray-800 text-white rounded-lg px-4 py-2.5 outline-none focus:ring-2 focus:ring-white border border-gray-700 text-sm placeholder-gray-600'
const chipCls = (on: boolean) =>
  `text-xs px-2.5 py-1.5 rounded-lg border transition font-medium ${on ? 'bg-white text-gray-900 border-white' : 'border-gray-700 text-gray-400 hover:bg-gray-800'}`

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
  // Inline add / edit panel (no modal): null = closed, '' = adding, else the lead being edited
  const [panelId, setPanelId] = useState<string | null>(null)
  const [form, setForm] = useState<LeadForm>({ name: '', phone: '', source: '', interest: 'membership', follow_up_date: '', notes: '' })
  const [panelError, setPanelError] = useState('')
  const [savingForm, setSavingForm] = useState(false)
  const panelRef = useRef<HTMLDivElement | null>(null)
  // Status prompts inside the edit panel: trial asks for a follow-up date, lost asks for a reason
  const [statusPrompt, setStatusPrompt] = useState<'trial' | 'lost' | null>(null)
  const [trialDate, setTrialDate] = useState('')
  const [lostChip, setLostChip] = useState('')
  const [lostText, setLostText] = useState('')
  const [acting, setActing] = useState(false)
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

  const scrollToPanel = () => setTimeout(() => panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)

  const openAdd = () => {
    setPanelId('')
    setForm({ name: '', phone: '', source: SOURCES(businessType)[0].key, interest: 'membership', follow_up_date: localDateIso(1), notes: '' })
    setPanelError('')
    scrollToPanel()
  }

  const openLead = (lead: Lead) => {
    setPanelId(lead.id)
    setForm({
      name: lead.name, phone: lead.phone || '', source: lead.source || '', interest: lead.interest || '',
      follow_up_date: lead.follow_up_date || '', notes: lead.notes || '',
    })
    setPanelError('')
    setStatusPrompt(null)
    scrollToPanel()
  }

  const closePanel = () => { setPanelId(null); setPanelError('') }

  const editing = panelId ? leads.find(l => l.id === panelId) || null : null
  const phoneRequired = isGymType(businessType)

  // Duplicate check on the normalised phone: an existing member, or another open lead. Saving is still allowed.
  const formPhone = normalizePhone(form.phone, country ?? 'IN')
  const dupMember = formPhone ? members.find(m => normalizePhone(m.phone, country ?? 'IN') === formPhone) : undefined
  const dupLead = formPhone
    ? openLeads.find(l => l.id !== panelId && normalizePhone(l.phone, country ?? 'IN') === formPhone)
    : undefined

  // Every update checks a row came back: RLS blocks return 0 rows without an error
  const saveLead = async (id: string, changes: Partial<Lead>): Promise<Lead | null> => {
    const { data, error } = await supabase.from('leads').update(changes).eq('id', id).select(LEAD_COLUMNS)
    if (error || !data?.length) {
      if (error) console.error('Lead update error:', error)
      showToast("Couldn't save", 'error')
      return null
    }
    const row = data[0] as Lead
    setLeads(prev => prev.map(l => (l.id === id ? row : l)))
    return row
  }

  // Run one immediate save from the action buttons (one at a time)
  const act = async (changes: Partial<Lead>, toastText: string) => {
    if (!editing || acting) return null
    setActing(true)
    const row = await saveLead(editing.id, changes)
    setActing(false)
    if (row) { showToast(toastText); setStatusPrompt(null) }
    return row
  }

  const setFollowUp = (date: string) => {
    if (!date) return
    act({ follow_up_date: date }, `✓ Follow-up set for ${formatDate(date, country, 'dayMonth')}`)
  }

  const handleWhatsApp = () => {
    if (!editing?.phone) return
    const text = leadMessage(editing, companyName, businessType)
    // Open first (inside the tap, so phones don't block it), then record the contact
    window.open(`https://wa.me/${dialCode(country ?? 'IN')}${editing.phone}?text=${encodeURIComponent(text)}`, '_blank')
    saveLead(editing.id, { last_contacted_at: new Date().toISOString() })
  }

  const lastContactedText = (lead: Lead) => {
    if (!lead.last_contacted_at) return ''
    const day = localDayOf(lead.last_contacted_at)
    return day === todayIso ? 'today' : formatDate(day, country, 'dayMonth')
  }

  const handleSaveForm = async () => {
    const name = form.name.trim()
    if (!name) { setPanelError('Enter a name'); return }
    if (phoneRequired && !formPhone) { setPanelError('Enter a phone number'); return }
    setSavingForm(true)
    setPanelError('')
    const fields = {
      name,
      phone: formPhone || null,
      source: form.source || null,
      interest: form.interest || null,
      notes: form.notes.trim() || null,
    }
    if (editing) {
      const row = await saveLead(editing.id, fields)
      setSavingForm(false)
      if (row) showToast('✓ Enquiry saved')
      return
    }
    // created_by is filled by the database default (auth.uid())
    const { data, error } = await supabase
      .from('leads')
      .insert({ company_id: companyId, ...fields, follow_up_date: form.follow_up_date || null })
      .select(LEAD_COLUMNS)
      .single()
    setSavingForm(false)
    if (error || !data) {
      if (error) console.error('Lead insert error:', error)
      setPanelError("Couldn't save the enquiry" + (error ? `: ${error.message}` : ''))
      return
    }
    setLeads(prev => [data as Lead, ...prev])
    closePanel()
    showToast('✓ Enquiry added')
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
          <button onClick={openAdd}
            className="bg-white hover:bg-gray-100 text-gray-900 text-xs sm:text-sm px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg transition font-medium shrink-0">
            + Add enquiry
          </button>
        </div>
      </div>

      <div className="px-4 sm:px-8 py-5 max-w-3xl mx-auto space-y-4">
        {/* Add / edit panel */}
        {panelId !== null && (
          <div ref={panelRef} className="bg-gray-900 border border-gray-700 rounded-2xl p-5 scroll-mt-4">
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-semibold text-white">{editing ? editing.name : 'New enquiry'}</h3>
              <button onClick={closePanel} aria-label="Close"
                className="text-gray-500 hover:text-white transition text-xl leading-none">✕</button>
            </div>

            {editing && (
              <div className="mb-5 pb-5 border-b border-gray-800 space-y-4">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className={`font-medium px-2 py-0.5 rounded-full ${STATUS_STYLE[editing.status].cls}`}>{STATUS_STYLE[editing.status].label}</span>
                  {editing.last_contacted_at && <span className="text-gray-400">Last contacted: {lastContactedText(editing)}</span>}
                  {editing.status === 'lost' && editing.lost_reason && <span className="text-gray-500">· {editing.lost_reason}</span>}
                </div>

                {/* WhatsApp follow-up (not for members who already joined) */}
                {editing.status !== 'joined' && (
                  <div>
                    <button type="button" onClick={handleWhatsApp} disabled={!editing.phone}
                      className="w-full sm:w-auto text-sm px-4 py-2.5 rounded-lg border border-green-700 text-green-400 hover:bg-green-900/30 transition font-medium disabled:opacity-40 disabled:hover:bg-transparent">
                      WhatsApp
                    </button>
                    {!editing.phone && <p className="text-xs text-gray-500 mt-1">No phone number</p>}
                  </div>
                )}

                {/* Next follow-up: each choice saves straight away */}
                {isOpen(editing) && (
                  <div>
                    <p className="text-xs text-gray-500 mb-1.5">
                      Next follow-up{editing.follow_up_date ? <>: <span className="text-gray-300">{formatDate(editing.follow_up_date, country, 'weekday')}</span></> : ''}
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      {([['+1 day', 1], ['+3 days', 3], ['+1 week', 7]] as const).map(([label, n]) => (
                        <button key={label} type="button" disabled={acting} onClick={() => setFollowUp(localDateIso(n))}
                          className={chipCls(editing.follow_up_date === localDateIso(n))}>
                          {label}
                        </button>
                      ))}
                      <input type="date" value={editing.follow_up_date || ''} disabled={acting}
                        onChange={e => setFollowUp(e.target.value)}
                        className="bg-gray-800 text-white rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-white border border-gray-700 text-xs" />
                    </div>
                  </div>
                )}

                {/* Status */}
                <div className="flex flex-wrap gap-2">
                  {editing.status === 'new' && (
                    <button type="button" onClick={() => { setStatusPrompt('trial'); setTrialDate(localDateIso(2)) }}
                      className="text-xs px-3 py-1.5 rounded-lg border border-purple-800 text-purple-300 hover:bg-purple-900/30 transition font-medium">
                      Mark as trial
                    </button>
                  )}
                  {isOpen(editing) && (
                    <button type="button" onClick={() => { setStatusPrompt('lost'); setLostChip(''); setLostText('') }}
                      className="text-xs px-3 py-1.5 rounded-lg border border-gray-700 text-gray-400 hover:bg-gray-800 transition font-medium">
                      Mark as lost
                    </button>
                  )}
                  {editing.status === 'lost' && (
                    <button type="button" disabled={acting} onClick={() => act({ status: 'new' }, '✓ Re-opened')}
                      className="text-xs px-3 py-1.5 rounded-lg border border-blue-800 text-blue-300 hover:bg-blue-900/30 transition font-medium">
                      Re-open
                    </button>
                  )}
                  {/* CONVERT TO MEMBER */}
                </div>

                {statusPrompt === 'trial' && (
                  <div className="bg-gray-800/60 rounded-xl p-3 space-y-2">
                    <label className="text-xs text-gray-400 block">Follow up after the trial on</label>
                    <input type="date" value={trialDate} onChange={e => setTrialDate(e.target.value)} className={INPUT} />
                    {trialDate && <p className="text-xs text-gray-400">{formatDate(trialDate, country, 'weekday')}</p>}
                    <div className="flex gap-2">
                      <button type="button" disabled={acting}
                        onClick={() => act({ status: 'trial', follow_up_date: trialDate || null }, '✓ Marked as trial')}
                        className="flex-1 bg-white hover:bg-gray-100 text-gray-900 font-semibold py-2 rounded-lg transition disabled:opacity-50 text-sm">
                        Mark as trial
                      </button>
                      <button type="button" onClick={() => setStatusPrompt(null)}
                        className="px-4 py-2 border border-gray-700 rounded-lg text-gray-400 hover:bg-gray-800 text-sm transition">Cancel</button>
                    </div>
                  </div>
                )}

                {statusPrompt === 'lost' && (
                  <div className="bg-gray-800/60 rounded-xl p-3 space-y-2">
                    <p className="text-xs text-gray-400">Why was it lost?</p>
                    <div className="flex flex-wrap gap-2">
                      {LOST_REASONS.map(r => (
                        <button key={r} type="button" onClick={() => setLostChip(r)} className={chipCls(lostChip === r)}>{r}</button>
                      ))}
                    </div>
                    <input type="text" placeholder="Details (optional)" value={lostText}
                      onChange={e => setLostText(e.target.value)} className={INPUT} />
                    <div className="flex gap-2">
                      <button type="button" disabled={acting || (!lostChip && !lostText.trim())}
                        onClick={() => act({
                          status: 'lost',
                          lost_reason: [lostChip, lostText.trim()].filter(Boolean).join(': '),
                          follow_up_date: null,
                        }, 'Marked as lost')}
                        className="flex-1 bg-white hover:bg-gray-100 text-gray-900 font-semibold py-2 rounded-lg transition disabled:opacity-50 text-sm">
                        Mark as lost
                      </button>
                      <button type="button" onClick={() => setStatusPrompt(null)}
                        className="px-4 py-2 border border-gray-700 rounded-lg text-gray-400 hover:bg-gray-800 text-sm transition">Cancel</button>
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="space-y-3">
              <input type="text" placeholder="Name" value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })} className={INPUT} />
              <div>
                <input type="tel" placeholder={`${phonePlaceholder(country ?? 'IN')}${phoneRequired ? '' : ' (optional)'}`} value={form.phone}
                  onChange={e => setForm({ ...form, phone: e.target.value })} className={INPUT} />
                {dupMember && (
                  <p className="text-xs text-amber-400 mt-1.5">
                    Already a member: {dupMember.full_name}{' '}
                    <button type="button" data-nav onClick={() => router.push(`/company/client/${dupMember.id}`)}
                      className="underline text-amber-300 hover:text-amber-200">Open</button>
                  </p>
                )}
                {!dupMember && dupLead && (
                  <button type="button" onClick={() => openLead(dupLead)}
                    className="text-xs text-amber-400 mt-1.5 underline hover:text-amber-300 text-left">
                    Already a lead: {dupLead.name}
                  </button>
                )}
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1.5">Source</p>
                <div className="flex flex-wrap gap-2">
                  {SOURCES(businessType).map(o => (
                    <button key={o.key} type="button" onClick={() => setForm({ ...form, source: o.key })} className={chipCls(form.source === o.key)}>
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1.5">Interested in</p>
                <div className="flex flex-wrap gap-2">
                  {INTERESTS.map(o => (
                    <button key={o.key} type="button" onClick={() => setForm({ ...form, interest: o.key })} className={chipCls(form.interest === o.key)}>
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>
              {!editing && (
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Follow-up date</label>
                  <input type="date" value={form.follow_up_date}
                    onChange={e => setForm({ ...form, follow_up_date: e.target.value })} className={INPUT} />
                  {form.follow_up_date && (
                    <p className="text-xs text-gray-400 mt-1">Follow up: {formatDate(form.follow_up_date, country, 'weekday')}</p>
                  )}
                </div>
              )}
              <textarea placeholder="Notes (optional)" rows={2} value={form.notes}
                onChange={e => setForm({ ...form, notes: e.target.value })} className={`${INPUT} resize-none`} />
            </div>

            {panelError && <p className="text-sm text-red-400 mt-3">{panelError}</p>}
            <div className="flex gap-2 mt-4">
              <button onClick={handleSaveForm} disabled={savingForm}
                className="flex-1 bg-white hover:bg-gray-100 text-gray-900 font-semibold py-2.5 rounded-lg transition disabled:opacity-50 text-sm">
                {savingForm ? 'Saving...' : editing ? 'Save changes' : 'Add enquiry'}
              </button>
              <button onClick={closePanel}
                className="px-4 py-2.5 border border-gray-700 rounded-lg text-gray-400 hover:bg-gray-800 text-sm transition">
                Cancel
              </button>
            </div>
          </div>
        )}

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

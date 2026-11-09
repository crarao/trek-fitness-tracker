'use client'

// Branches & batches (Dojo Build 2, ROADMAP #77; owner / partner, db/2026-11-03-branches-batches.md).
// A branch is a location; a batch is a class at one branch on set days and times.
// Branches are added / edited by super admin only (pricing is per branch, db/2026-11-03-branches-super-admin.md;
// app/branches-editor.tsx in Super Admin). Here the owner and partners see them and manage the batches inside. Students get a home batch on
// Add Student or their Profile tab, and can still attend any batch (attendance: Build 3, #78).
// Nothing is deleted (CLAUDE.md Rule #1; the tables have no delete permission): branches and batches are archived.
// Archiving keeps students' saved branch / batch; they still show, marked "(archived)", until changed.

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { type Country, normalizeCountry } from '@/lib/locale'
import { memberWord } from '@/lib/labels'
import {
  type Branch, type Batch, BRANCH_COLUMNS, BATCH_COLUMNS, WEEKDAYS, batchWhen, sortBatches, sortDays,
  tidyName, nameTaken, batchProblem,
} from '@/lib/batches'

const INPUT = 'w-full bg-gray-800 text-white rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm placeholder-gray-500'
const BTN = 'text-xs text-gray-300 border border-gray-700 hover:border-gray-500 px-3 py-1.5 rounded-lg'

type BatchDraft = { id: string | null; branch_id: string; name: string; days: string[]; start_time: string; end_time: string }

// "18:00:00" (Postgres) → "18:00" for <input type="time">
const hhmm = (t: string | null) => (t || '').slice(0, 5)

export default function BatchesPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [missing, setMissing] = useState(false)
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [companyName, setCompanyName] = useState('')
  const [country, setCountry] = useState<Country>('IN')
  const [businessType, setBusinessType] = useState<string | null>(null)
  const [branches, setBranches] = useState<Branch[]>([])
  const [batches, setBatches] = useState<Batch[]>([])
  const [counts, setCounts] = useState<{ branch: Record<string, number>; batch: Record<string, number> }>({ branch: {}, batch: {} })
  const [batchDraft, setBatchDraft] = useState<BatchDraft | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [toast, setToast] = useState<{ text: string; kind: 'success' | 'error' } | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const showToast = (text: string, kind: 'success' | 'error' = 'success') => {
    if (toastTimer.current) clearTimeout(toastTimer.current)
    setToast({ text, kind })
    toastTimer.current = setTimeout(() => setToast(null), 2500)
  }
  const mw = memberWord(businessType)

  useEffect(() => {
    let live = true
    ;(async () => {
      const { data: { session } } = await supabase.auth.getSession()
      const user = session?.user
      if (!user) { router.push('/login'); return }
      const { data: profile } = await supabase
        .from('profiles').select('company_id, companies:company_id(*)').eq('id', user.id).single()
      if (!profile?.company_id) { router.push('/login'); return }
      const co = (profile as unknown as { companies: { name?: string | null; country?: string | null; business_type?: string | null } | null }).companies
      const cId = profile.company_id as string
      const [br, ba, students] = await Promise.all([
        supabase.from('branches').select(BRANCH_COLUMNS).eq('company_id', cId).order('name'),
        supabase.from('batches').select(BATCH_COLUMNS).eq('company_id', cId),
        // select('*') so this works whether or not branch_id / batch_id exist yet
        supabase.from('profiles').select('*').eq('company_id', cId).eq('role', 'client').is('archived_at', null),
      ])
      if (!live) return
      setCompanyId(cId)
      setCompanyName(co?.name || '')
      setCountry(normalizeCountry(co?.country))
      setBusinessType(co?.business_type ?? null)
      if (br.error || ba.error) { setMissing(true); setLoading(false); return }
      setBranches((br.data || []) as Branch[])
      setBatches((ba.data || []) as Batch[])
      const branch: Record<string, number> = {}, batch: Record<string, number> = {}
      for (const p of (students.data || []) as { branch_id?: string | null; batch_id?: string | null }[]) {
        if (p.branch_id) branch[p.branch_id] = (branch[p.branch_id] || 0) + 1
        if (p.batch_id) batch[p.batch_id] = (batch[p.batch_id] || 0) + 1
      }
      setCounts({ branch, batch })
      setLoading(false)
    })()
    return () => { live = false }
  }, [router])

  const saveBatch = async () => {
    if (!batchDraft || !companyId) return
    const problem = batchProblem(batchDraft)
    if (problem) { setError(problem); return }
    const name = tidyName(batchDraft.name)
    if (nameTaken(batches.filter(b => b.branch_id === batchDraft.branch_id), name, batchDraft.id ?? undefined)) {
      setError('This branch already has a batch with this name.'); return
    }
    setSaving(true)
    setError('')
    const fields = {
      name, branch_id: batchDraft.branch_id, days: sortDays(batchDraft.days),
      start_time: batchDraft.start_time || null, end_time: batchDraft.end_time || null,
    }
    const { data, error } = batchDraft.id
      ? await supabase.from('batches').update(fields).eq('id', batchDraft.id).eq('company_id', companyId).select(BATCH_COLUMNS)
      : await supabase.from('batches').insert({ ...fields, company_id: companyId }).select(BATCH_COLUMNS)
    setSaving(false)
    if (error) { setError(error.code === '23505' ? 'This branch already has a batch with this name.' : 'Could not save: ' + error.message); return }
    if (!data?.length) { setError("Couldn't save: not allowed for this login"); return }
    const row = data[0] as Batch
    setBatches(l => (batchDraft.id ? l.map(b => (b.id === row.id ? row : b)) : [...l, row]))
    setBatchDraft(null)
    showToast(batchDraft.id ? 'Batch saved ✓' : `${row.name} added ✓`)
  }

  const setArchived = async (table: 'branches' | 'batches', id: string, name: string, archived: boolean) => {
    if (!companyId) return
    const { data, error } = await supabase.from(table)
      .update({ is_archived: archived }).eq('id', id).eq('company_id', companyId).select(table === 'branches' ? BRANCH_COLUMNS : BATCH_COLUMNS)
    if (error || !data?.length) { showToast(error ? 'Could not save: ' + error.message : "Couldn't save: not allowed for this login", 'error'); return }
    const row = data[0] as unknown
    if (table === 'branches') setBranches(l => l.map(b => (b.id === id ? row as Branch : b)))
    else setBatches(l => l.map(b => (b.id === id ? row as Batch : b)))
    showToast(archived ? `${name} archived` : `${name} restored`)
  }

  const studentCount = (n: number | undefined) => `${n || 0} ${(n || 0) === 1 ? mw.one.toLowerCase() : mw.many.toLowerCase()}`

  const batchForm = (d: BatchDraft) => (
    <div className="space-y-2 bg-gray-950/60 border border-gray-800 rounded-xl p-3">
      <input value={d.name} maxLength={60} autoFocus placeholder="Batch name (e.g. Juniors, Seniors, Kids 5–8)" aria-label="Batch name"
        onChange={e => setBatchDraft({ ...d, name: e.target.value })} className={INPUT} />
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Days">
        {WEEKDAYS.map(day => {
          const on = d.days.includes(day)
          return (
            <button key={day} type="button" aria-pressed={on}
              onClick={() => setBatchDraft({ ...d, days: on ? d.days.filter(x => x !== day) : [...d.days, day] })}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${on ? 'bg-orange-500 text-white' : 'bg-gray-800 text-gray-400 border border-gray-700 hover:border-gray-500'}`}>
              {day}
            </button>
          )
        })}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-[11px] text-gray-500">Starts
          <input type="time" value={d.start_time} onChange={e => setBatchDraft({ ...d, start_time: e.target.value })} className={`${INPUT} mt-1`} />
        </label>
        <label className="text-[11px] text-gray-500">Ends (optional)
          <input type="time" value={d.end_time} onChange={e => setBatchDraft({ ...d, end_time: e.target.value })} className={`${INPUT} mt-1`} />
        </label>
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={saveBatch} disabled={saving}
          className="flex-1 bg-orange-500 hover:bg-orange-400 text-white text-sm font-semibold py-2 rounded-lg disabled:opacity-50">
          {saving ? 'Saving…' : d.id ? 'Save' : 'Add batch'}
        </button>
        <button type="button" onClick={() => { setBatchDraft(null); setError('') }}
          className="flex-1 bg-gray-800 hover:bg-gray-700 text-white text-sm py-2 rounded-lg">Cancel</button>
      </div>
    </div>
  )

  const branchCard = (br: Branch) => {
    const list = sortBatches(batches.filter(b => b.branch_id === br.id && (showArchived || !b.is_archived)))
    return (
      <section key={br.id} className={`bg-gray-900 border rounded-2xl p-4 space-y-3 ${br.is_archived ? 'border-gray-800 opacity-70' : 'border-gray-800'}`}>
        <div className="min-w-0">
          <p className="text-base font-semibold text-white truncate">{br.name}{br.is_archived ? ' (archived)' : ''}</p>
          <p className="text-[11px] text-gray-500 truncate">{[br.address, studentCount(counts.branch[br.id])].filter(Boolean).join(' · ')}</p>
        </div>

        {!br.is_archived && (
          <>
            {list.length === 0 && batchDraft?.branch_id !== br.id && <p className="text-sm text-gray-500">No batches yet.</p>}
            <ul className="space-y-2">
              {list.map(b => (
                <li key={b.id}>
                  {batchDraft?.id === b.id ? batchForm(batchDraft) : (
                    <div className="flex items-center gap-3 bg-gray-800/50 rounded-xl px-3 py-2.5">
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm truncate ${b.is_archived ? 'text-gray-500' : 'text-white'}`}>{b.name}{b.is_archived ? ' (archived)' : ''}</p>
                        <p className="text-[11px] text-gray-500 truncate">{[batchWhen(b, country), studentCount(counts.batch[b.id])].filter(Boolean).join(' · ')}</p>
                      </div>
                      {b.is_archived ? (
                        <button type="button" onClick={() => setArchived('batches', b.id, b.name, false)} className={BTN}>Restore</button>
                      ) : (
                        <>
                          <button type="button" onClick={() => {
                            setError('')
                            setBatchDraft({ id: b.id, branch_id: b.branch_id, name: b.name, days: sortDays(b.days), start_time: hhmm(b.start_time), end_time: hhmm(b.end_time) })
                          }} className={BTN}>Edit</button>
                          <button type="button" onClick={() => setArchived('batches', b.id, b.name, true)}
                            className="text-xs text-gray-400 border border-gray-700 hover:border-amber-600 hover:text-amber-300 px-3 py-1.5 rounded-lg">Archive</button>
                        </>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
            {batchDraft && !batchDraft.id && batchDraft.branch_id === br.id ? batchForm(batchDraft) : (
              <button type="button"
                onClick={() => { setError(''); setBatchDraft({ id: null, branch_id: br.id, name: '', days: [], start_time: '', end_time: '' }) }}
                className="w-full text-sm text-orange-400 hover:text-orange-300 border border-dashed border-gray-700 hover:border-orange-700 rounded-xl py-2">
                + Add batch at {br.name}
              </button>
            )}
          </>
        )}
      </section>
    )
  }

  const shownBranches = branches.filter(b => showArchived || !b.is_archived)
  const anyArchived = branches.some(b => b.is_archived) || batches.some(b => b.is_archived)

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

      <div className="bg-gray-900 border-b border-gray-800 px-4 sm:px-8 py-4">
        <div className="flex items-center gap-3 min-w-0">
          <button data-nav onClick={() => router.push('/company')}
            className="text-xs text-gray-400 hover:text-white border border-gray-700 hover:border-gray-500 px-3 py-1.5 rounded-lg transition shrink-0">
            ← Back
          </button>
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-bold text-white">Branches &amp; batches</h1>
            {companyName && <p className="text-xs text-gray-500 truncate">{companyName}</p>}
          </div>
        </div>
      </div>

      <div className="px-4 sm:px-8 py-5 max-w-3xl mx-auto space-y-4">
        <p className="text-xs text-gray-400">
          Add the batches (classes) at each of your branches. Each {mw.one.toLowerCase()} gets a home batch on
          Add {mw.one} or their Profile tab, and can still attend any batch.
        </p>

        {loading ? (
          <div className="h-24 rounded-2xl bg-gray-900 border border-gray-800 animate-pulse" aria-label="Loading" />
        ) : missing ? (
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 text-sm text-gray-400">
            Branches and batches aren&apos;t set up yet. CoachBoard will switch them on for your account.
          </div>
        ) : (
          <div data-testid="page-batches" className="space-y-4">
            {shownBranches.length === 0 && (
              <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 text-sm text-gray-400">
                No branches yet.
              </div>
            )}
            {shownBranches.map(branchCard)}

            {anyArchived && (
              <button type="button" onClick={() => setShowArchived(!showArchived)} aria-pressed={showArchived}
                className="text-xs text-gray-500 hover:text-gray-300">
                {showArchived ? 'Hide archived' : 'Show archived'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

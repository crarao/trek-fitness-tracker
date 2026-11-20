'use client'

// Class activities (dojos; owner / partner; db/2026-11-19-dojo-activities-absences.md).
// The dojo's list of what a class can include (warm-ups, basics, kata, kumite…). The roll call shows it as a
// checklist above the students; "Pre-ticked" ones (the warm-ups) start ticked on every new class.
// Nothing is deleted (CLAUDE.md Rule #1; the table has no delete permission): an activity is archived, and classes
// that did it keep its name. Before the SQL ran, the page says so (the table read errors once).
// Items by belt (db/2026-11-20-activity-items.md): under a category, specific items (katas, kicks, kumite drills…)
// with the belt where they're first taught ("Heian Nidan · Yellow and above"). Shown once the parent_id column
// exists (one probe); items are never pre-ticked and move up / down within their category.

import PageNav from '@/app/page-nav'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { isDojo } from '@/lib/labels'
import {
  type DojoActivity, ACTIVITY_COLUMNS, ACTIVITY_NAME_MAX, ACTIVITY_DESCRIPTION_MAX, sortActivities,
  tidyActivityName, activityNameTaken, activityProblem, nextSortOrder, moveActivity, categoriesOf, itemsOf, fromBeltText,
} from '@/lib/dojo-activities'
import { type BeltRank, BELT_RANK_COLUMNS, gradingOn, beltLabel, beltOptions } from '@/lib/belts'

const INPUT = 'w-full bg-gray-800 text-white rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm placeholder-gray-500'
const BTN = 'text-xs text-gray-300 border border-gray-700 hover:border-gray-500 px-3 py-1.5 rounded-lg disabled:opacity-40'

type Draft = { id: string | null; name: string; description: string; is_default: boolean; parent_id: string | null; min_rank_id: string }

export default function ActivitiesPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [missing, setMissing] = useState(false)
  const [notDojo, setNotDojo] = useState(false)
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [companyName, setCompanyName] = useState('')
  const [list, setList] = useState<DojoActivity[]>([])
  const [itemsOn, setItemsOn] = useState(false)          // parent_id column exists (20 Nov SQL)
  const [ranks, setRanks] = useState<BeltRank[]>([])     // belt grading on: the gym's belts, for "first taught at"
  const [draft, setDraft] = useState<Draft | null>(null)
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

  useEffect(() => {
    let live = true
    ;(async () => {
      const { data: { session } } = await supabase.auth.getSession()
      const user = session?.user
      if (!user) { router.push('/login'); return }
      const { data: profile } = await supabase
        .from('profiles').select('company_id, companies:company_id(*)').eq('id', user.id).single()
      if (!profile?.company_id) { router.push('/login'); return }
      const co = (profile as unknown as { companies: { name?: string | null; business_type?: string | null; grading_enabled?: boolean | null } | null }).companies
      const cId = profile.company_id as string
      const [res, probe, rk] = await Promise.all([
        supabase.from('dojo_activities').select(ACTIVITY_COLUMNS).eq('company_id', cId),
        supabase.from('dojo_activities').select('parent_id').limit(1),
        gradingOn(co) ? supabase.from('belt_ranks').select(BELT_RANK_COLUMNS).eq('company_id', cId) : null,
      ])
      if (!live) return
      setItemsOn(!probe.error)
      setRanks(rk && !rk.error ? beltOptions((rk.data || []) as BeltRank[]) : [])
      setCompanyId(cId)
      setUserId(user.id)
      setCompanyName(co?.name || '')
      if (!isDojo(co?.business_type)) setNotDojo(true)
      if (res.error) setMissing(true)
      else setList((res.data || []) as DojoActivity[])
      setLoading(false)
    })()
    return () => { live = false }
  }, [router])

  const replace = (rows: DojoActivity[]) => setList(l => l.map(a => rows.find(r => r.id === a.id) ?? a))

  const save = async () => {
    if (!draft || !companyId) return
    const problem = activityProblem(draft)
    if (problem) { setError(problem); return }
    const name = tidyActivityName(draft.name)
    if (activityNameTaken(list, name, draft.id ?? undefined)) { setError('There is already an activity with this name (maybe archived).'); return }
    setSaving(true)
    setError('')
    const fields = {
      name, description: draft.description.trim() || null, is_default: draft.parent_id ? false : draft.is_default,
      ...(itemsOn && draft.parent_id ? { min_rank_id: draft.min_rank_id || null } : {}),
    }
    const siblings = list.filter(a => (a.parent_id ?? null) === draft.parent_id)
    const { data, error } = draft.id
      ? await supabase.from('dojo_activities').update(fields).eq('id', draft.id).eq('company_id', companyId).select(ACTIVITY_COLUMNS)
      : await supabase.from('dojo_activities')
        .insert({ ...fields, ...(itemsOn && draft.parent_id ? { parent_id: draft.parent_id } : {}), company_id: companyId, sort_order: nextSortOrder(siblings), created_by: userId })
        .select(ACTIVITY_COLUMNS)
    setSaving(false)
    if (error) { setError(error.code === '23505' ? 'There is already an activity or item with this name (maybe archived).' : 'Could not save: ' + error.message); return }
    if (!data?.length) { setError("Couldn't save: not allowed for this login"); return }
    const row = data[0] as DojoActivity
    if (draft.id) replace([row]); else setList(l => [...l, row])
    setDraft(null)
    showToast(draft.id ? 'Saved ✓' : `${row.name} added ✓`)
  }

  const patch = async (a: DojoActivity, fields: Partial<DojoActivity>, done: string) => {
    if (!companyId) return
    const { data, error } = await supabase.from('dojo_activities').update(fields).eq('id', a.id).eq('company_id', companyId).select(ACTIVITY_COLUMNS)
    if (error || !data?.length) { showToast(error ? 'Could not save: ' + error.message : "Couldn't save: not allowed for this login", 'error'); return }
    replace(data as DojoActivity[])
    if (done) showToast(done)
  }

  const move = async (a: DojoActivity, dir: -1 | 1) => {
    if (!companyId) return
    const changes = moveActivity(list.filter(x => (x.parent_id ?? null) === (a.parent_id ?? null)), a.id, dir)
    if (!changes.length) return
    // Show the new order straight away; reload if any save fails
    setList(l => l.map(x => { const c = changes.find(y => y.id === x.id); return c ? { ...x, sort_order: c.sort_order } : x }))
    const results = await Promise.all(changes.map(c =>
      supabase.from('dojo_activities').update({ sort_order: c.sort_order }).eq('id', c.id).eq('company_id', companyId).select('id')))
    if (results.some(r => r.error || !r.data?.length)) {
      showToast('Could not save the new order', 'error')
      const res = await supabase.from('dojo_activities').select(ACTIVITY_COLUMNS).eq('company_id', companyId)
      if (!res.error) setList((res.data || []) as DojoActivity[])
    }
  }

  const form = (d: Draft) => (
    <div className="space-y-2 bg-gray-950/60 border border-gray-800 rounded-xl p-3">
      <input value={d.name} maxLength={ACTIVITY_NAME_MAX} autoFocus placeholder="Activity name (e.g. Kata practice)" aria-label="Activity name"
        onChange={e => setDraft({ ...d, name: e.target.value })} className={INPUT} />
      <input value={d.description} maxLength={ACTIVITY_DESCRIPTION_MAX} placeholder="Description (optional)" aria-label="Description"
        onChange={e => setDraft({ ...d, description: e.target.value })} className={INPUT} />
      {d.parent_id ? (
        ranks.length > 0 && (
          <label className="block text-[11px] text-gray-500">First taught at (higher belts keep practising it)
            <select value={d.min_rank_id} onChange={e => setDraft({ ...d, min_rank_id: e.target.value })} aria-label="First taught at"
              className={`${INPUT} mt-1`}>
              <option value="">Every belt</option>
              {ranks.map(r => <option key={r.id} value={r.id}>{beltLabel(r)} and above</option>)}
            </select>
          </label>
        )
      ) : (
        <label className="flex items-center gap-2 text-sm text-gray-300">
          <input type="checkbox" checked={d.is_default} onChange={e => setDraft({ ...d, is_default: e.target.checked })} className="w-4 h-4 accent-orange-500" />
          Pre-tick on every new class
        </label>
      )}
      {error && <p className="text-xs text-red-400">{error}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={save} disabled={saving}
          className="flex-1 bg-orange-500 hover:bg-orange-400 text-white text-sm font-semibold py-2 rounded-lg disabled:opacity-50">
          {saving ? 'Saving…' : d.id ? 'Save' : 'Add activity'}
        </button>
        <button type="button" onClick={() => { setDraft(null); setError('') }}
          className="flex-1 bg-gray-800 hover:bg-gray-700 text-white text-sm py-2 rounded-lg">Cancel</button>
      </div>
    </div>
  )

  const active = categoriesOf(list.filter(a => !a.is_archived))
  const archived = sortActivities(list.filter(a => a.is_archived))
  const categoryName = (id: string | null | undefined) => list.find(x => x.id === id)?.name || ''
  const newDraft = (parent_id: string | null): Draft => ({ id: null, name: '', description: '', is_default: false, parent_id, min_rank_id: '' })

  const row = (a: DojoActivity, i: number, count = active.length) => (
    <li key={a.id} data-testid="activity-row" data-name={a.name}>
      {draft?.id === a.id ? form(draft) : (
        <div className={`flex items-start gap-2 bg-gray-900 border border-gray-800 rounded-xl px-3 py-2.5 ${a.is_archived ? 'opacity-70' : ''}`}>
          {!a.is_archived && (
            <div className="flex flex-col gap-1 shrink-0">
              <button type="button" aria-label={`Move ${a.name} up`} onClick={() => move(a, -1)} disabled={i === 0}
                className="w-8 h-7 rounded border border-gray-700 text-gray-400 hover:border-gray-500 disabled:opacity-30 text-xs">▲</button>
              <button type="button" aria-label={`Move ${a.name} down`} onClick={() => move(a, 1)} disabled={i === count - 1}
                className="w-8 h-7 rounded border border-gray-700 text-gray-400 hover:border-gray-500 disabled:opacity-30 text-xs">▼</button>
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className={`text-sm ${a.is_archived ? 'text-gray-500' : 'text-white'}`}>
              {a.name}{a.is_archived ? ' (archived)' : ''}
              {a.parent_id && <span data-testid="item-belt" className="ml-2 text-[10px] text-sky-300 border border-sky-900 bg-sky-950/60 px-1.5 py-0.5 rounded align-middle">{fromBeltText(a.min_rank_id, ranks, beltLabel)}</span>}
              {a.is_archived && a.parent_id && <span className="ml-2 text-[10px] text-gray-500">in {categoryName(a.parent_id)}</span>}
              {a.is_default && !a.is_archived && <span className="ml-2 text-[10px] text-green-300 border border-green-900 bg-green-950/60 px-1.5 py-0.5 rounded align-middle">Pre-ticked</span>}
            </p>
            {a.description && <p className="text-[11px] text-gray-500">{a.description}</p>}
            <div className="flex flex-wrap gap-1.5 mt-2">
              {a.is_archived ? (
                <button type="button" onClick={() => patch(a, { is_archived: false }, `${a.name} restored`)} className={BTN}>Restore</button>
              ) : (
                <>
                  <button type="button" onClick={() => { setError(''); setDraft({ id: a.id, name: a.name, description: a.description || '', is_default: a.is_default, parent_id: a.parent_id ?? null, min_rank_id: a.min_rank_id || '' }) }} className={BTN}>Edit</button>
                  {!a.parent_id && (
                    <button type="button" aria-pressed={a.is_default}
                      onClick={() => patch(a, { is_default: !a.is_default }, a.is_default ? `${a.name}: not pre-ticked` : `${a.name}: pre-ticked`)}
                      className={BTN}>{a.is_default ? 'Stop pre-ticking' : 'Pre-tick'}</button>
                  )}
                  <button type="button" onClick={() => patch(a, { is_archived: true }, `${a.name} archived`)}
                    className="text-xs text-gray-400 border border-gray-700 hover:border-amber-600 hover:text-amber-300 px-3 py-1.5 rounded-lg">Archive</button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </li>
  )

  return (
    <div className="min-h-screen bg-gray-950 text-white pb-10">
      <PageNav />
      {toast && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center px-6 pointer-events-none">
          <div role="status" className={`min-w-[280px] max-w-sm text-center px-10 py-6 rounded-2xl text-lg font-semibold shadow-2xl ${toast.kind === 'success' ? 'bg-green-600' : 'bg-red-600'}`}>{toast.text}</div>
        </div>
      )}

      <div className="bg-gray-900 border-b border-gray-800 px-4 sm:px-8 py-4">
        <div className="flex items-center gap-3 min-w-0">
          <button data-nav onClick={() => router.push('/company')}
            className="text-xs text-gray-400 hover:text-white border border-gray-700 hover:border-gray-500 px-3 py-1.5 rounded-lg transition shrink-0">← Back</button>
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-bold text-white">Class activities</h1>
            {companyName && <p className="text-xs text-gray-500 truncate">{companyName}</p>}
          </div>
        </div>
      </div>

      <div className="px-4 sm:px-8 py-5 max-w-2xl mx-auto space-y-4">
        {loading ? (
          <div className="h-24 rounded-2xl bg-gray-900 border border-gray-800 animate-pulse" aria-label="Loading" />
        ) : missing || notDojo ? (
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 text-sm text-gray-400">
            {notDojo ? 'Class activities are for dojos.' : "Class activities aren't set up yet. CoachBoard will switch them on for your account."}
          </div>
        ) : (
          <div data-testid="page-activities" className="space-y-4">
            <p className="text-xs text-gray-400">
              What a class can include. The roll call shows this list above the students; tick what the class did.
              Pre-ticked activities start ticked on every new class.{itemsOn ? ' Under an activity you can add items (e.g. each kata) with the belt where they are first taught; they count only for that belt and above.' : ''}
            </p>
            {active.length === 0 && !draft && <p className="bg-gray-900 border border-gray-800 rounded-2xl p-5 text-sm text-gray-400">No activities yet.</p>}
            <ul className="space-y-2">
              {active.map((c, i) => {
                const items = itemsOf(list.filter(a => !a.is_archived), c.id)
                return (
                  <li key={c.id} className="space-y-1.5">
                    <ul>{row(c, i)}</ul>
                    {(items.length > 0 || itemsOn) && (
                      <ul className="ml-6 pl-3 border-l border-gray-800 space-y-1.5" aria-label={`${c.name} items`}>
                        {items.map((it, j) => row(it, j, items.length))}
                        {itemsOn && (draft && !draft.id && draft.parent_id === c.id ? <li>{form(draft)}</li> : (
                          <li>
                            <button type="button" onClick={() => { setError(''); setDraft(newDraft(c.id)) }} aria-label={`Add item to ${c.name}`}
                              className="text-xs text-sky-300 hover:text-sky-200 px-1 py-1">+ Add item</button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                )
              })}
            </ul>
            {draft && !draft.id && !draft.parent_id ? form(draft) : (
              <button type="button" onClick={() => { setError(''); setDraft(newDraft(null)) }}
                className="w-full text-sm text-orange-400 hover:text-orange-300 border border-dashed border-gray-700 hover:border-orange-700 rounded-xl py-2.5">
                + Add activity
              </button>
            )}
            {archived.length > 0 && (
              <>
                <button type="button" onClick={() => setShowArchived(!showArchived)} aria-pressed={showArchived}
                  className="text-xs text-gray-500 hover:text-gray-300">
                  {showArchived ? 'Hide archived' : `Show archived (${archived.length})`}
                </button>
                {showArchived && <ul className="space-y-2">{archived.map((a, i) => row(a, i, archived.length))}</ul>}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

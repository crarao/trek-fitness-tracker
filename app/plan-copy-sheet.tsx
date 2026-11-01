'use client'

// "Copy plan from another client" bottom sheet for the plan builder: the gym's recent structured
// plans (database rules limit it to the viewer's gym; coaches see PT clients' plans), newest first,
// searchable by client name. Picking one hands its days to the editor; nothing is saved until the
// coach taps Assign / Save.

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { type Country, formatDate } from '@/lib/locale'
import { type PlanJson, normalizePlan, workoutDays } from '@/lib/plan-structure'

type Row = { id: string; client_id: string; week_start: string; plan: PlanJson; name: string }

export default function PlanCopySheet({
  open, onClose, onPick, currentClientId, country,
}: {
  open: boolean
  onClose: () => void
  onPick: (plan: PlanJson, from: string) => void
  currentClientId?: string
  country: Country
}) {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')

  useEffect(() => {
    if (!open) return
    setQuery('')
    setError('')
    let live = true
    ;(async () => {
      const { data, error } = await supabase.from('weekly_plans')
        .select('id, client_id, week_start, plan_json')
        .not('plan_json', 'is', null)
        .order('created_at', { ascending: false })
        .limit(80)
      if (!live) return
      if (error) { setError(error.message); setRows([]); return }
      const plans = (data || []) as { id: string; client_id: string; week_start: string; plan_json: unknown }[]
      const ids = [...new Set(plans.map(p => p.client_id))]
      const names = new Map<string, string>()
      if (ids.length) {
        const { data: people } = await supabase.from('profiles').select('id, full_name').in('id', ids)
        for (const p of people || []) names.set(p.id, p.full_name || '')
      }
      if (!live) return
      // Up to 3 plans per client, so one busy client doesn't fill the list
      const perClient = new Map<string, number>()
      const out: Row[] = []
      for (const p of plans) {
        const plan = normalizePlan(p.plan_json)
        if (!plan || !workoutDays(plan).some(d => d.exercises.length)) continue
        const n = perClient.get(p.client_id) || 0
        if (n >= 3) continue
        perClient.set(p.client_id, n + 1)
        out.push({ id: p.id, client_id: p.client_id, week_start: p.week_start, plan, name: names.get(p.client_id) || 'Client' })
      }
      setRows(out)
    })()
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => { live = false; document.body.style.overflow = prev; window.removeEventListener('keydown', onKey) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (rows || []).filter(r => !q || r.name.toLowerCase().includes(q))
  }, [rows, query])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Copy a plan from another client"
        onClick={e => e.stopPropagation()}
        className="w-full sm:max-w-lg h-[80dvh] sm:h-[70vh] flex flex-col bg-gray-900 border-t sm:border border-gray-700 rounded-t-2xl sm:rounded-2xl overflow-hidden">
        <div className="px-4 pt-3 pb-2 border-b border-gray-800 space-y-2.5">
          <div className="mx-auto w-10 h-1 rounded-full bg-gray-700 sm:hidden" aria-hidden="true" />
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-white">Copy a plan</p>
            <button type="button" onClick={onClose} className="text-sm text-gray-300 border border-gray-700 px-3 py-1.5 rounded-lg">Close</button>
          </div>
          <input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search client name"
            aria-label="Search client name"
            className="w-full bg-gray-800 text-white rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-base sm:text-sm placeholder:text-gray-500" />
        </div>
        <div className="flex-1 overflow-y-auto overscroll-contain">
          {rows === null ? (
            <p className="px-4 py-6 text-sm text-gray-500">Loading plans…</p>
          ) : error ? (
            <p className="px-4 py-6 text-sm text-red-400">Could not load plans: {error}</p>
          ) : shown.length === 0 ? (
            <p className="px-4 py-6 text-sm text-gray-500">{rows.length ? 'No client with that name.' : 'No day-by-day plans in your gym yet.'}</p>
          ) : (
            <ul className="divide-y divide-gray-800/70">
              {shown.map(r => {
                const days = workoutDays(r.plan)
                const count = r.plan.days.reduce((n, d) => n + d.exercises.length, 0)
                const isSelf = r.client_id === currentClientId
                return (
                  <li key={r.id}>
                    <button type="button" onClick={() => onPick(r.plan, isSelf ? 'this client' : r.name)}
                      className="w-full text-left px-4 py-3 hover:bg-gray-800/60 active:bg-gray-800">
                      <span className="flex items-baseline justify-between gap-3">
                        <span className="text-sm text-white truncate">{r.name}{isSelf && <span className="text-xs text-gray-500"> · this client</span>}</span>
                        <span className="text-[11px] text-gray-500 shrink-0">Week of {formatDate(r.week_start.slice(0, 10), country, 'dayMonth')}</span>
                      </span>
                      <span className="block text-[11px] text-gray-400 mt-0.5">
                        {days.length} workout day{days.length === 1 ? '' : 's'} · {count} exercise{count === 1 ? '' : 's'}
                      </span>
                      <span className="block text-[11px] text-orange-300/80 truncate mt-0.5">
                        {days.map(d => `${d.day} ${d.focus || 'Workout'}`).join(' · ')}
                      </span>
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

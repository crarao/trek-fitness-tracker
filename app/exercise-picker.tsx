'use client'

// "+ Add exercise" bottom sheet for the plan builder: search (name + other names), muscle group and
// equipment chips, the gym's recently used exercises first, tap to add (stays open to add several),
// and "+ Add '<typed>' as new exercise" which saves it to the gym's list (public.exercises) for
// every coach in that gym. Works without the table too: typed exercises are still added to the plan.

import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import {
  type Exercise, EXERCISE_COLUMNS, MUSCLE_GROUPS, EQUIPMENT, muscleLabel, equipmentLabel,
  searchExercises, hasExactName, recentFromPlans, tidyName, normalizeName,
} from '@/lib/exercises'

export type PickedExercise = { name: string; exercise_id?: string; muscle_group?: string | null }

type Library = { list: Exercise[]; recent: string[]; missing: boolean }

// Kept for the page's lifetime so the sheet opens instantly the second time; refreshed on each open
const cache = new Map<string, Library>()

async function loadLibrary(companyId: string | null): Promise<Library> {
  const [ex, plans] = await Promise.all([
    supabase.from('exercises').select(EXERCISE_COLUMNS).eq('is_archived', false).order('name').limit(2000),
    // Database rules limit this to the viewer's gym (coaches: PT clients' plans)
    supabase.from('weekly_plans').select('plan_json').not('plan_json', 'is', null)
      .order('created_at', { ascending: false }).limit(40),
  ])
  const missing = !!ex.error
  const list = ((ex.data || []) as Exercise[]).filter(e => !e.company_id || !companyId || e.company_id === companyId)
  return { list, recent: plans.error ? [] : recentFromPlans(plans.data || []), missing }
}

const chip = (on: boolean) =>
  `shrink-0 text-xs px-3 py-1.5 rounded-full border transition ${on ? 'bg-orange-500 border-orange-500 text-white font-semibold' : 'border-gray-700 text-gray-300'}`

export default function ExercisePicker({
  open, onClose, onPick, companyId, title,
}: {
  open: boolean
  onClose: () => void
  onPick: (e: PickedExercise) => void
  companyId: string | null
  title: string            // e.g. "Mon · Push"
}) {
  const key = companyId || '-'
  const [lib, setLib] = useState<Library | null>(() => cache.get(key) ?? null)
  const [query, setQuery] = useState('')
  const [muscle, setMuscle] = useState<string | null>(null)
  const [equipment, setEquipment] = useState<string | null>(null)
  const [added, setAdded] = useState<Record<string, number>>({})   // per exercise key, this opening
  const [addedTotal, setAddedTotal] = useState(0)
  const [flash, setFlash] = useState('')
  const [newName, setNewName] = useState<string | null>(null)     // asking the muscle group for this new exercise
  const [savingNew, setSavingNew] = useState(false)
  const [newError, setNewError] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Fresh state and data each time it opens
  useEffect(() => {
    if (!open) return
    setQuery(''); setMuscle(null); setEquipment(null); setAdded({}); setAddedTotal(0); setNewName(null); setNewError('')
    let live = true
    loadLibrary(companyId).then(l => { if (!live) return; cache.set(key, l); setLib(l) })
    // Keep the page behind still while the sheet is open
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => { live = false; document.body.style.overflow = prev; window.removeEventListener('keydown', onKey) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, key])

  const results = useMemo(
    () => lib ? searchExercises(lib.list, { query, muscle, equipment }, lib.recent) : [],
    [lib, query, muscle, equipment],
  )
  const recentShown = useMemo(() => {
    if (!lib || query.trim() || !lib.recent.length) return 0
    const set = new Set(lib.recent)
    let n = 0
    for (const e of results) { if (set.has(e.id) || set.has(normalizeName(e.name))) n++; else break }
    return Math.min(n, 12)
  }, [lib, query, results])

  if (!open) return null

  const typed = tidyName(query)
  const canAddNew = !!typed && !!lib && !hasExactName(lib.list, typed)

  const showFlash = (text: string) => {
    setFlash(text)
    if (flashTimer.current) clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => setFlash(''), 1500)
  }
  const pick = (e: PickedExercise, k: string) => {
    onPick(e)
    setAdded(a => ({ ...a, [k]: (a[k] || 0) + 1 }))
    setAddedTotal(n => n + 1)
    showFlash(`✓ ${e.name} added`)
  }
  const pickLibrary = (e: Exercise) => pick({ name: e.name, exercise_id: e.id, muscle_group: e.muscle_group }, e.id)

  // Saves the typed name to the gym's list, then adds it to the plan
  const saveNew = async (group: string) => {
    if (!newName) return
    setSavingNew(true)
    setNewError('')
    let saved: Exercise | null = null
    if (companyId && !lib?.missing) {
      const { data, error } = await supabase.from('exercises')
        .insert({ company_id: companyId, name: newName, muscle_group: group })
        .select(EXERCISE_COLUMNS).single()
      if (!error && data) saved = data as Exercise
      else if (error?.code === '23505') {
        // Someone in the gym added it a moment ago: use theirs
        const { data: existing } = await supabase.from('exercises').select(EXERCISE_COLUMNS)
          .eq('company_id', companyId).ilike('name', newName.replace(/[%_\\]/g, '\\$&')).limit(1)
        saved = (existing?.[0] as Exercise) ?? null
      } else if (error) {
        setNewError(`Added to this plan only. Couldn't save to the gym's list: ${error.message}`)
      }
    }
    setSavingNew(false)
    if (saved) {
      const s = saved
      setLib(l => {
        const next = l ? { ...l, list: l.list.some(e => e.id === s.id) ? l.list : [...l.list, s].sort((a, b) => a.name.localeCompare(b.name)) } : l
        if (next) cache.set(key, next)
        return next
      })
      pick({ name: s.name, exercise_id: s.id, muscle_group: s.muscle_group }, s.id)
    } else {
      pick({ name: newName, muscle_group: group }, `new:${normalizeName(newName)}`)
    }
    setNewName(null)
    setQuery('')
    inputRef.current?.focus()
  }

  const row = (e: Exercise) => {
    const n = added[e.id] || 0
    const meta = [muscleLabel(e.muscle_group), equipmentLabel(e.equipment)].filter(Boolean).join(' · ')
    return (
      <li key={e.id}>
        <button type="button" onClick={() => pickLibrary(e)}
          className="w-full flex items-center gap-3 text-left px-4 py-2.5 active:bg-gray-800 hover:bg-gray-800/60">
          <span className="flex-1 min-w-0">
            <span className="block text-sm text-white truncate">{e.name}</span>
            <span className="block text-[11px] text-gray-500 truncate">
              {meta}{e.company_id ? <span className="text-sky-400">{meta ? ' · ' : ''}Your gym</span> : null}
            </span>
          </span>
          {n > 0
            ? <span className="text-[11px] font-semibold text-green-300 bg-green-900/60 border border-green-700 px-2 py-0.5 rounded-full">✓{n > 1 ? ` ×${n}` : ''}</span>
            : <span className="w-7 h-7 grid place-items-center rounded-full border border-gray-700 text-orange-400 text-base" aria-hidden="true">+</span>}
        </button>
      </li>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={`Add exercises to ${title}`}
        onClick={e => e.stopPropagation()}
        className="w-full sm:max-w-lg h-[88dvh] sm:h-[80vh] flex flex-col bg-gray-900 border-t sm:border border-gray-700 rounded-t-2xl sm:rounded-2xl overflow-hidden">
        <div className="px-4 pt-3 pb-2 border-b border-gray-800 space-y-2.5">
          <div className="mx-auto w-10 h-1 rounded-full bg-gray-700 sm:hidden" aria-hidden="true" />
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-white truncate">Add to {title}</p>
            <button type="button" onClick={onClose}
              className="shrink-0 text-sm font-semibold text-white bg-orange-500 hover:bg-orange-400 px-4 py-1.5 rounded-lg">
              Done{addedTotal ? ` (${addedTotal})` : ''}
            </button>
          </div>
          <input ref={inputRef} autoFocus type="search" enterKeyHint="search" value={query}
            onChange={e => { setQuery(e.target.value); setNewName(null) }}
            onKeyDown={e => { if (e.key === 'Enter' && results[0] && query.trim()) { e.preventDefault(); pickLibrary(results[0]); setQuery('') } }}
            placeholder="Search, e.g. squat, lat pulldown, dand"
            aria-label="Search exercises"
            className="w-full bg-gray-800 text-white rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-base sm:text-sm placeholder:text-gray-500" />
          {newName === null && (<>
          <div className="flex gap-1.5 overflow-x-auto -mx-4 px-4 pb-0.5" role="group" aria-label="Muscle group">
            {MUSCLE_GROUPS.map(([k, label]) => (
              <button key={k} type="button" aria-pressed={muscle === k} onClick={() => setMuscle(muscle === k ? null : k)} className={chip(muscle === k)}>{label}</button>
            ))}
          </div>
          <div className="flex gap-1.5 overflow-x-auto -mx-4 px-4 pb-0.5" role="group" aria-label="Equipment">
            {EQUIPMENT.map(([k, label]) => (
              <button key={k} type="button" aria-pressed={equipment === k} onClick={() => setEquipment(equipment === k ? null : k)} className={chip(equipment === k)}>{label}</button>
            ))}
          </div>
          </>)}
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain">
          {newName !== null ? (
            <div className="p-4 space-y-3">
              <p className="text-sm text-white">New exercise: <span className="font-semibold">{newName}</span></p>
              <p className="text-xs text-gray-400">Pick its muscle group. It&apos;s saved to your gym&apos;s list for every coach and added to this plan.</p>
              <div className="grid grid-cols-3 gap-2">
                {MUSCLE_GROUPS.map(([k, label]) => (
                  <button key={k} type="button" disabled={savingNew} onClick={() => saveNew(k)}
                    className="text-sm py-2.5 rounded-xl border border-gray-700 text-gray-200 hover:border-orange-500 disabled:opacity-50">{label}</button>
                ))}
              </div>
              {savingNew && <p className="text-xs text-gray-400">Saving…</p>}
              <button type="button" onClick={() => setNewName(null)} className="text-xs text-gray-400 underline underline-offset-2">Back</button>
            </div>
          ) : (
            <>
              {newError && <p className="mx-4 mt-3 text-xs text-amber-300">{newError}</p>}
              {canAddNew && (
                <button type="button" onClick={() => { setNewError(''); setNewName(typed) }}
                  className="w-full text-left px-4 py-3 border-b border-gray-800 text-sm text-orange-300 hover:bg-gray-800/60">
                  + Add &lsquo;{typed}&rsquo; as new exercise
                </button>
              )}
              {!lib ? (
                <p className="px-4 py-6 text-sm text-gray-500">Loading exercises…</p>
              ) : lib.missing && !lib.list.length ? (
                <div className="px-4 py-6 space-y-2">
                  <p className="text-sm text-gray-400">The exercise list isn&apos;t set up yet.</p>
                  <p className="text-xs text-gray-500">Type the exercise name above and tap &ldquo;+ Add&rdquo; to put it in the plan.</p>
                </div>
              ) : results.length === 0 ? (
                <p className="px-4 py-6 text-sm text-gray-500">
                  No match{muscle || equipment ? ' with these filters' : ''}.{typed ? ' Add it as a new exercise above.' : ''}
                </p>
              ) : (
                <>
                  {recentShown > 0 && <p className="px-4 pt-3 pb-1 text-[11px] uppercase tracking-wider text-gray-500">Recently used in your gym</p>}
                  <ul className="divide-y divide-gray-800/70">{results.slice(0, recentShown).map(row)}</ul>
                  {recentShown > 0 && <p className="px-4 pt-4 pb-1 text-[11px] uppercase tracking-wider text-gray-500">All exercises</p>}
                  <ul className="divide-y divide-gray-800/70">{results.slice(recentShown, recentShown + 300).map(row)}</ul>
                </>
              )}
            </>
          )}
        </div>
        <div aria-live="polite" className="h-9 shrink-0 border-t border-gray-800 px-4 flex items-center text-xs text-green-300">
          {flash || <span className="text-gray-500">Tap to add. The sheet stays open so you can add several.</span>}
        </div>
      </div>
    </div>
  )
}

'use client'

// Manage the gym's exercise list (owner / partner): the gym's own exercises can be renamed, moved
// to another muscle group or equipment, archived and restored. The shared starter list is read-only.
// Exercises are never deleted (CLAUDE.md Rule #1; no delete permission on the table). Plans keep a
// copy of each exercise's name, so renaming or archiving never changes plans already assigned.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import {
  type Exercise, EXERCISE_COLUMNS, MUSCLE_GROUPS, EQUIPMENT, muscleLabel, equipmentLabel,
  searchExercises, tidyName, hasExactName,
} from '@/lib/exercises'

const INPUT = 'w-full bg-gray-800 text-white rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm placeholder-gray-500'
const SELECT = 'bg-gray-800 text-white rounded-lg px-2 py-2 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm'

type Edit = { id: string; name: string; muscle_group: string; equipment: string }

export default function ExercisesPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [missing, setMissing] = useState(false)
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [companyName, setCompanyName] = useState('')
  const [list, setList] = useState<Exercise[]>([])
  const [query, setQuery] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [showStarter, setShowStarter] = useState(false)
  const [edit, setEdit] = useState<Edit | null>(null)
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
        .from('profiles').select('company_id, companies:company_id(name)').eq('id', user.id).single()
      if (!profile?.company_id) { router.push('/login'); return }
      setCompanyId(profile.company_id)
      setCompanyName((profile as unknown as { companies: { name: string | null } | null }).companies?.name || '')
      const { data, error } = await supabase.from('exercises').select(EXERCISE_COLUMNS).order('name').limit(3000)
      if (error) setMissing(true)
      if (!live) return
      setList(((data || []) as Exercise[]).filter(e => !e.company_id || e.company_id === profile.company_id))
      setLoading(false)
    })()
    return () => { live = false }
  }, [router])

  const own = useMemo(() => list.filter(e => e.company_id), [list])
  const starter = useMemo(() => list.filter(e => !e.company_id), [list])
  const filterBy = (rows: Exercise[], archived: boolean) =>
    searchExercises(rows.filter(e => !!e.is_archived === archived), { query, muscle: null, equipment: null, includeArchived: true })
  const ownActive = filterBy(own, false)
  const ownArchived = filterBy(own, true)
  const starterShown = searchExercises(starter, { query, muscle: null, equipment: null })

  const startEdit = (e: Exercise) => {
    setError('')
    setEdit({ id: e.id, name: e.name, muscle_group: e.muscle_group || '', equipment: e.equipment || '' })
  }

  const save = async () => {
    if (!edit || !companyId) return
    const name = tidyName(edit.name)
    if (!name) { setError('Add a name.'); return }
    const others = list.filter(e => e.id !== edit.id && (e.company_id === companyId || !e.company_id))
    if (hasExactName(others, name)) { setError('There is already an exercise with this name.'); return }
    setSaving(true)
    setError('')
    // .select() so a save blocked by database rules (0 rows, no error) isn't reported as saved
    const { data, error } = await supabase.from('exercises')
      .update({ name, muscle_group: edit.muscle_group || null, equipment: edit.equipment || null })
      .eq('id', edit.id).eq('company_id', companyId).select(EXERCISE_COLUMNS)
    setSaving(false)
    if (error) { setError(error.code === '23505' ? 'There is already an exercise with this name.' : 'Could not save: ' + error.message); return }
    if (!data?.length) { setError("Couldn't save: not allowed for this login"); return }
    const row = data[0] as Exercise
    setList(l => l.map(e => (e.id === row.id ? row : e)).sort((a, b) => a.name.localeCompare(b.name)))
    setEdit(null)
    showToast('Saved ✓')
  }

  const setArchived = async (e: Exercise, archived: boolean) => {
    if (!companyId) return
    const { data, error } = await supabase.from('exercises')
      .update({ is_archived: archived }).eq('id', e.id).eq('company_id', companyId).select(EXERCISE_COLUMNS)
    if (error || !data?.length) { showToast(error ? 'Could not save: ' + error.message : "Couldn't save: not allowed for this login", 'error'); return }
    const row = data[0] as Exercise
    setList(l => l.map(x => (x.id === row.id ? row : x)))
    if (edit?.id === e.id) setEdit(null)
    showToast(archived ? `${e.name} archived` : `${e.name} restored`)
  }

  const meta = (e: Exercise) => [muscleLabel(e.muscle_group), equipmentLabel(e.equipment)].filter(Boolean).join(' · ') || 'No group'

  const ownRow = (e: Exercise, archived: boolean) => (
    <li key={e.id} className="px-4 py-3">
      {edit?.id === e.id ? (
        <div className="space-y-2">
          <input value={edit.name} maxLength={120} autoFocus aria-label="Exercise name"
            onChange={ev => setEdit({ ...edit, name: ev.target.value })} className={INPUT} />
          <div className="grid grid-cols-2 gap-2">
            <select value={edit.muscle_group} onChange={ev => setEdit({ ...edit, muscle_group: ev.target.value })} aria-label="Muscle group" className={SELECT}>
              <option value="">Muscle group</option>
              {MUSCLE_GROUPS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
            <select value={edit.equipment} onChange={ev => setEdit({ ...edit, equipment: ev.target.value })} aria-label="Equipment" className={SELECT}>
              <option value="">Equipment</option>
              {EQUIPMENT.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
          <p className="text-[11px] text-gray-500">Plans already assigned keep the old name.</p>
          <div className="flex gap-2">
            <button type="button" onClick={save} disabled={saving}
              className="flex-1 bg-orange-500 hover:bg-orange-400 text-white text-sm font-semibold py-2 rounded-lg disabled:opacity-50">
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button type="button" onClick={() => { setEdit(null); setError('') }}
              className="flex-1 bg-gray-800 hover:bg-gray-700 text-white text-sm py-2 rounded-lg">Cancel</button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <p className={`text-sm truncate ${archived ? 'text-gray-500' : 'text-white'}`}>{e.name}</p>
            <p className="text-[11px] text-gray-500 truncate">{meta(e)}</p>
          </div>
          {archived ? (
            <button type="button" onClick={() => setArchived(e, false)}
              className="text-xs text-gray-300 border border-gray-700 hover:border-gray-500 px-3 py-1.5 rounded-lg">Restore</button>
          ) : (
            <>
              <button type="button" onClick={() => startEdit(e)}
                className="text-xs text-gray-300 border border-gray-700 hover:border-gray-500 px-3 py-1.5 rounded-lg">Edit</button>
              <button type="button" onClick={() => setArchived(e, true)}
                className="text-xs text-gray-400 border border-gray-700 hover:border-amber-600 hover:text-amber-300 px-3 py-1.5 rounded-lg">Archive</button>
            </>
          )}
        </div>
      )}
    </li>
  )

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
            <h1 className="text-xl sm:text-2xl font-bold text-white">Exercise list</h1>
            {companyName && <p className="text-xs text-gray-500 truncate">{companyName}</p>}
          </div>
        </div>
      </div>

      <div className="px-4 sm:px-8 py-5 max-w-3xl mx-auto space-y-4">
        <p className="text-xs text-gray-400">
          Coaches pick exercises from this list when they build a plan. New ones are added from the plan
          builder (&ldquo;+ Add exercise&rdquo;, then type a name) and show up for every coach in your gym.
        </p>
        <input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search exercises"
          aria-label="Search exercises" className={INPUT} />

        {loading ? (
          <div className="h-24 rounded-2xl bg-gray-900 border border-gray-800 animate-pulse" aria-label="Loading" />
        ) : missing ? (
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 text-sm text-gray-400">
            The exercise list isn&apos;t set up yet. Plans still work: coaches type exercise names.
          </div>
        ) : (
          <>
            <section className="bg-gray-900 border border-gray-800 rounded-2xl">
              <p className="px-4 pt-4 pb-2 text-xs text-gray-500 uppercase tracking-wider">
                Your gym&apos;s exercises <span className="normal-case text-gray-600">({own.filter(e => !e.is_archived).length})</span>
              </p>
              {ownActive.length === 0 ? (
                <p className="px-4 pb-4 text-sm text-gray-500">{query ? 'No match.' : 'None yet. Coaches add them from the plan builder.'}</p>
              ) : (
                <ul className="divide-y divide-gray-800">{ownActive.map(e => ownRow(e, false))}</ul>
              )}
            </section>

            {own.some(e => e.is_archived) && (
              <section className="bg-gray-900 border border-gray-800 rounded-2xl">
                <button type="button" onClick={() => setShowArchived(!showArchived)} aria-expanded={showArchived}
                  className="w-full flex items-center justify-between px-4 py-3 text-left">
                  <span className="text-xs text-gray-500 uppercase tracking-wider">Archived <span className="normal-case text-gray-600">({own.filter(e => e.is_archived).length})</span></span>
                  <span className="text-gray-500 text-sm">{showArchived ? '▾' : '▸'}</span>
                </button>
                {showArchived && (
                  ownArchived.length
                    ? <ul className="divide-y divide-gray-800 border-t border-gray-800">{ownArchived.map(e => ownRow(e, true))}</ul>
                    : <p className="px-4 pb-4 text-sm text-gray-500">No match.</p>
                )}
              </section>
            )}

            <section className="bg-gray-900 border border-gray-800 rounded-2xl">
              <button type="button" onClick={() => setShowStarter(!showStarter)} aria-expanded={showStarter}
                className="w-full flex items-center justify-between px-4 py-3 text-left">
                <span className="text-xs text-gray-500 uppercase tracking-wider">Starter list <span className="normal-case text-gray-600">({starter.length}, read-only)</span></span>
                <span className="text-gray-500 text-sm">{showStarter || query ? '▾' : '▸'}</span>
              </button>
              {(showStarter || query) && (
                starterShown.length
                  ? <ul className="divide-y divide-gray-800 border-t border-gray-800">
                      {starterShown.map(e => (
                        <li key={e.id} className="px-4 py-2.5">
                          <p className="text-sm text-gray-200">{e.name}</p>
                          <p className="text-[11px] text-gray-500">{meta(e)}{e.aliases?.length ? ` · also: ${e.aliases.slice(0, 3).join(', ')}` : ''}</p>
                        </li>
                      ))}
                    </ul>
                  : <p className="px-4 pb-4 text-sm text-gray-500">No match.</p>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  )
}

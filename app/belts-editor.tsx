'use client'

// A gym's belt grading setup: the Grading switch and the belt ladder. Super admin only (decided 11 Nov: belts are part
// of setting up a dojo; owners can't change them). Used in Super Admin → Companies → Edit, like the Branches editor.
// Saves straight away. Nothing is deleted (CLAUDE.md Rule #1): a belt is turned off (is_active false), never removed;
// students and history keep it. New belts go at the end of the ladder. "Add standard belts" inserts the 9-belt
// ladder (lib/belts.ts STANDARD_BELTS) only when the gym has none (on conflict do nothing).

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { type BeltRank, type BeltDraft, BELT_RANK_COLUMNS, STANDARD_BELTS, beltLabel, beltFields } from '@/lib/belts'
import BeltChip from '@/app/belt-chip'

const INPUT = 'w-full bg-gray-800 text-white rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm placeholder-gray-500'
const BTN = 'text-xs text-gray-300 border border-gray-700 hover:border-gray-500 px-3 py-1.5 rounded-lg'

export default function BeltsEditor({ companyId, gradingEnabled, onGradingChange, onSaved }: {
  companyId: string
  gradingEnabled: boolean | null | undefined     // undefined = the column isn't there (Phase 1 SQL not run)
  onGradingChange?: (on: boolean) => void
  onSaved?: (text: string, kind?: 'success' | 'error') => void   // the page's toast
}) {
  const [belts, setBelts] = useState<BeltRank[] | null>(null)
  const [missing, setMissing] = useState(false)
  const [withDan, setWithDan] = useState(false)
  const [draft, setDraft] = useState<BeltDraft | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [inUse, setInUse] = useState<Record<string, number>>({})

  useEffect(() => {
    let live = true
    ;(async () => {
      const [rk, used] = await Promise.all([
        supabase.from('belt_ranks').select(BELT_RANK_COLUMNS).eq('company_id', companyId).order('rank_order'),
        supabase.from('profiles').select('current_rank_id').eq('company_id', companyId).eq('role', 'client')
          .is('archived_at', null).not('current_rank_id', 'is', null),
      ])
      if (!live) return
      if (rk.error) { setMissing(true); setBelts([]); return }
      const rows = (rk.data || []) as BeltRank[]
      setBelts(rows)
      // belt_ranks.dan exists (Phase 2 SQL): the probe answers without an error
      const probe = await supabase.from('belt_ranks').select('dan').limit(1)
      if (live) setWithDan(!probe.error)
      const n: Record<string, number> = {}
      for (const p of (used.data || []) as { current_rank_id: string }[]) n[p.current_rank_id] = (n[p.current_rank_id] || 0) + 1
      setInUse(n)
    })()
    return () => { live = false }
  }, [companyId])

  const setGrading = async (on: boolean) => {
    const { data, error } = await supabase.from('companies').update({ grading_enabled: on }).eq('id', companyId).select('id')
    if (error || !data?.length) { onSaved?.(error ? 'Could not save: ' + error.message : "Couldn't save: not allowed for this login", 'error'); return }
    onGradingChange?.(on)
    onSaved?.(on ? 'Grading on ✓' : 'Grading off')
  }

  const addStandard = async () => {
    if (!belts || belts.length) return
    setSaving(true)
    const rows = STANDARD_BELTS.map((b, i) => ({ ...b, company_id: companyId, rank_order: i }))
    const { data, error } = await supabase.from('belt_ranks')
      .upsert(rows, { onConflict: 'company_id,rank_order', ignoreDuplicates: true }).select(BELT_RANK_COLUMNS)
    setSaving(false)
    if (error) { onSaved?.('Could not add the belts: ' + error.message, 'error'); return }
    setBelts(((data || []) as BeltRank[]).sort((a, b) => a.rank_order - b.rank_order))
    onSaved?.(`${data?.length || 0} belts added ✓`)
  }

  const save = async () => {
    if (!draft || !belts) return
    const fields = beltFields(draft, withDan)
    if (typeof fields === 'string') { setError(fields); return }
    setSaving(true)
    setError('')
    const nextOrder = belts.reduce((m, b) => Math.max(m, b.rank_order), -1) + 1
    // .select() so a save blocked by database rules (0 rows, no error) isn't reported as saved
    const { data, error } = draft.id
      ? await supabase.from('belt_ranks').update(fields).eq('id', draft.id).eq('company_id', companyId).select(BELT_RANK_COLUMNS)
      : await supabase.from('belt_ranks').insert({ ...fields, company_id: companyId, rank_order: nextOrder }).select(BELT_RANK_COLUMNS)
    setSaving(false)
    if (error) { setError('Could not save: ' + error.message); return }
    if (!data?.length) { setError("Couldn't save: not allowed for this login"); return }
    const row = data[0] as BeltRank
    setBelts(l => (draft.id ? (l || []).map(b => (b.id === row.id ? row : b)) : [...(l || []), row]))
    setDraft(null)
    onSaved?.(draft.id ? 'Belt saved ✓' : `${beltLabel(row)} added ✓`)
  }

  const setActive = async (b: BeltRank, active: boolean) => {
    const { data, error } = await supabase.from('belt_ranks').update({ is_active: active }).eq('id', b.id).eq('company_id', companyId).select(BELT_RANK_COLUMNS)
    if (error || !data?.length) { onSaved?.(error ? 'Could not save: ' + error.message : "Couldn't save: not allowed for this login", 'error'); return }
    const row = data[0] as BeltRank
    setBelts(l => (l || []).map(x => (x.id === b.id ? row : x)))
    onSaved?.(active ? `${beltLabel(b)} on` : `${beltLabel(b)} turned off`)
  }

  const form = (d: BeltDraft) => (
    <div className="space-y-2" data-testid="belt-form">
      <div className="flex gap-2">
        <input value={d.belt_name} maxLength={40} autoFocus placeholder="Belt (e.g. Black)" aria-label="Belt name"
          onChange={e => setDraft({ ...d, belt_name: e.target.value })} className={INPUT} />
        <input type="color" value={d.color_hex} aria-label="Belt colour" onChange={e => setDraft({ ...d, color_hex: e.target.value })}
          className="w-12 h-10 shrink-0 rounded-lg bg-gray-800 border border-gray-700 p-1" />
      </div>
      <div className="flex gap-2">
        <select value={d.grade} aria-label="Grade" onChange={e => setDraft({ ...d, grade: e.target.value as BeltDraft['grade'] })} className={INPUT}>
          <option value="none">No number (e.g. White)</option>
          <option value="kyu">Kyu</option>
          {withDan && <option value="dan">Dan (black belts)</option>}
        </select>
        {d.grade !== 'none' && (
          <input type="number" inputMode="numeric" min={1} value={d.number} placeholder={d.grade === 'kyu' ? '8' : '1'} aria-label={`${d.grade} number`}
            onChange={e => setDraft({ ...d, number: e.target.value })} className={`${INPUT} max-w-[6rem]`} />
        )}
      </div>
      <div>
        <input type="number" inputMode="numeric" min={0} value={d.months} placeholder="Months after the belt before (e.g. 3)"
          aria-label="Months after the previous belt" onChange={e => setDraft({ ...d, months: e.target.value })} className={INPUT} />
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={save} disabled={saving} data-testid="belt-save"
          className="flex-1 bg-orange-500 hover:bg-orange-400 text-white text-sm font-semibold py-2 rounded-lg disabled:opacity-50">
          {saving ? 'Saving…' : d.id ? 'Save' : 'Add belt'}
        </button>
        <button type="button" onClick={() => { setDraft(null); setError('') }}
          className="flex-1 bg-gray-800 hover:bg-gray-700 text-white text-sm py-2 rounded-lg">Cancel</button>
      </div>
    </div>
  )

  if (belts === null) return <div className="h-12 rounded-xl bg-gray-800/60 animate-pulse" aria-label="Loading" />
  if (missing || gradingEnabled === undefined) return <p className="text-xs text-gray-600">Needs the belt grading SQL first (supabase/migrations/20261110120000_belt_grading.sql)</p>

  const editDraft = (b: BeltRank): BeltDraft => ({
    id: b.id, belt_name: b.belt_name, grade: b.kyu ? 'kyu' : b.dan ? 'dan' : 'none', number: String(b.kyu ?? b.dan ?? ''),
    color_hex: b.color_hex, months: b.min_months_from_previous != null ? String(b.min_months_from_previous) : '',
  })

  return (
    <div className="space-y-3" data-testid="belts-editor">
      <label className="flex items-start gap-2.5 text-sm text-gray-300 cursor-pointer max-w-sm">
        <input type="checkbox" checked={!!gradingEnabled} onChange={e => setGrading(e.target.checked)} data-testid="grading-switch"
          className="mt-0.5 w-4 h-4 accent-orange-500" />
        <span>
          Belt grading on
          <span className="block text-xs text-gray-500">Belts on students, history, grading exams and results. Off = hidden everywhere (nothing is lost).</span>
        </span>
      </label>

      {belts.length === 0 ? (
        <div className="bg-gray-800/50 rounded-xl p-3 space-y-2">
          <p className="text-xs text-gray-400">No belts yet. The standard ladder is White, Yellow 8 · Orange 7 · Green 6 · Blue 5 · Purple 4 · Brown 3 · 2 · 1 kyu (3 months each, 6 for Brown 2nd and 1st). Edit or add belts (e.g. Black) after.</p>
          <button type="button" onClick={addStandard} disabled={saving} data-testid="belts-standard"
            className="w-full bg-orange-500 hover:bg-orange-400 text-white text-sm font-semibold py-2 rounded-lg disabled:opacity-50">
            {saving ? 'Adding…' : 'Add standard belts'}
          </button>
        </div>
      ) : (
        <ul className="space-y-1.5">
          {belts.map(b => (
            <li key={b.id} className="bg-gray-800/50 rounded-xl px-3 py-2" data-testid="belt-row" data-name={beltLabel(b)}>
              {draft?.id === b.id ? form(draft) : (
                <div className="flex items-center gap-2">
                  <span className="w-14 shrink-0"><BeltChip rank={b} /></span>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm truncate ${b.is_active ? 'text-white' : 'text-gray-500'}`}>{beltLabel(b)}{b.is_active ? '' : ' (off)'}</p>
                    <p className="text-[11px] text-gray-500 truncate">
                      {[b.min_months_from_previous ? `${b.min_months_from_previous} months after the belt before` : 'No wait',
                        inUse[b.id] ? `${inUse[b.id]} on it` : ''].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  <button type="button" onClick={() => { setError(''); setDraft(editDraft(b)) }} className={BTN}>Edit</button>
                  <button type="button" onClick={() => setActive(b, !b.is_active)}
                    className="text-xs text-gray-400 border border-gray-700 hover:border-amber-600 hover:text-amber-300 px-3 py-1.5 rounded-lg">
                    {b.is_active ? 'Turn off' : 'Turn on'}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {belts.length > 0 && (draft && !draft.id ? (
        <div className="bg-gray-800/50 rounded-xl p-3">{form(draft)}</div>
      ) : (
        <button type="button" data-testid="belt-add"
          onClick={() => { setError(''); setDraft({ id: null, belt_name: '', grade: withDan ? 'dan' : 'kyu', number: '', color_hex: '#111111', months: '12' }) }}
          className="w-full text-sm text-orange-400 hover:text-orange-300 border border-dashed border-gray-700 hover:border-orange-700 rounded-xl py-2">
          + Add belt (at the top of the ladder)
        </button>
      ))}
      <p className="text-[11px] text-gray-600">Owners and partners can&apos;t change belts. Turning a belt off hides it for new students and exams; students on it keep it.</p>
    </div>
  )
}

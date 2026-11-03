'use client'

// A gym's branches: add, rename, archive / restore. Super admin only (pricing is per branch, decided 3 Nov;
// rule in db/2026-11-03-branches-super-admin.md). Used in Super Admin → Companies → Edit. Owners and partners
// add batches inside these branches on /company/batches but can't add branches.
// Nothing is deleted (CLAUDE.md Rule #1): branches are archived; students keep a saved archived branch.

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { type Branch, BRANCH_COLUMNS, tidyName, nameTaken } from '@/lib/batches'

const INPUT = 'w-full bg-gray-800 text-white rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm placeholder-gray-500'
const BTN = 'text-xs text-gray-300 border border-gray-700 hover:border-gray-500 px-3 py-1.5 rounded-lg'

type Draft = { id: string | null; name: string; address: string }

export default function BranchesEditor({ companyId, onSaved }: {
  companyId: string
  onSaved?: (text: string, kind?: 'success' | 'error') => void   // the page's toast
}) {
  const [branches, setBranches] = useState<Branch[] | null>(null)
  const [missing, setMissing] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [batchCount, setBatchCount] = useState<Record<string, number>>({})

  useEffect(() => {
    let live = true
    ;(async () => {
      const [br, ba] = await Promise.all([
        supabase.from('branches').select(BRANCH_COLUMNS).eq('company_id', companyId).order('name'),
        supabase.from('batches').select('branch_id, is_archived').eq('company_id', companyId),
      ])
      if (!live) return
      if (br.error) { setMissing(true); setBranches([]); return }
      setBranches((br.data || []) as Branch[])
      const n: Record<string, number> = {}
      for (const b of (ba.data || []) as { branch_id: string; is_archived: boolean }[]) if (!b.is_archived) n[b.branch_id] = (n[b.branch_id] || 0) + 1
      setBatchCount(n)
    })()
    return () => { live = false }
  }, [companyId])

  const save = async () => {
    if (!draft || !branches) return
    const name = tidyName(draft.name)
    if (!name) { setError('Add a name for the branch (e.g. Kokapet).'); return }
    if (name.length > 60) { setError('Keep the name under 60 characters.'); return }
    if (nameTaken(branches, name, draft.id ?? undefined)) { setError('There is already a branch with this name.'); return }
    setSaving(true)
    setError('')
    const fields = { name, address: tidyName(draft.address) || null }
    // .select() so a save blocked by database rules (0 rows, no error) isn't reported as saved
    const { data, error } = draft.id
      ? await supabase.from('branches').update(fields).eq('id', draft.id).eq('company_id', companyId).select(BRANCH_COLUMNS)
      : await supabase.from('branches').insert({ ...fields, company_id: companyId }).select(BRANCH_COLUMNS)
    setSaving(false)
    if (error) { setError(error.code === '23505' ? 'There is already a branch with this name.' : 'Could not save: ' + error.message); return }
    if (!data?.length) { setError("Couldn't save: not allowed for this login"); return }
    const row = data[0] as Branch
    setBranches(l => (draft.id ? (l || []).map(b => (b.id === row.id ? row : b)) : [...(l || []), row]).sort((a, b) => a.name.localeCompare(b.name)))
    setDraft(null)
    onSaved?.(draft.id ? 'Branch saved ✓' : `${row.name} added ✓`)
  }

  const setArchived = async (b: Branch, archived: boolean) => {
    const { data, error } = await supabase.from('branches')
      .update({ is_archived: archived }).eq('id', b.id).eq('company_id', companyId).select(BRANCH_COLUMNS)
    if (error || !data?.length) { onSaved?.(error ? 'Could not save: ' + error.message : "Couldn't save: not allowed for this login", 'error'); return }
    const row = data[0] as Branch
    setBranches(l => (l || []).map(x => (x.id === b.id ? row : x)))
    onSaved?.(archived ? `${b.name} archived` : `${b.name} restored`)
  }

  const form = (d: Draft) => (
    <div className="space-y-2">
      <input value={d.name} maxLength={60} autoFocus placeholder="Branch name (e.g. Kokapet)" aria-label="Branch name"
        onChange={e => setDraft({ ...d, name: e.target.value })} className={INPUT} />
      <input value={d.address} maxLength={200} placeholder="Address (optional)" aria-label="Address"
        onChange={e => setDraft({ ...d, address: e.target.value })} className={INPUT} />
      {error && <p className="text-xs text-red-400">{error}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={save} disabled={saving}
          className="flex-1 bg-orange-500 hover:bg-orange-400 text-white text-sm font-semibold py-2 rounded-lg disabled:opacity-50">
          {saving ? 'Saving…' : d.id ? 'Save' : 'Add branch'}
        </button>
        <button type="button" onClick={() => { setDraft(null); setError('') }}
          className="flex-1 bg-gray-800 hover:bg-gray-700 text-white text-sm py-2 rounded-lg">Cancel</button>
      </div>
    </div>
  )

  if (branches === null) return <div className="h-12 rounded-xl bg-gray-800/60 animate-pulse" aria-label="Loading" />
  if (missing) return <p className="text-xs text-gray-600">Needs the branches SQL first (db/2026-11-03-branches-batches.md)</p>

  const active = branches.filter(b => !b.is_archived).length
  return (
    <div className="space-y-2">
      <p className="text-xs text-gray-500">{active} active branch{active === 1 ? '' : 'es'} (pricing is per branch). The owner and partners add batches inside them.</p>
      <ul className="space-y-2">
        {branches.map(b => (
          <li key={b.id} className="bg-gray-800/50 rounded-xl px-3 py-2.5">
            {draft?.id === b.id ? form(draft) : (
              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <p className={`text-sm truncate ${b.is_archived ? 'text-gray-500' : 'text-white'}`}>{b.name}{b.is_archived ? ' (archived)' : ''}</p>
                  <p className="text-[11px] text-gray-500 truncate">{[b.address, `${batchCount[b.id] || 0} batch${(batchCount[b.id] || 0) === 1 ? '' : 'es'}`].filter(Boolean).join(' · ')}</p>
                </div>
                {b.is_archived ? (
                  <button type="button" onClick={() => setArchived(b, false)} className={BTN}>Restore</button>
                ) : (
                  <>
                    <button type="button" onClick={() => { setError(''); setDraft({ id: b.id, name: b.name, address: b.address || '' }) }} className={BTN}>Edit</button>
                    <button type="button" onClick={() => setArchived(b, true)}
                      className="text-xs text-gray-400 border border-gray-700 hover:border-amber-600 hover:text-amber-300 px-3 py-1.5 rounded-lg">Archive</button>
                  </>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
      {draft && !draft.id ? (
        <div className="bg-gray-800/50 rounded-xl p-3">{form(draft)}</div>
      ) : (
        <button type="button" onClick={() => { setError(''); setDraft({ id: null, name: '', address: '' }) }}
          className="w-full text-sm text-orange-400 hover:text-orange-300 border border-dashed border-gray-700 hover:border-orange-700 rounded-xl py-2">
          + Add branch
        </button>
      )}
    </div>
  )
}

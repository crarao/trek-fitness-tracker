'use client'

// Exam form + helpers shared by the exams list (schedule) and the exam page (edit). Belt grading Phase 2, PR B.

import { currencySymbol } from '@/lib/currency'
import { type Branch } from '@/lib/batches'
import { type BeltRank, beltLabel } from '@/lib/belts'

const INPUT = 'w-full bg-gray-800 text-white rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm placeholder-gray-500'
const LABEL = 'text-xs text-gray-500 mb-1 block'

export type ExamDraft = {
  exam_date: string; exam_time: string; venue: string; venueOther: string; fee: string; notes: string
  // Fee per belt being graded FOR (grading_exams.belt_fees, rank id → amount as typed); empty = the exam fee
  beltFees: Record<string, string>; beltFeesOpen: boolean
}

// The belts someone can be graded FOR (every active belt above the first), ladder order
export function feeBelts(ranks: BeltRank[]): BeltRank[] {
  const active = ranks.filter(r => r.is_active).sort((a, b) => a.rank_order - b.rank_order)
  return active.slice(1)
}

// A saved exam's belt fees → the form's strings
export function beltFeesDraft(saved: Record<string, number> | null | undefined): Record<string, string> {
  return Object.fromEntries(Object.entries(saved || {}).map(([k, v]) => [k, String(v)]))
}

// Venue options: the gym's active branches, oldest first (the first = the main branch, the default)
export function venueOptions(branches: Branch[]): string[] {
  return branches.filter(b => !b.is_archived)
    .sort((a, b) => (a.created_at || '').localeCompare(b.created_at || '') || a.name.localeCompare(b.name))
    .map(b => b.name)
}
export const OTHER_VENUE = '__other__'

type ExamFields = {
  exam_date: string; exam_time: string | null; venue: string | null; fee_amount: number | null; notes: string | null
  belt_fees?: Record<string, number> | null
}

// The draft → row fields (venue: a branch name or the typed one; fee empty = none).
// withBeltFees: only once grading_exams.belt_fees exists (20261112120000_belt_grading_fee_brown1.sql)
export function examFields(d: ExamDraft, withBeltFees = false): ExamFields | string {
  if (!d.exam_date) return 'Pick the exam date'
  const num = (v: string) => (v.trim() === '' ? null : Number(v))
  const fee = num(d.fee)
  if (fee !== null && (!Number.isFinite(fee) || fee < 0)) return 'Fee must be a number (or leave it empty)'
  const venue = (d.venue === OTHER_VENUE ? d.venueOther : d.venue).replace(/\s+/g, ' ').trim()
  const out: ExamFields = { exam_date: d.exam_date, exam_time: d.exam_time || null, venue: venue || null, fee_amount: fee, notes: d.notes.trim() || null }
  if (withBeltFees) {
    const fees: Record<string, number> = {}
    for (const [id, v] of Object.entries(d.beltFees)) {
      const n = num(v)
      if (n === null) continue
      if (!Number.isFinite(n) || n < 0) return 'Belt fees must be numbers (or left empty)'
      if (n !== fee) fees[id] = n          // same as the exam fee = nothing to store
    }
    out.belt_fees = Object.keys(fees).length ? fees : null
  }
  return out
}

// The exam form (schedule here, edit on the exam page)
export function ExamForm({ draft, setDraft, venues, currency, saving, error, onSave, onCancel, saveText, belts }: {
  draft: ExamDraft; setDraft: (d: ExamDraft) => void; venues: string[]; currency: string
  saving: boolean; error: string; onSave: () => void; onCancel: () => void; saveText: string
  belts: BeltRank[] | null   // belts to price separately; null = per-belt fees not set up yet (hidden)
}) {
  return (
    <div className="space-y-3 bg-gray-900 border border-gray-800 rounded-2xl p-4" data-testid="exam-form">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={LABEL}>Date *</label>
          <input type="date" aria-label="Exam date" value={draft.exam_date}
            onChange={e => setDraft({ ...draft, exam_date: e.target.value })} className={INPUT} />
        </div>
        <div>
          <label className={LABEL}>Time</label>
          <input type="time" aria-label="Exam time" value={draft.exam_time}
            onChange={e => setDraft({ ...draft, exam_time: e.target.value })} className={INPUT} />
        </div>
      </div>
      <div>
        <label className={LABEL}>Venue</label>
        <select aria-label="Venue" value={draft.venue} onChange={e => setDraft({ ...draft, venue: e.target.value })} className={INPUT}>
          {venues.map(v => <option key={v} value={v}>{v}</option>)}
          <option value={OTHER_VENUE}>Other…</option>
        </select>
        {draft.venue === OTHER_VENUE && (
          <input value={draft.venueOther} maxLength={80} placeholder="Venue" aria-label="Other venue"
            onChange={e => setDraft({ ...draft, venueOther: e.target.value })} className={`${INPUT} mt-2`} />
        )}
      </div>
      <div>
        <label className={LABEL}>Exam fee ({currencySymbol(currency)}, optional)</label>
        <input type="number" inputMode="decimal" min={0} aria-label="Exam fee" value={draft.fee} placeholder="e.g. 500"
          onChange={e => setDraft({ ...draft, fee: e.target.value })} className={INPUT} />
        {belts && belts.length > 0 && (
          <>
            <button type="button" aria-expanded={draft.beltFeesOpen} data-testid="belt-fees-toggle"
              onClick={() => setDraft({ ...draft, beltFeesOpen: !draft.beltFeesOpen })}
              className="text-xs text-orange-400 hover:text-orange-300 mt-2">
              {draft.beltFeesOpen ? 'Hide belt fees ▲' : 'Different fee for some belts? ▼'}
            </button>
            {draft.beltFeesOpen && (
              <div className="mt-2 space-y-1.5" data-testid="belt-fees">
                <p className="text-[11px] text-gray-500">Fee for grading TO each belt. Empty = the exam fee above.</p>
                {belts.map(b => (
                  <div key={b.id} className="flex items-center gap-2">
                    <span className="flex-1 text-xs text-gray-300 truncate">→ {beltLabel(b)}</span>
                    <input type="number" inputMode="decimal" min={0} aria-label={`Fee for ${beltLabel(b)}`}
                      value={draft.beltFees[b.id] ?? ''} placeholder={draft.fee || '—'}
                      onChange={e => setDraft({ ...draft, beltFees: { ...draft.beltFees, [b.id]: e.target.value } })}
                      className="w-28 bg-gray-800 text-white rounded-lg px-2 py-1.5 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm placeholder-gray-600" />
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
      <div>
        <label className={LABEL}>Notes (for the parents&apos; message)</label>
        <textarea rows={2} maxLength={300} aria-label="Notes" value={draft.notes} placeholder="e.g. Come in full uniform, 15 minutes early"
          onChange={e => setDraft({ ...draft, notes: e.target.value })} className={INPUT} />
      </div>
      {error && <p className="text-xs text-red-400" role="alert">{error}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={onSave} disabled={saving} data-testid="exam-save"
          className="flex-1 bg-orange-500 hover:bg-orange-600 disabled:opacity-60 text-white text-sm font-semibold rounded-lg py-2.5">
          {saving ? 'Saving…' : saveText}
        </button>
        <button type="button" onClick={onCancel} className="px-4 text-sm text-gray-400 border border-gray-700 rounded-lg">Close</button>
      </div>
    </div>
  )
}

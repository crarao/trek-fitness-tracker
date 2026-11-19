'use client'

// Set rows under a ticked exercise (17 Nov; shared since 19 Nov by the coach's plan day on the client page and
// a self-training member's own day in the client app): "Set 1 [kg] × [reps] ✕", + Set copies the row above,
// ✕ removes one (always at least one). kg is optional (bodyweight); a row without reps isn't saved.
import { type ReactNode } from 'react'
import NumBox from '@/app/num-box'
import { type SetEntry } from '@/lib/exercise-logs'

const MAX_SETS = 20

export default function SetRows({ name, rows: given, onChange, last }: {
  name: string
  rows: SetEntry[]
  onChange: (rows: SetEntry[]) => void
  last: ReactNode   // "Last: 3×10 @ 12 kg · 12 Nov" or "First time logging this exercise"
}) {
  const rows: SetEntry[] = given.length ? given : [{ kg: null, reps: null }]
  const box = 'min-w-0 h-11 bg-gray-800 text-white text-center rounded-lg px-1 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm'
  const change = (j: number, patch: Partial<SetEntry>) => onChange(rows.map((r, k) => (k === j ? { ...r, ...patch } : r)))
  return (
    <div className="pl-11 pr-3 pb-2.5 -mt-1 space-y-1.5">
      <p className="text-[11px] text-gray-500">{last}</p>
      {rows.map((r, j) => (
        <div key={j} className="flex items-center gap-1.5">
          <span className="w-11 shrink-0 text-[11px] text-gray-500">Set {j + 1}</span>
          <NumBox kind="weight" label={`${name} set ${j + 1} kg`} placeholder="kg" className={`${box} w-16`}
            value={r.kg} onValue={kg => change(j, { kg })} />
          <span className="text-gray-500 text-xs">kg ×</span>
          <NumBox kind="reps" label={`${name} set ${j + 1} reps`} placeholder="reps" className={`${box} w-14`}
            value={r.reps} onValue={reps => change(j, { reps })} />
          <button type="button" aria-label={`Remove set ${j + 1} of ${name}`} disabled={rows.length <= 1}
            onClick={() => onChange(rows.filter((_, k) => k !== j))}
            className="w-11 h-11 shrink-0 rounded-lg text-gray-500 hover:text-white disabled:opacity-30">✕</button>
        </div>
      ))}
      <button type="button" disabled={rows.length >= MAX_SETS}
        onClick={() => onChange([...rows, { ...rows[rows.length - 1] }])}
        className="h-11 px-4 rounded-lg border border-gray-700 text-sm text-orange-300 hover:border-orange-500 disabled:opacity-40">
        + Set
      </button>
    </div>
  )
}

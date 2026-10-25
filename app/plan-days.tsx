'use client'

import { useState, type ReactNode } from 'react'
import { type PlanJson, type PlanDay, daysInWeekOrder, dayLabel, exerciseDetail } from '@/lib/plan-structure'

// A structured plan as 7 day rows (in the order the plan's week runs). Tap a row to see its exercises.
// Used on the coach's plan cards and the client's My Plan. `done` holds day keys ("Mon") logged
// against this plan; `renderOpen` adds content under an open day (the client's Done ✓ form).
export default function PlanDays({
  plan, weekStart, done, doneNote, openDay, onToggle, renderOpen, compact = false,
}: {
  plan: PlanJson
  weekStart: string
  done?: Set<string>
  doneNote?: Record<string, string>   // e.g. { Tue: '45 min · ~265 kcal' } shown on done rows
  openDay?: string | null            // controlled: which day is open ("Mon"); omit to let the rows manage it
  onToggle?: (day: string | null) => void
  renderOpen?: (day: PlanDay, label: string) => ReactNode
  compact?: boolean
}) {
  const [ownOpen, setOwnOpen] = useState<string | null>(null)
  const open = openDay !== undefined ? openDay : ownOpen
  const setOpen = (d: string | null) => (onToggle ? onToggle(d) : setOwnOpen(d))

  return (
    <div className="space-y-1.5">
      {daysInWeekOrder(plan, weekStart).map(d => {
        const isOpen = open === d.day
        const isDone = !!done?.has(d.day)
        const hasContent = d.exercises.length > 0 || !!renderOpen
        if (d.rest && d.exercises.length === 0) {
          return (
            <div key={d.day} className="flex items-center gap-3 px-3 py-2 rounded-xl border border-gray-800/70 text-gray-600 text-xs">
              <span className="w-9 font-semibold">{d.day}</span>
              <span>Rest day</span>
            </div>
          )
        }
        return (
          <div key={d.day} className={`rounded-xl border ${isOpen ? 'border-orange-700 bg-gray-950' : isDone ? 'border-green-800 bg-green-950/30' : 'border-gray-700 bg-gray-800/40'}`}>
            <button type="button" aria-expanded={isOpen} disabled={!hasContent}
              onClick={() => setOpen(isOpen ? null : d.day)}
              className={`w-full flex items-center gap-3 text-left px-3 ${compact ? 'py-2' : 'py-3'} rounded-xl`}>
              <span className={`w-9 text-xs font-semibold ${isDone ? 'text-green-400' : 'text-orange-400'}`}>{d.day}</span>
              <span className="flex-1 min-w-0">
                <span className={`block text-sm font-medium truncate ${d.rest ? 'text-gray-400' : 'text-white'}`}>
                  {d.rest ? 'Rest day' : d.focus || 'Workout'}
                </span>
                <span className="block text-[11px] text-gray-500">
                  {d.exercises.length} exercise{d.exercises.length === 1 ? '' : 's'}
                  {isDone && doneNote?.[d.day] && <span className="text-green-400"> · {doneNote[d.day]}</span>}
                </span>
              </span>
              {isDone && <span className="text-[11px] font-semibold text-green-300 bg-green-900/60 border border-green-700 px-2 py-0.5 rounded-full">✓ Done</span>}
              <span className="text-gray-500 text-xs" aria-hidden="true">{isOpen ? '▾' : '▸'}</span>
            </button>
            {isOpen && (
              <div className="px-3 pb-3 space-y-3">
                {d.exercises.length > 0 && (
                  <ol className="divide-y divide-gray-800 rounded-lg border border-gray-800 bg-gray-900">
                    {d.exercises.map((e, i) => (
                      <li key={i} className="px-3 py-2">
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="text-sm text-gray-100">{e.name}</span>
                          {exerciseDetail(e) && <span className="text-xs text-orange-300 shrink-0 text-right">{exerciseDetail(e)}</span>}
                        </div>
                        {e.note && <p className="text-[11px] text-gray-500 mt-0.5">{e.note}</p>}
                      </li>
                    ))}
                  </ol>
                )}
                {renderOpen?.(d, dayLabel(d))}
              </div>
            )}
          </div>
        )
      })}
      {plan.note && <p className="text-[11px] text-gray-500 pt-1">{plan.note}</p>}
    </div>
  )
}

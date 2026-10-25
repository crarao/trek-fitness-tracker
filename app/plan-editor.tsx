'use client'

import { useState } from 'react'
import {
  type PlanJson, type PlanDay, type PlanExercise, type Weekday,
  daysInWeekOrder, emptyExercise, exerciseDetail,
} from '@/lib/plan-structure'

const inputCls = 'w-full min-w-0 bg-gray-800 text-white rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm placeholder:text-gray-500'

// Day-by-day plan editor: one row per day in the order the plan's week runs.
// Tap a day to edit it; toggle Workout / Rest; add, edit, move or remove exercise lines.
export default function PlanEditor({
  value, onChange, weekStart,
}: {
  value: PlanJson
  onChange: (plan: PlanJson) => void
  weekStart: string   // YYYY-MM-DD, '' if not picked yet (then Mon…Sun)
}) {
  const ordered = daysInWeekOrder(value, weekStart || '2024-01-01') // 1 Jan 2024 was a Monday
  const [open, setOpen] = useState<Weekday | null>(() => ordered.find(d => !d.rest)?.day ?? null)

  const updateDay = (day: Weekday, change: (d: PlanDay) => PlanDay) =>
    onChange({ ...value, days: value.days.map(d => (d.day === day ? change(d) : d)) })
  const updateExercise = (day: Weekday, i: number, patch: Partial<PlanExercise>) =>
    updateDay(day, d => ({ ...d, exercises: d.exercises.map((e, j) => (j === i ? { ...e, ...patch } : e)) }))
  const moveExercise = (day: Weekday, i: number, by: -1 | 1) =>
    updateDay(day, d => {
      const list = [...d.exercises]
      const j = i + by
      if (j < 0 || j >= list.length) return d
      ;[list[i], list[j]] = [list[j], list[i]]
      return { ...d, exercises: list }
    })
  const removeExercise = (day: Weekday, i: number) =>
    updateDay(day, d => ({ ...d, exercises: d.exercises.filter((_, j) => j !== i) }))

  const workoutCount = value.days.filter(d => !d.rest).length

  return (
    <div className="space-y-2">
      <p className="text-xs text-gray-400">
        {workoutCount} workout day{workoutCount === 1 ? '' : 's'} · tap a day to edit it
      </p>
      {ordered.map(d => {
        const isOpen = open === d.day
        const named = d.exercises.filter(e => e.name.trim()).length
        return (
          <div key={d.day} className={`rounded-xl border ${isOpen ? 'border-orange-600 bg-gray-950' : d.rest ? 'border-gray-800' : 'border-gray-700 bg-gray-800/40'}`}>
            <div className="flex items-center">
              <button type="button" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : d.day)}
                className="flex-1 min-w-0 flex items-center gap-3 text-left px-3 py-3 rounded-xl">
                <span className={`w-9 text-xs font-semibold ${d.rest ? 'text-gray-500' : 'text-orange-400'}`}>{d.day}</span>
                <span className="flex-1 min-w-0">
                  <span className={`block text-sm truncate ${d.rest ? 'text-gray-500' : 'text-white font-medium'}`}>
                    {d.rest ? 'Rest day' : d.focus.trim() || 'Workout (add a focus)'}
                  </span>
                  {(named > 0 || !d.rest) && (
                    <span className="block text-[11px] text-gray-500">{named} exercise{named === 1 ? '' : 's'}</span>
                  )}
                </span>
                <span className="text-gray-500 text-xs" aria-hidden="true">{isOpen ? '▾' : '▸'}</span>
              </button>
            </div>

            {isOpen && (
              <div className="px-3 pb-3 space-y-3">
                {/* Workout / Rest switch */}
                <div role="group" aria-label={`${d.day}: workout or rest`} className="grid grid-cols-2 rounded-lg border border-gray-700 overflow-hidden text-xs">
                  <button type="button" aria-pressed={!d.rest}
                    onClick={() => {
                      updateDay(d.day, x => ({ ...x, rest: false, exercises: x.exercises.length ? x.exercises : [emptyExercise()] }))
                      setOpen(d.day)
                    }}
                    className={`py-2 ${!d.rest ? 'bg-orange-500 text-white font-semibold' : 'text-gray-400'}`}>
                    Workout
                  </button>
                  <button type="button" aria-pressed={d.rest}
                    onClick={() => updateDay(d.day, x => ({ ...x, rest: true }))}
                    className={`py-2 ${d.rest ? 'bg-gray-700 text-white font-semibold' : 'text-gray-400'}`}>
                    Rest
                  </button>
                </div>
                {!d.rest && (
                  <div>
                    <label htmlFor={`focus-${d.day}`} className="text-[11px] text-gray-500 uppercase tracking-wider block mb-1">Focus</label>
                    <input size={1} id={`focus-${d.day}`} value={d.focus} maxLength={60}
                      placeholder="e.g. Lower Body Strength"
                      onChange={e => updateDay(d.day, x => ({ ...x, focus: e.target.value }))}
                      className={inputCls} />
                  </div>
                )}
                {d.rest && d.exercises.length === 0 && (
                  <p className="text-xs text-gray-500">Rest day. You can still add a light activity (e.g. a walk or stretching).</p>
                )}
                {d.rest && d.exercises.length > 0 && (
                  <p className="text-xs text-amber-300/80">Rest day. These stay as light activities for the client; remove any that aren&apos;t needed.</p>
                )}

                {d.exercises.map((e, i) => (
                  <div key={i} className="rounded-lg border border-gray-800 bg-gray-900 p-2.5 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-gray-500 w-4 text-right">{i + 1}</span>
                      <input size={1} aria-label={`${d.day} exercise ${i + 1} name`} value={e.name} maxLength={120}
                        placeholder="Exercise, e.g. Goblet Squat"
                        onChange={ev => updateExercise(d.day, i, { name: ev.target.value })}
                        className={inputCls} />
                    </div>
                    <div className="grid grid-cols-3 gap-2 pl-6">
                      <input size={1} aria-label="Sets" value={e.sets} maxLength={20} inputMode="numeric" placeholder="Sets"
                        onChange={ev => updateExercise(d.day, i, { sets: ev.target.value })} className={inputCls} />
                      <input size={1} aria-label="Reps or time" value={e.reps} maxLength={40} placeholder="Reps"
                        onChange={ev => updateExercise(d.day, i, { reps: ev.target.value })} className={inputCls} />
                      <input size={1} aria-label="Rest between sets" value={e.rest} maxLength={30} placeholder="Rest"
                        onChange={ev => updateExercise(d.day, i, { rest: ev.target.value })} className={inputCls} />
                    </div>
                    <div className="pl-6">
                      <input size={1} aria-label="Note" value={e.note} maxLength={160} placeholder="Note (optional), e.g. keep back flat"
                        onChange={ev => updateExercise(d.day, i, { note: ev.target.value })} className={inputCls + ' text-xs'} />
                    </div>
                    <div className="flex items-center justify-between pl-6">
                      <span className="text-[11px] text-orange-300 truncate">{exerciseDetail(e)}</span>
                      <div className="flex gap-1 shrink-0">
                        <button type="button" onClick={() => moveExercise(d.day, i, -1)} disabled={i === 0} aria-label="Move up"
                          className="w-8 h-8 grid place-items-center text-xs text-gray-400 border border-gray-700 rounded-lg disabled:opacity-30">↑</button>
                        <button type="button" onClick={() => moveExercise(d.day, i, 1)} disabled={i === d.exercises.length - 1} aria-label="Move down"
                          className="w-8 h-8 grid place-items-center text-xs text-gray-400 border border-gray-700 rounded-lg disabled:opacity-30">↓</button>
                        <button type="button" onClick={() => removeExercise(d.day, i)} aria-label={`Remove exercise ${i + 1}`}
                          className="w-8 h-8 grid place-items-center text-xs text-gray-400 hover:text-red-400 border border-gray-700 hover:border-red-500 rounded-lg">✕</button>
                      </div>
                    </div>
                  </div>
                ))}

                <button type="button"
                  onClick={() => updateDay(d.day, x => ({ ...x, exercises: [...x.exercises, emptyExercise()] }))}
                  className="w-full text-xs text-orange-400 hover:text-orange-300 border border-dashed border-gray-700 hover:border-orange-600 py-2.5 rounded-lg">
                  + Add {d.rest ? 'a light activity' : 'exercise'}
                </button>
              </div>
            )}
          </div>
        )
      })}
      <div>
        <label htmlFor="plan-note" className="text-[11px] text-gray-500 uppercase tracking-wider block mb-1">Note at the end (optional)</label>
        <input size={1} id="plan-note" value={value.note} maxLength={300}
          placeholder="e.g. Drink water between sets. Review with your coach before starting."
          onChange={e => onChange({ ...value, note: e.target.value })} className={inputCls} />
      </div>
    </div>
  )
}

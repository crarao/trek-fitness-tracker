'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  type PlanJson, type PlanDay, type PlanExercise, type Weekday,
  daysInWeekOrder, emptyExercise, exerciseDetail, MAX_EXERCISES_PER_DAY,
} from '@/lib/plan-structure'
import { type Country } from '@/lib/locale'
import ExercisePicker, { type PickedExercise } from '@/app/exercise-picker'
import PlanCopySheet from '@/app/plan-copy-sheet'

const inputCls = 'w-full min-w-0 bg-gray-800 text-white rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm placeholder:text-gray-500'
const smallInput = 'w-full min-w-0 bg-gray-800 text-white rounded-lg px-2 py-1.5 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-xs placeholder:text-gray-500'
const iconBtn = 'w-8 h-8 grid place-items-center text-xs text-gray-400 border border-gray-700 rounded-lg disabled:opacity-30'

// Sensible starting numbers for a picked exercise; the coach adjusts them in the row
function defaultsFor(group: string | null | undefined): Pick<PlanExercise, 'sets' | 'reps'> {
  if (group === 'cardio') return { sets: '', reps: '10 min' }
  if (group === 'mobility') return { sets: '2', reps: '30 s' }
  if (group === 'core') return { sets: '3', reps: '15' }
  return { sets: '3', reps: '10' }
}

const isBlank = (e: PlanExercise) => !e.name.trim() && !e.sets && !e.reps && !e.rest && !e.note && !e.weight

// Plan builder: day chips across the top (in the order the plan's week runs), the chosen day below.
// Each day: Workout / Rest, a title, exercises (sets stepper × reps, weight, rest, note, move, remove),
// "+ Add exercise" (library picker), duplicate to another day. "Copy from a client" fills the
// whole plan (hidden with allowCopy={false}, e.g. on an AI plan: copying would replace it). Days stay Mon…Sun because client Done ✓ / ticks are saved per weekday.
export default function PlanEditor({
  value, onChange, weekStart, companyId = null, clientId, country = 'IN', allowCopy = true,
}: {
  value: PlanJson
  onChange: (plan: PlanJson) => void
  weekStart: string   // YYYY-MM-DD, '' if not picked yet (then Mon…Sun)
  companyId?: string | null // the client's gym: custom exercises are saved to its list
  clientId?: string         // marks "this client" in Copy a plan
  country?: Country
  allowCopy?: boolean       // false = no "Copy from a client" button (AI plan panel)
}) {
  const ordered = daysInWeekOrder(value, weekStart || '2024-01-01') // 1 Jan 2024 was a Monday
  const [open, setOpen] = useState<Weekday>(() => ordered.find(d => !d.rest)?.day ?? ordered[0].day)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [copyOpen, setCopyOpen] = useState(false)
  const [notesOpen, setNotesOpen] = useState<Record<string, boolean>>({})
  const [dupOpen, setDupOpen] = useState(false)
  const [message, setMessage] = useState('')
  const msgTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const say = (text: string) => {
    setMessage(text)
    if (msgTimer.current) clearTimeout(msgTimer.current)
    msgTimer.current = setTimeout(() => setMessage(''), 2500)
  }

  // The picker adds to the latest plan, not the one from when it opened (several adds in a row)
  const latest = useRef(value)
  useLayoutEffect(() => { latest.current = value })

  // Changing the week start re-orders the days; moving those rows makes phones lose their place and
  // jump up the page. Remember where the page was and put it back right after the re-order.
  const lastScrollY = useRef(0)
  useEffect(() => {
    lastScrollY.current = window.scrollY
    const onScroll = () => { lastScrollY.current = window.scrollY }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])
  const firstWeekStart = useRef(weekStart)
  useLayoutEffect(() => {
    if (weekStart === firstWeekStart.current) return
    firstWeekStart.current = weekStart
    const y = lastScrollY.current
    window.scrollTo({ top: y })
    requestAnimationFrame(() => window.scrollTo({ top: y })) // again after the phone settles
  }, [weekStart])

  const updateDayIn = (plan: PlanJson, day: Weekday, change: (d: PlanDay) => PlanDay): PlanJson =>
    ({ ...plan, days: plan.days.map(d => (d.day === day ? change(d) : d)) })
  const updateDay = (day: Weekday, change: (d: PlanDay) => PlanDay) => onChange(updateDayIn(value, day, change))
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

  // Sets stepper: numbers only; "3-4" style text is left alone by the buttons
  const stepSets = (day: Weekday, i: number, e: PlanExercise, by: 1 | -1) => {
    const n = /^\d*$/.test(e.sets) ? parseInt(e.sets || '0', 10) : NaN
    if (Number.isNaN(n)) return
    const next = Math.max(0, Math.min(20, n + by))
    updateExercise(day, i, { sets: next ? String(next) : '' })
  }

  const addPicked = (p: PickedExercise) => {
    const plan = latest.current
    const day = plan.days.find(d => d.day === open)
    if (!day) return
    const base = day.exercises.filter(e => !isBlank(e)) // replace the empty starter line
    if (base.length >= MAX_EXERCISES_PER_DAY) { say(`Up to ${MAX_EXERCISES_PER_DAY} exercises a day`); return }
    const ex: PlanExercise = { ...emptyExercise(), name: p.name, ...defaultsFor(p.muscle_group) }
    if (p.exercise_id) ex.exercise_id = p.exercise_id
    const next = updateDayIn(plan, open, d => ({ ...d, rest: false, exercises: [...base, ex] }))
    latest.current = next
    onChange(next)
  }

  const duplicateTo = (from: PlanDay, to: Weekday) => {
    const target = value.days.find(d => d.day === to)
    if (target && target.exercises.some(e => !isBlank(e)) &&
        !confirm(`Replace ${to}'s ${target.exercises.length} exercise${target.exercises.length === 1 ? '' : 's'} with ${from.day}'s?`)) return
    onChange(updateDayIn(value, to, () => ({
      day: to, rest: from.rest, focus: from.focus, exercises: from.exercises.map(e => ({ ...e })),
    })))
    setDupOpen(false)
    setOpen(to)
    say(`Copied ${from.day} to ${to} ✓`)
  }

  const copyPlan = (plan: PlanJson, from: string) => {
    const hasWork = value.days.some(d => d.exercises.some(e => !isBlank(e)))
    if (hasWork && !confirm(`Replace this plan with the one from ${from}? Your changes here will be lost.`)) return
    onChange({ ...plan, days: plan.days.map(d => ({ ...d, exercises: d.exercises.map(e => ({ ...e })) })) })
    setCopyOpen(false)
    setOpen(daysInWeekOrder(plan, weekStart || '2024-01-01').find(d => !d.rest)?.day ?? open)
    say(`Copied from ${from} ✓ Check it, then save`)
  }

  const workoutCount = value.days.filter(d => !d.rest).length
  const exerciseCount = value.days.reduce((n, d) => n + d.exercises.filter(e => e.name.trim()).length, 0)
  const d = value.days.find(x => x.day === open) ?? ordered[0]

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-gray-400">
          {workoutCount} workout day{workoutCount === 1 ? '' : 's'} · {exerciseCount} exercise{exerciseCount === 1 ? '' : 's'}
        </p>
        {allowCopy && (
        <button type="button" onClick={() => setCopyOpen(true)}
          className="text-xs text-gray-300 hover:text-white border border-gray-700 hover:border-gray-500 px-2.5 py-1.5 rounded-lg">
          Copy from a client
        </button>
        )}
      </div>

      {/* Day chips */}
      <div role="tablist" aria-label="Days" className="grid grid-cols-7 gap-1">
        {ordered.map(x => {
          const sel = x.day === open
          const n = x.exercises.filter(e => e.name.trim()).length
          return (
            <button key={x.day} type="button" role="tab" aria-selected={sel}
              onClick={() => { setOpen(x.day); setDupOpen(false) }}
              className={`rounded-lg border py-1.5 text-center leading-tight ${sel ? 'border-orange-500 bg-orange-500/15' : x.rest ? 'border-gray-800' : 'border-gray-700 bg-gray-800/50'}`}>
              <span className={`block text-xs font-semibold ${sel ? 'text-orange-300' : x.rest ? 'text-gray-500' : 'text-white'}`}>{x.day}</span>
              <span className={`block text-[10px] ${x.rest ? 'text-gray-600' : 'text-gray-400'}`}>{x.rest ? (n ? `Rest+${n}` : 'Rest') : n}</span>
            </button>
          )
        })}
      </div>

      {/* The chosen day */}
      <div role="tabpanel" aria-label={d.day} className="rounded-xl border border-gray-700 bg-gray-950 p-3 space-y-3">
        <div role="group" aria-label={`${d.day}: workout or rest`} className="grid grid-cols-2 rounded-lg border border-gray-700 overflow-hidden text-xs">
          <button type="button" aria-pressed={!d.rest}
            onClick={() => updateDay(d.day, x => ({ ...x, rest: false }))}
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
            <label htmlFor={`focus-${d.day}`} className="text-[11px] text-gray-500 uppercase tracking-wider block mb-1">Day title</label>
            <input size={1} id={`focus-${d.day}`} value={d.focus} maxLength={60}
              placeholder="e.g. Push, Legs, Lower Body Strength"
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

        {d.exercises.map((e, i) => {
          const noteKey = `${d.day}:${i}`
          const showNote = !!e.note || !!notesOpen[noteKey]
          const numericSets = /^\d*$/.test(e.sets)
          return (
            <div key={i} className="rounded-lg border border-gray-800 bg-gray-900 p-2.5 space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-gray-500 w-4 text-right shrink-0">{i + 1}</span>
                <input size={1} aria-label={`${d.day} exercise ${i + 1} name`} value={e.name} maxLength={120}
                  placeholder="Exercise, e.g. Goblet Squat"
                  // Typing over a library exercise makes it a typed one (the link would be wrong)
                  onChange={ev => updateExercise(d.day, i, { name: ev.target.value, exercise_id: undefined })}
                  className={inputCls + ' font-medium'} />
                <button type="button" onClick={() => removeExercise(d.day, i)} aria-label={`Remove exercise ${i + 1}`}
                  className={iconBtn + ' hover:text-red-400 hover:border-red-500 shrink-0'}>✕</button>
              </div>
              <div className="grid grid-cols-[auto_1fr_1fr_1fr] gap-1.5 pl-6 items-end">
                <div>
                  <span className="block text-[10px] text-gray-500 mb-0.5">Sets</span>
                  {numericSets ? (
                    <div className="flex items-center rounded-lg border border-gray-700 bg-gray-800 overflow-hidden">
                      <button type="button" aria-label="One set fewer" onClick={() => stepSets(d.day, i, e, -1)}
                        className="w-7 h-[30px] text-gray-300 active:bg-gray-700">−</button>
                      <input size={1} aria-label="Sets" value={e.sets} maxLength={20} inputMode="numeric"
                        onChange={ev => updateExercise(d.day, i, { sets: ev.target.value })}
                        className="w-6 bg-transparent text-center text-xs text-white outline-none" />
                      <button type="button" aria-label="One more set" onClick={() => stepSets(d.day, i, e, 1)}
                        className="w-7 h-[30px] text-gray-300 active:bg-gray-700">+</button>
                    </div>
                  ) : (
                    <input size={1} aria-label="Sets" value={e.sets} maxLength={20}
                      onChange={ev => updateExercise(d.day, i, { sets: ev.target.value })} className={smallInput + ' w-20'} />
                  )}
                </div>
                <label className="block">
                  <span className="block text-[10px] text-gray-500 mb-0.5">Reps</span>
                  <input size={1} value={e.reps} maxLength={40} placeholder="10" aria-label="Reps or time"
                    onChange={ev => updateExercise(d.day, i, { reps: ev.target.value })} className={smallInput} />
                </label>
                <label className="block">
                  <span className="block text-[10px] text-gray-500 mb-0.5">Weight</span>
                  <input size={1} value={e.weight || ''} maxLength={30} placeholder="20 kg" aria-label="Weight"
                    onChange={ev => updateExercise(d.day, i, { weight: ev.target.value })} className={smallInput} />
                </label>
                <label className="block">
                  <span className="block text-[10px] text-gray-500 mb-0.5">Rest</span>
                  <input size={1} value={e.rest} maxLength={30} placeholder="60 s" aria-label="Rest between sets"
                    onChange={ev => updateExercise(d.day, i, { rest: ev.target.value })} className={smallInput} />
                </label>
              </div>
              {showNote && (
                <div className="pl-6">
                  <input size={1} aria-label="Note" value={e.note} maxLength={160} placeholder="Note, e.g. keep back flat"
                    autoFocus={!e.note}
                    onChange={ev => updateExercise(d.day, i, { note: ev.target.value })} className={smallInput} />
                </div>
              )}
              <div className="flex items-center justify-between gap-2 pl-6">
                {showNote
                  ? <span className="text-[11px] text-orange-300 truncate">{exerciseDetail(e)}</span>
                  : <button type="button" onClick={() => setNotesOpen(o => ({ ...o, [noteKey]: true }))}
                      className="text-[11px] text-gray-400 hover:text-white">+ Note</button>}
                <div className="flex gap-1 shrink-0">
                  <button type="button" onClick={() => moveExercise(d.day, i, -1)} disabled={i === 0} aria-label="Move up" className={iconBtn}>↑</button>
                  <button type="button" onClick={() => moveExercise(d.day, i, 1)} disabled={i === d.exercises.length - 1} aria-label="Move down" className={iconBtn}>↓</button>
                </div>
              </div>
            </div>
          )
        })}

        <button type="button" onClick={() => setPickerOpen(true)}
          className="w-full text-sm font-medium text-orange-300 hover:text-orange-200 border border-dashed border-orange-800 hover:border-orange-500 py-3 rounded-lg">
          + Add {d.rest ? 'a light activity' : 'exercise'}
        </button>
        <div className="flex items-center justify-between gap-2">
          <button type="button"
            onClick={() => updateDay(d.day, x => ({ ...x, exercises: [...x.exercises, emptyExercise()] }))}
            className="text-[11px] text-gray-400 hover:text-white underline underline-offset-2">
            Type one instead
          </button>
          <button type="button" onClick={() => setDupOpen(o => !o)} aria-expanded={dupOpen}
            className="text-[11px] text-gray-300 hover:text-white border border-gray-700 px-2.5 py-1 rounded-lg">
            Duplicate day…
          </button>
        </div>
        {dupOpen && (
          <div className="rounded-lg border border-gray-800 p-2.5">
            <p className="text-[11px] text-gray-400 mb-2">Copy {d.day}{d.focus ? ` (${d.focus})` : ''} to:</p>
            <div className="grid grid-cols-6 gap-1">
              {ordered.filter(x => x.day !== d.day).map(x => (
                <button key={x.day} type="button" onClick={() => duplicateTo(d, x.day)}
                  className={`text-xs py-1.5 rounded-lg border ${x.rest ? 'border-gray-800 text-gray-400' : 'border-gray-700 text-white'} hover:border-orange-500`}>
                  {x.day}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {message && <p aria-live="polite" className="text-xs text-green-400">{message}</p>}

      <div>
        <label htmlFor="plan-note" className="text-[11px] text-gray-500 uppercase tracking-wider block mb-1">Note at the end (optional)</label>
        <input size={1} id="plan-note" value={value.note} maxLength={300}
          placeholder="e.g. Drink water between sets. Review with your coach before starting."
          onChange={e => onChange({ ...value, note: e.target.value })} className={inputCls} />
      </div>

      <ExercisePicker open={pickerOpen} onClose={() => setPickerOpen(false)} onPick={addPicked}
        companyId={companyId} title={`${d.day}${!d.rest && d.focus ? ' · ' + d.focus : ''}`} />
      <PlanCopySheet open={copyOpen} onClose={() => setCopyOpen(false)} onPick={copyPlan}
        currentClientId={clientId} country={country} />
    </div>
  )
}

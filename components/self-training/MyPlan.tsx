'use client'

// "My plan" for a self-training member (19 Nov, client view build Part C; rules in lib/self-training.ts).
// They build their own week (days, exercises from the gym's list only, sets × reps, optional kg; no AI),
// it repeats every week until they edit it, and they log a day with the same set rows the coaches use
// (app/set-rows.tsx), pre-filled from their last time. Saves: the session first, then one exercise_logs row
// per ticked exercise, both logged_by the member. Every save checks rows came back and says so when not
// (a blocked write returns nothing). Unsaved ticks and numbers are kept on the phone for the day.
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import PlanEditor from '@/app/plan-editor'
import SetRows from '@/app/set-rows'
import {
  type PlanJson, type PlanDay, planJsonOf, emptyPlan, cleanPlan, planToText, workoutDays, dayLabel, exercisesDoneFor,
} from '@/lib/plan-structure'
import { dayKey, doneDayKeys, localToday } from '@/lib/plan-summary'
import { type Country, formatDate } from '@/lib/locale'
import { type Exercise } from '@/lib/exercises'
import {
  type LogDraft, type LogInsert, type SetEntry, lastLogFor, prefill, rowsToSave, isTimedOrDistance, logDetail, logLine, filledSets,
} from '@/lib/exercise-logs'
import { type ProgressLog } from '@/lib/progress'
import { ownPlanOn, expandOwnPlans, mondayOf } from '@/lib/self-training'

export type MyPlanRow = { id: string; client_id?: string; week_start: string; plan_details: string; plan_json?: unknown; created_by?: string | null; created_at?: string | null }
export type MyPlanSession = {
  id: string; session_date: string; duration_minutes: number; notes: string; weekly_plan_id: string | null; plan_day?: string | null
}

type DayDraft = { ticked: number[]; sets: Record<number, SetEntry[]>; minutes: string; notes: string }
const emptyDraft = (): DayDraft => ({ ticked: [], sets: {}, minutes: '', notes: '' })
const draftKey = (memberId: string, date: string, day: string) => `self-day:${memberId}:${date}:${day}`

const btn = 'min-h-[44px] rounded-xl text-sm font-semibold transition disabled:opacity-50'

export default function MyPlan({
  memberId, companyId, availableDays, country, plans, sessions, logs, library, notesEnabled, onSaved, toast,
}: {
  memberId: string
  companyId: string
  availableDays?: string | null
  country: Country
  plans: MyPlanRow[]
  sessions: MyPlanSession[]
  logs: ProgressLog[]
  library: Exercise[]
  notesEnabled: boolean
  onSaved: () => void
  toast: (text: string, kind?: 'success' | 'error') => void
}) {
  const today = localToday()
  const monday = mondayOf(today)
  const current = ownPlanOn(plans, memberId, today)
  const json = current ? planJsonOf(current) : null

  const [editing, setEditing] = useState<PlanJson | null>(null)
  const [savingPlan, setSavingPlan] = useState(false)
  const [planError, setPlanError] = useState('')
  const [showEarlier, setShowEarlier] = useState(false)
  const [openDay, setOpenDay] = useState<string | null>(null)
  const [draft, setDraft] = useState<DayDraft>(emptyDraft)
  const [dayError, setDayError] = useState('')
  const [saving, setSaving] = useState(false)
  // Session saved but the weights weren't: keep them to try again
  const [retry, setRetry] = useState<LogInsert[] | null>(null)

  // This week's copy of the plan and the sessions pointed at it, for the done ticks
  const done = (() => {
    if (!current) return new Set<string>()
    const ex = expandOwnPlans(plans, sessions, memberId, today)
    const week = ex.plans.find(p => p.week_start.slice(0, 10) === monday && p.created_by === memberId)
    return week ? doneDayKeys(week.id, ex.sessions) : new Set<string>()
  })()

  // Opening a day brings back its draft from the phone; every change is saved back
  const toggleDay = (day: string) => {
    if (openDay === day) { setOpenDay(null); return }
    let next = emptyDraft()
    try {
      const raw = localStorage.getItem(draftKey(memberId, today, day))
      if (raw) next = { ...emptyDraft(), ...JSON.parse(raw) }
    } catch { /* storage off: start empty */ }
    setDraft(next)
    setDayError('')
    setOpenDay(day)
  }
  const changeDraft = (next: DayDraft) => {
    setDraft(next)
    if (!openDay) return
    try { localStorage.setItem(draftKey(memberId, today, openDay), JSON.stringify(next)) } catch { /* storage off: kept until reload */ }
  }

  // ---- Building / editing the plan ----
  const startEditing = () => {
    setPlanError('')
    setShowEarlier(false)
    setEditing(json ? structuredClone(json) : emptyPlan(availableDays))
  }
  // Earlier versions of their own plan (24 Nov): every own plan except the one in effect, newest first, one per
  // week (a same-week edit replaced the older one). Picking one fills the editor; nothing is saved until Save.
  const earlier = (() => {
    const own = plans.filter(p => p.created_by === memberId && p.id !== current?.id)
      .sort((a, b) => mondayOf(b.week_start).localeCompare(mondayOf(a.week_start)) || (b.created_at || '').localeCompare(a.created_at || ''))
    const seen = new Set<string>()
    return own.filter(p => { const w = mondayOf(p.week_start); if (seen.has(w)) return false; seen.add(w); return true })
      .map(p => ({ plan: p, json: planJsonOf(p) }))
      .filter((x): x is { plan: MyPlanRow; json: PlanJson } => !!x.json && workoutDays(x.json).length > 0)
  })()
  const pickEarlier = (p: PlanJson) => {
    setPlanError('')
    setShowEarlier(false)
    setEditing(structuredClone(p))
  }
  const earlierList = earlier.length > 0 && (
    <div className="rounded-xl border border-gray-800 bg-gray-950/60" data-testid="self-plan-earlier">
      <button type="button" aria-expanded={showEarlier} onClick={() => setShowEarlier(!showEarlier)}
        className="w-full flex items-center justify-between gap-3 px-3 min-h-[44px] text-left text-sm text-orange-300">
        <span>Start from an earlier plan</span><span className="text-gray-500 text-xs">{showEarlier ? 'Hide' : earlier.length}</span>
      </button>
      {showEarlier && (
        <ul className="border-t border-gray-800 divide-y divide-gray-800">
          {earlier.map(({ plan, json: pj }) => (
            <li key={plan.id}>
              <button type="button" onClick={() => pickEarlier(pj)}
                className="w-full flex items-center justify-between gap-3 px-3 py-2.5 min-h-[48px] text-left hover:bg-gray-900">
                <span className="min-w-0">
                  <span className="block text-sm text-white">Week of {formatDate(plan.week_start, country, 'dayMonth')}</span>
                  <span className="block text-[11px] text-gray-500 truncate">
                    {workoutDays(pj).length} training day{workoutDays(pj).length === 1 ? '' : 's'} · {workoutDays(pj).map(d => d.day).join(', ')}
                  </span>
                </span>
                <span className="shrink-0 text-xs text-orange-400">Use</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
  const savePlan = async () => {
    if (!editing) return
    const clean = cleanPlan(editing)
    const days = clean.days.filter(d => !d.rest && d.exercises.some(e => e.name.trim()))
    if (!days.length) { setPlanError('Add at least one exercise to a training day.'); return }
    setSavingPlan(true)
    setPlanError('')
    // A new row from this Monday (an edit too): past weeks keep the plan they had. created_by is set by
    // the database (trigger fill_plan_created_by, db/2026-11-19-client-view.md Step 2).
    const { data, error } = await supabase.from('weekly_plans')
      .insert({ client_id: memberId, week_start: monday, plan_details: planToText(clean), plan_json: clean, workout_time: null })
      .select('id').single()
    setSavingPlan(false)
    if (error || !data) { setPlanError('Could not save your plan' + (error ? ': ' + error.message : '. Please try again.')); return }
    setEditing(null)
    toast(current ? '✓ Plan updated from this week' : '✓ Plan saved. It repeats every week until you change it.')
    onSaved()
  }

  if (editing) return (
    <div className="bg-gray-900 rounded-2xl p-4 border border-gray-800 space-y-4" data-testid="self-plan-editor">
      <div>
        <p className="text-base font-semibold text-white">{current ? 'Edit my plan' : 'Build my plan'}</p>
        <p className="text-xs text-gray-500 mt-0.5">Tap a day, then add exercises from your gym&apos;s list. Your plan repeats every week until you change it.</p>
      </div>
      {earlierList}
      <PlanEditor value={editing} onChange={setEditing} weekStart={monday} companyId={companyId} clientId={memberId}
        country={country} allowCopy={false} libraryOnly />
      {planError && <p className="text-sm text-red-400">{planError}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={savePlan} disabled={savingPlan} className={`flex-1 bg-orange-500 hover:bg-orange-400 text-white ${btn}`}>
          {savingPlan ? 'Saving…' : current ? 'Save changes' : 'Save my plan'}
        </button>
        <button type="button" onClick={() => setEditing(null)} className={`px-5 bg-gray-800 hover:bg-gray-700 text-white ${btn}`}>Cancel</button>
      </div>
    </div>
  )

  if (!current || !json) return (
    <div className="bg-gray-900 rounded-2xl p-6 border border-gray-800 text-center" data-testid="self-plan-empty">
      <p className="text-base font-semibold text-white">Plan your training week</p>
      <p className="text-sm text-gray-400 mt-1">Pick your days and exercises. It repeats every week, and your progress builds as you log.</p>
      <button type="button" onClick={startEditing} className={`mt-4 w-full bg-orange-500 hover:bg-orange-400 text-white ${btn}`}>Build my plan</button>
      {earlier.length > 0 && <div className="mt-3 text-left">{earlierList}</div>}
    </div>
  )

  // ---- Logging a day ----
  const exerciseDraft = (day: PlanDay, i: number): LogDraft =>
    ({ sets: draft.sets[i] ?? prefill(day.exercises[i], lastLogFor(day.exercises[i], logs, library)).sets })

  const toggleTick = (i: number) =>
    changeDraft({ ...draft, ticked: draft.ticked.includes(i) ? draft.ticked.filter(x => x !== i) : [...draft.ticked, i] })

  const saveWeights = async (rows: LogInsert[]): Promise<boolean> => {
    const { data, error } = await supabase.from('exercise_logs').insert(rows).select('id')
    if (error || (data?.length ?? 0) !== rows.length) {
      setRetry(rows)
      toast('Workout saved, but the weights didn\'t' + (error ? ': ' + error.message : '') + '. Tap Try again.', 'error')
      return false
    }
    setRetry(null)
    return true
  }

  const saveDay = async (day: PlanDay) => {
    if (saving) return
    const minutes = parseInt(draft.minutes, 10)
    if (!minutes || minutes <= 0) { setDayError('Enter how many minutes you trained'); return }
    const ticked = [...draft.ticked].sort((a, b) => a - b)
    if (!ticked.length) { setDayError('Tick the exercises you did'); return }
    setSaving(true)
    setDayError('')
    const label = dayLabel(day)
    const { data: session, error } = await supabase.from('logged_sessions').insert({
      client_id: memberId, weekly_plan_id: current.id, session_date: today, duration_minutes: minutes,
      notes: draft.notes, plan_day: label, exercises_done: exercisesDoneFor(day, ticked), logged_by: memberId,
    }).select('id').single()
    if (error || !session) {
      setSaving(false)
      setDayError('Could not save: ' + (error?.message || 'please try again'))
      return
    }
    const drafts: Record<number, LogDraft> = Object.fromEntries(ticked.map(i => [i, exerciseDraft(day, i)]))
    const rows = rowsToSave({
      exercises: day.exercises, ticked, drafts, sessionId: session.id, clientId: memberId, companyId, loggedBy: memberId, library,
    })
    const weightsOk = rows.length ? await saveWeights(rows) : true
    setSaving(false)
    try { localStorage.removeItem(draftKey(memberId, today, day.day)) } catch { /* ignore */ }
    setDraft(emptyDraft())
    setOpenDay(null)
    if (weightsOk) toast(`✓ ${day.day} saved · ${rows.length} exercise${rows.length === 1 ? '' : 's'}`)
    onSaved()
  }

  const setsEntered = draft.ticked.reduce((n, i) => n + (draft.sets[i] ? filledSets({ sets: draft.sets[i] }).length : 0), 0)
  const loggedToday = (day: PlanDay) => sessions.filter(s => s.session_date.slice(0, 10) >= monday && dayKey(s.plan_day) === day.day
    && plans.some(p => p.id === s.weekly_plan_id && p.created_by === memberId))

  return (
    <div className="space-y-3" data-testid="self-plan">
      <div className="bg-gray-900 rounded-2xl p-4 border border-gray-800">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wider">My plan</p>
            <p className="text-sm text-white mt-0.5">{workoutDays(json).length} training day{workoutDays(json).length === 1 ? '' : 's'} · repeats every week</p>
            <p className="text-[11px] text-gray-500 mt-0.5">Since {formatDate(current.week_start, country, 'dayMonth')} · {done.size} of {workoutDays(json).length} done this week</p>
          </div>
          <button type="button" onClick={startEditing}
            className="shrink-0 text-xs text-orange-400 border border-orange-900 hover:border-orange-500 px-3 py-1.5 rounded-lg">Edit plan</button>
        </div>
      </div>

      {retry && (
        <div className="bg-red-950 border border-red-800 rounded-xl p-3 flex items-center justify-between gap-3">
          <p className="text-xs text-red-200">Your last workout&apos;s weights weren&apos;t saved.</p>
          <button type="button" onClick={async () => { if (await saveWeights(retry)) { toast('✓ Weights saved'); onSaved() } }}
            className="text-xs bg-red-600 hover:bg-red-500 text-white px-3 py-1.5 rounded-lg">Try again</button>
        </div>
      )}

      {json.days.map(day => {
        if (day.rest || !day.exercises.some(e => e.name.trim())) return (
          <div key={day.day} className="flex items-center gap-3 px-3 py-2 rounded-xl border border-gray-800/70 text-gray-600 text-xs">
            <span className="w-9 font-semibold">{day.day}</span><span>Rest day</span>
          </div>
        )
        const isDone = done.has(day.day)
        const isOpen = openDay === day.day
        const exercises = day.exercises.filter(e => e.name.trim())
        return (
          <div key={day.day} className={`rounded-xl border ${isOpen ? 'border-orange-700 bg-gray-950' : isDone ? 'border-green-800 bg-green-950/30' : 'border-gray-700 bg-gray-800/40'}`}>
            <button type="button" aria-expanded={isOpen} onClick={() => toggleDay(day.day)}
              className="w-full flex items-center gap-3 text-left px-3 py-3 min-h-[56px]">
              <span className={`w-9 text-xs font-semibold ${isDone ? 'text-green-400' : 'text-orange-400'}`}>{day.day}</span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-medium text-white truncate">{day.focus || 'Workout'}</span>
                <span className="block text-[11px] text-gray-500">{exercises.length} exercise{exercises.length === 1 ? '' : 's'}</span>
              </span>
              {isDone && <span className="text-xs text-green-400">✓ Done</span>}
            </button>

            {isOpen && (isDone ? (
              <div className="px-3 pb-3 space-y-2">
                {loggedToday(day).map(s => (
                  <div key={s.id} className="text-xs text-gray-300 space-y-1 border-t border-gray-800 pt-2">
                    <p>Done {formatDate(s.session_date, country, 'weekday')} · {s.duration_minutes} min</p>
                    {logs.filter(l => l.session_id === s.id).sort((a, b) => a.position - b.position)
                      .map(l => <p key={l.id} className="text-gray-400">{logLine(l)}</p>)}
                    {s.notes && <p className="text-gray-400 bg-gray-900 rounded-lg px-3 py-2">{s.notes}</p>}
                  </div>
                ))}
              </div>
            ) : (
              <div className="pb-3">
                <p className="px-3 text-[11px] text-gray-500">Tick each exercise as you do it and enter your sets.</p>
                <ul className="mt-1">
                  {day.exercises.map((e, i) => {
                    if (!e.name.trim()) return null
                    const on = draft.ticked.includes(i)
                    const last = lastLogFor(e, logs, library)
                    return (
                      <li key={i}>
                        <button type="button" aria-pressed={on} onClick={() => toggleTick(i)}
                          className="w-full flex items-center gap-3 px-3 py-2.5 text-left min-h-[48px]">
                          <span className={`w-6 h-6 shrink-0 rounded-full border-2 grid place-items-center text-xs ${on ? 'bg-green-600 border-green-600 text-white' : 'border-gray-600'}`}>{on ? '✓' : ''}</span>
                          <span className="flex-1 min-w-0">
                            <span className="block text-sm text-white truncate">{e.name}</span>
                            <span className="block text-[11px] text-gray-500">{[e.sets && `${e.sets} sets`, e.reps && `${e.reps} reps`, e.weight].filter(Boolean).join(' · ')}</span>
                          </span>
                        </button>
                        {on && !isTimedOrDistance(e) && (
                          <SetRows name={e.name} rows={exerciseDraft(day, i).sets}
                            onChange={rows => changeDraft({ ...draft, sets: { ...draft.sets, [i]: rows } })}
                            last={last ? <>Last: {logDetail(last) || '—'} · {formatDate(last.session_date, country, 'dayMonth')}</> : 'First time logging this exercise'} />
                        )}
                      </li>
                    )
                  })}
                </ul>
                <div className="px-3 pt-2 space-y-2 border-t border-gray-800 mt-1">
                  <div className="flex items-center gap-2">
                    <label htmlFor={`min-${day.day}`} className="text-xs text-gray-400">Minutes</label>
                    <input id={`min-${day.day}`} type="text" inputMode="numeric" value={draft.minutes} placeholder="e.g. 45"
                      onChange={ev => changeDraft({ ...draft, minutes: ev.target.value.replace(/\D/g, '').slice(0, 3) })}
                      className="w-20 h-11 bg-gray-800 text-white text-center rounded-lg outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm" />
                  </div>
                  {notesEnabled && (
                    <textarea value={draft.notes} rows={2} maxLength={500} placeholder="Notes (optional)"
                      onChange={ev => changeDraft({ ...draft, notes: ev.target.value })}
                      className="w-full bg-gray-800 text-white rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm resize-none" />
                  )}
                  {dayError && <p className="text-sm text-red-400">{dayError}</p>}
                  <button type="button" disabled={saving} onClick={() => saveDay(day)}
                    className={`w-full bg-green-600 hover:bg-green-500 text-white ${btn}`} data-testid="self-save-day">
                    {saving ? 'Saving…' : `Save ${day.day} · ${draft.ticked.length} exercise${draft.ticked.length === 1 ? '' : 's'}${setsEntered ? ` · ${setsEntered} sets` : ''}`}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )
      })}
    </div>
  )
}

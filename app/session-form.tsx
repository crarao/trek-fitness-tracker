'use client'

import { type ReactNode } from 'react'
import { ACTIVITIES } from '@/lib/activities'
import { type Country, formatDate } from '@/lib/locale'
import { localToday } from '@/lib/plan-summary'

// One form for both ways a client logs a workout, so they look and behave the same:
//  - 'log': Log tab, for anything (asks "What did you do?" and which plan week it belongs to)
//  - 'day': Done ✓ on a day of this week's plan (the day says what was done)
// Same fields, order and buttons in both: Minutes · Date · How did it feel · Notes · save.

export type SessionDraft = {
  session_date: string
  duration_minutes: string
  notes: string
  star_rating: number
  activity: string        // ACTIVITIES key ('log' mode)
  activity_name: string   // typed name for Sport / Other
  weekly_plan_id: string  // 'log' mode: optional link to a plan week
}

export const emptyDraft = (weeklyPlanId = ''): SessionDraft => ({
  session_date: localToday(), duration_minutes: '', notes: '', star_rating: 0,
  activity: '', activity_name: '', weekly_plan_id: weeklyPlanId,
})

const FEELINGS = [
  { rating: 1, emoji: '😓', label: 'Tough' },
  { rating: 2, emoji: '😐', label: 'Okay' },
  { rating: 3, emoji: '🙂', label: 'Good' },
  { rating: 4, emoji: '😄', label: 'Great' },
  { rating: 5, emoji: '🔥', label: 'Best' },
]

const inputCls = 'w-full min-w-0 bg-gray-800 text-white rounded-xl px-3 py-2.5 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm'
const labelCls = 'text-[11px] text-gray-500 uppercase tracking-wider block mb-1.5'

export default function SessionForm({
  mode, value, onChange, heading, idPrefix, country, notesEnabled, plans = [],
  error, saving, submitLabel, onSubmit, onCancel,
}: {
  mode: 'log' | 'day'
  value: SessionDraft
  onChange: (next: SessionDraft) => void
  heading: ReactNode
  idPrefix: string
  country: Country | null
  notesEnabled: boolean
  plans?: { id: string; week_start: string }[]
  error?: string
  saving: boolean
  submitLabel: string
  onSubmit: () => void
  onCancel?: () => void
}) {
  const set = (patch: Partial<SessionDraft>) => onChange({ ...value, ...patch })
  const chosen = ACTIVITIES.find(a => a.key === value.activity)

  return (
    <div className="space-y-4">
      {heading}

      {mode === 'log' && (
        <div>
          <p className={labelCls}>What did you do?</p>
          <div className="grid grid-cols-5 gap-1.5" role="radiogroup" aria-label="Activity">
            {ACTIVITIES.map(a => (
              <button key={a.key} type="button" role="radio" aria-checked={value.activity === a.key}
                onClick={() => set({ activity: a.key, activity_name: a.askName ? value.activity_name : '' })}
                className={`py-2 rounded-xl border text-center ${value.activity === a.key ? 'border-orange-500 bg-orange-950' : 'border-gray-700 bg-gray-800'}`}>
                <div className="text-base leading-none">{a.emoji}</div>
                <div className="text-[10px] text-gray-300 mt-1 leading-tight">{a.label}</div>
              </button>
            ))}
          </div>
          {chosen?.askName && (
            <input aria-label={chosen.askName} placeholder={chosen.askName} maxLength={40}
              value={value.activity_name} onChange={e => set({ activity_name: e.target.value })}
              className={inputCls + ' mt-2'} />
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor={`${idPrefix}-minutes`} className={labelCls}>Minutes</label>
          <input id={`${idPrefix}-minutes`} type="number" inputMode="numeric" min={1} placeholder="e.g. 45"
            value={value.duration_minutes} onChange={e => set({ duration_minutes: e.target.value })}
            className={inputCls} />
        </div>
        <div>
          <label htmlFor={`${idPrefix}-date`} className={labelCls}>Date</label>
          <input id={`${idPrefix}-date`} type="date" max={localToday()}
            value={value.session_date} onChange={e => set({ session_date: e.target.value })}
            className={inputCls} />
        </div>
      </div>
      {value.session_date && (
        <p className="text-[11px] text-gray-500 -mt-2">{formatDate(value.session_date, country, 'weekday')}</p>
      )}

      <div>
        <p className={labelCls}>How did it feel?</p>
        <div className="flex gap-1.5">
          {FEELINGS.map(f => (
            <button key={f.rating} type="button" aria-pressed={value.star_rating === f.rating}
              onClick={() => set({ star_rating: value.star_rating === f.rating ? 0 : f.rating })}
              className={`flex-1 py-2 rounded-xl border text-center ${value.star_rating === f.rating ? 'border-orange-500 bg-orange-950' : 'border-gray-700 bg-gray-800'}`}>
              <div className="text-base">{f.emoji}</div>
              <div className="text-[10px] text-gray-400">{f.label}</div>
            </button>
          ))}
        </div>
      </div>

      {notesEnabled && (
        <div>
          <label htmlFor={`${idPrefix}-notes`} className={labelCls}>Notes for your coach (optional)</label>
          <textarea id={`${idPrefix}-notes`} rows={2} placeholder="How did it go? Anything to share…"
            value={value.notes} onChange={e => set({ notes: e.target.value })}
            className={inputCls + ' resize-none'} />
        </div>
      )}

      {mode === 'log' && plans.length > 0 && (
        <div>
          <label htmlFor={`${idPrefix}-plan`} className={labelCls}>Part of a plan week? (optional)</label>
          <select id={`${idPrefix}-plan`} value={value.weekly_plan_id} onChange={e => set({ weekly_plan_id: e.target.value })}
            className={inputCls}>
            <option value="">No, an extra activity</option>
            {plans.map(p => (
              <option key={p.id} value={p.id}>Week of {formatDate(p.week_start, country, 'dayMonth')}</option>
            ))}
          </select>
        </div>
      )}

      {error && <p className="text-sm text-red-400" role="alert">{error}</p>}

      <div className="flex gap-2">
        <button type="button" onClick={onSubmit} disabled={saving}
          className="flex-1 bg-green-600 hover:bg-green-500 text-white font-semibold py-3 rounded-xl text-sm disabled:opacity-50">
          {saving ? 'Saving…' : submitLabel}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} disabled={saving}
            className="px-4 bg-gray-800 hover:bg-gray-700 text-white text-sm rounded-xl">
            Cancel
          </button>
        )}
      </div>
    </div>
  )
}

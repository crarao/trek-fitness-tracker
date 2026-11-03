// Branches and batches (Dojo Build 2, ROADMAP #77; tables in db/2026-11-03-branches-batches.md).
// A branch is one of the gym's locations; a batch is a class at one branch on set days and times.
// A student has a home batch (profiles.batch_id) but can attend any batch (attendance: Build 3, #78).
// Pure helpers, no Supabase calls, so scripts/check-batches.ts can run them. Safe in the browser and on the server.

import { type Country } from './locale'

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const
export type Weekday = typeof WEEKDAYS[number]

export type Branch = { id: string; company_id: string; name: string; address: string | null; is_archived: boolean; created_at?: string }
export type Batch = {
  id: string; company_id: string; branch_id: string; name: string
  days: string[]; start_time: string | null; end_time: string | null; is_archived: boolean; created_at?: string
}

export const BRANCH_COLUMNS = 'id, company_id, name, address, is_archived, created_at'
export const BATCH_COLUMNS = 'id, company_id, branch_id, name, days, start_time, end_time, is_archived, created_at'

// Days in week order, only known ones, no repeats
export function sortDays(days: readonly string[] | null | undefined): Weekday[] {
  const set = new Set(days || [])
  return WEEKDAYS.filter(d => set.has(d))
}

// "Daily", "Mon–Fri", "Mon/Wed/Fri", "Mon–Wed/Sat" (runs of 3+ days joined with an en dash)
export function daysLabel(days: readonly string[] | null | undefined): string {
  const list = sortDays(days)
  if (list.length === 7) return 'Daily'
  if (!list.length) return ''
  const idx = list.map(d => WEEKDAYS.indexOf(d))
  const parts: string[] = []
  for (let i = 0; i < idx.length; ) {
    let j = i
    while (j + 1 < idx.length && idx[j + 1] === idx[j] + 1) j++
    parts.push(j - i >= 2 ? `${WEEKDAYS[idx[i]]}–${WEEKDAYS[idx[j]]}` : idx.slice(i, j + 1).map(k => WEEKDAYS[k]).join('/'))
    i = j + 1
  }
  return parts.join('/')
}

// "18:00" or "18:00:00" (Postgres time) → "6 pm" / "6:30 pm" (India, UAE) or "6 PM" / "6:30 PM" (US, Canada)
export function timeLabel(t: string | null | undefined, country: Country | null | undefined): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(t || '')
  if (!m) return ''
  const h = Number(m[1]), min = m[2]
  if (h > 23) return ''
  const ampm = h < 12 ? 'am' : 'pm'
  const h12 = h % 12 === 0 ? 12 : h % 12
  const text = `${h12}${min === '00' ? '' : `:${min}`} ${ampm}`
  return country === 'US' || country === 'CA' ? text.toUpperCase() : text
}

// "6–7 pm", "6:30–7:30 am", "11 am–12 pm", "6 pm" (no end)
export function timeRange(start: string | null | undefined, end: string | null | undefined, country: Country | null | undefined): string {
  const a = timeLabel(start, country)
  const b = timeLabel(end, country)
  if (!a) return ''
  if (!b) return a
  const [aT, aP] = a.split(' ')
  const [bT, bP] = b.split(' ')
  return aP === bP ? `${aT}–${bT} ${bP}` : `${a}–${b}`
}

// When a batch meets: "Mon/Wed/Fri · 6–7 pm"
export function batchWhen(b: Pick<Batch, 'days' | 'start_time' | 'end_time'>, country: Country | null | undefined): string {
  return [daysLabel(b.days), timeRange(b.start_time, b.end_time, country)].filter(Boolean).join(' · ')
}

// The line under a student's name: "Kokapet · Juniors · Mon/Wed/Fri 6–7 pm" (parts that are known)
export function homeBatchLine(
  branch: Pick<Branch, 'name'> | null | undefined,
  batch: Pick<Batch, 'name' | 'days' | 'start_time' | 'end_time'> | null | undefined,
  country: Country | null | undefined,
): string {
  const when = batch ? [daysLabel(batch.days), timeRange(batch.start_time, batch.end_time, country)].filter(Boolean).join(' ') : ''
  return [branch?.name, batch?.name, when].filter(Boolean).join(' · ')
}

// Batches of a branch in the order a sensei thinks of them: by start time, then name; archived last
export function sortBatches<T extends Pick<Batch, 'name' | 'start_time' | 'is_archived'>>(list: T[]): T[] {
  return [...list].sort((a, b) =>
    Number(a.is_archived) - Number(b.is_archived)
    || (a.start_time || '99').localeCompare(b.start_time || '99')
    || a.name.localeCompare(b.name))
}

// Spaces tidied; '' when empty
export const tidyName = (s: string | null | undefined) => (s || '').replace(/\s+/g, ' ').trim()

// Same name (case-insensitive, spaces tidied) already used among these rows (the database refuses it too)
export function nameTaken(rows: { id: string; name: string }[], name: string, exceptId?: string): boolean {
  const n = tidyName(name).toLowerCase()
  return rows.some(r => r.id !== exceptId && tidyName(r.name).toLowerCase() === n)
}

// What's wrong with a batch before saving ('' = fine)
export function batchProblem(b: { name: string; days: string[]; start_time: string; end_time: string }): string {
  if (!tidyName(b.name)) return 'Add a name for the batch (e.g. Juniors).'
  if (tidyName(b.name).length > 60) return 'Keep the name under 60 characters.'
  if (!sortDays(b.days).length) return 'Pick at least one day.'
  if (b.end_time && !b.start_time) return 'Add a start time too.'
  if (b.start_time && b.end_time && b.end_time <= b.start_time) return 'The end time must be after the start time.'
  return ''
}

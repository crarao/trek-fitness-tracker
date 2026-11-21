// Dojo class activities + the 7-day lock (db/2026-11-19-dojo-activities-absences.md).
// A dojo keeps a list of activities (warm-ups, kata, kumite…); a batch's class on a day ticks the ones it did,
// and everyone present gets that class's activities. Tick only, no counts. The two warm-ups (is_default) are
// pre-ticked on a new class and can be unticked.
// A class day more than 7 days back is locked (attendance, the class, its activities) unless the owner unlocked it
// (batch_classes.unlocked_at). The database enforces it (triggers); these helpers only decide what the screen shows.
// Pure helpers, no Supabase calls, so scripts/check-dojo-activities.ts can run them. Dates are 'YYYY-MM-DD' strings.
// Nothing is deleted (CLAUDE.md Rule #1): archive an activity, untick = removed_at.

import { addDays } from './attendance'

export type DojoActivity = {
  id: string
  company_id?: string
  name: string
  description: string | null
  sort_order: number
  is_default: boolean
  is_archived: boolean
}
export const ACTIVITY_COLUMNS = 'id, company_id, name, description, sort_order, is_default, is_archived'

export type BatchClass = {
  id: string
  company_id?: string
  batch_id: string
  class_date: string
  logged_by: string | null
  logged_at: string | null
  unlocked_by: string | null
  unlocked_at: string | null
  notes?: string | null
}
export const BATCH_CLASS_COLUMNS = 'id, company_id, batch_id, class_date, logged_by, logged_at, unlocked_by, unlocked_at, notes'

export type ClassActivity = {
  id?: string
  company_id?: string
  class_id: string
  activity_id: string
  activity_name: string
  removed_at: string | null
}
export const CLASS_ACTIVITY_COLUMNS = 'id, company_id, class_id, activity_id, activity_name, removed_at'

export const LOCK_DAYS = 7
export const ACTIVITY_NAME_MAX = 60
export const ACTIVITY_DESCRIPTION_MAX = 200

// By sort_order, then name (archived ones keep their place; callers filter)
export function sortActivities<T extends Pick<DojoActivity, 'sort_order' | 'name'>>(list: T[]): T[] {
  return [...list].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
}

export const tidyActivityName = (s: string) => s.replace(/\s+/g, ' ').trim()

// Same name (ignoring case and spaces) already on the list? Mirrors the unique index on lower(btrim(name)).
export function activityNameTaken(list: Pick<DojoActivity, 'id' | 'name'>[], name: string, exceptId?: string): boolean {
  const key = tidyActivityName(name).toLowerCase()
  return list.some(a => a.id !== exceptId && tidyActivityName(a.name).toLowerCase() === key)
}

export function activityProblem(d: { name: string; description?: string | null }): string {
  const name = tidyActivityName(d.name)
  if (!name) return 'Give the activity a name.'
  if (name.length > ACTIVITY_NAME_MAX) return `Keep the name under ${ACTIVITY_NAME_MAX} characters.`
  if ((d.description || '').trim().length > ACTIVITY_DESCRIPTION_MAX) return `Keep the description under ${ACTIVITY_DESCRIPTION_MAX} characters.`
  return ''
}

// The next sort_order for a new activity: after the last one
export const nextSortOrder = (list: Pick<DojoActivity, 'sort_order'>[]) =>
  list.reduce((m, a) => Math.max(m, a.sort_order), 0) + 1

// Move one active activity up (-1) or down (+1) among the active ones. Returns the rows whose sort_order changes
// (renumbered 1..n in the new order, so old ties or gaps are fixed on the way); [] when it can't move.
export function moveActivity(list: DojoActivity[], id: string, dir: -1 | 1): { id: string; sort_order: number }[] {
  const active = sortActivities(list.filter(a => !a.is_archived))
  const i = active.findIndex(a => a.id === id)
  const j = i + dir
  if (i < 0 || j < 0 || j >= active.length) return []
  const order = [...active]
  ;[order[i], order[j]] = [order[j], order[i]]
  return order.map((a, k) => ({ id: a.id, sort_order: k + 1 })).filter((x, k) => order[k].sort_order !== x.sort_order)
}

// ── The class checklist ─────────────────────────────────────────────────────────────────────────────────────

export type ChecklistItem = { id: string; name: string; description: string | null; ticked: boolean; archived: boolean }

// What the roll call shows. No class row yet (or a row made only to unlock the day, logged_at null, with no
// activities): the active list with the defaults pre-ticked (not saved until the class is saved). A logged class:
// exactly what was saved (removed_at = unticked). Archived activities show only when this class ticked them,
// under the name saved with the class.
export function checklist(opts: {
  activities: DojoActivity[]
  cls: Pick<BatchClass, 'logged_at'> | null
  saved: ClassActivity[]            // this class's rows (any removed_at)
}): { items: ChecklistItem[]; logged: boolean } {
  const logged = !!opts.cls?.logged_at || opts.saved.length > 0
  const byId = new Map(opts.saved.map(r => [r.activity_id, r]))
  const items: ChecklistItem[] = []
  for (const a of sortActivities(opts.activities)) {
    const row = byId.get(a.id)
    const ticked = logged ? !!row && !row.removed_at : a.is_default
    if (a.is_archived && !(row && !row.removed_at)) continue
    items.push({ id: a.id, name: a.is_archived && row ? row.activity_name : a.name, description: a.description, ticked, archived: a.is_archived })
  }
  // A ticked activity whose list row we can't see any more (shouldn't happen: activities are never deleted)
  for (const r of opts.saved) {
    if (!r.removed_at && !opts.activities.some(a => a.id === r.activity_id)) {
      items.push({ id: r.activity_id, name: r.activity_name, description: null, ticked: true, archived: true })
    }
  }
  return { items, logged }
}

// The class activity rows to save: one per item, ticked → removed_at null, unticked → removed_at now.
// Only items that already have a row, or are ticked, are sent (an untick of something never saved needs no row).
export function activityRowsToSave(opts: {
  classId: string
  companyId: string
  items: Pick<ChecklistItem, 'id' | 'name' | 'ticked'>[]
  saved: Pick<ClassActivity, 'activity_id'>[]
  now: string
}): ClassActivity[] {
  const have = new Set(opts.saved.map(r => r.activity_id))
  return opts.items
    .filter(i => i.ticked || have.has(i.id))
    .map(i => ({ company_id: opts.companyId, class_id: opts.classId, activity_id: i.id, activity_name: i.name, removed_at: i.ticked ? null : opts.now }))
}

export const ticksSummary = (items: Pick<ChecklistItem, 'ticked'>[]) => {
  const n = items.filter(i => i.ticked).length
  return `${n} activit${n === 1 ? 'y' : 'ies'}`
}

// ── The 7-day lock ──────────────────────────────────────────────────────────────────────────────────────────

// More than LOCK_DAYS back (today − 8 and earlier), the same rule as the database's class_day_locked()
export const olderThanLock = (date: string, today: string) => date < addDays(today, -LOCK_DAYS)

// Locked = old and not unlocked by the owner
export const dayLocked = (date: string, today: string, cls: Pick<BatchClass, 'unlocked_at'> | null | undefined) =>
  olderThanLock(date, today) && !cls?.unlocked_at

// Only the owner unlocks / locks again (db trigger batch_class_checks), and only old days need it
export function lockAction(opts: { date: string; today: string; cls: Pick<BatchClass, 'unlocked_at'> | null | undefined; role: string }): 'unlock' | 'lock' | null {
  if (opts.role !== 'company_admin' || !olderThanLock(opts.date, opts.today)) return null
  return opts.cls?.unlocked_at ? 'lock' : 'unlock'
}

// A save refused by the database: its own message when it's one of ours ("…locked (older than 7 days)…"),
// else a plain one
export function saveErrorText(error: { message?: string } | null | undefined): string {
  const m = (error?.message || '').trim()
  if (!m) return "Couldn't save: not allowed for this login"
  if (/locked|unlock|logged_by must be|can't be moved|can''t be moved/i.test(m)) return m
  return 'Could not save: ' + m
}

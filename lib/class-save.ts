// Save a batch's class for a day as logged, with its ticked activities (db/2026-11-19-dojo-activities-absences.md).
// Used by All of today (/company/attendance/today) when a student is marked there, so the pre-ticked warm-ups are
// recorded even when nobody opens the batch's own roll call. The roll call does the same itself (ensureClass).
// batch_classes is read → update / insert, never upserted: its BEFORE INSERT lock trigger fires before Postgres sees
// a duplicate, so an upsert on an unlocked old day would be refused. A 23505 (someone saved it a moment ago) is read
// back and updated.

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  type BatchClass, type ClassActivity, type ChecklistItem, BATCH_CLASS_COLUMNS, CLASS_ACTIVITY_COLUMNS, activityRowsToSave,
} from './dojo-activities'

export async function saveClassLogged(db: SupabaseClient, opts: {
  companyId: string
  batchId: string
  date: string
  me: string
  existing: BatchClass | null        // the day's class row already read (e.g. made by Unlock), or null
  items: ChecklistItem[]             // the checklist as it should be saved (pre-ticked defaults on a new class)
  saved: ClassActivity[]             // the existing class's activity rows
}): Promise<{ cls: BatchClass; acts: ClassActivity[] } | { error: { message?: string } | null }> {
  const now = new Date().toISOString()
  const write = (row: BatchClass | null) => row
    ? db.from('batch_classes').update({ logged_at: now, logged_by: opts.me }).eq('id', row.id).select(BATCH_CLASS_COLUMNS)
    : db.from('batch_classes').insert({ company_id: opts.companyId, batch_id: opts.batchId, class_date: opts.date, logged_at: now, logged_by: opts.me }).select(BATCH_CLASS_COLUMNS)
  let res = await write(opts.existing)
  if (res.error?.code === '23505') {
    const again = await db.from('batch_classes').select(BATCH_CLASS_COLUMNS).eq('batch_id', opts.batchId).eq('class_date', opts.date).maybeSingle()
    res = await write((again.data as BatchClass | null) ?? null)
  }
  if (res.error || !res.data?.length) return { error: res.error }
  const cls = res.data[0] as BatchClass
  const savedNow = cls.id === opts.existing?.id ? opts.saved : []
  const rows = activityRowsToSave({ classId: cls.id, companyId: opts.companyId, items: opts.items, saved: savedNow, now })
  if (!rows.length) return { cls, acts: savedNow }
  const ar = await db.from('batch_class_activities').upsert(rows, { onConflict: 'class_id,activity_id' }).select(CLASS_ACTIVITY_COLUMNS)
  if (ar.error || !ar.data?.length) return { error: ar.error }
  return { cls, acts: ar.data as ClassActivity[] }
}

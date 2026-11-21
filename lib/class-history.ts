// One student's class history for a date range (month-by-month summary on the student page and in Class reports).
// Reads only what that student needs: their own present marks (any batch), their home batch's present marks (to know
// which days its roll call was taken), the class rows of those batches with their ticked activities, holidays and
// their leave. Attendance is paged (1,000 rows a page); class activities are read in chunks of 100 class ids.
// Returns null when a table can't be read (the 19 Nov SQL hasn't run): the caller shows nothing.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { AttendanceRow } from './attendance'
import { type StudentLeave, LEAVE_COLUMNS } from './leave'
import { type Holiday, HOLIDAY_COLUMNS } from './holidays'
import type { ReportClass, ReportClassActivity } from './class-reports'

export type StudentHistory = {
  attendance: AttendanceRow[]
  classes: ReportClass[]
  acts: ReportClassActivity[]
  holidays: Holiday[]
  leaves: StudentLeave[]
}

export async function loadStudentHistory(db: SupabaseClient, opts: {
  companyId: string
  studentId: string
  homeBatchId: string | null | undefined
  from: string
  to: string
}): Promise<StudentHistory | null> {
  const attendance: AttendanceRow[] = []
  const PAGE = 1000
  const who = opts.homeBatchId ? `profile_id.eq.${opts.studentId},batch_id.eq.${opts.homeBatchId}` : `profile_id.eq.${opts.studentId}`
  for (let at = 0; at < 50 * PAGE; at += PAGE) {
    const { data, error } = await db.from('attendance').select('batch_id, profile_id, class_date, present, is_drop_in')
      .eq('company_id', opts.companyId).eq('present', true).gte('class_date', opts.from).lte('class_date', opts.to)
      .or(who).order('class_date').order('id').range(at, at + PAGE - 1)
    if (error) return null
    attendance.push(...((data || []) as AttendanceRow[]))
    if ((data || []).length < PAGE) break
  }
  const batchIds = [...new Set([...(opts.homeBatchId ? [opts.homeBatchId] : []),
    ...attendance.filter(r => r.profile_id === opts.studentId).map(r => r.batch_id)])]
  const [cls, hol, lv] = await Promise.all([
    batchIds.length
      ? db.from('batch_classes').select('id, batch_id, class_date, logged_at').eq('company_id', opts.companyId)
        .in('batch_id', batchIds).gte('class_date', opts.from).lte('class_date', opts.to)
      : Promise.resolve({ data: [], error: null }),
    db.from('holidays').select(HOLIDAY_COLUMNS).eq('company_id', opts.companyId).is('removed_at', null)
      .gte('holiday_date', opts.from).lte('holiday_date', opts.to),
    db.from('student_leaves').select(LEAVE_COLUMNS).eq('company_id', opts.companyId).eq('profile_id', opts.studentId)
      .is('cancelled_at', null).lte('from_date', opts.to).gte('to_date', opts.from),
  ])
  if (cls.error || hol.error || lv.error) return null
  const classes = (cls.data || []) as ReportClass[]
  const acts: ReportClassActivity[] = []
  const ids = classes.map(c => c.id)
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await db.from('batch_class_activities').select('class_id, activity_id, activity_name, removed_at').in('class_id', ids.slice(i, i + 100))
    if (error) return null
    acts.push(...((data || []) as ReportClassActivity[]))
  }
  return { attendance, classes, acts, holidays: (hol.data || []) as Holiday[], leaves: (lv.data || []) as StudentLeave[] }
}

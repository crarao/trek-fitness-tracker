'use client'

// "Month by month" for one dojo student (21 Nov): the last 6 months (back to the month they joined), newest first.
// Each month: classes came of the classes they had, absences, leave days, and the activities done (top 3, "all" opens
// the rest). Same day rules as the Class reports calendar and the absentee list (lib/class-reports.ts).
// Shared because the student page (Progress tab) and Class reports → By student both show it. Reads its own data
// (lib/class-history.ts); shows nothing when the activity tables aren't there yet.

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { type Country, formatDate, localDateIso } from '@/lib/locale'
import type { Batch } from '@/lib/batches'
import { loadStudentHistory } from '@/lib/class-history'
import { type MonthSummary, type ReportStudent, HISTORY_MONTHS, historyRange, monthSummaries, indexClasses, loggedDays } from '@/lib/class-reports'

type Props = {
  companyId: string
  student: ReportStudent
  homeBatch: Pick<Batch, 'id' | 'branch_id' | 'name' | 'days' | 'start_time' | 'is_archived'> | null
  country: Country | null
  onOpenMonth?: (monthIso: string) => void   // tap a month: its calendar
}

export default function StudentMonths({ companyId, student, homeBatch, country, onOpenMonth }: Props) {
  const [rows, setRows] = useState<MonthSummary[] | null | 'none'>(null)
  const [open, setOpen] = useState<Set<string>>(new Set())

  useEffect(() => {
    let live = true
    ;(async () => {
      setRows(null)
      const today = localDateIso()
      const { from, to } = historyRange(today, student.created_at)
      const h = await loadStudentHistory(supabase, { companyId, studentId: student.id, homeBatchId: homeBatch?.id, from, to })
      if (!live) return
      if (!h) { setRows('none'); return }
      setRows(monthSummaries({
        student, homeBatch, today, attendance: h.attendance, logged: loggedDays(h.attendance, h.classes),
        index: indexClasses(h.classes, h.acts), leaves: h.leaves, holidays: h.holidays,
      }))
    })()
    return () => { live = false }
  }, [companyId, student, homeBatch])

  if (rows === 'none') return null
  return (
    <section data-testid="student-months" className="bg-gray-900 border border-gray-800 rounded-2xl p-4 space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-semibold text-white">Month by month</p>
        <p className="text-[11px] text-gray-500">Last {HISTORY_MONTHS} months</p>
      </div>
      {rows === null ? (
        <div className="h-24 rounded-xl bg-gray-800/50 animate-pulse" aria-label="Loading" />
      ) : rows.length === 0 ? (
        <p className="text-sm text-gray-500">No months yet.</p>
      ) : (
        <ul className="divide-y divide-gray-800">
          {rows.map(m => {
            const all = open.has(m.month)
            const shown = all ? m.activities : m.activities.slice(0, 3)
            return (
              <li key={m.month} data-testid="month-row" data-month={m.month} className="py-2.5 space-y-1">
                <div className="flex items-baseline justify-between gap-3">
                  {onOpenMonth ? (
                    <button type="button" onClick={() => onOpenMonth(m.month)} className="text-sm font-medium text-white hover:text-orange-300 text-left">
                      {formatDate(m.month, country, 'monthYear')}{m.soFar ? ' (so far)' : ''} ›
                    </button>
                  ) : (
                    <p className="text-sm font-medium text-white">{formatDate(m.month, country, 'monthYear')}{m.soFar ? ' (so far)' : ''}</p>
                  )}
                  <p className="text-xs text-gray-300 shrink-0 text-right">
                    <span className="text-green-400 font-semibold" data-testid="month-came">{m.came}</span>
                    {m.of > 0 ? ` of ${m.of}` : ''} class{(m.of || m.came) === 1 ? '' : 'es'}
                    {m.absent > 0 && <span className="text-red-300"> · {m.absent} absent</span>}
                    {m.leave > 0 && <span className="text-sky-300"> · {m.leave} on leave</span>}
                  </p>
                </div>
                {m.activities.length > 0 ? (
                  <p className="text-[11px] text-gray-400">
                    {shown.map(a => `${a.name} ${a.count}×`).join(' · ')}
                    {m.activities.length > 3 && (
                      <button type="button" onClick={() => setOpen(o => { const n = new Set(o); if (n.has(m.month)) n.delete(m.month); else n.add(m.month); return n })}
                        className="ml-2 text-orange-400 hover:text-orange-300">{all ? 'less' : `+${m.activities.length - 3} more`}</button>
                    )}
                  </p>
                ) : m.came > 0 ? <p className="text-[11px] text-gray-500">No activities recorded</p> : null}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

'use client'

// Dojo class reports (owner / partner / sensei; db/2026-11-19-dojo-activities-absences.md; rules in
// lib/class-reports.ts). Static route next to /today, before [batchId]. Read-only.
//   Day      — each batch that day: activities, how many came, "Not logged", holidays. Tap = the roll call.
//   Student  — one student's month: a calendar (came / absent / leave / holiday / not logged) and how many times
//              each activity was done.
//   Activity — each activity in the month: classes that did it, per batch, and when it was last done.
//   Grading  — (belt grading on) the existing belt rule next to classes and activity counts since the belt date.
// Each month's data is read once (attendance paged, class activities in chunks). Before the SQL ran: a note.

import PageNav from '@/app/page-nav'
import BeltChip from '@/app/belt-chip'
import StudentMonths from '@/app/student-months'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { type Country, normalizeCountry, formatDate, localDateIso } from '@/lib/locale'
import { isDojo, memberWord } from '@/lib/labels'
import { type Batch, type Branch, BATCH_COLUMNS, BRANCH_COLUMNS, WEEKDAYS, timeLabel } from '@/lib/batches'
import { type AttendanceRow, addDays } from '@/lib/attendance'
import { type StudentLeave, LEAVE_COLUMNS } from '@/lib/leave'
import { type Holiday, HOLIDAY_COLUMNS, monthGrid, monthBounds, shiftMonth } from '@/lib/holidays'
import { type DojoActivity, ACTIVITY_COLUMNS, sortActivities } from '@/lib/dojo-activities'
import { type BeltRank, BELT_RANK_COLUMNS, gradingOn, beltsById, beltLabel, toGoText } from '@/lib/belts'
import {
  type ReportClass, type ReportClassActivity, type ReportStudent, type DayStatus,
  indexClasses, loggedDays, dayReport, studentDays, studentTotals, activityReport, readiness,
} from '@/lib/class-reports'

type Tab = 'day' | 'student' | 'activity' | 'grading'
type Student = ReportStudent & { current_rank_id?: string | null; rank_achieved_on?: string | null }
type RangeData = { attendance: AttendanceRow[]; classes: ReportClass[]; acts: ReportClassActivity[]; holidays: Holiday[]; leaves: StudentLeave[] }

const STATUS: Record<DayStatus, { label: string; cell: string }> = {
  came: { label: 'Came', cell: 'bg-green-900/60 border-green-700 text-green-100' },
  absent: { label: 'Absent', cell: 'bg-red-950/70 border-red-800 text-red-200' },
  leave: { label: 'On leave', cell: 'bg-sky-950/60 border-sky-800 text-sky-200' },
  holiday: { label: 'Holiday', cell: 'bg-amber-950/60 border-amber-800 text-amber-200' },
  'not-logged': { label: 'Not logged', cell: 'bg-gray-900 border-dashed border-gray-600 text-gray-400' },
  off: { label: 'Not their day', cell: 'bg-gray-950/40 border-gray-900 text-gray-600' },
  future: { label: '', cell: 'bg-gray-950/40 border-gray-900 text-gray-700' },
  'before-join': { label: 'Before joining', cell: 'bg-gray-950/40 border-gray-900 text-gray-700' },
}

// Present attendance from..to (paged: 1,000 rows a page), the classes and their activities, holidays, leave
async function loadRange(companyId: string, from: string, to: string): Promise<RangeData | null> {
  const attendance: AttendanceRow[] = []
  const PAGE = 1000
  for (let at = 0; at < 50 * PAGE; at += PAGE) {
    const { data, error } = await supabase.from('attendance').select('batch_id, profile_id, class_date, present, is_drop_in')
      .eq('company_id', companyId).eq('present', true).gte('class_date', from).lte('class_date', to)
      .order('class_date').order('id').range(at, at + PAGE - 1)
    if (error) return null
    attendance.push(...((data || []) as AttendanceRow[]))
    if ((data || []).length < PAGE) break
  }
  const [cls, hol, lv] = await Promise.all([
    supabase.from('batch_classes').select('id, batch_id, class_date, logged_at').eq('company_id', companyId).gte('class_date', from).lte('class_date', to),
    supabase.from('holidays').select(HOLIDAY_COLUMNS).eq('company_id', companyId).is('removed_at', null).gte('holiday_date', from).lte('holiday_date', to),
    supabase.from('student_leaves').select(LEAVE_COLUMNS).eq('company_id', companyId).is('cancelled_at', null).lte('from_date', to).gte('to_date', from),
  ])
  if (cls.error || hol.error || lv.error) return null
  const classes = (cls.data || []) as ReportClass[]
  const acts: ReportClassActivity[] = []
  const ids = classes.map(c => c.id)
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await supabase.from('batch_class_activities').select('class_id, activity_id, activity_name, removed_at').in('class_id', ids.slice(i, i + 100))
    if (error) return null
    acts.push(...((data || []) as ReportClassActivity[]))
  }
  return { attendance, classes, acts, holidays: (hol.data || []) as Holiday[], leaves: (lv.data || []) as StudentLeave[] }
}

export default function ClassReportsPage() {
  const router = useRouter()
  const today = localDateIso()
  const [loading, setLoading] = useState(true)
  const [missing, setMissing] = useState(false)
  const [notDojo, setNotDojo] = useState(false)
  const [me, setMe] = useState<{ role: string; companyId: string } | null>(null)
  const [country, setCountry] = useState<Country>('IN')
  const [businessType, setBusinessType] = useState<string | null>(null)
  const [branches, setBranches] = useState<Branch[]>([])
  const [batches, setBatches] = useState<Batch[]>([])
  const [students, setStudents] = useState<Student[]>([])
  const [activities, setActivities] = useState<DojoActivity[]>([])
  const [ranks, setRanks] = useState<BeltRank[]>([])
  const [tab, setTab] = useState<Tab>('day')
  const [branch, setBranch] = useState('all')
  const [day, setDay] = useState(today)
  const [month, setMonth] = useState(shiftMonth(today, 0))
  const [studentId, setStudentId] = useState('')
  // By student: the month calendar or the last 6 months (21 Nov)
  const [studentView, setStudentView] = useState<'calendar' | 'months'>('calendar')
  const [data, setData] = useState<RangeData | null>(null)
  const [dataLoading, setDataLoading] = useState(false)
  const [grading, setGrading] = useState<RangeData | null>(null)
  const mw = memberWord(businessType)

  useEffect(() => {
    let live = true
    ;(async () => {
      const { data: { session } } = await supabase.auth.getSession()
      const user = session?.user
      if (!user) { router.push('/login'); return }
      const { data: profile } = await supabase.from('profiles').select('role, company_id, companies:company_id(*)').eq('id', user.id).single()
      if (!profile?.company_id) { router.push('/login'); return }
      const co = (profile as unknown as { companies: { country?: string | null; business_type?: string | null; grading_enabled?: boolean | null } | null }).companies
      const cId = profile.company_id as string
      const [br, ba, people, act, rk] = await Promise.all([
        supabase.from('branches').select(BRANCH_COLUMNS).eq('company_id', cId).order('created_at'),
        supabase.from('batches').select(BATCH_COLUMNS).eq('company_id', cId),
        supabase.from('profiles').select('id, full_name, batch_id, branch_id, available_days, created_at, current_rank_id, rank_achieved_on')
          .eq('company_id', cId).eq('role', 'client').is('archived_at', null).order('full_name'),
        supabase.from('dojo_activities').select(ACTIVITY_COLUMNS).eq('company_id', cId),
        gradingOn(co) ? supabase.from('belt_ranks').select(BELT_RANK_COLUMNS).eq('company_id', cId) : null,
      ])
      if (!live) return
      setMe({ role: profile.role as string, companyId: cId })
      setCountry(normalizeCountry(co?.country))
      setBusinessType(co?.business_type ?? null)
      if (!isDojo(co?.business_type)) setNotDojo(true)
      if (br.error || ba.error || people.error || act.error) { setMissing(true); setLoading(false); return }
      setBranches(((br.data || []) as Branch[]).filter(b => !b.is_archived))
      setBatches((ba.data || []) as Batch[])
      setStudents((people.data || []) as Student[])
      setActivities((act.data || []) as DojoActivity[])
      setRanks(rk && !rk.error ? (rk.data || []) as BeltRank[] : [])
      // Opened from a student's "Month by month" (?student=<id>&month=YYYY-MM-01): that student's month calendar
      const q = new URLSearchParams(window.location.search)
      const qs = q.get('student'), qm = q.get('month')
      if (qs) {
        setTab('student'); setStudentId(qs)
        if (qm && /^\d{4}-\d{2}-01$/.test(qm) && qm <= shiftMonth(localDateIso(), 0)) setMonth(qm)
      }
      setLoading(false)
    })()
    return () => { live = false }
  }, [router])

  // The month's data (Day uses the month its day is in)
  const shownMonth = tab === 'day' ? shiftMonth(day, 0) : month
  useEffect(() => {
    if (!me || missing) return
    let live = true
    ;(async () => {
      setDataLoading(true)
      const { from, to } = monthBounds(shownMonth)
      const d = await loadRange(me.companyId, from, to)
      if (!live) return
      if (!d) setMissing(true)
      else setData(d)
      setDataLoading(false)
    })()
    return () => { live = false }
  }, [me, missing, shownMonth])

  // Grading: from the earliest belt date (at most a year back) to today, read once when the tab opens
  useEffect(() => {
    if (tab !== 'grading' || grading || !me || !ranks.length) return
    let live = true
    ;(async () => {
      const yearBack = addDays(today, -365)
      const earliest = students.map(s => (s.rank_achieved_on || s.created_at || '').slice(0, 10)).filter(Boolean).sort()[0] || yearBack
      const d = await loadRange(me.companyId, earliest < yearBack ? yearBack : earliest, today)
      if (live && d) setGrading(d)
    })()
    return () => { live = false }
  }, [tab, grading, me, ranks.length, students, today])

  const shownBatches = useMemo(() => batches.filter(b => !b.is_archived && (branch === 'all' || b.branch_id === branch)), [batches, branch])
  const shownStudents = useMemo(() => students.filter(s => {
    if (branch === 'all') return true
    return (s.branch_id || batches.find(b => b.id === s.batch_id)?.branch_id) === branch
  }), [students, batches, branch])
  const index = useMemo(() => (data ? indexClasses(data.classes, data.acts) : new Map()), [data])
  const logged = useMemo(() => (data ? loggedDays(data.attendance, data.classes) : new Set<string>()), [data])
  const batchOf = (id: string | null | undefined) => batches.find(b => b.id === id) ?? null
  const rankById = beltsById(ranks)
  const gradingTab = ranks.length > 0
  const tabs: [Tab, string][] = [['day', 'By day'], ['student', `By ${mw.one.toLowerCase()}`], ['activity', 'By activity'], ...(gradingTab ? [['grading', 'Grading'] as [Tab, string]] : [])]

  const monthNav = (
    <div className="flex items-center justify-between">
      <button type="button" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Previous month" className="w-10 h-10 rounded-lg border border-gray-700 text-gray-300 hover:border-gray-500">‹</button>
      <p className="text-sm font-semibold">{formatDate(month, country, 'monthYear')}</p>
      <button type="button" onClick={() => setMonth(shiftMonth(month, 1))} disabled={month >= shiftMonth(today, 0)} aria-label="Next month"
        className="w-10 h-10 rounded-lg border border-gray-700 text-gray-300 hover:border-gray-500 disabled:opacity-30">›</button>
    </div>
  )

  // ── tabs ──
  const dayTab = () => {
    const rows = data ? dayReport({ date: day, batches: shownBatches, attendance: data.attendance, index, holidays: data.holidays }) : []
    return (
      <div className="space-y-3" data-testid="report-day">
        <div className="flex items-center justify-between">
          <button type="button" onClick={() => setDay(addDays(day, -1))} aria-label="Previous day" className="w-10 h-10 rounded-lg border border-gray-700 text-gray-300 hover:border-gray-500">‹</button>
          <p className="text-sm font-medium">{day === today ? 'Today · ' : ''}{formatDate(day, country, 'weekday')}</p>
          <button type="button" onClick={() => setDay(addDays(day, 1))} disabled={day >= today} aria-label="Next day"
            className="w-10 h-10 rounded-lg border border-gray-700 text-gray-300 hover:border-gray-500 disabled:opacity-30">›</button>
        </div>
        {rows.length === 0 && <p className="bg-gray-900 border border-gray-800 rounded-2xl p-5 text-sm text-gray-400">No batches on this day.</p>}
        {rows.map(r => (
          <button key={r.batch.id} type="button" data-nav data-testid="day-row" data-name={r.batch.name}
            onClick={() => router.push(`/company/attendance/${r.batch.id}${day === today ? '' : `?date=${day}`}`)}
            className="w-full text-left bg-gray-900 border border-gray-800 hover:border-gray-600 rounded-2xl px-4 py-3 space-y-2">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold truncate">{r.batch.name}{r.extra ? ' · extra class' : ''}</p>
                <p className="text-[11px] text-gray-500">{[timeLabel(r.batch.start_time, country), branches.length > 1 ? branches.find(b => b.id === r.batch.branch_id)?.name : ''].filter(Boolean).join(' · ')}</p>
              </div>
              {r.holiday ? <span className="text-xs text-amber-300 shrink-0">🏖 {r.holiday}</span>
                : r.logged ? <span className="text-xs text-green-400 font-semibold shrink-0">{r.present} came</span>
                : <span className="text-xs text-red-400 shrink-0">{day > today ? '' : 'Not logged'}</span>}
            </div>
            {r.activities.length > 0 ? (
              <div className="flex flex-wrap gap-1">{r.activities.map(a => <span key={a} className="text-[11px] text-orange-100 bg-orange-500/20 border border-orange-700 px-2 py-0.5 rounded">{a}</span>)}</div>
            ) : r.logged && !r.holiday ? <p className="text-[11px] text-gray-500">No activities ticked</p> : null}
          </button>
        ))}
      </div>
    )
  }

  const studentTab = () => {
    const s = shownStudents.find(x => x.id === studentId) ?? null
    const { from, to } = monthBounds(month)
    const days = s && data ? studentDays({ student: s, homeBatch: batchOf(s.batch_id), from, to, today, attendance: data.attendance, logged, index, leaves: data.leaves, holidays: data.holidays }) : []
    const byDate = Object.fromEntries(days.map(d => [d.date, d]))
    const totals = studentTotals(days)
    return (
      <div className="space-y-3" data-testid="report-student">
        <select value={studentId} onChange={e => setStudentId(e.target.value)} aria-label={`Pick a ${mw.one.toLowerCase()}`}
          className="w-full bg-gray-800 text-white rounded-lg px-3 py-2.5 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm">
          <option value="">Pick a {mw.one.toLowerCase()}…</option>
          {shownStudents.map(x => <option key={x.id} value={x.id}>{x.full_name}{batchOf(x.batch_id) ? ` · ${batchOf(x.batch_id)!.name}` : ''}</option>)}
        </select>
        {s && (
          <div className="flex gap-1 bg-gray-900 border border-gray-800 rounded-xl p-1" role="tablist" aria-label="View">
            {(['calendar', 'months'] as const).map(v => (
              <button key={v} type="button" role="tab" aria-selected={studentView === v} onClick={() => setStudentView(v)}
                className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-medium ${studentView === v ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'}`}>
                {v === 'calendar' ? 'Calendar' : 'Months'}
              </button>
            ))}
          </div>
        )}
        {s && studentView === 'months' && me && (
          <StudentMonths companyId={me.companyId} student={s} homeBatch={batchOf(s.batch_id)} country={country}
            onOpenMonth={m => { setMonth(m); setStudentView('calendar') }} />
        )}
        {(!s || studentView === 'calendar') && monthNav}
        {s && studentView === 'calendar' && (
          <>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="bg-gray-900 border border-gray-800 rounded-xl py-2"><p className="text-xl font-bold text-green-400" data-testid="student-came">{totals.came}</p><p className="text-[11px] text-gray-500">came</p></div>
              <div className="bg-gray-900 border border-gray-800 rounded-xl py-2"><p className="text-xl font-bold text-red-400" data-testid="student-absent">{totals.absent}</p><p className="text-[11px] text-gray-500">absent</p></div>
              <div className="bg-gray-900 border border-gray-800 rounded-xl py-2"><p className="text-xl font-bold text-sky-300">{totals.leave}</p><p className="text-[11px] text-gray-500">on leave</p></div>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-2">
              <div className="grid grid-cols-7 text-center text-[10px] text-gray-500 uppercase pb-1">{WEEKDAYS.map(d => <span key={d}>{d}</span>)}</div>
              {monthGrid(month).map((w, i) => (
                <div key={i} className="grid grid-cols-7 gap-1 mb-1">
                  {w.map((d, j) => {
                    if (!d) return <span key={j} />
                    const sd = byDate[d]
                    const st = STATUS[sd?.status || 'future']
                    return (
                      <span key={d} data-date={d} data-status={sd?.status} title={[st.label, ...(sd?.activities || [])].filter(Boolean).join(' · ')}
                        className={`min-h-[40px] rounded-lg border px-1 py-1 text-xs ${st.cell}`}>
                        {Number(d.slice(8))}{sd?.status === 'came' && sd.activities.length ? <span className="block text-[9px] leading-tight opacity-80">{sd.activities.length} act.</span> : null}
                      </span>
                    )
                  })}
                </div>
              ))}
              <div className="flex flex-wrap gap-x-3 gap-y-1 px-1 pt-1 text-[10px] text-gray-400">
                {(['came', 'absent', 'leave', 'holiday', 'not-logged'] as DayStatus[]).map(k => (
                  <span key={k} className="flex items-center gap-1"><span className={`w-3 h-3 rounded border ${STATUS[k].cell}`} />{STATUS[k].label}</span>
                ))}
              </div>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 space-y-2" data-testid="student-activity-totals">
              <p className="text-sm font-semibold">Activities this month</p>
              {totals.activities.length === 0 ? <p className="text-sm text-gray-500">None recorded.</p> : (
                <ul className="space-y-1">
                  {totals.activities.map(a => (
                    <li key={a.name} className="flex justify-between text-sm"><span className="text-gray-300">{a.name}</span><span className="text-white font-semibold">{a.count}×</span></li>
                  ))}
                </ul>
              )}
            </div>
            {days.some(d => d.status === 'came') && (
              <ul className="space-y-1 text-xs">
                {days.filter(d => d.status === 'came').map(d => (
                  <li key={d.date} className="flex gap-3"><span className="w-20 shrink-0 text-gray-500">{formatDate(d.date, country, 'weekday')}</span><span className="text-gray-300">{d.activities.join(', ') || '—'}</span></li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    )
  }

  const activityTab = () => {
    const { from, to } = monthBounds(month)
    const rows = data ? activityReport({ activities, batches: shownBatches, index, from, to }) : []
    return (
      <div className="space-y-3" data-testid="report-activity">
        {monthNav}
        {rows.length === 0 && <p className="bg-gray-900 border border-gray-800 rounded-2xl p-5 text-sm text-gray-400">No activities set up yet.</p>}
        {rows.map(r => (
          <section key={r.activity.id} data-testid="activity-report-row" data-name={r.activity.name} className="bg-gray-900 border border-gray-800 rounded-2xl px-4 py-3 space-y-1.5">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-sm font-semibold truncate">{r.activity.name}{r.activity.archived ? ' (archived)' : ''}</p>
              <p className="text-xs shrink-0"><span className={r.total ? 'text-white font-semibold' : 'text-gray-500'}>{r.total} class{r.total === 1 ? '' : 'es'}</span>
                {r.last && <span className="text-gray-500"> · last {formatDate(r.last, country, 'dayMonth')}</span>}</p>
            </div>
            {r.batches.length === 0 ? <p className="text-[11px] text-gray-500">Not done this month.</p> : (
              <ul className="space-y-0.5">
                {r.batches.map(b => (
                  <li key={b.batch.id} className="flex justify-between text-xs text-gray-400">
                    <span className="truncate">{b.batch.name}</span><span className="shrink-0">{b.count}× · last {b.last ? formatDate(b.last, country, 'dayMonth') : '—'}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
    )
  }

  const gradingTabView = () => {
    if (!grading) return <div className="h-32 rounded-2xl bg-gray-900 border border-gray-800 animate-pulse" aria-label="Loading" />
    const gIndex = indexClasses(grading.classes, grading.acts)
    const rows = readiness({ students: shownStudents, ranks, attendance: grading.attendance, index: gIndex, asOf: today })
    const order = sortActivities(activities)
    return (
      <div className="space-y-2" data-testid="report-grading">
        <p className="text-xs text-gray-400">The belt rule (months on the current belt) as of today, with classes and activities since the belt date. Information only: no extra rule.</p>
        {rows.length === 0 && <p className="bg-gray-900 border border-gray-800 rounded-2xl p-5 text-sm text-gray-400">No {mw.many.toLowerCase()} with a belt set.</p>}
        {rows.map(r => {
          const e = r.eligibility
          const status = e.kind === 'eligible' ? (e.dateMissing ? 'Ready · belt date missing' : 'Ready') : e.kind === 'not-yet' ? toGoText(e.daysToGo) : e.kind === 'top' ? 'Highest belt' : 'Belt not set'
          const counts = order.map(a => ({ name: a.name, n: r.activities[a.id] || 0 })).filter(x => x.n > 0)
          return (
            <div key={r.student.id} data-testid="readiness-row" data-name={r.student.full_name} className="bg-gray-900 border border-gray-800 rounded-2xl px-4 py-3 space-y-1">
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-1.5 min-w-0">
                  <span className="text-sm text-white truncate">{r.student.full_name}</span>
                  <BeltChip rank={rankById[r.student.current_rank_id || '']} />
                </span>
                <span className={`text-xs shrink-0 ${e.kind === 'eligible' ? 'text-green-400 font-semibold' : 'text-gray-400'}`}>{status}</span>
              </div>
              <p className="text-[11px] text-gray-500">
                {'to' in e && e.to ? `Next: ${beltLabel(e.to)} · ` : ''}{r.classes} class{r.classes === 1 ? '' : 'es'} since {r.since ? formatDate(r.since, country, 'medium') : '—'}
              </p>
              {counts.length > 0 && <p className="text-[11px] text-gray-300">{counts.map(c => `${c.name} ${c.n}`).join(' · ')}</p>}
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white pb-10">
      <PageNav />
      <div className="bg-gray-900 border-b border-gray-800 px-4 sm:px-8 py-4">
        <div className="flex items-center gap-3 min-w-0">
          <button data-nav onClick={() => router.push(me?.role === 'coach' ? '/coach' : '/company')}
            className="text-xs text-gray-400 hover:text-white border border-gray-700 hover:border-gray-500 px-3 py-1.5 rounded-lg transition shrink-0">← Back</button>
          <h1 className="text-xl sm:text-2xl font-bold text-white">Class reports</h1>
        </div>
      </div>

      <div className="px-4 sm:px-8 py-5 max-w-2xl mx-auto space-y-4">
        {loading ? (
          <div className="h-40 rounded-2xl bg-gray-900 border border-gray-800 animate-pulse" aria-label="Loading" />
        ) : missing || notDojo ? (
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 text-sm text-gray-400">
            {notDojo ? 'Class reports are for dojos.' : "Class reports aren't set up yet. CoachBoard will switch them on for your account."}
          </div>
        ) : (
          <div data-testid="page-class-reports" className="space-y-4">
            <div role="tablist" className="flex gap-1 bg-gray-900 border border-gray-800 rounded-xl p-1 overflow-x-auto">
              {tabs.map(([k, label]) => (
                <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
                  className={`flex-1 whitespace-nowrap px-3 py-2 rounded-lg text-xs font-medium ${tab === k ? 'bg-orange-500 text-white' : 'text-gray-400 hover:text-white'}`}>{label}</button>
              ))}
            </div>
            {branches.length > 1 && (
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Branch">
                {[{ id: 'all', name: 'All branches' }, ...branches].map(b => (
                  <button key={b.id} type="button" aria-pressed={branch === b.id} onClick={() => setBranch(b.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${branch === b.id ? 'bg-orange-500 text-white' : 'bg-gray-800 text-gray-400 border border-gray-700 hover:border-gray-500'}`}>{b.name}</button>
                ))}
              </div>
            )}
            <div className={dataLoading ? 'opacity-60' : ''}>
              {tab === 'day' && dayTab()}
              {tab === 'student' && studentTab()}
              {tab === 'activity' && activityTab()}
              {tab === 'grading' && gradingTab && gradingTabView()}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

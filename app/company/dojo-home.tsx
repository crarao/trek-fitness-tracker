'use client'

// Dojo owner / partner home (ROADMAP: Dojo owner home redesign, 14 Nov 2026). Rendered by app/company/page.tsx only in
// attendanceMode (a dojo with branches, batches and attendance); gyms, solo coaches and a dojo before branches keep the
// old dashboard. Built around what a dojo owner opens it for: did today's classes happen, which parents to chase for
// fees, who needs attention, and finding a student.
// Everything comes from page.tsx as props (its state and handlers, never copied). The existing sections (Senseis,
// revenue, CoachBoard plan, Settings, the student table) arrive ready-made as slots and are shown unchanged.
// Own reads (read-only, once on load): staff names for "by <who>", 60 days of present attendance (not seen), the next
// grading exam and its picked count. Rules: lib/dojo-home.ts (check: scripts/check-dojo-home.ts).

import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { type Country, formatDate, localDateIso } from '@/lib/locale'
import { formatMoney, formatMoneyByCurrency } from '@/lib/currency'
import { memberWord, staffWord } from '@/lib/labels'
import { type Branch, type Batch, timeLabel } from '@/lib/batches'
import { type AttendanceRow } from '@/lib/attendance'
import { type LeadSummary } from '@/lib/leads'
import { type GradingExam, GRADING_EXAM_COLUMNS } from '@/lib/belts'
import {
  type FeeStudent, type FeeRow, type BatchState, type StaffName,
  batchState, todaySummary, todaySummaryText, markedByName, feesToCollect, notSeen, lastPresentDates,
  firstNamesLine, telHref, ATTENDANCE_LOOKBACK_DAYS, NOT_SEEN_DAYS,
} from '@/lib/dojo-home'

export type DojoStudent = FeeStudent & {
  created_at: string
  batch_id?: string | null
}

type ManageKey = 'senseis' | 'revenue' | 'plan' | 'settings'

type Props<S extends DojoStudent> = {
  companyId: string | null
  companyName: string
  logoUrl: string
  roleLabel: string                  // "Owner" / "Partner" ('' until known)
  businessType: string | null
  country: Country | null
  currency: string | null
  loading: boolean                   // the student list hasn't loaded yet
  students: S[]                      // active students (all branches; inBranch filters)
  inBranch: (s: S) => boolean        // the page's branch rule (the same one the table uses)
  branches: Branch[]
  batches: Batch[]
  branchFilter: string               // 'all' | branch id | 'none'
  onBranchChange: (id: string) => void
  todaysBatches: Batch[]             // batches meeting today (all branches), start-time order
  attToday: AttendanceRow[]          // today's present rows
  beltsOn: boolean
  leadSummary: LeadSummary | null
  monthByCurrency: { currency: string; amount: number }[]
  reminderUrl: (s: S) => string | null   // exactly the link the row's Remind / Send reminder opens (null = opens the student)
  onAddStudent: () => void
  onOpenClient: (id: string) => void
  onShowTab: (tab: 'expiring' | 'expired') => void
  onLogout: () => void
  banners: ReactNode                 // Subscription banners, unchanged
  studentList: ReactNode             // the member table, unchanged (testids inside)
  manage: {
    senseis: ReactNode | null        // the Coaches section (coaches-section); null = not shown for this gym
    onOpenSenseis: () => void
    revenue: ReactNode               // This month card + revenue drill-in + Plan breakdown
    onOpenRevenue: () => void
    plan: ReactNode | null           // CoachBoard subscription status card
    settings: ReactNode              // the Settings panel (shown while settingsOpen)
    settingsOpen: boolean
    onToggleSettings: (open: boolean) => void
  }
}

const initials = (name: string) => name.trim().split(/\s+/).map(n => n[0] || '').join('').toUpperCase().slice(0, 2)

const card = 'bg-gray-900 border border-gray-800 rounded-2xl p-4'
const linkBtn = 'text-xs text-orange-400 hover:text-orange-300 py-2'

export default function DojoHome<S extends DojoStudent>(p: Props<S>) {
  const router = useRouter()
  const mw = memberWord(p.businessType)
  const sw = staffWord(p.businessType)
  const many = mw.many.toLowerCase()
  const one = mw.one.toLowerCase()

  // Batch states follow the clock: refresh each minute while the page is open (no new queries)
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(t)
  }, [])
  const todayIso = localDateIso()

  // ---- Reads (read-only) ----
  // Who marked today's rows: owner, partner or sensei names
  const [staffById, setStaffById] = useState<Record<string, StaffName>>({})
  const markerIds = useMemo(() => [...new Set(p.attToday.map(r => r.marked_by).filter((x): x is string => !!x))].sort().join(','), [p.attToday])
  useEffect(() => {
    if (!markerIds) return
    let off = false
    supabase.from('profiles').select('id, full_name, role').in('id', markerIds.split(','))
      .then(({ data, error }) => {
        if (off || error) return
        setStaffById(Object.fromEntries((data || []).map(r => [r.id as string, { full_name: r.full_name as string | null, role: r.role as string | null }])))
      })
    return () => { off = true }
  }, [markerIds])

  // Present attendance of the last 60 days, reduced to the last date per student (not seen). Paged: 1,000 rows a page
  const [presence, setPresence] = useState<{ last: Record<string, string>; since: string | null } | null>(null)
  useEffect(() => {
    if (!p.companyId) return
    let off = false
    ;(async () => {
      const rows: { profile_id: string; class_date: string }[] = []
      const PAGE = 1000
      for (let from = 0; from < 20 * PAGE; from += PAGE) {
        const { data, error } = await supabase.from('attendance').select('profile_id, class_date')
          .eq('company_id', p.companyId as string).eq('present', true).gte('class_date', localDateIso(-ATTENDANCE_LOOKBACK_DAYS))
          .order('class_date', { ascending: false }).order('id').range(from, from + PAGE - 1)
        if (error) { if (!off) setPresence({ last: {}, since: null }); return }
        rows.push(...((data || []) as { profile_id: string; class_date: string }[]))
        if ((data || []).length < PAGE) break
      }
      if (!off) setPresence(lastPresentDates(rows))
    })()
    return () => { off = true }
  }, [p.companyId])

  // Next grading exam (scheduled, today or later) and how many students are picked (not removed; read with * so it
  // works before and after the Phase 2 SQL, like the exam page)
  const [grading, setGrading] = useState<{ exam: GradingExam | null } | null>(null)
  const activeIds = useMemo(() => new Set(p.students.map(s => s.id)), [p.students])
  const [candidates, setCandidates] = useState<{ student_id: string; removed_at?: string | null }[]>([])
  useEffect(() => {
    if (!p.companyId || !p.beltsOn) return
    let off = false
    ;(async () => {
      const { data, error } = await supabase.from('grading_exams').select(GRADING_EXAM_COLUMNS)
        .eq('company_id', p.companyId as string).eq('status', 'scheduled').gte('exam_date', localDateIso())
        .order('exam_date').limit(1)
      if (off) return
      if (error) { setGrading({ exam: null }); return }
      const exam = ((data || []) as GradingExam[])[0] || null
      if (!exam) { setGrading({ exam: null }); return }
      const c = await supabase.from('grading_exam_candidates').select('*').eq('exam_id', exam.id)
      if (off) return
      setCandidates(c.error ? [] : (c.data || []) as { student_id: string; removed_at?: string | null }[])
      setGrading({ exam })
    })()
    return () => { off = true }
  }, [p.companyId, p.beltsOn])
  // Picked = ticked (not removed) and still an active student, as on the exam page
  const pickedCount = candidates.filter(c => !c.removed_at && activeIds.has(c.student_id)).length

  // ---- Branch filter (the header's switcher filters every card) ----
  const activeBranches = p.branches.filter(b => !b.is_archived)
  const showSwitcher = activeBranches.length >= 2
  const noBranchCount = p.students.filter(s => !s.branch_id).length
  const students = p.students.filter(p.inBranch)
  const branchName = (id: string | null | undefined) => p.branches.find(b => b.id === id)?.name || ''
  const batchName = (id: string | null | undefined) => p.batches.find(b => b.id === id)?.name || ''
  const batchesShown = p.branchFilter === 'all' || p.branchFilter === 'none'
    ? p.todaysBatches
    : p.todaysBatches.filter(b => b.branch_id === p.branchFilter)

  // ---- 1. Today ----
  const batchRows = batchesShown.map(b => ({
    b, state: batchState(b, p.attToday, now, p.country) as BatchState,
    by: markedByName(p.attToday.filter(r => r.batch_id === b.id), staffById, sw.one),
  }))
  const summary = todaySummaryText(todaySummary(batchRows.map(r => r.state)))

  // ---- 2. Fees ----
  const fees = feesToCollect({ students, baseCurrency: p.currency, country: p.country })

  // ---- 3. Needs attention ----
  const notSeenRows = presence ? notSeen({ students, lastPresentByStudent: presence.last, attendanceSince: presence.since, today: todayIso }) : []
  const [showNotSeen, setShowNotSeen] = useState(false)
  const enquiries = p.leadSummary ? p.leadSummary.dueToday + p.leadSummary.overdue : 0
  const windowStart = localDateIso(-ATTENDANCE_LOOKBACK_DAYS)
  const lastCameText = (s: S, last: string | null) => last
    ? `last came ${formatDate(last, p.country, 'dayMonth')}`
    : (s.created_at || '').slice(0, 10) < windowStart ? `not in the last ${ATTENDANCE_LOOKBACK_DAYS} days` : 'no classes yet'

  // ---- Manage sheet + Manage area ----
  const [sheetOpen, setSheetOpen] = useState(false)
  const [manageOpen, setManageOpen] = useState(false)
  const sheetRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!sheetOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSheetOpen(false) }
    window.addEventListener('keydown', onKey)
    sheetRef.current?.querySelector<HTMLElement>('button')?.focus()
    return () => window.removeEventListener('keydown', onKey)
  }, [sheetOpen])
  const scrollToId = (id: string) => {
    // After the section has rendered
    setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60)
  }
  const openManage = (key: ManageKey) => {
    setSheetOpen(false)
    setManageOpen(true)
    if (key === 'senseis') p.manage.onOpenSenseis()
    if (key === 'revenue') p.manage.onOpenRevenue()
    if (key === 'settings') p.manage.onToggleSettings(true)
    scrollToId(`manage-${key}`)
  }
  const go = (path: string) => { setSheetOpen(false); router.push(path) }
  const showTab = (tab: 'expiring' | 'expired') => { p.onShowTab(tab); scrollToId('dojo-students') }

  const money = (amount: number, cur: string | null) => formatMoney(amount, p.currency === null ? null : (cur || p.currency))

  const feeRow = (r: FeeRow<S>, kind: 'due' | 'lapsed') => {
    const first = r.students[0]
    const sub = [r.line, money(r.amount, r.currency),
      kind === 'due' ? `due ${formatDate(r.dueDate, p.country, 'dayMonth')}` : `lapsed ${formatDate(r.dueDate, p.country, 'dayMonth')}`]
      .filter(Boolean).join(' · ')
    const wa = kind === 'due' ? p.reminderUrl(first) : null
    const tel = kind === 'lapsed' ? telHref(r.phone, p.country) : null
    return (
      <li key={r.key} className="flex items-center gap-3 py-2">
        <button type="button" data-nav onClick={() => p.onOpenClient(first.id)} className="flex items-center gap-3 flex-1 min-w-0 text-left">
          <span className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${kind === 'due' ? 'bg-amber-900/60 text-amber-300' : 'bg-red-900/60 text-red-300'}`}>{initials(r.name)}</span>
          <span className="min-w-0">
            <span className="block text-sm text-white truncate">{r.name}</span>
            <span className="block text-xs text-gray-400 truncate">{sub}</span>
          </span>
        </button>
        {kind === 'due' ? (
          <button type="button" aria-label={`WhatsApp ${r.name}`}
            onClick={() => { if (wa) window.open(wa, '_blank'); else p.onOpenClient(first.id) }}
            className="w-11 h-11 flex-shrink-0 rounded-xl border border-green-700 text-green-400 hover:bg-green-900/30 flex items-center justify-center">
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.4.8 3.2.6a2.8 2.8 0 0 0 1.8-1.3 2.3 2.3 0 0 0 .2-1.3c-.1-.1-.3-.2-.5-.3Z" /></svg>
          </button>
        ) : tel ? (
          <a href={tel} aria-label={`Call ${r.name}`}
            className="w-11 h-11 flex-shrink-0 rounded-xl border border-red-800 text-red-400 hover:bg-red-900/30 flex items-center justify-center">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M2.3 6.8c0 8.3 6.6 15 14.9 15h2.3a2.2 2.2 0 0 0 2.2-2.3v-1.4c0-.5-.3-1-.8-1.1l-4.4-1.1c-.4-.1-.9 0-1.2.4l-1 1.3c-.3.4-.9.6-1.4.4a12.2 12.2 0 0 1-7.2-7.2c-.2-.5 0-1.1.4-1.4l1.3-1c.4-.3.5-.8.4-1.2L6.8 3.1c-.1-.5-.6-.8-1.1-.8H4.5a2.2 2.2 0 0 0-2.2 2.2v2.3Z" /></svg>
          </a>
        ) : (
          <button type="button" aria-label={`Call ${r.name}`} disabled title="No phone number saved"
            className="w-11 h-11 flex-shrink-0 rounded-xl border border-gray-800 text-gray-600 flex items-center justify-center">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M2.3 6.8c0 8.3 6.6 15 14.9 15h2.3a2.2 2.2 0 0 0 2.2-2.3v-1.4c0-.5-.3-1-.8-1.1l-4.4-1.1c-.4-.1-.9 0-1.2.4l-1 1.3c-.3.4-.9.6-1.4.4a12.2 12.2 0 0 1-7.2-7.2c-.2-.5 0-1.1.4-1.4l1.3-1c.4-.3.5-.8.4-1.2L6.8 3.1c-.1-.5-.6-.8-1.1-.8H4.5a2.2 2.2 0 0 0-2.2 2.2v2.3Z" /></svg>
          </button>
        )}
      </li>
    )
  }

  const pill = (s: BatchState) => {
    switch (s.kind) {
      case 'done': return <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-green-900/50 text-green-400 whitespace-nowrap">{s.came} came</span>
      case 'missed': return <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-red-900/50 text-red-400 whitespace-nowrap">Not taken</span>
      case 'upcoming': return <span className="text-xs px-2.5 py-1 rounded-full bg-gray-800 text-gray-400 whitespace-nowrap">Starts {s.startsLabel}</span>
      default: return <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-orange-900/40 text-orange-400 whitespace-nowrap">Take attendance</span>
    }
  }

  const sheetItem = (label: string, onClick: () => void, hint?: string) => (
    <li>
      <button type="button" onClick={onClick}
        className="w-full min-h-[44px] flex items-center justify-between gap-3 px-4 py-3 text-left text-sm text-white hover:bg-gray-800 rounded-xl">
        <span>{label}{hint && <span className="block text-xs text-gray-500">{hint}</span>}</span>
        <span className="text-gray-500" aria-hidden="true">→</span>
      </button>
    </li>
  )

  const skeleton = <div className="h-24 rounded-2xl bg-gray-900 border border-gray-800 animate-pulse" aria-hidden="true" />
  const attentionHasRows = notSeenRows.length > 0 || p.beltsOn || enquiries > 0

  return (
    <>
      {/* Header */}
      <div className="bg-gray-900 border-b border-gray-800 px-4 sm:px-8 pt-4 pb-3 space-y-3">
        <div className="flex items-center gap-3">
          {p.logoUrl && (
            <img src={p.logoUrl} alt={p.companyName} className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl object-cover border border-gray-700" />
          )}
          <div className="flex-1 min-w-0">
            <h1 className="text-xl sm:text-2xl font-bold text-white truncate">{p.companyName || 'CoachBoard'}</h1>
            {p.roleLabel && <p className="text-xs text-gray-500">{p.roleLabel}</p>}
          </div>
          <button type="button" aria-label="Manage menu" aria-haspopup="dialog" aria-expanded={sheetOpen} onClick={() => setSheetOpen(true)}
            className="w-11 h-11 flex-shrink-0 rounded-xl border border-gray-700 text-gray-300 hover:border-gray-500 hover:text-white flex items-center justify-center text-xl leading-none">
            ⋯
          </button>
        </div>
        {showSwitcher && (
          <div className="flex gap-1.5 flex-wrap" role="group" aria-label="Branch">
            {[{ id: 'all', label: 'All' }, ...activeBranches.map(b => ({ id: b.id, label: b.name })),
              ...(noBranchCount > 0 ? [{ id: 'none', label: 'No branch' }] : [])].map(chip => (
              <button key={chip.id} type="button" onClick={() => p.onBranchChange(chip.id)} aria-pressed={p.branchFilter === chip.id}
                className={`text-xs px-3 py-2 rounded-full border transition ${p.branchFilter === chip.id ? 'bg-orange-500 border-orange-500 text-white' : 'bg-gray-900 border-gray-700 text-gray-300 hover:border-gray-500'}`}>
                {chip.label}
              </button>
            ))}
          </div>
        )}
        <button type="button" data-testid="add-member-open" onClick={p.onAddStudent}
          className="w-full min-h-[44px] bg-white hover:bg-gray-100 text-gray-900 text-sm font-semibold rounded-xl transition">
          + Add {mw.one}
        </button>
      </div>

      {p.banners}

      {p.loading ? (
        <div className="px-4 sm:px-8 pt-3 space-y-3" aria-busy="true">
          <span className="sr-only" role="status">Loading…</span>
          {skeleton}{skeleton}{skeleton}
        </div>
      ) : (
        <>
          {/* 1. Today */}
          <div className="px-4 sm:px-8 pt-3">
            <div className={card}>
              <div className="flex items-baseline justify-between gap-3 flex-wrap">
                <h2 className="text-sm font-semibold text-white">Today · {formatDate(now, p.country, 'weekday')}</h2>
                <span className="flex gap-3">
                  <button type="button" data-nav onClick={() => router.push('/company/attendance/today')} className={linkBtn}>All of today →</button>
                  <button type="button" data-nav onClick={() => router.push('/company/attendance')} className={linkBtn}>This month →</button>
                </span>
              </div>
              {batchRows.length === 0 ? (
                <p className="text-sm text-gray-500 mt-1">No batches today.</p>
              ) : (
                <>
                  <p className="text-xs text-gray-400 mt-0.5 mb-2">{summary}</p>
                  <ul className="divide-y divide-gray-800">
                    {batchRows.map(({ b, state, by }) => (
                      <li key={b.id}>
                        <button type="button" data-nav onClick={() => router.push(`/company/attendance/${b.id}`)}
                          className="w-full min-h-[44px] flex items-center gap-3 py-2.5 text-left hover:bg-gray-800/40 rounded-lg">
                          <span className="w-16 flex-shrink-0 text-xs text-gray-400">{timeLabel(b.start_time, p.country) || '—'}</span>
                          <span className="flex-1 min-w-0">
                            <span className="block text-sm text-white truncate">{b.name}</span>
                            {(activeBranches.length > 1 || (state.kind === 'done' && by)) && (
                              <span className="block text-xs text-gray-500 truncate">
                                {[activeBranches.length > 1 ? branchName(b.branch_id) : '', state.kind === 'done' && by ? `by ${by}` : ''].filter(Boolean).join(' · ')}
                              </span>
                            )}
                            {state.kind === 'missed' && (
                              <span className="block text-xs text-red-400">Ended {state.endedLabel}, no roll call yet</span>
                            )}
                          </span>
                          {pill(state)}
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          </div>

          {/* 2. Fees to collect */}
          <div className="px-4 sm:px-8 pt-3">
            <div className={card}>
              <h2 className="text-sm font-semibold text-white">Fees to collect</h2>
              {fees.dueThisWeek.length === 0 && fees.lapsed.length === 0 ? (
                <p className="text-sm text-gray-400 mt-1">All fees are up to date.</p>
              ) : (
                <>
                  <p className="text-2xl font-bold text-amber-400 mt-1">{formatMoneyByCurrency(fees.totals.byCurrency, p.currency)}</p>
                  <p className="text-xs text-gray-500">from {fees.totals.parents} parent{fees.totals.parents === 1 ? '' : 's'}</p>
                  {fees.dueThisWeek.length > 0 && (
                    <div className="mt-3">
                      <p className="text-xs text-gray-500 uppercase tracking-wider">Due this week · {fees.dueThisWeek.length}</p>
                      <ul className="divide-y divide-gray-800">{fees.dueThisWeek.slice(0, 3).map(r => feeRow(r, 'due'))}</ul>
                      {fees.dueThisWeek.length > 3 && (
                        <button type="button" onClick={() => showTab('expiring')} className={linkBtn}>+ {fees.dueThisWeek.length - 3} more · see Expiring</button>
                      )}
                    </div>
                  )}
                  {fees.lapsed.length > 0 && (
                    <div className="mt-3">
                      <p className="text-xs text-gray-500 uppercase tracking-wider">Lapsed · call the parent · {fees.lapsed.length}</p>
                      <ul className="divide-y divide-gray-800">{fees.lapsed.slice(0, 3).map(r => feeRow(r, 'lapsed'))}</ul>
                      {fees.lapsed.length > 3 && (
                        <button type="button" onClick={() => showTab('expired')} className={linkBtn}>+ {fees.lapsed.length - 3} more lapsed · see Expired</button>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* 3. Needs attention (only when a row has something) */}
          {attentionHasRows && (
            <div className="px-4 sm:px-8 pt-3">
              <div className={card}>
                <h2 className="text-sm font-semibold text-white mb-1">Needs attention</h2>
                <ul className="divide-y divide-gray-800">
                  {notSeenRows.length > 0 && (
                    <li>
                      <button type="button" onClick={() => setShowNotSeen(!showNotSeen)} aria-expanded={showNotSeen}
                        className="w-full min-h-[44px] flex items-center justify-between gap-3 py-2.5 text-left">
                        <span className="min-w-0">
                          <span className="block text-sm text-white">{notSeenRows.length} {notSeenRows.length === 1 ? one : many} not seen in {NOT_SEEN_DAYS}+ days</span>
                          <span className="block text-xs text-gray-500 truncate">{firstNamesLine(notSeenRows.map(r => r.student.full_name))}</span>
                        </span>
                        <span className={`text-gray-500 text-sm transition-transform inline-block ${showNotSeen ? 'rotate-180' : ''}`} aria-hidden="true">▾</span>
                      </button>
                      {showNotSeen && (
                        <ul className="pb-2">
                          {notSeenRows.map(({ student, lastPresent }) => (
                            <li key={student.id}>
                              <button type="button" data-nav onClick={() => p.onOpenClient(student.id)}
                                className="w-full min-h-[44px] flex items-center justify-between gap-3 px-2 py-2 text-left hover:bg-gray-800/50 rounded-lg">
                                <span className="min-w-0">
                                  <span className="block text-sm text-gray-200 truncate">{student.full_name}</span>
                                  {batchName(student.batch_id) && <span className="block text-xs text-gray-500 truncate">{batchName(student.batch_id)}</span>}
                                </span>
                                <span className="text-xs text-gray-400 whitespace-nowrap">{lastCameText(student, lastPresent)}</span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  )}
                  {p.beltsOn && (
                    <li>
                      <button type="button" data-nav data-testid="grading-link"
                        onClick={() => router.push(grading?.exam ? `/company/grading/${grading.exam.id}` : '/company/grading')}
                        className="w-full min-h-[44px] flex items-center justify-between gap-3 py-2.5 text-left">
                        <span className="min-w-0">
                          {!grading ? (
                            <span className="block text-sm text-gray-400">Grading exams</span>
                          ) : grading.exam ? (
                            <>
                              <span className="block text-sm text-white">Grading exam · {formatDate(grading.exam.exam_date, p.country, 'weekday')}</span>
                              <span className="block text-xs text-gray-500 truncate">
                                {[grading.exam.venue || '', pickedCount ? `${pickedCount} ${pickedCount === 1 ? one : many} picked` : `No ${many} picked yet`].filter(Boolean).join(' · ')}
                              </span>
                            </>
                          ) : (
                            <span className="block text-sm text-gray-400">No grading exam scheduled</span>
                          )}
                        </span>
                        <span className="text-gray-500" aria-hidden="true">→</span>
                      </button>
                    </li>
                  )}
                  {enquiries > 0 && (
                    <li>
                      <button type="button" data-nav onClick={() => router.push('/company/leads')}
                        className="w-full min-h-[44px] flex items-center justify-between gap-3 py-2.5 text-left">
                        <span className="text-sm text-white">{enquiries} {enquiries === 1 ? 'enquiry' : 'enquiries'} to follow up today</span>
                        <span className="text-gray-500" aria-hidden="true">→</span>
                      </button>
                    </li>
                  )}
                </ul>
              </div>
            </div>
          )}
        </>
      )}

      {/* 4. Students: the existing table, unchanged (tabs, search, archived filter, row actions, testids) */}
      <div id="dojo-students" className="scroll-mt-2">{p.studentList}</div>

      {/* 5. Month line */}
      <div className="px-4 sm:px-8 pb-2 text-center text-xs text-gray-500 space-y-1">
        <p>
          {formatDate(now, p.country, 'monthLong')} so far: {formatMoneyByCurrency(p.monthByCurrency, p.currency)} collected
          {p.leadSummary && <> · {p.leadSummary.joinedThisMonth} {p.leadSummary.joinedThisMonth === 1 ? 'enquiry' : 'enquiries'} joined · {p.leadSummary.lostThisMonth} lost</>}
        </p>
        <button type="button" onClick={() => setSheetOpen(true)} className="text-orange-400 hover:text-orange-300 py-2">
          Revenue, {sw.many.toLowerCase()}, batches → Manage
        </button>
      </div>

      {/* Manage area: the existing sections, unchanged, collapsed at the bottom */}
      <div className="px-4 sm:px-8 pt-1 pb-2">
        <button type="button" onClick={() => setManageOpen(!manageOpen)} aria-expanded={manageOpen}
          className="w-full min-h-[44px] flex items-center justify-between text-left text-xs text-gray-500 uppercase tracking-wider border-t border-gray-800 pt-3">
          Manage
          <span className={`text-sm transition-transform inline-block ${manageOpen ? 'rotate-180' : ''}`} aria-hidden="true">▾</span>
        </button>
      </div>
      {manageOpen && (
        <div className="pb-10">
          {p.manage.senseis && <div id="manage-senseis" className="scroll-mt-2">{p.manage.senseis}</div>}
          <div id="manage-revenue" className="scroll-mt-2">{p.manage.revenue}</div>
          {p.manage.plan && <div id="manage-plan" className="scroll-mt-2">{p.manage.plan}</div>}
          <div id="manage-settings" className="px-4 sm:px-8 pt-3 scroll-mt-2">
            <button type="button" onClick={() => p.manage.onToggleSettings(!p.manage.settingsOpen)} aria-expanded={p.manage.settingsOpen}
              className={`${card} w-full flex items-center justify-between text-left`}>
              <span className="text-xs text-gray-500 uppercase tracking-wider">Settings</span>
              <span className={`text-gray-500 text-sm transition-transform inline-block ${p.manage.settingsOpen ? 'rotate-180' : ''}`} aria-hidden="true">▾</span>
            </button>
          </div>
          {p.manage.settingsOpen && p.manage.settings}
        </div>
      )}

      {/* Manage sheet (⋯ or the month line's link): closes on Close, a tap outside, or Escape */}
      {sheetOpen && (
        <div className="fixed inset-0 z-40 bg-black/60 flex items-end justify-center" onClick={() => setSheetOpen(false)}>
          <div ref={sheetRef} role="dialog" aria-modal="true" aria-label="Manage"
            onClick={e => e.stopPropagation()}
            className="w-full max-w-lg bg-gray-900 border-t border-gray-700 rounded-t-2xl px-3 pt-3 pb-6 max-h-[85vh] overflow-y-auto">
            <p className="px-4 pt-1 pb-1 text-xs text-gray-500 uppercase tracking-wider">Dojo</p>
            <ul>
              {p.manage.senseis && sheetItem(sw.many, () => openManage('senseis'))}
              {sheetItem('Branches & batches', () => go('/company/batches'))}
              {sheetItem('Attendance this month', () => go('/company/attendance'))}
              {p.beltsOn && sheetItem('Grading exams', () => go('/company/grading'))}
              {sheetItem('Enquiries', () => go('/company/leads'))}
              {sheetItem('Revenue & fee plans', () => openManage('revenue'))}
            </ul>
            <p className="px-4 pt-3 pb-1 text-xs text-gray-500 uppercase tracking-wider">Account</p>
            <ul>
              {p.manage.plan && sheetItem('CoachBoard plan', () => openManage('plan'))}
              {sheetItem('Settings', () => openManage('settings'), 'Change password')}
              <li>
                <button type="button" data-nav onClick={() => { setSheetOpen(false); p.onLogout() }}
                  className="w-full min-h-[44px] px-4 py-3 text-left text-sm text-red-400 hover:bg-gray-800 rounded-xl">
                  Log out
                </button>
              </li>
            </ul>
            <button type="button" onClick={() => setSheetOpen(false)}
              className="w-full min-h-[44px] mt-3 bg-gray-800 hover:bg-gray-700 text-white text-sm rounded-xl">
              Close
            </button>
          </div>
        </div>
      )}
    </>
  )
}

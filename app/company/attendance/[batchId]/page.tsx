'use client'

// Roll call for one batch on one day (Dojo Build 3, ROADMAP #78; db/2026-11-03-attendance.md).
// Senseis, the owner and partners tap who came; tap again to undo (saved as present = false, never deleted).
// Everyone not tapped counts as absent. "+ Drop-in" adds a student from another batch.
// ?date=YYYY-MM-DD opens another day (past days can be corrected; no future days).
// The whole day's attendance is loaded (every batch), so a student already marked in another batch shows
// "Already came today · Kids 5 PM · by Sensei Ravi" and marking them here asks first. Two classes a day stay allowed.
// Class activities + 7-day lock (db/2026-11-19-dojo-activities-absences.md; rules in lib/dojo-activities.ts): a checklist
// above the students (the dojo's activities, pre-ticked ones ticked on a new class). The class is saved
// (batch_classes, logged_at / logged_by) with its ticked activities on the first student marked or the first
// activity tapped; after that each tap saves. A day more than 7 days back is read-only unless the owner unlocked it
// (Unlock / Lock again, owner only). The database enforces the lock; its message is shown when a save is refused.
// Before that SQL runs the tables can't be read: no checklist, no lock, the roll call as before.
// Leave + availability (same SQL file; rules in lib/leave.ts): a home student not marked present has an "On leave"
// button → sheet "until when?" (default this day) + note; on leave = greyed "On leave until 24 Nov" with Cancel leave
// (cancelled_at, never deleted). "Attends: Mon, Wed, Fri" under the name when available_days narrows the batch days.

import PageNav from '@/app/page-nav'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { type Country, normalizeCountry, formatDate, localDateIso } from '@/lib/locale'
import { memberWord, staffWord } from '@/lib/labels'
import { loadGymStaff } from '@/lib/gym-staff'
import { type BeltRank, BELT_RANK_COLUMNS, gradingOn, beltsById } from '@/lib/belts'
import BeltChip from '@/app/belt-chip'
import { type Batch, type Branch, BATCH_COLUMNS, BRANCH_COLUMNS, batchWhen, sortDays } from '@/lib/batches'
import { type AttendanceRow, type RosterStudent, ATTENDANCE_COLUMNS, roster, tapRow, addDays, weekdayOf, cameElsewhere, elsewhereText } from '@/lib/attendance'
import {
  type DojoActivity, type BatchClass, type ClassActivity, type ChecklistItem, ACTIVITY_COLUMNS, BATCH_CLASS_COLUMNS,
  CLASS_ACTIVITY_COLUMNS, checklist, activityRowsToSave, ticksSummary, dayLocked, lockAction, saveErrorText, LOCK_DAYS, groupByCategory,
} from '@/lib/dojo-activities'
import { type Holiday, HOLIDAY_COLUMNS, holidayFor, noClassesText } from '@/lib/holidays'
import { type StudentLeave, LEAVE_COLUMNS, LEAVE_NOTE_MAX, leaveOn, leaveText, leaveProblem, leaveRow, attendsLabel, expectedDays } from '@/lib/leave'

type Student = RosterStudent & { available_days?: string | null }

export default function RollCallPage() {
  const router = useRouter()
  const params = useParams()
  const searchParams = useSearchParams()
  const batchId = params.batchId as string
  const today = localDateIso()
  const asked = searchParams.get('date')
  const date = asked && /^\d{4}-\d{2}-\d{2}$/.test(asked) && asked <= today ? asked : today

  const [loading, setLoading] = useState(true)
  const [problem, setProblem] = useState('')
  const [me, setMe] = useState<{ id: string; role: string; companyId: string } | null>(null)
  const [country, setCountry] = useState<Country>('IN')
  // Belt grading on: the gym's belts by id (one read); empty = no chips
  const [beltById, setBeltById] = useState<Record<string, BeltRank>>({})
  const [businessType, setBusinessType] = useState<string | null>(null)
  const [batch, setBatch] = useState<Batch | null>(null)
  const [branch, setBranch] = useState<Branch | null>(null)
  const [students, setStudents] = useState<Student[]>([])
  const [rows, setRows] = useState<AttendanceRow[]>([])   // the whole day, every batch
  const [allBatches, setAllBatches] = useState<Batch[]>([])
  const [staff, setStaff] = useState<Record<string, { name: string; role: string }>>({})
  const [confirmFor, setConfirmFor] = useState<RosterStudent | null>(null)
  const [busy, setBusy] = useState<Set<string>>(new Set())
  const [showDropIn, setShowDropIn] = useState(false)
  const [query, setQuery] = useState('')
  // Class activities + lock: null = the tables aren't there yet (feature hidden)
  const [activities, setActivities] = useState<DojoActivity[] | null>(null)
  const [cls, setCls] = useState<BatchClass | null>(null)
  const [classActs, setClassActs] = useState<ClassActivity[]>([])
  const [actBusy, setActBusy] = useState(false)
  const [lockBusy, setLockBusy] = useState(false)
  // One "save the class" at a time (two quick taps must not insert the class twice)
  const ensuring = useRef<Promise<BatchClass | null> | null>(null)
  // Leave: null = the table isn't there yet (no leave buttons). The sheet is open for one student.
  const [leaves, setLeaves] = useState<StudentLeave[] | null>(null)
  // Holidays on this day (any branch); null = the table isn't there yet
  const [holidays, setHolidays] = useState<Holiday[] | null>(null)
  const [leaveFor, setLeaveFor] = useState<Student | null>(null)
  const [leaveTo, setLeaveTo] = useState('')
  const [leaveNote, setLeaveNote] = useState('')
  const [leaveError, setLeaveError] = useState('')
  const [leaveSaving, setLeaveSaving] = useState(false)
  const [toast, setToast] = useState<{ text: string; kind: 'success' | 'error' } | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const showToast = (text: string, kind: 'success' | 'error' = 'success') => {
    if (toastTimer.current) clearTimeout(toastTimer.current)
    setToast({ text, kind })
    toastTimer.current = setTimeout(() => setToast(null), 2500)
  }
  const mw = memberWord(businessType)

  useEffect(() => {
    let live = true
    ;(async () => {
      setLoading(true)
      const { data: { session } } = await supabase.auth.getSession()
      const user = session?.user
      if (!user) { router.push('/login'); return }
      const { data: profile } = await supabase.from('profiles')
        .select('id, role, company_id, companies:company_id(*)').eq('id', user.id).single()
      if (!profile?.company_id) { router.push('/login'); return }
      const co = (profile as unknown as { companies: { country?: string | null; business_type?: string | null; grading_enabled?: boolean | null } | null }).companies
      const [ba, people, att, gymBatches, staffList, ranks, acts, classRow, leaveRes, holidayRes] = await Promise.all([
        supabase.from('batches').select(BATCH_COLUMNS).eq('id', batchId).maybeSingle(),
        // Database rules give a sensei the gym's PT students (every dojo student); owners all clients
        supabase.from('profiles').select('id, full_name, batch_id, archived_at, current_rank_id, available_days').eq('company_id', profile.company_id)
          .eq('role', 'client').is('archived_at', null).order('full_name'),
        // The whole day across batches, to warn when a student already came to another class
        supabase.from('attendance').select(ATTENDANCE_COLUMNS).eq('company_id', profile.company_id).eq('class_date', date),
        supabase.from('batches').select(BATCH_COLUMNS).eq('company_id', profile.company_id),
        loadGymStaff(profile.company_id as string),
        // Belt grading on: the gym's belts once, for the chips
        gradingOn(co) ? supabase.from('belt_ranks').select(BELT_RANK_COLUMNS).eq('company_id', profile.company_id) : null,
        // Class activities + this class (an error = the tables aren't there yet: feature hidden)
        supabase.from('dojo_activities').select(ACTIVITY_COLUMNS).eq('company_id', profile.company_id),
        supabase.from('batch_classes').select(BATCH_CLASS_COLUMNS).eq('batch_id', batchId).eq('class_date', date).maybeSingle(),
        // Leave covering this day (an error = the table isn't there yet: no leave buttons)
        supabase.from('student_leaves').select(LEAVE_COLUMNS).eq('company_id', profile.company_id)
          .is('cancelled_at', null).lte('from_date', date).gte('to_date', date),
        supabase.from('holidays').select(HOLIDAY_COLUMNS).eq('company_id', profile.company_id).eq('holiday_date', date).is('removed_at', null),
      ])
      if (!live) return
      setMe({ id: user.id, role: profile.role as string, companyId: profile.company_id as string })
      setCountry(normalizeCountry(co?.country))
      setBusinessType(co?.business_type ?? null)
      if (att.error) { setProblem("Attendance isn't set up yet."); setLoading(false); return }
      if (ba.error || !ba.data) { setProblem('This batch was not found.'); setLoading(false); return }
      const b = ba.data as Batch
      setBatch(b)
      const { data: br } = await supabase.from('branches').select(BRANCH_COLUMNS).eq('id', b.branch_id).maybeSingle()
      if (!live) return
      setBranch((br as Branch | null) ?? null)
      setStudents((people.data || []) as Student[])
      setLeaves(leaveRes.error ? null : (leaveRes.data || []) as StudentLeave[])
      setHolidays(holidayRes.error ? null : (holidayRes.data || []) as Holiday[])
      setRows((att.data || []) as AttendanceRow[])
      setAllBatches((gymBatches.data || []) as Batch[])
      setStaff(Object.fromEntries(staffList.map(x => [x.id, { name: x.full_name, role: x.role }])))
      if (ranks?.error) console.error('Belt ranks error:', ranks.error)
      setBeltById(beltsById((ranks && !ranks.error ? ranks.data || [] : []) as BeltRank[]))
      if (acts.error || classRow.error) {
        setActivities(null); setCls(null); setClassActs([])
      } else {
        const c = (classRow.data as BatchClass | null) ?? null
        const saved = c ? await supabase.from('batch_class_activities').select(CLASS_ACTIVITY_COLUMNS).eq('class_id', c.id) : null
        if (!live) return
        if (saved?.error) console.error('Class activities error:', saved.error)
        setActivities((acts.data || []) as DojoActivity[])
        setCls(c)
        setClassActs((saved && !saved.error ? saved.data || [] : []) as ClassActivity[])
      }
      setLoading(false)
    })()
    return () => { live = false }
  }, [batchId, date, router])

  const list = useMemo(() => roster({ batchId, date, students, rows }), [batchId, date, students, rows])
  const presentIds = useMemo(() => new Set(rows.filter(r => r.present && r.batch_id === batchId).map(r => r.profile_id)), [rows, batchId])

  // "Kids 5 PM · by Sensei Ravi" for a student already marked in another batch today
  const sw = staffWord(businessType).one
  const batchLabel = (id: string) => {
    const b = allBatches.find(x => x.id === id)
    return b ? [b.name, batchWhen(b, country).split(' · ')[1] || ''].filter(Boolean).join(' ') : 'another batch'
  }
  const markedByName = (id: string | null | undefined) => {
    const p = id ? staff[id] : null
    const first = (p?.name || '').trim().split(/\s+/)[0]
    if (!first) return ''
    return p?.role === 'coach' ? `${sw} ${first}` : first
  }
  const elsewhere = (s: RosterStudent) => cameElsewhere(rows, s.id, batchId, date)
  const elsewhereLine = (s: RosterStudent) => elsewhereText(elsewhere(s), batchLabel, markedByName)

  // Marking someone who already came to another batch today asks first (allowed: exams, extra classes)
  const askOrTap = (student: RosterStudent) => {
    if (blocked) return
    if (!presentIds.has(student.id) && elsewhere(student).length) { setConfirmFor(student); return }
    tap(student)
  }

  const tap = async (student: RosterStudent) => {
    if (!me || busy.has(student.id) || blocked) return
    const current = presentIds.has(student.id)
    const row = tapRow({ batchId, date, student, companyId: me.companyId, current, markedBy: me.id })
    setBusy(s => new Set(s).add(student.id))
    // Show it straight away; put it back if the save fails
    const other = (r: AttendanceRow) => r.profile_id !== student.id || r.batch_id !== batchId
    setRows(rs => [...rs.filter(other), row])
    const { data, error } = await supabase.from('attendance')
      .upsert(row, { onConflict: 'batch_id,profile_id,class_date' }).select(ATTENDANCE_COLUMNS)
    setBusy(s => { const n = new Set(s); n.delete(student.id); return n })
    if (error || !data?.length) {
      setRows(rs => [...rs.filter(other), ...(current ? [{ ...row, present: true }] : [])])
      showToast(saveErrorText(error), 'error')
      return
    }
    setRows(rs => [...rs.filter(other), data[0] as AttendanceRow])
    // The first student marked saves the class with its ticked activities
    if (activities && !logged) await ensureClass(items)
  }

  // ── Class activities ──────────────────────────────────────────────────────────────────────────────────────
  const { items, logged } = useMemo(
    () => (activities ? checklist({ activities, cls, saved: classActs }) : { items: [] as ChecklistItem[], logged: false }),
    [activities, cls, classActs])
  const locked = activities !== null && dayLocked(date, today, cls)
  // A holiday for this batch's branch (or all branches) closes the day: nothing saves (lib/holidays.ts)
  const holiday = holidays && batch ? holidayFor(holidays, batch.branch_id, date) : null
  const blocked = locked || !!holiday
  const lockMove = activities !== null && me ? lockAction({ date, today, cls, role: me.role }) : null

  // Save the class (logged now, by me) and these ticks, once. A row may already exist (made by Unlock, or by
  // someone else a moment ago): then it's updated, never inserted twice. Not an upsert: the lock trigger checks
  // the INSERT before Postgres sees the duplicate, so an unlocked old day would be refused.
  const ensureClass = (ticks: ChecklistItem[]): Promise<BatchClass | null> => {
    if (ensuring.current) return ensuring.current
    const run = (async () => {
      if (!me) return null
      const now = new Date().toISOString()
      const write = async (existing: BatchClass | null) => existing
        ? supabase.from('batch_classes').update({ logged_at: now, logged_by: me.id }).eq('id', existing.id).select(BATCH_CLASS_COLUMNS)
        : supabase.from('batch_classes').insert({ company_id: me.companyId, batch_id: batchId, class_date: date, logged_at: now, logged_by: me.id }).select(BATCH_CLASS_COLUMNS)
      let res = await write(cls)
      if (res.error?.code === '23505') {
        // Someone saved this class a moment ago: use their row
        const again = await supabase.from('batch_classes').select(BATCH_CLASS_COLUMNS).eq('batch_id', batchId).eq('class_date', date).maybeSingle()
        res = await write((again.data as BatchClass | null) ?? null)
      }
      if (res.error || !res.data?.length) { showToast(saveErrorText(res.error), 'error'); return null }
      const c = res.data[0] as BatchClass
      setCls(c)
      const savedNow = c.id === cls?.id ? classActs : []
      const actRows = activityRowsToSave({ classId: c.id, companyId: me.companyId, items: ticks, saved: savedNow, now })
      if (actRows.length) {
        const ar = await supabase.from('batch_class_activities').upsert(actRows, { onConflict: 'class_id,activity_id' }).select(CLASS_ACTIVITY_COLUMNS)
        if (ar.error || !ar.data?.length) { showToast(saveErrorText(ar.error), 'error'); return c }
        setClassActs(ar.data as ClassActivity[])
      }
      return c
    })()
    ensuring.current = run
    run.finally(() => { ensuring.current = null })
    return run
  }

  const toggleActivity = async (item: ChecklistItem) => {
    if (!me || blocked || actBusy) return
    const flipped = items.map(i => (i.id === item.id ? { ...i, ticked: !i.ticked } : i))
    setActBusy(true)
    if (!logged || !cls) {
      // First tap on a new class: save the class with the ticks as they are now
      await ensureClass(flipped)
      setActBusy(false)
      return
    }
    const row: ClassActivity = {
      company_id: me.companyId, class_id: cls.id, activity_id: item.id, activity_name: item.name,
      removed_at: item.ticked ? new Date().toISOString() : null,
    }
    const before = classActs
    setClassActs(l => [...l.filter(r => r.activity_id !== item.id), row])
    const { data, error } = await supabase.from('batch_class_activities')
      .upsert(row, { onConflict: 'class_id,activity_id' }).select(CLASS_ACTIVITY_COLUMNS)
    setActBusy(false)
    if (error || !data?.length) { setClassActs(before); showToast(saveErrorText(error), 'error'); return }
    setClassActs(l => [...l.filter(r => r.activity_id !== item.id), data[0] as ClassActivity])
  }

  // Owner only: open an old day for changes, or close it again (the database refuses anyone else)
  const setUnlocked = async (open: boolean) => {
    if (!me || lockBusy) return
    setLockBusy(true)
    const now = new Date().toISOString()
    const res = cls
      ? await supabase.from('batch_classes').update({ unlocked_at: open ? now : null, unlocked_by: open ? me.id : null }).eq('id', cls.id).select(BATCH_CLASS_COLUMNS)
      : await supabase.from('batch_classes').insert({ company_id: me.companyId, batch_id: batchId, class_date: date, unlocked_at: now, unlocked_by: me.id, logged_by: me.id }).select(BATCH_CLASS_COLUMNS)
    setLockBusy(false)
    if (res.error || !res.data?.length) { showToast(saveErrorText(res.error), 'error'); return }
    setCls(res.data[0] as BatchClass)
    showToast(open ? 'Unlocked: changes allowed' : 'Locked again')
  }

  const goDate = (d: string) => router.replace(`/company/attendance/${batchId}${d === today ? '' : `?date=${d}`}`)
  const back = () => router.push(me?.role === 'coach' ? '/coach' : '/company')

  const dropInChoices = students
    .filter(s => s.batch_id !== batchId && !presentIds.has(s.id))
    .filter(s => !query.trim() || s.full_name.toLowerCase().includes(query.trim().toLowerCase()))
    .slice(0, 30)

  const notClassDay = batch && !sortDays(batch.days).includes(weekdayOf(date) as never)

  const studentButton = (s: Student, present: boolean, dropIn = false) => {
    const also = elsewhereLine(s)
    const leave = !present && !dropIn ? leaveOf(s) : null
    const attends = !dropIn && batch ? attendsLabel(s.available_days, batch.days) : ''
    const offDay = attends && batch && !expectedDays(s.available_days, batch.days).includes(weekdayOf(date) as never)
    // Leave button: home students not marked present, on an open day, once the table exists
    const leaveButton = leaves !== null && !dropIn && !present && !blocked
    return (
    <li key={s.id} data-testid="roll-row" data-name={s.full_name} className="flex items-stretch gap-2">
      <button type="button" onClick={() => askOrTap(s)} aria-pressed={present} disabled={busy.has(s.id) || blocked || !!leave}
        className={`flex-1 min-w-0 flex items-center gap-3 rounded-xl px-4 py-3 border text-left transition min-h-[52px] ${present
          ? 'bg-green-950/50 border-green-800 text-white' : leave ? 'bg-gray-900/60 border-gray-800 text-gray-500'
          : 'bg-gray-900 border-gray-800 text-gray-300 hover:border-gray-600'} ${leave ? 'disabled:opacity-100' : 'disabled:opacity-60'}`}>
        <span className={`w-6 h-6 rounded-full flex items-center justify-center text-sm shrink-0 ${present ? 'bg-green-500 text-white' : 'border border-gray-600'}`}>
          {present ? '✓' : ''}
        </span>
        <span className="flex-1 min-w-0">
          <span className="flex items-center gap-1.5 min-w-0">
            <span className="truncate text-sm font-medium">{s.full_name}</span>
            <BeltChip rank={beltById[s.current_rank_id || '']} />
          </span>
          {leave && <span data-testid="on-leave" className="block text-[11px] text-gray-400 truncate">{leaveText(leave, date, country)}{leave.note ? ` · ${leave.note}` : ''}</span>}
          {attends && <span className="block text-[11px] text-gray-500 truncate">{attends}{offDay ? ' · not their day' : ''}</span>}
          {also && <span className="block text-[11px] text-amber-300 truncate">⚠ {present ? 'Also came today' : 'Already came today'} · {also}</span>}
        </span>
        {dropIn && <span className="text-[11px] text-sky-300 border border-sky-900 bg-sky-950/60 px-1.5 py-0.5 rounded">Drop-in</span>}
      </button>
      {leaveButton && (leave ? (
        <button type="button" onClick={() => cancelLeave(s, leave)} disabled={busy.has(s.id)}
          className="shrink-0 px-3 rounded-xl border border-gray-700 text-xs text-gray-300 hover:border-gray-500 disabled:opacity-50">Cancel leave</button>
      ) : (
        <button type="button" onClick={() => openLeave(s)} disabled={busy.has(s.id)}
          className="shrink-0 px-3 rounded-xl border border-gray-800 text-xs text-gray-400 hover:border-gray-600 hover:text-gray-200 disabled:opacity-50">On leave</button>
      ))}
    </li>
    )
  }

  // ── Leave ─────────────────────────────────────────────────────────────────────────────────────────────────
  const leaveOf = (s: Student) => (leaves ? leaveOn(leaves, s.id, date) : null)
  const openLeave = (s: Student) => { setLeaveFor(s); setLeaveTo(date); setLeaveNote(''); setLeaveError('') }

  const saveLeave = async () => {
    if (!me || !leaveFor || leaveSaving) return
    const problem = leaveProblem({ from: date, to: leaveTo, note: leaveNote })
    if (problem) { setLeaveError(problem); return }
    setLeaveSaving(true)
    const { data, error } = await supabase.from('student_leaves')
      .insert(leaveRow({ companyId: me.companyId, profileId: leaveFor.id, from: date, to: leaveTo, note: leaveNote, markedBy: me.id }))
      .select(LEAVE_COLUMNS)
    setLeaveSaving(false)
    if (error || !data?.length) { setLeaveError(saveErrorText(error)); return }
    const row = data[0] as StudentLeave
    setLeaves(l => [...(l || []), row])
    showToast(`${leaveFor.full_name.split(/\s+/)[0]}: ${leaveText(row, date, country).toLowerCase()}`)
    setLeaveFor(null)
  }

  const cancelLeave = async (s: Student, leave: StudentLeave) => {
    if (!me || busy.has(s.id)) return
    setBusy(b => new Set(b).add(s.id))
    const { data, error } = await supabase.from('student_leaves')
      .update({ cancelled_at: new Date().toISOString(), cancelled_by: me.id }).eq('id', leave.id).select(LEAVE_COLUMNS)
    setBusy(b => { const n = new Set(b); n.delete(s.id); return n })
    if (error || !data?.length) { showToast(saveErrorText(error), 'error'); return }
    setLeaves(l => (l || []).filter(x => x.id !== leave.id))
    showToast(`Leave cancelled for ${s.full_name.split(/\s+/)[0]}`)
  }

  const olderLockBanner = () => {
    if (!locked && !lockMove) return null
    return (
      <div data-testid="lock-banner" className={`flex items-center gap-3 rounded-xl px-3 py-2.5 border text-xs ${locked
        ? 'bg-gray-900 border-gray-700 text-gray-300' : 'bg-amber-950/40 border-amber-900 text-amber-200'}`}>
        <span className="flex-1">
          {locked
            ? <>🔒 Locked — older than {LOCK_DAYS} days.{lockMove ? '' : ' Ask the owner to unlock it.'}</>
            : <>Unlocked by the owner: changes allowed for this day.</>}
        </span>
        {lockMove && (
          <button type="button" onClick={() => setUnlocked(lockMove === 'unlock')} disabled={lockBusy}
            className="shrink-0 text-xs font-semibold border border-gray-600 hover:border-gray-400 px-3 py-1.5 rounded-lg disabled:opacity-50">
            {lockMove === 'unlock' ? 'Unlock' : 'Lock again'}
          </button>
        )}
      </div>
    )
  }

  const activityCard = () => {
    const canSetUp = me && (me.role === 'company_admin' || me.role === 'partner')
    if (!items.length) {
      return canSetUp ? (
        <button type="button" data-nav onClick={() => router.push('/company/activities')}
          className="w-full text-xs text-gray-400 hover:text-white border border-dashed border-gray-700 rounded-xl py-2.5">
          Set up class activities →
        </button>
      ) : null
    }
    return (
      <section data-testid="class-activities" className="bg-gray-900 border border-gray-800 rounded-2xl p-3 space-y-2">
        <div className="flex items-baseline justify-between gap-2 px-1">
          <p className="text-sm font-semibold">Activities</p>
          <p className="text-[11px] text-gray-500">{logged ? `${ticksSummary(items)} · saved` : 'Saved with the first ' + mw.one.toLowerCase() + ' you mark'}</p>
        </div>
        {/* Grouped by category (yoga: Asana, Pranayama…); a list without categories is one flat list, as before */}
        {groupByCategory(items).map(g => {
          const chips = (
            <ul key={g.category ?? '-'} className="flex flex-wrap gap-1.5">
              {g.items.map(i => (
                <li key={i.id}>
                  <button type="button" role="checkbox" aria-checked={i.ticked} aria-label={i.name} title={i.description || undefined}
                    onClick={() => toggleActivity(i)} disabled={blocked || actBusy}
                    className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs border transition min-h-[36px] ${i.ticked
                      ? 'bg-orange-500/20 border-orange-600 text-orange-100' : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-500'} disabled:opacity-60`}>
                    <span aria-hidden="true">{i.ticked ? '✓' : '+'}</span>{i.name}
                  </button>
                </li>
              ))}
            </ul>
          )
          return g.category === null && items.every(i => !i.category) ? chips : (
            <div key={g.category ?? '-'} className="space-y-1" data-testid="activity-group">
              <p className="text-[11px] text-gray-500 uppercase tracking-wider px-1">{g.category ?? 'Other'}</p>
              {chips}
            </div>
          )
        })}
      </section>
    )
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white pb-10">
      <PageNav />
      {toast && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center px-6 pointer-events-none">
          <div role="status" className={`min-w-[280px] max-w-sm text-center px-10 py-6 rounded-2xl text-lg font-semibold shadow-2xl ${toast.kind === 'success' ? 'bg-green-600' : 'bg-red-600'}`}>{toast.text}</div>
        </div>
      )}

      {confirmFor && (
        <div className="fixed inset-0 z-[55] bg-black/70 flex items-end sm:items-center justify-center p-4" onClick={() => setConfirmFor(null)}>
          <div role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}
            className="w-full max-w-sm bg-gray-900 border border-gray-700 rounded-2xl p-5 space-y-3">
            <p className="text-base font-semibold">{confirmFor.full_name} already came today</p>
            <p className="text-sm text-amber-300">{elsewhereLine(confirmFor)}</p>
            <p className="text-sm text-gray-400">Mark them present in {batch?.name || 'this batch'} as well? Fine for a second class (exams, extra practice).</p>
            <div className="flex gap-2 pt-1">
              <button type="button" onClick={() => setConfirmFor(null)}
                className="flex-1 py-2.5 rounded-xl border border-gray-700 text-gray-300 hover:border-gray-500 text-sm">Cancel</button>
              <button type="button" onClick={() => { const s = confirmFor; setConfirmFor(null); tap(s) }}
                className="flex-1 py-2.5 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-semibold text-sm">Mark present too</button>
            </div>
          </div>
        </div>
      )}

      {leaveFor && (
        <div className="fixed inset-0 z-[55] bg-black/70 flex items-end sm:items-center justify-center p-4" onClick={() => setLeaveFor(null)}>
          <div role="dialog" aria-modal="true" aria-label="On leave" onClick={e => e.stopPropagation()}
            className="w-full max-w-sm bg-gray-900 border border-gray-700 rounded-2xl p-5 space-y-3">
            <p className="text-base font-semibold">{leaveFor.full_name} is on leave</p>
            <p className="text-xs text-gray-400">From {formatDate(date, country, 'weekday')}. They won&apos;t count as absent while on leave.</p>
            <label className="block text-xs text-gray-400">Until when?
              <input type="date" value={leaveTo} min={date} onChange={e => setLeaveTo(e.target.value)} aria-label="Until when"
                className="mt-1 w-full bg-gray-800 text-white rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm" />
            </label>
            <input value={leaveNote} maxLength={LEAVE_NOTE_MAX} onChange={e => setLeaveNote(e.target.value)} placeholder="Note (optional, e.g. exams, travelling)" aria-label="Leave note"
              className="w-full bg-gray-800 text-white rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm placeholder-gray-500" />
            {leaveError && <p className="text-xs text-red-400">{leaveError}</p>}
            <div className="flex gap-2 pt-1">
              <button type="button" onClick={() => setLeaveFor(null)}
                className="flex-1 py-2.5 rounded-xl border border-gray-700 text-gray-300 hover:border-gray-500 text-sm">Cancel</button>
              <button type="button" onClick={saveLeave} disabled={leaveSaving}
                className="flex-1 py-2.5 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-semibold text-sm disabled:opacity-50">{leaveSaving ? 'Saving…' : 'Save leave'}</button>
            </div>
          </div>
        </div>
      )}

      <div className="bg-gray-900 border-b border-gray-800 px-4 py-4 sticky top-0 z-30">
        <div className="max-w-2xl mx-auto">
          <div className="flex items-center gap-3">
            <button data-nav onClick={back}
              className="text-xs text-gray-400 hover:text-white border border-gray-700 hover:border-gray-500 px-3 py-1.5 rounded-lg shrink-0">← Back</button>
            <div className="min-w-0 flex-1">
              <h1 className="text-lg font-bold truncate">{batch?.name || 'Class'}</h1>
              <p className="text-xs text-gray-500 truncate">{[branch?.name, batch ? batchWhen(batch, country) : ''].filter(Boolean).join(' · ')}</p>
            </div>
            {!loading && !problem && <p className="text-sm shrink-0"><span data-testid="came-count" className="text-green-400 font-bold text-lg">{list.came}</span> <span className="text-gray-500">came</span></p>}
          </div>
          <div className="flex items-center justify-between mt-3">
            <button type="button" onClick={() => goDate(addDays(date, -1))} aria-label="Previous day"
              className="w-10 h-10 rounded-lg border border-gray-700 text-gray-300 hover:border-gray-500">‹</button>
            <p className="text-sm font-medium">{date === today ? 'Today · ' : ''}{formatDate(date, country, 'weekday')}</p>
            <button type="button" onClick={() => goDate(addDays(date, 1))} disabled={date >= today} aria-label="Next day"
              className="w-10 h-10 rounded-lg border border-gray-700 text-gray-300 hover:border-gray-500 disabled:opacity-30">›</button>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-4 space-y-4">
        {loading ? (
          <div className="h-32 rounded-2xl bg-gray-900 border border-gray-800 animate-pulse" aria-label="Loading" />
        ) : problem ? (
          <p className="bg-gray-900 border border-gray-800 rounded-2xl p-5 text-sm text-gray-400">{problem}</p>
        ) : (
          <>
            {holiday && (
              <p data-testid="holiday-banner" className="text-sm text-amber-200 bg-amber-950/50 border border-amber-800 rounded-xl px-3 py-2.5">
                🏖 {noClassesText(holiday)}. Nothing is saved for this day.
              </p>
            )}
            {activities !== null && !holiday && olderLockBanner()}
            {activities !== null && activityCard()}
            {notClassDay && <p className="text-xs text-amber-300 bg-amber-950/40 border border-amber-900 rounded-xl px-3 py-2">This batch doesn&apos;t usually meet on {weekdayOf(date)}. You can still mark an extra class.</p>}
            {!blocked && <p className="text-xs text-gray-500">Tap each {mw.one.toLowerCase()} who came. Tap again to undo. Not tapped = absent.</p>}

            {list.home.length === 0 ? (
              <p className="bg-gray-900 border border-gray-800 rounded-2xl p-5 text-sm text-gray-400">
                No {mw.many.toLowerCase()} have this as their home batch yet. Set it on Add {mw.one} or their Profile tab, or add drop-ins below.
              </p>
            ) : (
              <ul className="space-y-2">{list.home.map(h => studentButton(h.student, h.present))}</ul>
            )}

            {list.dropIns.length > 0 && (
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Drop-ins</p>
                <ul className="space-y-2">{list.dropIns.map(s => studentButton(s, true, true))}</ul>
              </div>
            )}

            {blocked ? null : showDropIn ? (
              <div className="bg-gray-900 border border-gray-800 rounded-2xl p-3 space-y-2">
                <input type="search" autoFocus value={query} onChange={e => setQuery(e.target.value)}
                  placeholder={`Find a ${mw.one.toLowerCase()} from another batch`}
                  className="w-full bg-gray-800 text-white rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm placeholder-gray-500" />
                {dropInChoices.length === 0 ? <p className="text-sm text-gray-500 px-1">No match.</p> : (
                  <ul className="max-h-72 overflow-y-auto divide-y divide-gray-800">
                    {dropInChoices.map(s => (
                      <li key={s.id}>
                        <button type="button" onClick={() => { askOrTap(s); setQuery('') }} className="w-full text-left px-2 py-2.5 text-sm text-gray-200 hover:bg-gray-800 rounded-lg">
                          + {s.full_name}
                          {elsewhereLine(s) && <span className="block text-[11px] text-amber-300 truncate pl-3">⚠ Already came today · {elsewhereLine(s)}</span>}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <button type="button" onClick={() => { setShowDropIn(false); setQuery('') }} className="text-xs text-gray-400 hover:text-white">Done</button>
              </div>
            ) : (
              <button type="button" onClick={() => setShowDropIn(true)}
                className="w-full text-sm text-sky-300 hover:text-sky-200 border border-dashed border-gray-700 hover:border-sky-800 rounded-xl py-2.5">
                + Drop-in from another batch
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}

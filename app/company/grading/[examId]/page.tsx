'use client'

// One grading exam (Phase 2, PR B): details (Edit / Cancel exam) and the students who sit it.
// Every active student with a belt is listed; to_rank = the next active belt (lib/belts.ts nextBelt, no skipping).
// Eligible = days on the current belt by the EXAM date ≥ the next belt's months × 30 (no override); belt date missing =
// eligible with a warning; not eligible: greyed with "N mo to go"; no belt: "Set the belt on their profile first";
// top belt: "Highest belt". Attendance is shown for information only (no rule yet, decision 11 Nov).
// Tick saves a grading_exam_candidates row; untick sets removed_at (never erased). A student can be on one scheduled
// exam at a time and a completed / cancelled exam is locked (both also enforced by the database trigger,
// supabase/migrations/20261111120000_belt_grading_phase2.sql). Senseis see everything read-only.
// PR C, three steps for a scheduled exam: Pick · Notices (WhatsApp to the parent, sets notice_sent_at) · Exam day
// (Fee paid tick + Pass / Fail, saved as tapped; nothing changes on the students yet) → Save results =
// rpc save_grading_results (all-or-nothing: pass = next belt + 'exam' history row, exam completed; safe twice).
// Completed: each student's new belt / "stays", Tell parent (result_sent_at), Undo results (rpc undo_grading_results).
// Cancelled: Tell parent: cancelled for those who had the notice (cancel_sent_at).

import PageNav from '@/app/page-nav'
import { rememberBranch, rememberedBranch } from '@/lib/branch-memory'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { type Country, normalizeCountry, formatDate, localDateIso } from '@/lib/locale'
import { formatMoney } from '@/lib/currency'
import { memberWord } from '@/lib/labels'
import { type Branch, type Batch, BRANCH_COLUMNS, BATCH_COLUMNS, timeLabel, sortBatches } from '@/lib/batches'
import { addDays } from '@/lib/attendance'
import {
  type BeltRank, type GradingExam, type ExamCandidate, BELT_RANK_COLUMNS, GRADING_EXAM_COLUMNS, beltFee, feeSummary,
  gradingOn, beltsById, eligibility, notEligibleText, examStatusLabel, examDetailsChanged, attendanceShare, beltLabel,
  gradingRecipient, gradingNoticeText, gradingResultText, gradingCancelText, waLink, resultsReady, gradingRpcMessage,
} from '@/lib/belts'
import BeltChip from '@/app/belt-chip'
import { type ExamDraft, ExamForm, venueOptions, examFields, OTHER_VENUE, feeBelts, beltFeesDraft } from '../exam-form'

type Student = {
  id: string; full_name: string; current_rank_id: string | null; rank_achieved_on: string | null
  branch_id: string | null; batch_id: string | null; created_at: string; archived_at: string | null
  phone: string | null; guardian_name: string | null; guardian_phone: string | null
}
const STUDENT_COLUMNS = 'id, full_name, current_rank_id, rank_achieved_on, branch_id, batch_id, created_at, archived_at, phone, guardian_name, guardian_phone'
type Step = 'pick' | 'notices' | 'day'
// Candidates are read with * so columns added later (Phase 2 SQL) are picked up without breaking older databases
const CAND = '*'

export default function GradingExamPage() {
  const router = useRouter()
  const { examId } = useParams<{ examId: string }>()
  const today = localDateIso()
  const [loading, setLoading] = useState(true)
  const [problem, setProblem] = useState('')
  const [companyId, setCompanyId] = useState('')
  const [country, setCountry] = useState<Country>('IN')
  const [currency, setCurrency] = useState('INR')
  const [businessType, setBusinessType] = useState<string | null>(null)
  const [canEdit, setCanEdit] = useState(false)
  const [gymName, setGymName] = useState('')
  const [upiId, setUpiId] = useState('')
  const [step, setStep] = useState<Step | null>(null)   // null = pick the right one for the exam once it loads
  const [reloadKey, setReloadKey] = useState(0)        // bump after Save / Undo results: read everything again
  const [working, setWorking] = useState(false)
  const [exam, setExam] = useState<GradingExam | null>(null)
  const [ranks, setRanks] = useState<BeltRank[]>([])
  const [students, setStudents] = useState<Student[]>([])
  const [candidates, setCandidates] = useState<ExamCandidate[]>([])
  // Students already on ANOTHER scheduled exam: student id → that exam's date
  const [elsewhere, setElsewhere] = useState<Record<string, string>>({})
  const [branches, setBranches] = useState<Branch[]>([])
  const [batches, setBatches] = useState<Batch[]>([])
  // Attendance (information only): present days per student, and the gym's first attendance day. null = not set up
  const [present, setPresent] = useState<Record<string, string[]> | null>(null)
  const [firstAttendance, setFirstAttendance] = useState<string | null>(null)
  const [branchFilter, setBranchFilter] = useState('all')
  const [batchFilter, setBatchFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState<Set<string>>(new Set())

  const [draft, setDraft] = useState<ExamDraft | null>(null)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [toast, setToast] = useState<{ text: string; kind: 'success' | 'error' } | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const showToast = (text: string, kind: 'success' | 'error' = 'success') => {
    if (toastTimer.current) clearTimeout(toastTimer.current)
    setToast({ text, kind })
    toastTimer.current = setTimeout(() => setToast(null), 2800)
  }
  const mw = memberWord(businessType)

  useEffect(() => {
    let live = true
    ;(async () => {
      const { data: { session } } = await supabase.auth.getSession()
      const user = session?.user
      if (!user) { router.push('/login'); return }
      const { data: profile } = await supabase.from('profiles')
        .select('role, company_id, companies:company_id(*)').eq('id', user.id).single()
      if (!profile?.company_id) { router.push('/login'); return }
      const co = (profile as unknown as { companies: { name?: string | null; upi_id?: string | null; country?: string | null; currency?: string | null; business_type?: string | null; grading_enabled?: boolean | null } | null }).companies
      setGymName(co?.name || '')
      setUpiId(co?.upi_id || '')
      const cId = profile.company_id as string
      setCompanyId(cId)
      setCountry(normalizeCountry(co?.country))
      setCurrency(co?.currency || 'INR')
      setBusinessType(co?.business_type ?? null)
      setCanEdit(profile.role === 'company_admin' || profile.role === 'partner')
      if (!gradingOn(co)) { setProblem("Belt grading isn't switched on for this account."); setLoading(false); return }

      const { data: ex, error: exError } = await supabase.from('grading_exams').select(GRADING_EXAM_COLUMNS)
        .eq('id', examId).eq('company_id', cId).maybeSingle()
      if (!live) return
      if (exError || !ex) { setProblem('This exam was not found.'); setLoading(false); return }
      const e = ex as GradingExam
      const [rk, st, cand, others, br, ba, att, firstAtt] = await Promise.all([
        supabase.from('belt_ranks').select(BELT_RANK_COLUMNS).eq('company_id', cId),
        // Database rules give a sensei the gym's PT students (every dojo student); owners all clients
        supabase.from('profiles').select(STUDENT_COLUMNS).eq('company_id', cId).eq('role', 'client')
          .is('archived_at', null).order('full_name'),
        supabase.from('grading_exam_candidates').select(CAND).eq('exam_id', e.id),
        // Other scheduled exams' lists: one exam per student at a time
        supabase.from('grading_exam_candidates').select('student_id, removed_at, grading_exams!inner(id, exam_date, status)')
          .eq('company_id', cId).neq('exam_id', e.id).is('removed_at', null).eq('grading_exams.status', 'scheduled'),
        supabase.from('branches').select(BRANCH_COLUMNS).eq('company_id', cId),
        supabase.from('batches').select(BATCH_COLUMNS).eq('company_id', cId),
        // Attendance for the last 13 months up to the exam (one read for everyone, not per student)
        supabase.from('attendance').select('profile_id, class_date').eq('company_id', cId).eq('present', true)
          .gte('class_date', addDays(e.exam_date, -400)).lte('class_date', e.exam_date).limit(20000),
        supabase.from('attendance').select('class_date').eq('company_id', cId).eq('present', true)
          .order('class_date').limit(1),
      ])
      if (!live) return
      if (rk.error || cand.error || st.error) {
        console.error('Grading exam load error:', rk.error || cand.error || st.error)
        setProblem("Couldn't load this exam. Refresh the page to try again.")
        setLoading(false); return
      }
      let people = (st.data || []) as Student[]
      // Picked students archived since: still listed (read their rows by id)
      const missing = ((cand.data || []) as ExamCandidate[]).map(c => c.student_id).filter(id => !people.some(p => p.id === id))
      if (missing.length) {
        const extra = await supabase.from('profiles').select(STUDENT_COLUMNS).in('id', missing)
        people = [...people, ...((extra.data || []) as Student[])]
      }
      setExam(e)
      // First step shown: Exam day once the date has come (or results), else Pick
      // (only when someone is already picked: an empty list stays on Pick while you tick)
      const anyPicked = ((cand.data || []) as ExamCandidate[]).some(c => !c.removed_at)
      setStep(s => s ?? (e.exam_date <= localDateIso() && anyPicked ? 'day' : 'pick'))
      setRanks((rk.data || []) as BeltRank[])
      setStudents(people)
      setCandidates((cand.data || []) as ExamCandidate[])
      if (others.error) console.error('Other exams error:', others.error)
      setElsewhere(Object.fromEntries(((others.data || []) as unknown as { student_id: string; grading_exams: { exam_date: string } | null }[])
        .map(o => [o.student_id, o.grading_exams?.exam_date || ''])))
      setBranches(br.error ? [] : (br.data || []) as Branch[])
      if (!br.error) setBranchFilter(rememberedBranch((br.data || []) as Branch[]))   // last chip picked on this phone
      setBatches(ba.error ? [] : (ba.data || []) as Batch[])
      if (!att.error) {
        const map: Record<string, string[]> = {}
        for (const r of (att.data || []) as { profile_id: string; class_date: string }[]) (map[r.profile_id] ||= []).push(r.class_date)
        setPresent(map)
        setFirstAttendance(((firstAtt.data || [])[0] as { class_date?: string } | undefined)?.class_date ?? null)
      }
      setLoading(false)
    })()
    return () => { live = false }
  }, [examId, router, reloadKey])

  const beltById = useMemo(() => beltsById(ranks), [ranks])
  const batchById = useMemo(() => Object.fromEntries(batches.map(b => [b.id, b])), [batches])
  const candidateFor = useMemo(() => Object.fromEntries(candidates.map(c => [c.student_id, c])), [candidates])
  const open = exam?.status === 'scheduled'
  // Fees per belt (grading_exams.belt_fees): the column comes with select('*') once its SQL ran
  const feeOn = !!exam && 'belt_fees' in exam
  const editable = canEdit && open

  type Row = {
    s: Student
    picked: ExamCandidate | null
    elig: ReturnType<typeof eligibility>
    why: string | null           // why they can't be ticked
    warn: string[]               // shown in amber, doesn't block
    attendance: string
  }

  const rows: Row[] = useMemo(() => {
    if (!exam) return []
    const until = exam.exam_date < today ? exam.exam_date : today
    return students.map(s => {
      const c = candidateFor[s.id]
      const picked = c && !c.removed_at ? c : null
      const elig = eligibility({ ranks, currentRankId: s.current_rank_id, achievedOn: s.rank_achieved_on, examDate: exam.exam_date })
      const warn: string[] = []
      let why = notEligibleText(elig)
      if (!why && elsewhere[s.id]) why = `On the ${formatDate(elsewhere[s.id], country, 'dayMonth')} exam`
      if (elig.kind === 'eligible' && elig.dateMissing) warn.push('Belt date missing')
      if (picked && s.current_rank_id !== picked.from_rank_id) warn.push('Belt changed since picked: untick and tick again')
      if (s.archived_at) warn.push('Archived')
      let attendance = ''
      if (present) {
        const home = s.batch_id ? batchById[s.batch_id] : null
        const a = attendanceShare({ attended: present[s.id] || [], homeDays: home?.days ?? null,
          from: [s.rank_achieved_on, s.created_at, firstAttendance], until })
        attendance = a.pct != null ? `Attendance ${a.pct}% (${a.attended} of ${a.scheduled})` : a.scheduled === null ? `${a.attended} classes · no home batch` : ''
      }
      return { s, picked, elig, why, warn, attendance }
    })
  }, [exam, students, candidateFor, ranks, elsewhere, present, firstAttendance, batchById, country, today])

  const filtered = rows.filter(r => {
    const branchOf = r.s.branch_id || (r.s.batch_id ? batchById[r.s.batch_id]?.branch_id : null)
    if (branchFilter !== 'all' && branchOf !== branchFilter) return false
    if (batchFilter !== 'all' && r.s.batch_id !== batchFilter) return false
    const q = search.trim().toLowerCase()
    return !q || r.s.full_name.toLowerCase().includes(q)
  })
  const pickedRows = filtered.filter(r => r.picked)
  const canSit = filtered.filter(r => !r.picked && !r.why)
  const notYet = filtered.filter(r => !r.picked && r.why)
  const pickedTotal = rows.filter(r => r.picked).length
  const activeBranches = branches.filter(b => !b.is_archived).sort((a, b) => a.name.localeCompare(b.name))
  const branchBatches = sortBatches(batches.filter(b => !b.is_archived && b.branch_id === branchFilter))

  const toggle = async (r: Row) => {
    if (!exam || !editable || busy.has(r.s.id)) return
    const existing = candidateFor[r.s.id]
    setBusy(b => new Set(b).add(r.s.id))
    let res
    if (r.picked) {
      res = await supabase.from('grading_exam_candidates').update({ removed_at: new Date().toISOString() })
        .eq('id', r.picked.id).select(CAND)
    } else if (r.elig.kind === 'eligible' && !r.why) {
      const fields = { removed_at: null, from_rank_id: r.elig.from.id, to_rank_id: r.elig.to.id }
      res = existing
        ? await supabase.from('grading_exam_candidates').update(fields).eq('id', existing.id).select(CAND)
        : await supabase.from('grading_exam_candidates').insert({ ...fields, company_id: companyId, exam_id: exam.id, student_id: r.s.id })
          .select(CAND)
    }
    setBusy(b => { const n = new Set(b); n.delete(r.s.id); return n })
    if (!res) return
    if (res.error || !res.data?.length) {
      showToast(res.error ? "Couldn't save: " + res.error.message : "Couldn't save: not allowed for this login", 'error')
      return
    }
    const row = res.data[0] as ExamCandidate
    setCandidates(l => (l.some(c => c.id === row.id) ? l.map(c => (c.id === row.id ? row : c)) : [...l, row]))
  }

  const startEdit = (openFees = false) => {
    if (!exam) return
    const venues = venueOptions(branches)
    const inList = !!exam.venue && venues.includes(exam.venue)
    setFormError('')
    setDraft({
      exam_date: exam.exam_date, exam_time: (exam.exam_time || '').slice(0, 5),
      venue: inList ? exam.venue as string : OTHER_VENUE, venueOther: inList ? '' : exam.venue || '',
      fee: exam.fee_amount != null ? String(exam.fee_amount) : '', notes: exam.notes || '',
      beltFees: beltFeesDraft(exam.belt_fees), beltFeesOpen: openFees || (!!exam.belt_fees && Object.keys(exam.belt_fees).length > 0),
    })
  }

  const saveEdit = async () => {
    if (!exam || !draft) return
    const fields = examFields(draft, feeOn)
    if (typeof fields === 'string') { setFormError(fields); return }
    setSaving(true)
    setFormError('')
    const { data, error } = await supabase.from('grading_exams').update(fields).eq('id', exam.id).select(GRADING_EXAM_COLUMNS)
    if (error || !data?.length) {
      setSaving(false)
      setFormError(error ? "Couldn't save: " + error.message : "Couldn't save: not allowed for this login"); return
    }
    const updated = data[0] as GradingExam
    // New date / time / venue: the parents need the new details, so "Sent ✓" is cleared (decision 10)
    let resent = false
    if (examDetailsChanged(exam, updated) && candidates.some(c => c.notice_sent_at && !c.removed_at)) {
      const r = await supabase.from('grading_exam_candidates').update({ notice_sent_at: null })
        .eq('exam_id', exam.id).not('notice_sent_at', 'is', null).select(CAND)
      if (!r.error) {
        const changed = (r.data || []) as ExamCandidate[]
        setCandidates(l => l.map(c => changed.find(x => x.id === c.id) ?? c))
        resent = true
      }
    }
    setSaving(false)
    setExam(updated)
    setDraft(null)
    showToast(resent ? 'Saved ✓ Send the notices again' : 'Saved ✓')
  }

  const cancelExam = async () => {
    if (!exam || !editable) return
    if (!confirm(`Cancel the ${formatDate(exam.exam_date, country, 'medium')} exam? It stays in the list as cancelled.`)) return
    const { data, error } = await supabase.from('grading_exams').update({ status: 'cancelled' }).eq('id', exam.id).select(GRADING_EXAM_COLUMNS)
    if (error || !data?.length) { showToast(error ? "Couldn't cancel: " + error.message : "Couldn't cancel: not allowed for this login", 'error'); return }
    setExam(data[0] as GradingExam)
    showToast('Exam cancelled')
  }

  // ── PR C actions ─────────────────────────────────────────────────────────────────────────────────
  const updateCandidate = async (c: ExamCandidate, fields: Record<string, unknown>) => {
    const { data, error } = await supabase.from('grading_exam_candidates').update(fields).eq('id', c.id).select(CAND)
    if (error || !data?.length) {
      showToast(error ? "Couldn't save: " + error.message : "Couldn't save: not allowed for this login", 'error')
      return false
    }
    const row = data[0] as ExamCandidate
    setCandidates(l => l.map(x => (x.id === row.id ? row : x)))
    return true
  }
  // Opening WhatsApp counts as sent (the link opens in a new tab; this page keeps the tick)
  const markSent = (c: ExamCandidate, field: 'notice_sent_at' | 'result_sent_at' | 'cancel_sent_at') => {
    if (canEdit) void updateCandidate(c, { [field]: new Date().toISOString() })
  }
  const setResult = (c: ExamCandidate, result: 'pass' | 'fail') => {
    if (!editable) return
    void updateCandidate(c, { result: c.result === result ? null : result })   // tap again = not marked
  }
  const setFeePaid = (c: ExamCandidate) => { if (canEdit) void updateCandidate(c, { fee_paid: !c.fee_paid }) }

  const saveResults = async () => {
    if (!exam || !editable || working) return
    if (!confirm(`Save the results? Passing ${mw.many.toLowerCase()} move up one belt now.`)) return
    setWorking(true)
    const { data, error } = await supabase.rpc('save_grading_results', { p_exam_id: exam.id })
    setWorking(false)
    if (error) { showToast("Couldn't save: " + error.message, 'error'); return }
    const res = data as Parameters<typeof gradingRpcMessage>[0]
    showToast(gradingRpcMessage(res), res?.ok ? 'success' : 'error')
    if (res?.ok) setReloadKey(k => k + 1)
  }
  const undoResults = async () => {
    if (!exam || !canEdit || exam.status !== 'completed' || working) return
    if (!confirm('Undo the results? Passing students go back to their old belt and the exam opens again.')) return
    setWorking(true)
    const { data, error } = await supabase.rpc('undo_grading_results', { p_exam_id: exam.id })
    setWorking(false)
    if (error) { showToast("Couldn't undo: " + error.message, 'error'); return }
    const res = data as Parameters<typeof gradingRpcMessage>[0]
    showToast(gradingRpcMessage(res), res?.ok ? 'success' : 'error')
    if (res?.ok) { setStep('day'); setReloadKey(k => k + 1) }
  }

  // A WhatsApp button that marks the row as sent; no WhatsApp number → a note
  const waButton = (r: Row, text: string, sentAt: string | null | undefined, field: 'notice_sent_at' | 'result_sent_at' | 'cancel_sent_at', label: string, testid: string) => {
    const to = gradingRecipient(r.s, country)
    const who = to.toParent ? `to ${to.greetName || 'parent'} (parent)` : `to ${to.greetName || mw.one.toLowerCase()}`
    if (!to.waDigits) return <span className="text-[11px] text-gray-500">No WhatsApp number</span>
    return (
      <span className="flex items-center gap-2 shrink-0">
        {sentAt && <span className="text-[11px] text-green-400" data-testid={`${testid}-sent`}>Sent ✓</span>}
        {canEdit && (
          <a href={waLink(to.waDigits, text)} target="_blank" rel="noopener noreferrer" data-testid={testid}
            onClick={() => r.picked && markSent(r.picked, field)} title={who}
            className={`text-xs px-3 py-1.5 rounded-lg font-medium ${sentAt ? 'text-gray-300 border border-gray-700' : 'bg-green-600 hover:bg-green-500 text-white'}`}>
            {sentAt ? 'Again' : label}
          </a>
        )}
      </span>
    )
  }

  const beltLine = (r: Row) => {
    const c = r.picked!
    const from = beltById[c.from_rank_id || '']
    const to = beltById[c.to_rank_id]
    return (
      <p className="text-[11px] text-gray-400 flex items-center gap-1 flex-wrap">
        <BeltChip rank={from} /> <span aria-hidden="true">→</span> <BeltChip rank={to} />
        {exam && (() => { const fee = beltFee(exam, c.to_rank_id); return fee ? <span className="text-gray-500"> · {formatMoney(fee, currency)}</span> : null })()}
      </p>
    )
  }

  // Notices step: one WhatsApp per student
  const noticeRow = (r: Row) => {
    const c = r.picked!
    const text = gradingNoticeText({ student: r.s, exam: exam!, from: beltById[c.from_rank_id || ''], to: beltById[c.to_rank_id] ?? { id: c.to_rank_id, belt_name: 'next belt', kyu: null },
      gymName, currency, country, upiId })
    return (
      <li key={r.s.id} data-testid="notice-row" data-name={r.s.full_name}
        className="flex items-center gap-3 rounded-xl px-3 py-2.5 border bg-gray-900 border-gray-800">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-white truncate">{r.s.full_name}</p>
          {beltLine(r)}
        </div>
        {waButton(r, text, c.notice_sent_at, 'notice_sent_at', 'Send', 'notice-send')}
      </li>
    )
  }

  // Exam day step: Fee paid + Pass / Fail, saved as tapped
  const dayRow = (r: Row) => {
    const c = r.picked!
    const fee = exam ? beltFee(exam, c.to_rank_id) : null
    const btn = (v: 'pass' | 'fail') => {
      const on = c.result === v
      const tone = v === 'pass' ? (on ? 'bg-green-600 text-white border-green-600' : 'text-green-300 border-gray-700') : (on ? 'bg-red-600 text-white border-red-600' : 'text-red-300 border-gray-700')
      return (
        <button type="button" aria-pressed={on} disabled={!editable} onClick={() => setResult(c, v)} data-testid={`result-${v}`}
          className={`text-xs px-3 py-2 rounded-lg border font-medium disabled:opacity-60 ${tone}`}>
          {v === 'pass' ? 'Pass' : 'Fail'}
        </button>
      )
    }
    return (
      <li key={r.s.id} data-testid="day-row" data-name={r.s.full_name}
        className={`rounded-xl px-3 py-2.5 border ${c.result === 'pass' ? 'bg-green-950/40 border-green-900' : c.result === 'fail' ? 'bg-red-950/30 border-red-900/60' : 'bg-gray-900 border-gray-800'}`}>
        <div className="flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-white truncate">{r.s.full_name}</p>
            {beltLine(r)}
          </div>
          <div className="flex gap-1.5 shrink-0">{btn('pass')}{btn('fail')}</div>
        </div>
        {fee != null && fee > 0 && (
          <label className="mt-2 flex items-center gap-2 text-xs text-gray-400 w-fit">
            <input type="checkbox" checked={!!c.fee_paid} disabled={!canEdit} onChange={() => setFeePaid(c)} aria-label={`${r.s.full_name} fee paid`}
              className="w-4 h-4 accent-green-500" />
            Fee paid ({formatMoney(fee, currency)})
          </label>
        )}
      </li>
    )
  }

  // Completed: the new belt or "stays", Tell parent
  const resultRow = (r: Row) => {
    const c = r.picked!
    const from = beltById[c.from_rank_id || '']
    const to = beltById[c.to_rank_id]
    const pass = c.result === 'pass'
    const text = exam && to ? gradingResultText({ student: r.s, result: pass ? 'pass' : 'fail', examDate: exam.exam_date, from, to, gymName, country }) : ''
    return (
      <li key={r.s.id} data-testid="result-row" data-name={r.s.full_name}
        className={`flex items-center gap-3 rounded-xl px-3 py-2.5 border ${pass ? 'bg-green-950/40 border-green-900' : 'bg-gray-900 border-gray-800'}`}>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-white truncate">{r.s.full_name}</p>
          <p className="text-[11px] flex items-center gap-1 flex-wrap">
            {pass
              ? <><span className="text-green-400">Passed · now</span> <BeltChip rank={to} /> <span className="text-gray-300">{beltLabel(to)}</span></>
              : <span className="text-gray-400">Stays {beltLabel(from)}</span>}
            {!c.fee_paid && exam && (beltFee(exam, c.to_rank_id) || 0) > 0
              ? <span className="text-amber-300"> · fee not marked paid</span> : null}
          </p>
        </div>
        {text && waButton(r, text, c.result_sent_at, 'result_sent_at', 'Tell parent', 'result-send')}
      </li>
    )
  }

  // Cancelled: tell those who had the notice
  const cancelRow = (r: Row) => {
    const c = r.picked!
    const text = exam ? gradingCancelText({ student: r.s, examDate: exam.exam_date, gymName, country }) : ''
    return (
      <li key={r.s.id} data-testid="cancel-row" data-name={r.s.full_name}
        className="flex items-center gap-3 rounded-xl px-3 py-2.5 border bg-gray-900 border-gray-800">
        <p className="flex-1 min-w-0 text-sm font-medium text-white truncate">{r.s.full_name}</p>
        {waButton(r, text, c.cancel_sent_at, 'cancel_sent_at', 'Tell parent', 'cancel-send')}
      </li>
    )
  }

  const studentRow = (r: Row) => {
    const tickable = editable && (!!r.picked || !r.why)
    const from = r.picked ? beltById[r.picked.from_rank_id || ''] : r.elig.kind !== 'no-belt' ? r.elig.from : null
    const to = r.picked ? beltById[r.picked.to_rank_id] : r.elig.kind === 'eligible' || r.elig.kind === 'not-yet' ? r.elig.to : null
    return (
      <li key={r.s.id} data-testid="candidate-row" data-name={r.s.full_name}>
        <div className={`flex items-center gap-3 rounded-xl px-3 py-2.5 border ${r.picked ? 'bg-green-950/40 border-green-900' : 'bg-gray-900 border-gray-800'} ${!r.picked && r.why ? 'opacity-55' : ''}`}>
          {editable && (
            <button type="button" role="checkbox" aria-checked={!!r.picked} aria-label={`${r.s.full_name} sits the exam`}
              disabled={!tickable || busy.has(r.s.id)} onClick={() => toggle(r)}
              className={`w-7 h-7 shrink-0 rounded-md flex items-center justify-center text-sm ${r.picked ? 'bg-green-500 text-white' : 'border border-gray-600'} disabled:opacity-40`}>
              {r.picked ? '✓' : ''}
            </button>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-white truncate">{r.s.full_name}</p>
            <p className="text-[11px] text-gray-400 flex items-center gap-1 flex-wrap">
              {from ? <><BeltChip rank={from} />{to && <> <span aria-hidden="true">→</span> <BeltChip rank={to} /></>}</> : null}
              {r.why && !r.picked && <span className="text-gray-500">{from ? ' · ' : ''}{r.why}</span>}
            </p>
            {/* Fee for this student = the fee for the belt they go for (set on the exam) */}
            {r.picked && exam && (() => {
              const fee = beltFee(exam, r.picked.to_rank_id)
              return <span data-testid="candidate-fee" className="text-[11px] text-gray-400">{fee != null ? `Fee ${formatMoney(fee, currency)}` : 'No fee'}</span>
            })()}
            {(r.attendance || r.warn.length > 0) && (
              <p className="text-[11px] text-gray-500">
                {r.attendance}
                {r.warn.map(w => <span key={w} className="text-amber-300">{r.attendance || w !== r.warn[0] ? ' · ' : ''}⚠ {w}</span>)}
              </p>
            )}
          </div>
        </div>
      </li>
    )
  }

  const status = exam ? examStatusLabel(exam, today) : ''

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <PageNav />
      {toast && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center px-6 pointer-events-none">
          <div role="status"
            className={`min-w-[280px] max-w-sm text-center px-10 py-6 rounded-2xl text-lg font-semibold shadow-2xl ring-1 ring-black/20 ${toast.kind === 'success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'}`}>
            {toast.text}
          </div>
        </div>
      )}

      <div className="bg-gray-900 border-b border-gray-800 px-4 sm:px-8 py-4">
        <div className="flex items-center gap-3 min-w-0">
          <button data-nav onClick={() => router.push('/company/grading')}
            className="text-xs text-gray-400 hover:text-white border border-gray-700 hover:border-gray-500 px-3 py-1.5 rounded-lg transition shrink-0">
            ← Exams
          </button>
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-white truncate">
              {exam ? `Grading · ${formatDate(exam.exam_date, country, 'medium')}` : 'Grading exam'}
            </h1>
            {exam && <p className="text-xs text-gray-500">{status}</p>}
          </div>
        </div>
      </div>

      <div className="px-4 sm:px-8 py-5 max-w-3xl mx-auto space-y-4">
        {loading ? (
          <div className="h-24 rounded-2xl bg-gray-900 border border-gray-800 animate-pulse" aria-label="Loading" />
        ) : problem || !exam ? (
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 text-sm text-gray-400">{problem || 'This exam was not found.'}</div>
        ) : (
          <div data-testid="page-grading-exam" className="space-y-4">
            {draft ? (
              <ExamForm draft={draft} setDraft={setDraft} venues={venueOptions(branches)} currency={currency} saving={saving}
                belts={feeOn ? feeBelts(ranks) : null}
                error={formError} onSave={saveEdit} onCancel={() => setDraft(null)} saveText="Save changes" />
            ) : (
              <section className="bg-gray-900 border border-gray-800 rounded-2xl p-4 space-y-1.5">
                <p className="text-base font-semibold text-white">
                  {formatDate(exam.exam_date, country, 'medium')}{exam.exam_time ? ` · ${timeLabel(exam.exam_time, country)}` : ''}
                </p>
                {exam.venue && <p className="text-sm text-gray-300">{exam.venue}</p>}
                <p className="text-sm text-gray-400">Fee: {feeSummary(exam, ranks, n => formatMoney(n, currency))}</p>
                {exam.notes && <p className="text-sm text-gray-400 whitespace-pre-line">{exam.notes}</p>}
                {exam.status === 'cancelled' && <p className="text-sm text-gray-500">This exam was cancelled. Its list is kept as it was.</p>}
                {exam.status === 'completed' && <p className="text-sm text-green-400">Results saved. The list is locked.</p>}
                {editable && (
                  <div className="flex gap-2 pt-2">
                    <button type="button" onClick={() => startEdit()} data-testid="exam-edit"
                      className="text-xs text-gray-300 border border-gray-700 hover:border-gray-500 px-3 py-1.5 rounded-lg">Edit</button>
                    <button type="button" onClick={cancelExam} data-testid="exam-cancel"
                      className="text-xs text-gray-400 border border-gray-700 hover:border-red-700 hover:text-red-300 px-3 py-1.5 rounded-lg">Cancel exam</button>
                  </div>
                )}
              </section>
            )}

            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-white">
                {mw.many} sitting: <span data-testid="picked-count">{pickedTotal}</span>
                {pickedTotal > 0 && (() => {
                  const total = rows.filter(r => r.picked).reduce((t, r) => t + (beltFee(exam, r.picked!.to_rank_id) || 0), 0)
                  return total > 0 ? <span data-testid="fees-total" className="text-gray-400 font-normal"> · fees {formatMoney(total, currency)}</span> : null
                })()}
              </h2>
              {!canEdit && <span className="text-[11px] text-gray-500">View only</span>}
              {editable && feeOn && !draft && (
                <button type="button" onClick={() => startEdit(true)} data-testid="fees-edit" className="text-xs text-orange-400 hover:text-orange-300 shrink-0">Edit fees</button>
              )}
            </div>

            {/* Branch / batch chips (gyms with branches), like the dashboard */}
            {activeBranches.length > 1 && (
              <div className="flex gap-1.5 overflow-x-auto pb-1" role="group" aria-label="Branch">
                {[{ id: 'all', name: 'All' }, ...activeBranches].map(b => (
                  <button key={b.id} type="button" aria-pressed={branchFilter === b.id}
                    onClick={() => { setBranchFilter(b.id); setBatchFilter('all'); rememberBranch(b.id) }}
                    className={`shrink-0 px-3 py-1.5 rounded-full text-xs ${branchFilter === b.id ? 'bg-orange-500 text-white' : 'bg-gray-800 text-gray-400 border border-gray-700'}`}>
                    {b.name}
                  </button>
                ))}
              </div>
            )}
            {(activeBranches.length === 1 ? sortBatches(batches.filter(b => !b.is_archived)) : branchBatches).length > 1 && (
              <div className="flex gap-1.5 overflow-x-auto pb-1" role="group" aria-label="Batch">
                {[{ id: 'all', name: 'All batches' }, ...(activeBranches.length === 1 ? sortBatches(batches.filter(b => !b.is_archived)) : branchBatches)].map(b => (
                  <button key={b.id} type="button" aria-pressed={batchFilter === b.id} onClick={() => setBatchFilter(b.id)}
                    className={`shrink-0 px-3 py-1.5 rounded-full text-xs ${batchFilter === b.id ? 'bg-gray-200 text-gray-900' : 'bg-gray-800 text-gray-400 border border-gray-700'}`}>
                    {b.name}
                  </button>
                ))}
              </div>
            )}
            <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder={`Search ${mw.many.toLowerCase()}`}
              aria-label={`Search ${mw.many.toLowerCase()}`}
              className="w-full bg-gray-900 text-white rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-800 text-sm placeholder-gray-500" />

            {/* Scheduled: three steps. Completed: results. Cancelled: tell the parents who had the notice */}
            {open && pickedTotal > 0 && (() => {
              const live = candidates.filter(c => !c.removed_at)
              const tabs: [Step, string][] = [
                ['pick', `1 · Pick (${live.length})`],
                ['notices', `2 · Notices (${live.filter(c => c.notice_sent_at).length}/${live.length})`],
                ['day', `3 · Exam day (${live.filter(c => c.result).length}/${live.length})`],
              ]
              return (
                <div className="grid grid-cols-3 gap-1 bg-gray-900 border border-gray-800 rounded-xl p-1" role="tablist">
                  {tabs.map(([k, label]) => (
                    <button key={k} type="button" role="tab" aria-selected={(step ?? 'pick') === k} data-testid={`step-${k}`}
                      onClick={() => setStep(k)}
                      className={`text-[11px] sm:text-xs py-2 rounded-lg font-medium ${(step ?? 'pick') === k ? 'bg-orange-500 text-white' : 'text-gray-400'}`}>
                      {label}
                    </button>
                  ))}
                </div>
              )
            })()}

            {exam.status === 'completed' ? (
              <section className="space-y-2" data-testid="results">
                <h3 className="text-xs text-gray-500 uppercase tracking-wider">
                  Results · {pickedRows.filter(r => r.picked?.result === 'pass').length} passed · {pickedRows.filter(r => r.picked?.result === 'fail').length} stay
                </h3>
                <ul className="space-y-1.5">{pickedRows.map(resultRow)}</ul>
                {canEdit && (
                  <button type="button" onClick={undoResults} disabled={working} data-testid="results-undo"
                    className="text-xs text-gray-400 border border-gray-700 hover:border-amber-600 hover:text-amber-300 px-3 py-2 rounded-lg disabled:opacity-60">
                    Undo results
                  </button>
                )}
              </section>
            ) : exam.status === 'cancelled' ? (
              <section className="space-y-2">
                <h3 className="text-xs text-gray-500 uppercase tracking-wider">Tell the parents it&apos;s cancelled</h3>
                {pickedRows.some(r => r.picked?.notice_sent_at)
                  ? <ul className="space-y-1.5">{pickedRows.filter(r => r.picked?.notice_sent_at).map(cancelRow)}</ul>
                  : <p className="text-sm text-gray-500">No notices were sent for this exam.</p>}
              </section>
            ) : (step ?? 'pick') === 'notices' && pickedTotal > 0 ? (
              <section className="space-y-2">
                <p className="text-xs text-gray-500">Tap Send: WhatsApp opens with the message to the parent (or the {mw.one.toLowerCase()} when there&apos;s no parent number). Send it there.</p>
                <ul className="space-y-1.5">{pickedRows.map(noticeRow)}</ul>
              </section>
            ) : (step ?? 'pick') === 'day' && pickedTotal > 0 ? (
              <section className="space-y-2">
                <p className="text-xs text-gray-500">Tick Fee paid and mark Pass or Fail. Belts change only when you press Save results.</p>
                <ul className="space-y-1.5">{pickedRows.map(dayRow)}</ul>
                {canEdit && (() => {
                  const ready = resultsReady(candidates)
                  const live = candidates.filter(c => !c.removed_at)
                  return (
                    <div className="pt-2 space-y-1">
                      <button type="button" onClick={saveResults} disabled={!ready || working} data-testid="results-save"
                        className="w-full bg-orange-500 hover:bg-orange-600 disabled:bg-gray-800 disabled:text-gray-500 text-white text-sm font-semibold rounded-xl py-3">
                        {working ? 'Saving…' : 'Save results'}
                      </button>
                      {!ready && <p className="text-[11px] text-gray-500 text-center">{live.filter(c => !c.result).length} still to mark Pass or Fail</p>}
                    </div>
                  )
                })()}
              </section>
            ) : (
              <>
                <section className="space-y-2">
                  <h3 className="text-xs text-gray-500 uppercase tracking-wider">Picked ({pickedRows.length})</h3>
                  {pickedRows.length === 0
                    ? <p className="text-sm text-gray-500">{editable ? `Nobody yet. Tick the ${mw.many.toLowerCase()} below.` : 'Nobody picked.'}</p>
                    : <ul className="space-y-1.5">{pickedRows.map(studentRow)}</ul>}
                </section>

                {open && (
                  <section className="space-y-2">
                    <h3 className="text-xs text-gray-500 uppercase tracking-wider">Can sit the exam ({canSit.length})</h3>
                    {canSit.length === 0
                      ? <p className="text-sm text-gray-500">Nobody else is ready for this date.</p>
                      : <ul className="space-y-1.5">{canSit.map(studentRow)}</ul>}
                  </section>
                )}

                {open && notYet.length > 0 && (
                  <section className="space-y-2">
                    <h3 className="text-xs text-gray-500 uppercase tracking-wider">Not yet ({notYet.length})</h3>
                    <ul className="space-y-1.5">{notYet.map(studentRow)}</ul>
                  </section>
                )}

                {open && (
                  <p className="text-[11px] text-gray-600">
                    Time on the current belt is counted to the exam date, 30 days a month. Each {mw.one.toLowerCase()} goes up one belt.
                  </p>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

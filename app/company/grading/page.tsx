'use client'

// Belt grading exams (Phase 2, PR B): the gym's exams, upcoming first, then past / completed / cancelled.
// Owner / partners schedule an exam here (date required, time, venue from the branch list, fee, notes) and open it
// to pick students (/company/grading/<exam id>). Senseis open this page read-only (proxy allows coach; RLS blocks writes).
// Hidden when companies.grading_enabled is off or the gym has no belts. Exams are never deleted: Cancel = status 'cancelled'.

import PageNav from '@/app/page-nav'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { type Country, normalizeCountry, formatDate, localDateIso } from '@/lib/locale'
import { formatMoney } from '@/lib/currency'
import { memberWord, staffWord } from '@/lib/labels'
import { type Branch, BRANCH_COLUMNS, timeLabel } from '@/lib/batches'
import { type ExamDraft, ExamForm, venueOptions, examFields, OTHER_VENUE, feeBelts } from './exam-form'
import {
  type GradingExam, type BeltRank, GRADING_EXAM_COLUMNS, BELT_RANK_COLUMNS, gradingOn, splitExams, examStatusLabel, feeSummary,
} from '@/lib/belts'

export default function GradingExamsPage() {
  const router = useRouter()
  const today = localDateIso()
  const [loading, setLoading] = useState(true)
  const [off, setOff] = useState(false)
  const [companyId, setCompanyId] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [country, setCountry] = useState<Country>('IN')
  const [currency, setCurrency] = useState('INR')
  const [businessType, setBusinessType] = useState<string | null>(null)
  const [canEdit, setCanEdit] = useState(false)
  const [isCoach, setIsCoach] = useState(false)
  const [exams, setExams] = useState<GradingExam[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [venues, setVenues] = useState<string[]>([])
  const [ranks, setRanks] = useState<BeltRank[]>([])
  const [feeOn, setFeeOn] = useState(false)
  const [draft, setDraft] = useState<ExamDraft | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [showPast, setShowPast] = useState(false)
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
      const { data: { session } } = await supabase.auth.getSession()
      const user = session?.user
      if (!user) { router.push('/login'); return }
      const { data: profile } = await supabase.from('profiles')
        .select('role, company_id, companies:company_id(*)').eq('id', user.id).single()
      if (!profile?.company_id) { router.push('/login'); return }
      const co = (profile as unknown as { companies: { name?: string | null; country?: string | null; currency?: string | null; business_type?: string | null; grading_enabled?: boolean | null } | null }).companies
      const cId = profile.company_id as string
      setCompanyId(cId)
      setCompanyName(co?.name || '')
      setCountry(normalizeCountry(co?.country))
      setCurrency(co?.currency || 'INR')
      setBusinessType(co?.business_type ?? null)
      setCanEdit(profile.role === 'company_admin' || profile.role === 'partner')
      setIsCoach(profile.role === 'coach')
      if (!gradingOn(co)) { setOff(true); setLoading(false); return }
      const [ranks, ex, cand, br] = await Promise.all([
        supabase.from('belt_ranks').select(BELT_RANK_COLUMNS).eq('company_id', cId),
        supabase.from('grading_exams').select(GRADING_EXAM_COLUMNS).eq('company_id', cId),
        supabase.from('grading_exam_candidates').select('exam_id, removed_at').eq('company_id', cId),
        supabase.from('branches').select(BRANCH_COLUMNS).eq('company_id', cId),
      ])
      if (!live) return
      if (ranks.error || !ranks.data?.length || ex.error) { setOff(true); setLoading(false); return }
      setRanks((ranks.data || []) as BeltRank[])
      // Fees per belt: the column is there once its SQL ran (a probe; exams are read with *)
      const probe = await supabase.from('grading_exams').select('belt_fees').limit(1)
      setFeeOn(!probe.error)
      setExams((ex.data || []) as GradingExam[])
      const c: Record<string, number> = {}
      for (const r of (cand.data || []) as { exam_id: string; removed_at?: string | null }[]) if (!r.removed_at) c[r.exam_id] = (c[r.exam_id] || 0) + 1
      setCounts(c)
      setVenues(br.error ? [] : venueOptions((br.data || []) as Branch[]))
      setLoading(false)
    })()
    return () => { live = false }
  }, [router])

  const openForm = () => {
    setError('')
    setDraft({ exam_date: '', exam_time: '', venue: venues[0] ?? OTHER_VENUE, venueOther: '', fee: '', notes: '', beltFees: {}, beltFeesOpen: false })
  }

  const save = async () => {
    if (!draft) return
    const fields = examFields(draft, feeOn)
    if (typeof fields === 'string') { setError(fields); return }
    setSaving(true)
    setError('')
    const { data, error } = await supabase.from('grading_exams')
      .insert({ ...fields, company_id: companyId, status: 'scheduled' }).select(GRADING_EXAM_COLUMNS)
    setSaving(false)
    if (error || !data?.length) { setError(error ? "Couldn't save: " + error.message : "Couldn't save: not allowed for this login"); return }
    const row = data[0] as GradingExam
    showToast('Exam scheduled ✓')
    router.push(`/company/grading/${row.id}`)
  }

  const { upcoming, past } = splitExams(exams, today)

  const examCard = (e: GradingExam) => {
    const label = examStatusLabel(e, today)
    const n = counts[e.id] || 0
    const tone = label === 'Completed' ? 'text-green-400 border-green-900' : label === 'Cancelled' ? 'text-gray-500 border-gray-700'
      : label === 'Results due' ? 'text-amber-300 border-amber-800' : 'text-sky-300 border-sky-900'
    return (
      <li key={e.id}>
        <button type="button" data-nav data-testid="exam-row" onClick={() => router.push(`/company/grading/${e.id}`)}
          className={`w-full text-left bg-gray-900 border border-gray-800 hover:border-gray-600 rounded-2xl px-4 py-3 transition ${e.status === 'cancelled' ? 'opacity-60' : ''}`}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-white">
                {formatDate(e.exam_date, country, 'medium')}{e.exam_time ? ` · ${timeLabel(e.exam_time, country)}` : ''}
              </p>
              <p className="text-xs text-gray-400 truncate">
                {[e.venue, `${n} ${n === 1 ? mw.one.toLowerCase() : mw.many.toLowerCase()}`,
                  e.fee_amount != null || (e.belt_fees && Object.keys(e.belt_fees).length) ? `Fee ${feeSummary(e, ranks, n => formatMoney(n, currency))}` : ''].filter(Boolean).join(' · ')}
              </p>
            </div>
            <span className={`shrink-0 text-[11px] border px-2 py-0.5 rounded-full ${tone}`}>{label}</span>
          </div>
        </button>
      </li>
    )
  }

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
          <button data-nav onClick={() => router.push(isCoach ? '/coach' : '/company')}
            className="text-xs text-gray-400 hover:text-white border border-gray-700 hover:border-gray-500 px-3 py-1.5 rounded-lg transition shrink-0">
            ← Back
          </button>
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-bold text-white">Belt grading</h1>
            {companyName && <p className="text-xs text-gray-500 truncate">{companyName}</p>}
          </div>
        </div>
      </div>

      <div className="px-4 sm:px-8 py-5 max-w-3xl mx-auto space-y-4">
        {loading ? (
          <div className="h-24 rounded-2xl bg-gray-900 border border-gray-800 animate-pulse" aria-label="Loading" />
        ) : off ? (
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 text-sm text-gray-400">
            Belt grading isn&apos;t switched on for this account.
          </div>
        ) : (
          <div data-testid="page-grading" className="space-y-4">
            {canEdit && (draft ? (
              <ExamForm draft={draft} setDraft={setDraft} venues={venues} currency={currency} saving={saving} error={error}
                belts={feeOn ? feeBelts(ranks) : null}
                onSave={save} onCancel={() => setDraft(null)} saveText="Schedule exam" />
            ) : (
              <button type="button" onClick={openForm} data-testid="exam-new"
                className="w-full bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold rounded-xl py-3">
                + Schedule exam
              </button>
            ))}
            {!canEdit && (
              <p className="text-xs text-gray-500">Exams are scheduled by the owner. {staffWord(businessType).many} can see them and the results.</p>
            )}

            <section className="space-y-2">
              <h2 className="text-xs text-gray-500 uppercase tracking-wider">Upcoming</h2>
              {upcoming.length === 0
                ? <p className="text-sm text-gray-500">No exams scheduled.</p>
                : <ul className="space-y-2">{upcoming.map(examCard)}</ul>}
            </section>

            {past.length > 0 && (
              <section className="space-y-2">
                <button type="button" onClick={() => setShowPast(!showPast)} aria-expanded={showPast}
                  className="text-xs text-gray-500 uppercase tracking-wider hover:text-gray-300">
                  Past &amp; cancelled ({past.length}) {showPast ? '▲' : '▼'}
                </button>
                {/* Results due (date passed, not saved) always show */}
                <ul className="space-y-2">{past.filter(e => showPast || examStatusLabel(e, today) === 'Results due').map(examCard)}</ul>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

'use client'

// Monthly reports (19 Nov, client view build Part C4): the gym reviews a month for its PT and self-training
// members and makes the PDF (the monthly progress report plus a Coach review section: sessions and volume
// per week, new bests, stalled, not done, the coach's note and, for self-training members, a plain line
// inviting them to talk to the gym about a plateau). Owner / partners for their gym; Super Admin for any gym
// (?company=<id>, linked from Super Admin → Companies). Members can't open this page (proxy.ts) and see
// their live progress in the app, not this reviewed report, until the gym sends it.
// Numbers: lib/monthly-report.ts (month counts, message), lib/review-report.ts (review), lib/self-training.ts
// (a member's own plan repeats every week). The coach's note isn't stored (decided 19 Nov).
import { Suspense, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import PageNav from '@/app/page-nav'
import { supabase } from '@/lib/supabase'
import { type Country, normalizeCountry, formatDate } from '@/lib/locale'
import { memberWord, isDojo } from '@/lib/labels'
import { getClientSettings, isSelfTraining, type ClientSettings } from '@/lib/clientSettings'
import { monthOptions, defaultMonth, monthBounds, summarizeMonth, monthlyTotals, monthRangeText, buildMonthlyMessage, strengthGains } from '@/lib/monthly-report'
import { type ShareClient } from '@/lib/progress-share'
import { withoutEarlyLinks } from '@/lib/adherence'
import { planJsonOf } from '@/lib/plan-structure'
import { type ExerciseLog, EXERCISE_LOG_COLUMNS } from '@/lib/exercise-logs'
import { type Exercise, EXERCISE_COLUMNS } from '@/lib/exercises'
import { type ProgressLog, strengthReport } from '@/lib/progress'
import { expandOwnPlans, ownPlanOn } from '@/lib/self-training'
import { monthReview, plateauLine } from '@/lib/review-report'

type Company = { id: string; name: string; country?: string | null; business_type?: string | null; company_type?: string | null; client_settings?: unknown; created_at?: string }
type Member = ShareClient & { id: string; client_type?: string | null; weight_kg?: number | null; created_at?: string }
type Plan = { id: string; client_id: string; week_start: string; plan_details: string; plan_json?: unknown; created_by?: string | null; created_at?: string | null }
type Session = { id: string; client_id: string; session_date: string; duration_minutes: number; weekly_plan_id: string | null; plan_day?: string | null; activity?: string | null }
type Made = { text: string; toPhone: string | null; toLabel: string }

export default function ReportsPage() {
  return <Suspense fallback={<div className="min-h-screen bg-gray-950" />}><Reports /></Suspense>
}

function Reports() {
  const router = useRouter()
  const params = useSearchParams()
  const [problem, setProblem] = useState('')
  const [company, setCompany] = useState<Company | null>(null)
  const [settings, setSettings] = useState<ClientSettings | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [monthSessions, setMonthSessions] = useState<Record<string, number>>({})
  const [month, setMonth] = useState('')
  const [viewerName, setViewerName] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [allNote, setAllNote] = useState('')
  const [busy, setBusy] = useState<string | null>(null)   // member id being made, or 'all'
  const [allDone, setAllDone] = useState(0)
  const [made, setMade] = useState<Record<string, Made>>({})
  const [toast, setToast] = useState<{ text: string; kind: 'success' | 'error' } | null>(null)
  const library = useRef<Exercise[] | null>(null)

  const say = (text: string, kind: 'success' | 'error' = 'success') => {
    setToast({ text, kind })
    setTimeout(() => setToast(null), 3500)
  }

  // Who is looking, and which gym
  useEffect(() => {
    let live = true
    ;(async () => {
      const { data: { session } } = await supabase.auth.getSession()
      const user = session?.user
      if (!user) { router.push('/login'); return }
      const { data: me } = await supabase.from('profiles').select('id, role, company_id, full_name').eq('id', user.id).single()
      if (!me) { router.push('/login'); return }
      const cid = me.role === 'super_admin' ? params.get('company') : me.company_id
      if (!cid) { setProblem('Pick a company from Super Admin → Companies.'); return }
      const { data: co, error } = await supabase.from('companies').select('*').eq('id', cid).single()
      if (!live) return
      if (error || !co) { setProblem("Couldn't load the gym. Refresh to try again."); return }
      setViewerName(me.role === 'super_admin' ? '' : me.full_name || '')
      setCompany(co as Company)
      const s = getClientSettings(co)
      setSettings(s)
      const { data: list, error: mErr } = await supabase.from('profiles').select('*')
        .eq('company_id', cid).eq('role', 'client').is('archived_at', null).order('full_name')
      if (!live) return
      if (mErr) { setProblem("Couldn't load the members. Refresh to try again."); return }
      // PT members, and self-training members when the gym has self-training on
      setMembers(((list || []) as Member[]).filter(m => m.client_type === 'pt' || isSelfTraining(m.client_type, s)))
      const options = monthOptions({ since: (co as Company).created_at ?? null, country: normalizeCountry(co.country) })
      setMonth(defaultMonth(options))
    })()
    return () => { live = false }
  }, [params, router])

  // Sessions per member in the picked month, for the list
  useEffect(() => {
    if (!month || !members.length) return
    let live = true
    const { from, to } = monthBounds(month)
    supabase.from('logged_sessions').select('client_id').in('client_id', members.map(m => m.id))
      .gte('session_date', from).lte('session_date', to)
      .then(({ data }) => {
        if (!live) return
        const counts: Record<string, number> = {}
        for (const r of data || []) counts[r.client_id] = (counts[r.client_id] || 0) + 1
        setMonthSessions(counts)
      })
    return () => { live = false }
  }, [month, members])

  const country: Country = normalizeCountry(company?.country)
  const mw = memberWord(company?.business_type)

  // One member's report: load their plans / sessions / weights, count the month, draw the PDF
  const makeReport = async (m: Member, coachNote: string): Promise<Made | null> => {
    if (!company || !settings) return null
    if (!library.current) {
      const { data } = await supabase.from('exercises').select(EXERCISE_COLUMNS)
      library.current = ((data || []) as Exercise[]).filter(e => !e.company_id || e.company_id === company.id)
    }
    const [plansR, sessR, logsR] = await Promise.all([
      supabase.from('weekly_plans').select('*').eq('client_id', m.id),
      supabase.from('logged_sessions').select('*').eq('client_id', m.id).order('session_date'),
      supabase.from('exercise_logs').select(EXERCISE_LOG_COLUMNS).eq('client_id', m.id),
    ])
    if (plansR.error || sessR.error) throw new Error((plansR.error || sessR.error)!.message)
    const rawPlans = (plansR.data || []) as Plan[]
    const rawSessions = (sessR.data || []) as Session[]
    const self = isSelfTraining(m.client_type, settings)
    const { upTo: monthEnd } = summarizeMonth({ plans: [], sessions: [], month })
    const ex = self ? expandOwnPlans(rawPlans, rawSessions, m.id, monthEnd) : { plans: rawPlans, sessions: rawSessions }
    const sessions = withoutEarlyLinks(ex.sessions, ex.plans)
    const summary = summarizeMonth({ plans: ex.plans, sessions, month, weightKg: m.weight_kg, businessType: company.business_type })
    const dates = Object.fromEntries(rawSessions.map(s => [s.id, s.session_date.slice(0, 10)]))
    const logs: ProgressLog[] = logsR.error ? [] : ((logsR.data || []) as ExerciseLog[])
      .flatMap(l => (dates[l.session_id] ? [{ ...l, session_date: dates[l.session_id] }] : []))
    const lib = library.current
    // The plan in effect at the month's last counted day: their own one, or the gym's latest started
    const planRow = self ? ownPlanOn(rawPlans, m.id, summary.upTo)
      : [...rawPlans].filter(p => p.week_start.slice(0, 10) <= summary.upTo).sort((a, b) => b.week_start.localeCompare(a.week_start))[0] ?? null
    const review = monthReview({ logs, library: lib, plan: planRow ? planJsonOf(planRow) : null, summary })
    const gains = strengthGains(logs, lib, summary.month, summary.upTo)
    const base = { client: m, companyName: company.name, businessType: company.business_type, coachName: viewerName, summary, gains, country }
    const pdfText = buildMonthlyMessage(base).text
    const message = buildMonthlyMessage({ ...base, note: coachNote })
    const { downloadProgressPdf } = await import('@/lib/progress-pdf')
    const safeName = m.full_name.trim().replace(/[^\w]+/g, '-').replace(/^-|-$/g, '') || 'member'
    await downloadProgressPdf({
      companyName: company.name, clientName: m.full_name, weekStart: summary.from, country, text: pdfText,
      month: {
        rangeText: monthRangeText(summary, country),
        tiles: [
          ...(summary.planned ? [['Plan days', `${summary.done} of ${summary.planned}`] as [string, string]] : []),
          ['Sessions', String(summary.sessions)],
          ['Minutes', summary.minutes.toLocaleString('en-US')],
          ['Active days', String(summary.activeDays)],
        ],
        months: monthlyTotals(rawSessions, summary.month, 6),
      },
      strength: logs.length ? strengthReport(logs, lib, summary.upTo) : null,
      showCalories: false,
      review: {
        weeks: review.weeks.map(w => ({ label: formatDate(w.from, country, 'dayMonth'), sessions: w.sessions, volume: w.volume })),
        newBests: review.newBests, stalled: review.stalled, notDone: review.notDone,
        coachNote, closing: self ? plateauLine(company.name, review.stalled) : null,
      },
    }, `${safeName}-monthly-review-${summary.month}.pdf`)
    return message
  }

  const generateOne = async (m: Member) => {
    setBusy(m.id)
    try {
      const r = await makeReport(m, note)
      if (r) { setMade(x => ({ ...x, [m.id]: r })); say(`✓ ${m.full_name}'s report downloaded`) }
    } catch (e) {
      say('Could not make the report: ' + (e instanceof Error ? e.message : 'please try again'), 'error')
    }
    setBusy(null)
  }

  // Every listed member, one after another, with the same note. Browsers may ask once to allow several downloads.
  const generateAll = async () => {
    setBusy('all')
    setAllDone(0)
    let failed = 0
    for (const m of members) {
      try {
        const r = await makeReport(m, allNote)
        if (r) setMade(x => ({ ...x, [m.id]: r }))
      } catch { failed++ }
      setAllDone(n => n + 1)
    }
    setBusy(null)
    say(failed ? `Done, but ${failed} report${failed === 1 ? '' : 's'} couldn't be made. Try those one by one.` : `✓ ${members.length} reports downloaded`, failed ? 'error' : 'success')
  }

  const options = company ? monthOptions({ since: company.created_at ?? null, country }) : []
  const card = 'bg-gray-900 rounded-2xl border border-gray-800'

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <PageNav />
      {toast && (
        <div role="status" className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-xl text-sm font-medium shadow-xl ${toast.kind === 'success' ? 'bg-green-600' : 'bg-red-600'}`}>
          {toast.text}
        </div>
      )}
      <div className="max-w-2xl mx-auto px-4 py-5 space-y-4">
        <div>
          <h1 className="text-lg font-bold">Monthly reports</h1>
          <p className="text-xs text-gray-500 mt-0.5">{company?.name ? `${company.name} · ` : ''}Review a month, add your note, and send the PDF. {mw.many} don&apos;t see this until you send it.</p>
        </div>

        {problem ? <p className="text-sm text-amber-400">{problem}</p> : !company || !month ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : isDojo(company.business_type) ? (
          <p className="text-sm text-gray-400">Dojos send attendance from each student&apos;s page.</p>
        ) : (
          <div className="space-y-4" data-testid="page-reports">
            <div className={`${card} p-4 space-y-3`}>
              <label htmlFor="report-month" className="text-xs text-gray-500 uppercase tracking-wider block">Month</label>
              <select id="report-month" value={month} onChange={e => { setMonth(e.target.value); setMade({}) }}
                className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-white outline-none focus:ring-2 focus:ring-orange-500">
                {options.map(o => <option key={o.month} value={o.month}>{o.label}{o.current ? ' (so far)' : ''}</option>)}
              </select>
              {members.length > 1 && (
                <div className="space-y-2 border-t border-gray-800 pt-3">
                  <p className="text-xs text-gray-400">Generate all: one note for everyone, then a PDF each.</p>
                  <textarea value={allNote} onChange={e => setAllNote(e.target.value)} rows={2} maxLength={600}
                    placeholder="Note for everyone (optional), e.g. Great month. New classes start on the 1st."
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-orange-500 resize-none" />
                  <button type="button" disabled={!!busy} onClick={generateAll}
                    className="w-full min-h-[44px] bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-xl text-sm font-semibold disabled:opacity-50">
                    {busy === 'all' ? `Making ${allDone} of ${members.length}…` : `Generate all (${members.length})`}
                  </button>
                </div>
              )}
            </div>

            {members.length === 0 ? (
              <p className="text-sm text-gray-500">
                No PT{settings?.self_training_enabled ? ' or self-training' : ''} {mw.many.toLowerCase()} yet.
              </p>
            ) : (
              <ul className={`${card} divide-y divide-gray-800`}>
                {members.map(m => {
                  const self = !!settings && isSelfTraining(m.client_type, settings)
                  const open = openId === m.id
                  const r = made[m.id]
                  return (
                    <li key={m.id} className="px-4 py-3" data-testid="report-row">
                      <div className="flex items-center gap-3 min-h-[44px]">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{m.full_name}</p>
                          <p className="text-[11px] text-gray-500">{self ? 'Self-training' : 'PT'} · {monthSessions[m.id] || 0} session{monthSessions[m.id] === 1 ? '' : 's'}{r ? <span className="text-green-400"> · PDF made</span> : null}</p>
                        </div>
                        <button type="button" disabled={!!busy} onClick={() => { setOpenId(open ? null : m.id); setNote('') }}
                          className="shrink-0 text-xs font-semibold text-orange-300 border border-orange-900 hover:border-orange-500 rounded-lg px-3 py-2 disabled:opacity-50">
                          {open ? 'Close' : 'Generate'}
                        </button>
                      </div>
                      {open && (
                        <div className="mt-2 space-y-2">
                          <textarea value={note} onChange={e => setNote(e.target.value)} rows={3} maxLength={600}
                            placeholder={`Your note to ${m.full_name.split(/\s+/)[0]} (optional): what went well, what to work on`}
                            className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-orange-500 resize-none" />
                          <button type="button" disabled={!!busy} onClick={() => generateOne(m)} data-testid="report-generate"
                            className="w-full min-h-[44px] bg-orange-500 hover:bg-orange-400 rounded-xl text-sm font-semibold disabled:opacity-50">
                            {busy === m.id ? 'Making the PDF…' : r ? 'Make the PDF again' : 'Make the PDF'}
                          </button>
                          {r && (r.toPhone ? (
                            <button type="button" onClick={() => window.open(`https://wa.me/${r.toPhone}?text=${encodeURIComponent(r.text)}`, '_blank')}
                              className="w-full min-h-[44px] bg-green-600 hover:bg-green-500 rounded-xl text-sm font-semibold">
                              Send to {r.toLabel} on WhatsApp (attach the PDF)
                            </button>
                          ) : (
                            <p className="text-xs text-gray-500">No WhatsApp number saved for {m.full_name}: send the PDF another way.</p>
                          ))}
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

'use client'

// Today's schedule (owner / partners; gyms and individual coaches): one day's PT sessions by workout time,
// with who trained and who logged it. Read-only (tapping a row only opens the client).
// Rules and statuses: lib/today-schedule.ts. Not for dojos (no plans: Attendance → All of today) or when the
// Train module is off. Individual coaches: no coach names, filter or "covered by".
// ?date=YYYY-MM-DD opens another day (past and future, read-only).
// Loads: the profile, then 5 reads in parallel (PT clients, membership dates, plans that can cover the day,
// that day's sessions, staff names). Database rules keep everything to the owner's own gym.

import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { type Country, normalizeCountry, formatDate, localDateIso } from '@/lib/locale'
import { isDojo, staffWord } from '@/lib/labels'
import { isCoachCompany } from '@/lib/company-type'
import { addDays } from '@/lib/attendance'
import { loadGymStaff, type GymStaff } from '@/lib/gym-staff'
import { type CoachClient, type CoachPlan, type CoachSession } from '@/lib/coach-today'
import { type ScheduleRow, type ScheduleMembership, buildDaySchedule, forCoach, timeLabel, hourLabel } from '@/lib/today-schedule'

export default function TodaySchedulePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-950" />}>
      <TodaySchedule />
    </Suspense>
  )
}

const nowMinutesOf = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes() }
const firstName = (name: string | null | undefined) => (name || '').trim().replace(/^(coach|sensei)\s+/i, '').split(/\s+/)[0] || ''

function TodaySchedule() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const today = localDateIso()
  const asked = searchParams.get('date')
  const date = asked && /^\d{4}-\d{2}-\d{2}$/.test(asked) ? asked : today

  const [loading, setLoading] = useState(true)
  const [problem, setProblem] = useState('')
  const [company, setCompany] = useState<{ country: Country; businessType: string | null; coachCompany: boolean } | null>(null)
  const [clients, setClients] = useState<CoachClient[]>([])
  const [plans, setPlans] = useState<CoachPlan[]>([])
  const [sessions, setSessions] = useState<CoachSession[]>([])
  const [memberships, setMemberships] = useState<ScheduleMembership[]>([])
  const [staff, setStaff] = useState<GymStaff[]>([])
  const [coachFilter, setCoachFilter] = useState<string | null>(null)
  const [nowMinutes, setNowMinutes] = useState(nowMinutesOf)
  const companyId = useRef<string | null>(null)

  // Statuses move from Expected to Not logged as the day goes on
  useEffect(() => {
    const t = setInterval(() => setNowMinutes(nowMinutesOf()), 60000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    let live = true
    ;(async () => {
      setLoading(true)
      if (!companyId.current) {
        const { data: { session } } = await supabase.auth.getSession()
        const user = session?.user
        if (!user) { router.push('/login'); return }
        const { data: profile } = await supabase.from('profiles')
          .select('id, company_id, companies:company_id(*)').eq('id', user.id).single()
        if (!profile?.company_id) { router.push('/login'); return }
        const co = (profile as unknown as { companies: { country?: string | null; business_type?: string | null; company_type?: string | null; client_module_enabled?: boolean | null } | null }).companies
        if (!live) return
        setCompany({ country: normalizeCountry(co?.country), businessType: co?.business_type ?? null, coachCompany: isCoachCompany(co) })
        if (isDojo(co?.business_type) || !co?.client_module_enabled) {
          setProblem(isDojo(co?.business_type) ? 'Dojos use Attendance → All of today.' : 'The Train module is off for this account.')
          setLoading(false)
          return
        }
        companyId.current = profile.company_id as string
      }
      const cId = companyId.current
      const [clientsRes, memRes, plansRes, sessionsRes, staffList] = await Promise.all([
        supabase.from('profiles').select('id, full_name, phone, primary_coach_id, archived_at, client_type')
          .eq('company_id', cId).eq('role', 'client').eq('client_type', 'pt').is('archived_at', null).order('full_name'),
        supabase.from('memberships').select('profile_id, start_date, end_date').eq('company_id', cId),
        // A plan covers 7 days from its start, so only plans that started in the 6 days up to the date
        supabase.from('weekly_plans').select('id, client_id, week_start, plan_details, plan_json, workout_time')
          .gte('week_start', addDays(date, -6)).lte('week_start', date),
        supabase.from('logged_sessions')
          .select('id, client_id, session_date, duration_minutes, weekly_plan_id, plan_day, activity, logged_by, created_at')
          .eq('session_date', date),
        loadGymStaff(cId),
      ])
      if (!live) return
      const failed = [clientsRes, memRes, plansRes, sessionsRes].find(r => r.error)
      if (failed?.error) { console.error('Today schedule load error:', failed.error); setProblem("Couldn't load the schedule. Refresh the page to try again.") }
      else setProblem('')
      setClients((clientsRes.data || []) as CoachClient[])
      setMemberships((memRes.data || []) as ScheduleMembership[])
      setPlans((plansRes.data || []) as CoachPlan[])
      setSessions((sessionsRes.data || []) as CoachSession[])
      setStaff(staffList)
      setLoading(false)
    })()
    return () => { live = false }
  }, [date, router])

  const country = company?.country ?? 'IN'
  const solo = !!company?.coachCompany
  const sw = staffWord(company?.businessType).one
  const staffNames = useMemo(() => Object.fromEntries(staff.map(s => [s.id, s.full_name])), [staff])
  const coachIds = useMemo(() => new Set(staff.filter(s => s.role === 'coach').map(s => s.id)), [staff])
  const day = useMemo(() => buildDaySchedule({ clients, plans, sessions, memberships, staffNames, coachIds, date, today, nowMinutes, word: sw }),
    [clients, plans, sessions, memberships, staffNames, coachIds, date, today, nowMinutes, sw])

  // Coach chips: active coach logins, plus anyone else set as a primary coach today; "No coach" when some have none
  const allRows = [...day.slots, ...day.noTime, ...day.alsoTrained]
  const chipIds = [...new Set([
    ...staff.filter(s => s.role === 'coach' && !s.archived_at).map(s => s.id),
    ...allRows.map(r => r.coachId).filter((x): x is string => !!x),
  ])].sort((a, b) => (staffNames[a] || '').localeCompare(staffNames[b] || ''))
  const hasNoCoach = allRows.some(r => !r.coachId)
  const filter = solo ? null : coachFilter
  const slots = forCoach(day.slots, filter)
  const noTime = forCoach(day.noTime, filter)
  const alsoTrained = forCoach(day.alsoTrained, filter)
  const shownScheduled = [...slots, ...noTime].filter(r => r.scheduled)
  const summary = filter ? {
    expected: shownScheduled.length,
    trained: [...slots, ...noTime, ...alsoTrained].filter(r => r.status === 'trained').length,
    notLogged: shownScheduled.filter(r => r.status === 'not-logged').length,
  } : day.summary

  // Slots grouped by hour
  const hours: { hour: number; rows: ScheduleRow[] }[] = []
  for (const r of slots) {
    const h = Math.floor(r.minutes! / 60)
    if (hours.at(-1)?.hour !== h) hours.push({ hour: h, rows: [] })
    hours.at(-1)!.rows.push(r)
  }

  const goDate = (d: string) => router.replace(`/company/today${d === today ? '' : `?date=${d}`}`)
  const dayWord = date === today ? 'today' : 'that day'

  const statusBadge = (r: ScheduleRow) => {
    if (r.status === 'trained') {
      const by = r.loggerId === 'client' ? 'logged by client' : solo ? '' : r.covering ? `covered by ${firstName(staffNames[r.loggerId || '']) || 'staff'}` : r.trainedBy || ''
      return (
        <span className={`text-xs font-medium ${r.covering && !solo ? 'text-amber-300' : 'text-green-400'}`}>
          ✓ Trained{by ? ` · ${by}` : ''}
        </span>
      )
    }
    if (r.status === 'not-logged') return <span className="text-xs font-medium text-red-400">Not logged</span>
    if (r.status === 'expected') return <span className="text-xs text-gray-400">Expected</span>
    return <span className="text-xs text-gray-600">—</span>
  }

  const coachLine = (r: ScheduleRow) => {
    if (solo) return null
    const name = r.coachId ? firstName(staffNames[r.coachId]) : ''
    return <span className={name ? 'text-gray-400' : 'text-gray-600'}>{name ? `${sw} ${name}` : `No ${sw.toLowerCase()}`}</span>
  }

  const row = (r: ScheduleRow, showTime: boolean, note?: string | null) => (
    <li key={r.client.id}>
      <button type="button" data-nav onClick={() => router.push(`/company/client/${r.client.id}`)}
        className={`w-full text-left bg-gray-900 border rounded-xl px-3 py-2.5 flex items-start gap-3 transition hover:border-gray-600 ${r.status === 'trained' ? 'border-green-900/60' : r.status === 'not-logged' ? 'border-red-900/50' : 'border-gray-800'}`}>
        {showTime && <span className="w-16 shrink-0 text-sm font-semibold text-white tabular-nums">{timeLabel(r.minutes!, country)}</span>}
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-white truncate">{r.client.full_name}</span>
          <span className="block text-[11px] truncate">
            {coachLine(r)}
            {(note || r.dayLabel) && <span className="text-gray-500">{solo ? '' : ' · '}{note || r.dayLabel}</span>}
          </span>
        </span>
        <span className="shrink-0 text-right max-w-[45%]">{statusBadge(r)}</span>
      </button>
    </li>
  )

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <div className="bg-gray-900 border-b border-gray-800 px-4 py-4 sticky top-0 z-30">
        <div className="max-w-2xl mx-auto">
          <div className="flex items-center gap-3">
            <button data-nav onClick={() => router.push('/company')}
              className="text-xs text-gray-400 hover:text-white border border-gray-700 hover:border-gray-500 px-3 py-1.5 rounded-lg shrink-0">← Back</button>
            <div className="min-w-0 flex-1">
              <h1 className="text-lg font-bold truncate">{solo ? 'My day' : date === today ? "Today's schedule" : 'Schedule'}</h1>
              <p className="text-xs text-gray-500 truncate">PT sessions by workout time · read-only</p>
            </div>
          </div>
          <div className="flex items-center justify-between mt-3 gap-2">
            <button type="button" onClick={() => goDate(addDays(date, -1))} aria-label="Previous day"
              className="w-10 h-10 rounded-lg border border-gray-700 text-gray-300 hover:border-gray-500 shrink-0">‹</button>
            {/* Tap the date to pick any day (native date picker on top, invisible) */}
            <div className="flex-1 text-center min-w-0">
              <label className="relative block cursor-pointer">
                <span className="text-sm font-medium">{date === today ? 'Today · ' : ''}{formatDate(date, country, 'weekday')}</span>
                <input type="date" value={date} onChange={e => e.target.value && goDate(e.target.value)} aria-label="Pick a day"
                  className="absolute inset-0 opacity-0 w-full h-full cursor-pointer" />
              </label>
              {date === today
                ? <span className="block text-[11px] text-gray-500">Tap the date to pick a day</span>
                : <button type="button" onClick={() => goDate(today)} className="text-[11px] text-orange-400 hover:text-orange-300">Back to today</button>}
            </div>
            <button type="button" onClick={() => goDate(addDays(date, 1))} aria-label="Next day"
              className="w-10 h-10 rounded-lg border border-gray-700 text-gray-300 hover:border-gray-500 shrink-0">›</button>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-4 space-y-4">
        {loading ? (
          <div className="space-y-3" aria-busy="true">
            <div className="h-16 rounded-2xl bg-gray-900 border border-gray-800 animate-pulse" />
            {[0, 1, 2].map(i => <div key={i} className="h-14 rounded-xl bg-gray-900 border border-gray-800 animate-pulse" />)}
          </div>
        ) : problem ? (
          <p className="text-sm text-gray-300 bg-gray-900 border border-gray-800 rounded-xl px-4 py-3">{problem}</p>
        ) : (
          <div data-testid="page-today" className="space-y-4">
            {/* Summary */}
            <div className="grid grid-cols-3 gap-2">
              {([
                ['Expected', summary.expected, 'text-white'],
                ['Trained', summary.trained, 'text-green-400'],
                ['Not logged', summary.notLogged, summary.notLogged ? 'text-red-400' : 'text-gray-500'],
              ] as const).map(([label, n, color]) => (
                <div key={label} className="bg-gray-900 border border-gray-800 rounded-2xl px-3 py-2.5 text-center">
                  <p className={`text-2xl font-bold ${color}`}>{n}</p>
                  <p className="text-[11px] text-gray-500">{label}</p>
                </div>
              ))}
            </div>

            {/* Coach filter (gyms only) */}
            {!solo && (chipIds.length > 0 || hasNoCoach) && (
              <div className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4">
                {[
                  { id: null as string | null, label: 'All' },
                  ...chipIds.map(id => ({ id, label: firstName(staffNames[id]) || sw })),
                  ...(hasNoCoach ? [{ id: 'none', label: `No ${sw.toLowerCase()}` }] : []),
                ].map(c => (
                  <button key={c.id ?? 'all'} type="button" onClick={() => setCoachFilter(c.id)} aria-pressed={filter === c.id}
                    className={`text-xs px-3 py-1.5 rounded-full border whitespace-nowrap transition ${filter === c.id ? 'bg-orange-500 border-orange-500 text-white' : 'bg-gray-900 border-gray-700 text-gray-300 hover:border-gray-500'}`}>
                    {c.label}
                  </button>
                ))}
              </div>
            )}

            {shownScheduled.length === 0 && (
              <div className="bg-gray-900 rounded-2xl p-6 text-center text-gray-400 border border-gray-800 text-sm">
                No PT sessions scheduled {dayWord}{filter ? ` for ${filter === 'none' ? `clients with no ${sw.toLowerCase()}` : firstName(staffNames[filter])}` : ''}.
                <span className="block text-xs text-gray-500 mt-1">Sessions come from each client&apos;s plan for the week and its workout time.</span>
              </div>
            )}

            {hours.map(h => (
              <section key={h.hour} className="space-y-1.5">
                <h2 className="text-xs text-gray-500 uppercase tracking-wider">{hourLabel(h.hour * 60, country)}</h2>
                <ul className="space-y-1.5">{h.rows.map(r => row(r, true))}</ul>
              </section>
            ))}

            {alsoTrained.length > 0 && (
              <section className="space-y-1.5">
                <h2 className="text-xs text-gray-500 uppercase tracking-wider">Also trained <span className="normal-case text-gray-600">(not on their plan {dayWord})</span></h2>
                <ul className="space-y-1.5">{alsoTrained.map(r => row(r, false, r.reason === 'rest' ? 'Rest day on plan' : 'No plan this week'))}</ul>
              </section>
            )}

            {noTime.length > 0 && (
              <section className="space-y-1.5">
                <h2 className="text-xs text-gray-500 uppercase tracking-wider">No time set <span className="normal-case text-gray-600">({noTime.length})</span></h2>
                <ul className="space-y-1.5">{noTime.map(r => row(r, false, r.reason === 'no-plan' ? 'No plan this week' : r.workoutTime ? `Time "${r.workoutTime}" not readable` : 'No workout time on plan'))}</ul>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

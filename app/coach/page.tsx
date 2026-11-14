'use client'

// Coach home (ROADMAP #40): today's training list for the gym's PT clients. Who is expected today and
// whether they've trained; not a chase list (no "missed" or follow-up prompts here).
// Coaches see PT clients only (all of them) and staff names; never memberships, payments, leads or settings.

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { type Country, normalizeCountry, formatDate, localDateIso, daysUntil } from '@/lib/locale'
import { thisWeekMonday } from '@/lib/calories'
import { staffWord, ptWord, isDojo } from '@/lib/labels'
import { type Branch, type Batch, BRANCH_COLUMNS, BATCH_COLUMNS, homeBatchLine, batchWhen } from '@/lib/batches'
import { type AttendanceRow, ATTENDANCE_COLUMNS, batchesOn } from '@/lib/attendance'
import { withoutEarlyLinks } from '@/lib/adherence'
import { todayRows, sortRows, type CoachClient, type CoachPlan, type CoachSession, type StaffMember, type TodayRow } from '@/lib/coach-today'
import { loadGymStaff } from '@/lib/gym-staff'
import { workoutTimeLabel } from '@/lib/today-schedule'
import { type BeltRank, BELT_RANK_COLUMNS, gradingOn, beltsById } from '@/lib/belts'
import BeltChip from '@/app/belt-chip'

type Staff = StaffMember & { role: string; archived_at: string | null }
type MembershipStatus = { profile_id: string; plan_type: string | null; start_date: string | null; end_date: string | null }
type Filter = 'all' | 'mine' | 'not-yet'

export default function CoachHomePage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [me, setMe] = useState<{ id: string; full_name: string } | null>(null)
  const [company, setCompany] = useState<{ name: string; logo_url: string | null; country: Country; business_type: string | null } | null>(null)
  // Dojo: each student's branch / home batch (db/2026-11-03-branches-batches.md); empty before that SQL
  const [placement, setPlacement] = useState<Record<string, string>>({})
  // Dojo attendance (#78): today's present rows (null = attendance not set up yet), and the gym's branches / batches
  const [attToday, setAttToday] = useState<AttendanceRow[] | null>(null)
  const [dojoBranches, setDojoBranches] = useState<Branch[]>([])
  const [dojoBatches, setDojoBatches] = useState<Batch[]>([])
  const [clients, setClients] = useState<CoachClient[]>([])
  const [staff, setStaff] = useState<Staff[]>([])
  const [plans, setPlans] = useState<CoachPlan[]>([])
  const [sessions, setSessions] = useState<CoachSession[]>([])
  // Belt grading on (companies.grading_enabled): the gym's belts by id and each student's current belt; empty = no chips
  const [beltById, setBeltById] = useState<Record<string, BeltRank>>({})
  const [clientRank, setClientRank] = useState<Record<string, string>>({})
  const [membershipEnd, setMembershipEnd] = useState<Record<string, string | null>>({})
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const [openingId, setOpeningId] = useState<string | null>(null)
  // Change password (the owner sets the first one: for phone logins it's the phone number)
  const [showPassword, setShowPassword] = useState(false)
  const [pwForm, setPwForm] = useState({ next: '', confirm: '', saving: false, message: '', ok: false })
  const today = localDateIso()

  useEffect(() => { load() }, [])

  const load = async () => {
    // getSession reads the saved login locally (the proxy already verified it with Supabase)
    const { data: { session } } = await supabase.auth.getSession()
    const user = session?.user
    if (!user) { router.push('/login'); return }

    // Plans that can cover today started within the last 6 days
    const planSince = localDateIso(-6)
    // Everything in parallel (no company filter needed: database rules give a coach only their own gym's
    // PT clients, their plans and sessions, and the gym's staff)
    const [profileRes, clientsRes, staffRes, plansRes, sessionsRes, membershipRes] = await Promise.all([
      supabase.from('profiles')
        .select('id, full_name, company_id, companies:company_id(name, logo_url, country, business_type, grading_enabled)')
        .eq('id', user.id).single(),
      supabase.from('profiles')
        .select('id, full_name, phone, primary_coach_id, archived_at, client_type, current_rank_id')
        .eq('role', 'client').eq('client_type', 'pt').is('archived_at', null)
        .order('full_name'),
      // Staff names through gym_staff() (coaches can't read owner / partner rows directly)
      loadGymStaff(),
      supabase.from('weekly_plans')
        .select('id, client_id, week_start, plan_details, plan_json, workout_time')
        .gte('week_start', planSince).lte('week_start', today),
      supabase.from('logged_sessions')
        .select('id, client_id, session_date, duration_minutes, weekly_plan_id, plan_day, exercises_done, activity, logged_by, created_at')
        .gte('session_date', thisWeekMonday()).lte('session_date', today),
      supabase.rpc('pt_membership_status'),
    ])

    const failed = [profileRes, clientsRes, plansRes, sessionsRes].find(r => r.error)
    if (failed?.error) { console.error('Coach home load error:', failed.error); setError("Couldn't load today's list. Refresh the page to try again.") }
    if (membershipRes.error) console.error('Membership status error:', membershipRes.error)

    const profile = profileRes.data as { id: string; full_name: string | null; company_id: string | null; companies: { name?: string | null; logo_url?: string | null; country?: string | null; business_type?: string | null; grading_enabled?: boolean | null } | null } | null
    setMe({ id: user.id, full_name: profile?.full_name || '' })
    setCompany({
      name: profile?.companies?.name || '',
      logo_url: profile?.companies?.logo_url || null,
      country: normalizeCountry(profile?.companies?.country),
      // Kept so the dojo wording (Sensei, students, Came today) switches on
      business_type: profile?.companies?.business_type ?? null,
    })
    // Dojo: the line under each student ("Kokapet · Juniors · Mon/Wed/Fri 6–7 pm"). Errors (no tables yet) = no line
    if (isDojo(profile?.companies?.business_type)) {
      const [pl, br, ba] = await Promise.all([
        supabase.from('profiles').select('id, branch_id, batch_id').eq('role', 'client').eq('client_type', 'pt').is('archived_at', null),
        supabase.from('branches').select(BRANCH_COLUMNS),
        supabase.from('batches').select(BATCH_COLUMNS),
      ])
      if (!pl.error && !br.error && !ba.error) {
        const branchById = Object.fromEntries(((br.data || []) as Branch[]).map(b => [b.id, b]))
        const batchById = Object.fromEntries(((ba.data || []) as Batch[]).map(b => [b.id, b]))
        const country = normalizeCountry(profile?.companies?.country)
        setPlacement(Object.fromEntries(((pl.data || []) as { id: string; branch_id: string | null; batch_id: string | null }[])
          .map(p => {
            const batch = p.batch_id ? batchById[p.batch_id] : null
            return [p.id, homeBatchLine(branchById[p.branch_id || batch?.branch_id || ''], batch, country)]
          })
          .filter(([, line]) => line)))
        setDojoBranches((br.data || []) as Branch[])
        setDojoBatches((ba.data || []) as Batch[])
        const att = await supabase.from('attendance').select(ATTENDANCE_COLUMNS).eq('class_date', today).eq('present', true)
        setAttToday(att.error ? null : (att.data || []) as AttendanceRow[])
      }
    }
    // Belt grading: one read of the gym's belts for the chips (an error = none, no chips)
    if (gradingOn(profile?.companies) && profile?.company_id) {
      const ranks = await supabase.from('belt_ranks').select(BELT_RANK_COLUMNS).eq('company_id', profile.company_id)
      if (ranks.error) console.error('Belt ranks error:', ranks.error)
      else {
        setBeltById(beltsById((ranks.data || []) as BeltRank[]))
        setClientRank(Object.fromEntries(((clientsRes.data || []) as { id: string; current_rank_id?: string | null }[])
          .filter(c => c.current_rank_id).map(c => [c.id, c.current_rank_id as string])))
      }
    }
    setClients((clientsRes.data || []) as CoachClient[])
    setStaff(staffRes as Staff[])
    setPlans((plansRes.data || []) as CoachPlan[])
    setSessions((sessionsRes.data || []) as CoachSession[])
    setMembershipEnd(Object.fromEntries(((membershipRes.data || []) as MembershipStatus[]).map(m => [m.profile_id, m.end_date])))
    setLoading(false)
  }

  const handleChangePassword = async () => {
    if (pwForm.next.length < 6) { setPwForm({ ...pwForm, message: 'Password must be at least 6 characters', ok: false }); return }
    if (pwForm.next !== pwForm.confirm) { setPwForm({ ...pwForm, message: 'Passwords do not match', ok: false }); return }
    setPwForm({ ...pwForm, saving: true, message: '' })
    const { error } = await supabase.auth.updateUser({ password: pwForm.next })
    if (error) { setPwForm({ ...pwForm, saving: false, message: 'Error: ' + error.message, ok: false }); return }
    setPwForm({ next: '', confirm: '', saving: false, message: 'Password changed ✓ Use it next time you log in.', ok: true })
    setTimeout(() => { setShowPassword(false); setPwForm(p => ({ ...p, message: '' })) }, 2500)
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  // Plans tab, today's day open (the client page reads tab and day). Dojo: no plans, so the Sessions tab with
  // the Log session form open (stop-gap attendance until Build 3)
  const openClient = (id: string) => {
    if (openingId) return
    setOpeningId(id)
    const dojoHome = isDojo(company?.business_type)
    // Dojo with attendance: the student's Attendance tab; before that, Sessions with Log session open
    router.push(dojoHome ? (attToday ? `/company/client/${id}?tab=sessions` : `/company/client/${id}?tab=sessions&log=today`) : `/company/client/${id}?tab=plans&day=today`)
    setTimeout(() => setOpeningId(prev => (prev === id ? null : prev)), 10000) // safety reset
  }

  if (loading) return (
    <div className="min-h-screen bg-gray-950 text-white" aria-busy="true">
      <span className="sr-only" role="status">Loading today&apos;s list…</span>
      <div className="bg-gray-900 border-b border-gray-800 px-4 py-4 flex items-center gap-3">
        <div className="h-10 w-10 rounded-xl bg-gray-800 animate-pulse" />
        <div className="space-y-2">
          <div className="h-4 w-32 rounded bg-gray-800 animate-pulse" />
          <div className="h-3 w-24 rounded bg-gray-800/70 animate-pulse" />
        </div>
      </div>
      <div className="max-w-2xl mx-auto px-4 py-5 space-y-3">
        <div className="h-9 rounded-xl bg-gray-900 border border-gray-800 animate-pulse" />
        {[0, 1, 2, 3].map(i => <div key={i} className="h-20 rounded-2xl bg-gray-900 border border-gray-800 animate-pulse" />)}
      </div>
    </div>
  )

  const country = company?.country ?? 'IN'
  // Dojo (business type martial_arts): "Sensei" and "students" (every student is a PT client there), lib/labels.ts
  const bt = company?.business_type
  const sw = staffWord(bt)
  const pw = ptWord(bt)
  const dojo = isDojo(bt)
  // Attendance replaces logged sessions for "came today" once the attendance table exists
  const attendanceMode = dojo && attToday !== null
  const cameIds = new Set((attToday || []).map(r => r.profile_id))
  const isDone = (r: TodayRow) => (attendanceMode ? cameIds.has(r.client.id) : !!r.doneToday)
  const todaysBatches = attendanceMode
    ? batchesOn(dojoBatches.filter(b => !dojoBranches.find(x => x.id === b.branch_id)?.is_archived), today)
    : []
  const who = dojo ? 'students' : 'clients'
  const coaches = staff.filter(s => s.role === 'coach')
  // A session dated before its plan started counts in its own week, not as that plan's day (14 Nov)
  const rows = sortRows(todayRows(clients, plans, withoutEarlyLinks(sessions, plans), staff, me?.id || '', today, sw.one,
    new Set(staff.filter(x => x.role === 'coach').map(x => x.id))))
  const q = search.trim().toLowerCase()
  const shown = rows
    .filter(r => filter === 'all' || (filter === 'mine' ? r.isMine : !isDone(r)))
    .filter(r => !q || r.client.full_name.toLowerCase().includes(q) || (r.client.phone || '').includes(q))
  // Dojo: no plans (attendance replaces them later), so never the "no plans" note
  const noPlansThisWeek = !dojo && clients.length > 0 && rows.every(r => r.todayDay === 'no-plan')
  const counts: Record<Filter, number> = {
    all: rows.length,
    mine: rows.filter(r => r.isMine).length,
    'not-yet': rows.filter(r => !isDone(r)).length,
  }

  // Only when it matters: ends within 7 days, or already ended
  const membershipTag = (clientId: string) => {
    const end = membershipEnd[clientId]
    const left = daysUntil(end)
    if (left == null || left > 7) return null
    return left < 0
      ? <span className="text-[11px] px-2 py-0.5 rounded-full bg-red-950 text-red-300 border border-red-900">Membership expired</span>
      : <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-950 text-amber-300 border border-amber-900">Membership ends {formatDate(end, country, 'dayMonth')}</span>
  }

  const workoutText = (r: TodayRow) => {
    if (dojo) return null
    if (r.todayDay === 'no-plan') return <span className="text-gray-500">No plan this week</span>
    if (r.todayDay === 'rest') return <span className="text-gray-500">Rest day</span>
    return <span className="text-gray-300">{r.todayDay.label}{r.workoutTime ? ` · ${workoutTimeLabel(r.workoutTime, country)}` : ''}</span>
  }

  const coachLine = (r: TodayRow) => (r.primaryCoach === 'You' ? 'You' : r.primaryCoach ? `Primary: ${r.primaryCoach}` : `No primary ${sw.one.toLowerCase()}`)

  return (
    <div data-testid="page-coach" className="min-h-screen bg-gray-950 text-white">
      {/* Header */}
      <div className="bg-gray-900 border-b border-gray-800 px-4 py-4">
        <div className="max-w-2xl mx-auto flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            {company?.logo_url ? (
              <img src={company.logo_url} alt={company.name} className="w-10 h-10 rounded-xl object-cover border border-gray-700 shrink-0" />
            ) : (
              <div className="w-10 h-10 bg-orange-500 rounded-xl flex items-center justify-center shrink-0">
                <span className="text-white font-bold">{(company?.name || 'C')[0]}</span>
              </div>
            )}
            <div className="min-w-0">
              <p className="text-xs text-gray-500 truncate">{company?.name || 'CoachBoard'}</p>
              <h1 className="text-lg font-bold text-white truncate">Hi {(me?.full_name || '').trim().split(/\s+/)[0] || sw.one}</h1>
              <p className="text-xs text-gray-400">{formatDate(today, country, 'weekday')}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button type="button" onClick={() => setShowPassword(!showPassword)} aria-expanded={showPassword}
              className="text-xs text-gray-400 hover:text-white border border-gray-700 hover:border-gray-500 px-3 py-1.5 rounded-lg transition">
              Password
            </button>
            <button data-nav onClick={handleLogout}
              className="text-xs text-gray-400 hover:text-white border border-gray-700 hover:border-gray-500 px-3 py-1.5 rounded-lg transition">
              Logout
            </button>
          </div>
        </div>
        {showPassword && (
          <div className="max-w-2xl mx-auto mt-4 space-y-2">
            <p className="text-xs text-gray-500 uppercase tracking-wider">Change password</p>
            <input type="password" placeholder="New password (min 6)" autoComplete="new-password" aria-label="New password"
              value={pwForm.next} onChange={e => setPwForm({ ...pwForm, next: e.target.value, message: '' })}
              className="w-full bg-gray-800 text-white rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm" />
            <input type="password" placeholder="Confirm new password" autoComplete="new-password" aria-label="Confirm new password"
              value={pwForm.confirm} onChange={e => setPwForm({ ...pwForm, confirm: e.target.value, message: '' })}
              className="w-full bg-gray-800 text-white rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm" />
            {pwForm.message && <p className={`text-xs ${pwForm.ok ? 'text-green-400' : 'text-red-400'}`}>{pwForm.message}</p>}
            <button type="button" onClick={handleChangePassword} disabled={pwForm.saving}
              className="w-full bg-orange-500 hover:bg-orange-600 text-white font-semibold py-2.5 rounded-xl text-sm transition disabled:opacity-50">
              {pwForm.saving ? 'Saving...' : 'Update password'}
            </button>
          </div>
        )}
      </div>

      <div className="max-w-2xl mx-auto px-4 py-5 space-y-4">
        {error && <p className="text-sm text-red-300 bg-red-950 border border-red-900 rounded-xl px-4 py-3">{error}</p>}

        {/* Dojo: today's batches across every branch; tap one to take the roll call */}
        {attendanceMode && (
          <section className="space-y-2">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-xs text-gray-500 uppercase tracking-wider">Today&apos;s batches</h2>
              <span className="flex gap-3">
                <button type="button" data-nav onClick={() => router.push('/company/attendance/today')} className="text-xs text-orange-400 hover:text-orange-300">All of today →</button>
                <button type="button" data-nav onClick={() => router.push('/company/attendance')} className="text-xs text-orange-400 hover:text-orange-300">This month →</button>
              </span>
            </div>
            {todaysBatches.length === 0 ? (
              <p className="text-sm text-gray-500 bg-gray-900 border border-gray-800 rounded-2xl px-4 py-3">No batches today.</p>
            ) : (
              <ul className="space-y-2">
                {todaysBatches.map(b => {
                  const came = (attToday || []).filter(a => a.batch_id === b.id).length
                  const branchName = dojoBranches.find(x => x.id === b.branch_id)?.name
                  return (
                    <li key={b.id}>
                      <button type="button" data-nav onClick={() => router.push(`/company/attendance/${b.id}`)}
                        className={`w-full text-left bg-gray-900 border rounded-2xl px-4 py-3 transition hover:border-gray-600 ${came ? 'border-green-900/60' : 'border-gray-800'}`}>
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-white truncate">{b.name}</p>
                            <p className="text-[11px] text-gray-500 truncate">{[dojoBranches.filter(x => !x.is_archived).length > 1 ? branchName : '', batchWhen(b, country).split(' · ')[1] || ''].filter(Boolean).join(' · ')}</p>
                          </div>
                          <span className={`text-xs shrink-0 ${came ? 'text-green-400 font-semibold' : 'text-orange-400'}`}>{came ? `${came} came` : 'Take attendance'}</span>
                        </div>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        )}

        {/* Belt grading on: exams and results, read-only for senseis */}
        {Object.keys(beltById).length > 0 && (
          <button type="button" data-nav onClick={() => router.push('/company/grading')} data-testid="grading-link"
            className="w-full text-left bg-gray-900 border border-gray-800 rounded-2xl px-4 py-3 text-sm text-gray-400 hover:border-gray-600 transition">
            Exams and results <span className="text-white font-medium">→ Belt grading</span>
          </button>
        )}

        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-xs text-gray-500 uppercase tracking-wider">Today <span className="normal-case text-gray-600">({pw})</span></h2>
          <p className="text-xs text-gray-500">
            <span className="text-green-400 font-semibold">{rows.filter(isDone).length}</span> {dojo ? 'came today' : 'trained today'}
          </p>
        </div>

        {clients.length === 0 ? (
          <div className="bg-gray-900 rounded-2xl p-8 text-center text-gray-400 border border-gray-800 text-sm">
            No {pw} yet. The owner adds them.
          </div>
        ) : (
          <>
            {/* Chips + search */}
            <div className="flex flex-wrap gap-2">
              {([['all', `All ${pw}`], ['mine', `My ${who}`], ['not-yet', dojo ? 'Not in yet today' : 'Not trained yet today']] as const).map(([key, label]) => (
                <button key={key} type="button" onClick={() => setFilter(key)} aria-pressed={filter === key}
                  className={`text-xs px-3 py-1.5 rounded-full border transition ${filter === key ? 'bg-orange-500 border-orange-500 text-white' : 'bg-gray-900 border-gray-700 text-gray-300 hover:border-gray-500'}`}>
                  {label} <span className={filter === key ? 'text-orange-100' : 'text-gray-500'}>{counts[key]}</span>
                </button>
              ))}
            </div>
            <input type="search" placeholder="Search by name or phone" value={search} onChange={e => setSearch(e.target.value)}
              className="w-full bg-gray-900 text-white rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-800 text-sm placeholder-gray-600" />

            {noPlansThisWeek && (
              <p className="text-sm text-gray-400 bg-gray-900 border border-gray-800 rounded-xl px-4 py-3">
                No plans for this week yet. Open a client to create one.
              </p>
            )}

            {shown.length === 0 ? (
              <p className="text-sm text-gray-500 text-center py-6">
                {filter === 'mine' && !q ? `No ${who} have you as their primary ${sw.one.toLowerCase()}.` : `No ${who} match.`}
              </p>
            ) : (
              <ul className="space-y-2">
                {shown.map(r => (
                  <li key={r.client.id} data-testid="coach-row" data-name={r.client.full_name}>
                    <button type="button" data-nav onClick={() => openClient(r.client.id)}
                      className={`w-full text-left bg-gray-900 border rounded-2xl px-4 py-3 transition hover:border-gray-600 ${openingId === r.client.id ? 'border-orange-500' : r.doneToday ? 'border-green-900/60' : 'border-gray-800'}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <p className="text-sm font-medium text-white truncate">{r.client.full_name}</p>
                            <BeltChip rank={beltById[clientRank[r.client.id] || '']} />
                          </div>
                          <p className={`text-[11px] ${r.isMine ? 'text-orange-400' : 'text-gray-500'}`}>{coachLine(r)}</p>
                        </div>
                        <div className="text-right shrink-0">
                          {openingId === r.client.id ? (
                            <span className="text-xs text-orange-400">Opening…</span>
                          ) : attendanceMode ? (
                            cameIds.has(r.client.id)
                              ? <span className="text-xs text-green-400 font-medium">✓ Came today · {(attToday || []).filter(a => a.profile_id === r.client.id).map(a => dojoBatches.find(b => b.id === a.batch_id)?.name).filter(Boolean).join(', ')}</span>
                              : <span className="text-xs text-gray-500">Not yet</span>
                          ) : r.doneToday ? (
                            <span className="text-xs text-green-400 font-medium">
                              ✓ {dojo ? 'Came today' : 'Done'} · by {r.doneToday.by}{r.doneToday.exercises ? ` · ${r.doneToday.exercises}` : ''}
                            </span>
                          ) : (
                            <span className="text-xs text-gray-500">{dojo ? 'Not yet · Log session' : 'Not yet'}</span>
                          )}
                        </div>
                      </div>
                      {!dojo && <p className="text-xs mt-1.5 truncate">{workoutText(r)}</p>}
                      {dojo && placement[r.client.id] && <p className="text-xs mt-1.5 truncate text-gray-400">{placement[r.client.id]}</p>}
                      {membershipTag(r.client.id) && <div className="mt-2">{membershipTag(r.client.id)}</div>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {/* Coaches: sessions each active coach logged today (read-only). Not for dojos: senseis tap attendance, nothing to tally */}
        {!dojo && coaches.some(c => !c.archived_at) && (
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">{sw.many} · sessions logged today</p>
            <ul className="space-y-1">
              {coaches.filter(c => !c.archived_at).map(c => {
                const n = sessions.filter(s => s.session_date === today && s.logged_by === c.id).length
                return (
                  <li key={c.id} className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="text-gray-200 truncate">{c.full_name}{c.id === me?.id ? ' (you)' : ''}</span>
                    <span className={n ? 'text-white font-semibold' : 'text-gray-500'}>{n}</span>
                  </li>
                )
              })}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}

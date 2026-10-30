'use client'

// Coach home (ROADMAP #40): today's training list for the gym's PT clients. Who is expected today and
// whether they've trained; not a chase list (no "missed" or follow-up prompts here).
// Coaches see PT clients only (all of them) and staff names; never memberships, payments, leads or settings.

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { type Country, normalizeCountry, formatDate, localDateIso, daysUntil } from '@/lib/locale'
import { thisWeekMonday } from '@/lib/calories'
import { todayRows, sortRows, type CoachClient, type CoachPlan, type CoachSession, type StaffMember, type TodayRow } from '@/lib/coach-today'
import { loadGymStaff } from '@/lib/gym-staff'

type Staff = StaffMember & { role: string; archived_at: string | null }
type MembershipStatus = { profile_id: string; plan_type: string | null; start_date: string | null; end_date: string | null }
type Filter = 'all' | 'mine' | 'not-yet'

export default function CoachHomePage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [me, setMe] = useState<{ id: string; full_name: string } | null>(null)
  const [company, setCompany] = useState<{ name: string; logo_url: string | null; country: Country } | null>(null)
  const [clients, setClients] = useState<CoachClient[]>([])
  const [staff, setStaff] = useState<Staff[]>([])
  const [plans, setPlans] = useState<CoachPlan[]>([])
  const [sessions, setSessions] = useState<CoachSession[]>([])
  const [membershipEnd, setMembershipEnd] = useState<Record<string, string | null>>({})
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const [openingId, setOpeningId] = useState<string | null>(null)
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
        .select('id, full_name, company_id, companies:company_id(name, logo_url, country, business_type)')
        .eq('id', user.id).single(),
      supabase.from('profiles')
        .select('id, full_name, phone, primary_coach_id, archived_at, client_type')
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

    const profile = profileRes.data as { id: string; full_name: string | null; companies: { name?: string | null; logo_url?: string | null; country?: string | null } | null } | null
    setMe({ id: user.id, full_name: profile?.full_name || '' })
    setCompany({
      name: profile?.companies?.name || '',
      logo_url: profile?.companies?.logo_url || null,
      country: normalizeCountry(profile?.companies?.country),
    })
    setClients((clientsRes.data || []) as CoachClient[])
    setStaff(staffRes as Staff[])
    setPlans((plansRes.data || []) as CoachPlan[])
    setSessions((sessionsRes.data || []) as CoachSession[])
    setMembershipEnd(Object.fromEntries(((membershipRes.data || []) as MembershipStatus[]).map(m => [m.profile_id, m.end_date])))
    setLoading(false)
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  // Plans tab, today's day open (the client page reads tab and day)
  const openClient = (id: string) => {
    if (openingId) return
    setOpeningId(id)
    router.push(`/company/client/${id}?tab=plans&day=today`)
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
  const coaches = staff.filter(s => s.role === 'coach')
  const rows = sortRows(todayRows(clients, plans, sessions, staff, me?.id || '', today))
  const q = search.trim().toLowerCase()
  const shown = rows
    .filter(r => filter === 'all' || (filter === 'mine' ? r.isMine : !r.doneToday))
    .filter(r => !q || r.client.full_name.toLowerCase().includes(q) || (r.client.phone || '').includes(q))
  const noPlansThisWeek = clients.length > 0 && rows.every(r => r.todayDay === 'no-plan')
  const counts: Record<Filter, number> = {
    all: rows.length,
    mine: rows.filter(r => r.isMine).length,
    'not-yet': rows.filter(r => !r.doneToday).length,
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
    if (r.todayDay === 'no-plan') return <span className="text-gray-500">No plan this week</span>
    if (r.todayDay === 'rest') return <span className="text-gray-500">Rest day</span>
    return <span className="text-gray-300">{r.todayDay.label}{r.workoutTime ? ` · ${r.workoutTime}` : ''}</span>
  }

  const coachLine = (r: TodayRow) => (r.primaryCoach === 'You' ? 'You' : r.primaryCoach ? `Primary: ${r.primaryCoach}` : 'No primary coach')

  return (
    <div className="min-h-screen bg-gray-950 text-white">
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
              <h1 className="text-lg font-bold text-white truncate">Hi {(me?.full_name || '').trim().split(/\s+/)[0] || 'Coach'}</h1>
              <p className="text-xs text-gray-400">{formatDate(today, country, 'weekday')}</p>
            </div>
          </div>
          <button data-nav onClick={handleLogout}
            className="text-xs text-gray-400 hover:text-white border border-gray-700 hover:border-gray-500 px-3 py-1.5 rounded-lg transition shrink-0">
            Logout
          </button>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-5 space-y-4">
        {error && <p className="text-sm text-red-300 bg-red-950 border border-red-900 rounded-xl px-4 py-3">{error}</p>}

        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-xs text-gray-500 uppercase tracking-wider">Today <span className="normal-case text-gray-600">(PT clients)</span></h2>
          <p className="text-xs text-gray-500">
            <span className="text-green-400 font-semibold">{rows.filter(r => r.doneToday).length}</span> trained today
          </p>
        </div>

        {clients.length === 0 ? (
          <div className="bg-gray-900 rounded-2xl p-8 text-center text-gray-400 border border-gray-800 text-sm">
            No PT clients yet. The owner adds them.
          </div>
        ) : (
          <>
            {/* Chips + search */}
            <div className="flex flex-wrap gap-2">
              {([['all', 'All PT clients'], ['mine', 'My clients'], ['not-yet', 'Not trained yet today']] as const).map(([key, label]) => (
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
                {filter === 'mine' && !q ? 'No clients have you as their primary coach.' : 'No clients match.'}
              </p>
            ) : (
              <ul className="space-y-2">
                {shown.map(r => (
                  <li key={r.client.id}>
                    <button type="button" data-nav onClick={() => openClient(r.client.id)}
                      className={`w-full text-left bg-gray-900 border rounded-2xl px-4 py-3 transition hover:border-gray-600 ${openingId === r.client.id ? 'border-orange-500' : r.doneToday ? 'border-green-900/60' : 'border-gray-800'}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-white truncate">{r.client.full_name}</p>
                          <p className={`text-[11px] ${r.isMine ? 'text-orange-400' : 'text-gray-500'}`}>{coachLine(r)}</p>
                        </div>
                        <div className="text-right shrink-0">
                          {openingId === r.client.id ? (
                            <span className="text-xs text-orange-400">Opening…</span>
                          ) : r.doneToday ? (
                            <span className="text-xs text-green-400 font-medium">
                              ✓ Done · by {r.doneToday.by}{r.doneToday.exercises ? ` · ${r.doneToday.exercises}` : ''}
                            </span>
                          ) : (
                            <span className="text-xs text-gray-500">Not yet</span>
                          )}
                        </div>
                      </div>
                      <p className="text-xs mt-1.5 truncate">{workoutText(r)}</p>
                      {membershipTag(r.client.id) && <div className="mt-2">{membershipTag(r.client.id)}</div>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {/* Coaches: sessions each active coach logged today (read-only) */}
        {coaches.some(c => !c.archived_at) && (
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Coaches · sessions logged today</p>
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

'use client'

// All of today's attendance on one screen (Dojo Build 3 follow-up, ROADMAP #78). Owner, partners and senseis.
// Every batch that meets today, as a table grouped by batch: tick who came, home batch / who marked it on the right.
// Any sensei can mark any student. A student already marked in another batch today shows a warning and marking them
// again asks first; two classes a day stay allowed (exams, extra practice). Same rows as the roll call page.
// ?date=YYYY-MM-DD opens another day (past days can be corrected; no future days).

import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { type Country, normalizeCountry, formatDate, localDateIso } from '@/lib/locale'
import { memberWord, staffWord } from '@/lib/labels'
import { loadGymStaff } from '@/lib/gym-staff'
import { type BeltRank, BELT_RANK_COLUMNS, gradingOn, beltsById } from '@/lib/belts'
import BeltChip from '@/app/belt-chip'
import { type Batch, type Branch, BATCH_COLUMNS, BRANCH_COLUMNS, batchWhen } from '@/lib/batches'
import { type AttendanceRow, type RosterStudent, type DayEntry, ATTENDANCE_COLUMNS, dayBoard, tapRow, addDays, elsewhereText } from '@/lib/attendance'

type Student = RosterStudent & { branch_id: string | null }

// useSearchParams needs a Suspense boundary on a static route
export default function TodayAttendancePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-950" />}>
      <TodayAttendance />
    </Suspense>
  )
}

function TodayAttendance() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const today = localDateIso()
  const asked = searchParams.get('date')
  const date = asked && /^\d{4}-\d{2}-\d{2}$/.test(asked) && asked <= today ? asked : today

  const [loading, setLoading] = useState(true)
  const [problem, setProblem] = useState('')
  const [me, setMe] = useState<{ id: string; role: string; companyId: string } | null>(null)
  const [country, setCountry] = useState<Country>('IN')
  const [businessType, setBusinessType] = useState<string | null>(null)
  // Belt grading on: the gym's belts by id (one read); empty = no chips
  const [beltById, setBeltById] = useState<Record<string, BeltRank>>({})
  const [branches, setBranches] = useState<Branch[]>([])
  const [batches, setBatches] = useState<Batch[]>([])
  const [students, setStudents] = useState<Student[]>([])
  const [rows, setRows] = useState<AttendanceRow[]>([])
  const [staff, setStaff] = useState<Record<string, { name: string; role: string }>>({})
  const [branchFilter, setBranchFilter] = useState('all')
  const [busy, setBusy] = useState<Set<string>>(new Set())
  const [confirmFor, setConfirmFor] = useState<{ batch: Batch; entry: DayEntry } | null>(null)
  const [toast, setToast] = useState<{ text: string; kind: 'success' | 'error' } | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const showToast = (text: string, kind: 'success' | 'error' = 'success') => {
    if (toastTimer.current) clearTimeout(toastTimer.current)
    setToast({ text, kind })
    toastTimer.current = setTimeout(() => setToast(null), 2500)
  }
  const mw = memberWord(businessType)
  const sw = staffWord(businessType).one

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
      const cId = profile.company_id as string
      const [br, ba, people, att, staffList, ranks] = await Promise.all([
        supabase.from('branches').select(BRANCH_COLUMNS).eq('company_id', cId).order('name'),
        supabase.from('batches').select(BATCH_COLUMNS).eq('company_id', cId),
        // Database rules give a sensei the gym's PT students (every dojo student); owners all clients
        supabase.from('profiles').select('id, full_name, branch_id, batch_id, archived_at, current_rank_id').eq('company_id', cId)
          .eq('role', 'client').is('archived_at', null).order('full_name'),
        supabase.from('attendance').select(ATTENDANCE_COLUMNS).eq('company_id', cId).eq('class_date', date),
        loadGymStaff(cId),
        // Belt grading on: the gym's belts once, for the chips
        gradingOn(co) ? supabase.from('belt_ranks').select(BELT_RANK_COLUMNS).eq('company_id', cId) : null,
      ])
      if (!live) return
      setMe({ id: user.id, role: profile.role as string, companyId: cId })
      setCountry(normalizeCountry(co?.country))
      setBusinessType(co?.business_type ?? null)
      if (att.error || br.error || ba.error) { setProblem("Attendance isn't set up yet."); setLoading(false); return }
      setBranches((br.data || []) as Branch[])
      setBatches((ba.data || []) as Batch[])
      setStudents((people.data || []) as Student[])
      setRows((att.data || []) as AttendanceRow[])
      setStaff(Object.fromEntries(staffList.map(x => [x.id, { name: x.full_name, role: x.role }])))
      if (ranks?.error) console.error('Belt ranks error:', ranks.error)
      setBeltById(beltsById((ranks && !ranks.error ? ranks.data || [] : []) as BeltRank[]))
      setLoading(false)
    })()
    return () => { live = false }
  }, [date, router])

  const shownBatches = useMemo(() => batches.filter(b => !branches.find(x => x.id === b.branch_id)?.is_archived
    && (branchFilter === 'all' || b.branch_id === branchFilter)), [batches, branches, branchFilter])
  const board = useMemo(() => dayBoard({ date, batches: shownBatches, students, rows }), [date, shownBatches, students, rows])
  const activeBranches = branches.filter(b => !b.is_archived)

  const batchById = useMemo(() => Object.fromEntries(batches.map(b => [b.id, b])), [batches])
  const timeOf = (b: Batch) => batchWhen(b, country).split(' · ')[1] || ''
  const batchLabel = (id: string) => {
    const b = batchById[id]
    return b ? [b.name, timeOf(b)].filter(Boolean).join(' ') : 'another batch'
  }
  const markedByName = (id: string | null | undefined) => {
    const p = id ? staff[id] : null
    const first = (p?.name || '').trim().split(/\s+/)[0]
    if (!first) return ''
    return p?.role === 'coach' ? `${sw} ${first}` : first
  }

  const key = (batchId: string, profileId: string) => `${batchId}:${profileId}`

  const tap = async (batch: Batch, entry: DayEntry) => {
    const s = entry.student
    const k = key(batch.id, s.id)
    if (!me || busy.has(k)) return
    const current = entry.present
    const row = tapRow({ batchId: batch.id, date, student: s, companyId: me.companyId, current, markedBy: me.id })
    const other = (r: AttendanceRow) => r.profile_id !== s.id || r.batch_id !== batch.id
    const before = rows.find(r => !other(r))
    setBusy(b => new Set(b).add(k))
    setRows(rs => [...rs.filter(other), row])
    const { data, error } = await supabase.from('attendance')
      .upsert(row, { onConflict: 'batch_id,profile_id,class_date' }).select(ATTENDANCE_COLUMNS)
    setBusy(b => { const n = new Set(b); n.delete(k); return n })
    if (error || !data?.length) {
      setRows(rs => [...rs.filter(other), ...(before ? [before] : [])])
      showToast(error ? 'Could not save: ' + error.message : "Couldn't save: not allowed for this login", 'error')
      return
    }
    setRows(rs => [...rs.filter(other), data[0] as AttendanceRow])
  }

  // Marking someone who already came to another batch today asks first
  const askOrTap = (batch: Batch, entry: DayEntry) => {
    if (!entry.present && entry.elsewhere.length) { setConfirmFor({ batch, entry }); return }
    tap(batch, entry)
  }

  const goDate = (d: string) => router.replace(`/company/attendance/today${d === today ? '' : `?date=${d}`}`)
  const back = () => router.push(me?.role === 'coach' ? '/coach' : '/company')
  const branchName = (id: string) => branches.find(x => x.id === id)?.name || ''

  return (
    <div className="min-h-screen bg-gray-950 text-white pb-10">
      {toast && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center px-6 pointer-events-none">
          <div role="status" className={`min-w-[280px] max-w-sm text-center px-10 py-6 rounded-2xl text-lg font-semibold shadow-2xl ${toast.kind === 'success' ? 'bg-green-600' : 'bg-red-600'}`}>{toast.text}</div>
        </div>
      )}

      {confirmFor && (
        <div className="fixed inset-0 z-[55] bg-black/70 flex items-end sm:items-center justify-center p-4" onClick={() => setConfirmFor(null)}>
          <div role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}
            className="w-full max-w-sm bg-gray-900 border border-gray-700 rounded-2xl p-5 space-y-3">
            <p className="text-base font-semibold">{confirmFor.entry.student.full_name} already came today</p>
            <p className="text-sm text-amber-300">{elsewhereText(confirmFor.entry.elsewhere, batchLabel, markedByName)}</p>
            <p className="text-sm text-gray-400">Mark them present in {confirmFor.batch.name} as well? Fine for a second class (exams, extra practice).</p>
            <div className="flex gap-2 pt-1">
              <button type="button" onClick={() => setConfirmFor(null)}
                className="flex-1 py-2.5 rounded-xl border border-gray-700 text-gray-300 hover:border-gray-500 text-sm">Cancel</button>
              <button type="button" onClick={() => { const c = confirmFor; setConfirmFor(null); tap(c.batch, c.entry) }}
                className="flex-1 py-2.5 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-semibold text-sm">Mark present too</button>
            </div>
          </div>
        </div>
      )}

      <div className="bg-gray-900 border-b border-gray-800 px-4 py-4 sticky top-0 z-30">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-center gap-3">
            <button data-nav onClick={back}
              className="text-xs text-gray-400 hover:text-white border border-gray-700 hover:border-gray-500 px-3 py-1.5 rounded-lg shrink-0">← Back</button>
            <div className="min-w-0 flex-1">
              <h1 className="text-lg font-bold truncate">{date === today ? "Today's attendance" : 'Attendance'}</h1>
              <p className="text-xs text-gray-500 truncate">All batches · any {sw.toLowerCase()} can mark</p>
            </div>
            {!loading && !problem && (
              <p className="text-sm shrink-0 text-right">
                <span data-testid="came-count" className="text-green-400 font-bold text-lg">{board.came}</span> <span className="text-gray-500">came</span>
                {board.twice > 0 && <span className="block text-[11px] text-amber-300">{board.twice} in 2 batches</span>}
              </p>
            )}
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

      <div className="max-w-3xl mx-auto px-4 py-4 space-y-4">
        {loading ? (
          <div className="h-32 rounded-2xl bg-gray-900 border border-gray-800 animate-pulse" aria-label="Loading" />
        ) : problem ? (
          <p className="bg-gray-900 border border-gray-800 rounded-2xl p-5 text-sm text-gray-400">{problem}</p>
        ) : (
          <div data-testid="page-attendance-today" className="space-y-4">
            {activeBranches.length > 1 && (
              <div className="flex gap-1.5 flex-wrap">
                {[{ id: 'all', name: 'All branches' }, ...activeBranches].map(b => (
                  <button key={b.id} type="button" onClick={() => setBranchFilter(b.id)} aria-pressed={branchFilter === b.id}
                    className={`text-xs px-3 py-1.5 rounded-full border ${branchFilter === b.id ? 'bg-orange-500 border-orange-500 text-white' : 'bg-gray-900 border-gray-700 text-gray-300 hover:border-gray-500'}`}>
                    {b.name}
                  </button>
                ))}
              </div>
            )}

            <p className="text-xs text-gray-500">Tick each {mw.one.toLowerCase()} who came. Tick again to undo. Not ticked = absent. ⚠ = already marked in another batch today.</p>

            {board.groups.length === 0 && <p className="bg-gray-900 border border-gray-800 rounded-2xl p-5 text-sm text-gray-400">No batches on this day.</p>}

            {board.groups.map(g => (
              <section key={g.batch.id} className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
                <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-gray-800">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate">{g.batch.name}</p>
                    <p className="text-[11px] text-gray-500 truncate">
                      {[activeBranches.length > 1 ? branchName(g.batch.branch_id) : '', timeOf(g.batch), g.extra ? 'extra class' : ''].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className={`text-xs ${g.came ? 'text-green-400 font-semibold' : 'text-gray-500'}`}>{g.came} of {g.entries.filter(e => !e.dropIn).length}{g.entries.some(e => e.dropIn) ? '+' : ''}</span>
                    <button type="button" data-nav onClick={() => router.push(`/company/attendance/${g.batch.id}${date === today ? '' : `?date=${date}`}`)}
                      className="text-xs text-sky-300 hover:text-sky-200">+ Drop-in</button>
                  </div>
                </div>
                {g.entries.length === 0 ? (
                  <p className="px-4 py-3 text-sm text-gray-500">No {mw.many.toLowerCase()} in this batch yet.</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="sr-only"><tr><th>Came</th><th>{mw.one}</th><th>Batch</th></tr></thead>
                    <tbody className="divide-y divide-gray-800">
                      {g.entries.map(e => {
                        const k = key(g.batch.id, e.student.id)
                        const also = e.elsewhere.length ? elsewhereText(e.elsewhere, batchLabel, markedByName) : ''
                        const home = e.student.batch_id ? batchById[e.student.batch_id] : null
                        const who = e.present ? markedByName(e.markedBy) : ''
                        return (
                          <tr key={k} onClick={() => askOrTap(g.batch, e)}
                            className={`cursor-pointer ${busy.has(k) ? 'opacity-60' : ''} ${e.present ? 'bg-green-950/30' : 'hover:bg-gray-800/50'}`}>
                            <td className="pl-4 pr-2 py-2.5 w-10">
                              <button type="button" role="checkbox" aria-checked={e.present} aria-label={`${e.student.full_name} came`} disabled={busy.has(k)}
                                onClick={ev => { ev.stopPropagation(); askOrTap(g.batch, e) }}
                                className={`w-6 h-6 rounded-md flex items-center justify-center text-sm ${e.present ? 'bg-green-500 text-white' : 'border border-gray-600'}`}>
                                {e.present ? '✓' : ''}
                              </button>
                            </td>
                            <td className="py-2.5 pr-2 min-w-0">
                              <span className="flex items-center gap-1.5 min-w-0">
                                <span className={`truncate font-medium ${e.present ? 'text-white' : 'text-gray-300'}`}>{e.student.full_name}</span>
                                <BeltChip rank={beltById[e.student.current_rank_id || '']} />
                              </span>
                              {also && <span className="block text-[11px] text-amber-300 truncate">⚠ {e.present ? 'Also came today' : 'Already came today'} · {also}</span>}
                            </td>
                            <td className="py-2.5 pr-4 text-right text-[11px] whitespace-nowrap align-top">
                              {e.dropIn
                                ? <span className="text-sky-300">Drop-in{home ? ` · ${home.name}` : ''}</span>
                                : <span className="text-gray-500">Home</span>}
                              {who && <span className="block text-gray-500">by {who}</span>}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )}
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

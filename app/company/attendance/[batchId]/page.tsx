'use client'

// Roll call for one batch on one day (Dojo Build 3, ROADMAP #78; db/2026-11-03-attendance.md).
// Senseis, the owner and partners tap who came; tap again to undo (saved as present = false, never deleted).
// Everyone not tapped counts as absent. "+ Drop-in" adds a student from another batch.
// ?date=YYYY-MM-DD opens another day (past days can be corrected; no future days).
// The whole day's attendance is loaded (every batch), so a student already marked in another batch shows
// "Already came today · Kids 5 PM · by Sensei Ravi" and marking them here asks first. Two classes a day stay allowed.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { type Country, normalizeCountry, formatDate, localDateIso } from '@/lib/locale'
import { memberWord, staffWord } from '@/lib/labels'
import { loadGymStaff } from '@/lib/gym-staff'
import { type Batch, type Branch, BATCH_COLUMNS, BRANCH_COLUMNS, batchWhen, sortDays } from '@/lib/batches'
import { type AttendanceRow, type RosterStudent, ATTENDANCE_COLUMNS, roster, tapRow, addDays, weekdayOf, cameElsewhere, elsewhereText } from '@/lib/attendance'

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
  const [businessType, setBusinessType] = useState<string | null>(null)
  const [batch, setBatch] = useState<Batch | null>(null)
  const [branch, setBranch] = useState<Branch | null>(null)
  const [students, setStudents] = useState<RosterStudent[]>([])
  const [rows, setRows] = useState<AttendanceRow[]>([])   // the whole day, every batch
  const [allBatches, setAllBatches] = useState<Batch[]>([])
  const [staff, setStaff] = useState<Record<string, { name: string; role: string }>>({})
  const [confirmFor, setConfirmFor] = useState<RosterStudent | null>(null)
  const [busy, setBusy] = useState<Set<string>>(new Set())
  const [showDropIn, setShowDropIn] = useState(false)
  const [query, setQuery] = useState('')
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
      const co = (profile as unknown as { companies: { country?: string | null; business_type?: string | null } | null }).companies
      const [ba, people, att, gymBatches, staffList] = await Promise.all([
        supabase.from('batches').select(BATCH_COLUMNS).eq('id', batchId).maybeSingle(),
        // Database rules give a sensei the gym's PT students (every dojo student); owners all clients
        supabase.from('profiles').select('id, full_name, batch_id, archived_at').eq('company_id', profile.company_id)
          .eq('role', 'client').is('archived_at', null).order('full_name'),
        // The whole day across batches, to warn when a student already came to another class
        supabase.from('attendance').select(ATTENDANCE_COLUMNS).eq('company_id', profile.company_id).eq('class_date', date),
        supabase.from('batches').select(BATCH_COLUMNS).eq('company_id', profile.company_id),
        loadGymStaff(profile.company_id as string),
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
      setStudents((people.data || []) as RosterStudent[])
      setRows((att.data || []) as AttendanceRow[])
      setAllBatches((gymBatches.data || []) as Batch[])
      setStaff(Object.fromEntries(staffList.map(x => [x.id, { name: x.full_name, role: x.role }])))
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
    if (!presentIds.has(student.id) && elsewhere(student).length) { setConfirmFor(student); return }
    tap(student)
  }

  const tap = async (student: RosterStudent) => {
    if (!me || busy.has(student.id)) return
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
      showToast(error ? 'Could not save: ' + error.message : "Couldn't save: not allowed for this login", 'error')
      return
    }
    setRows(rs => [...rs.filter(other), data[0] as AttendanceRow])
  }

  const goDate = (d: string) => router.replace(`/company/attendance/${batchId}${d === today ? '' : `?date=${d}`}`)
  const back = () => router.push(me?.role === 'coach' ? '/coach' : '/company')

  const dropInChoices = students
    .filter(s => s.batch_id !== batchId && !presentIds.has(s.id))
    .filter(s => !query.trim() || s.full_name.toLowerCase().includes(query.trim().toLowerCase()))
    .slice(0, 30)

  const notClassDay = batch && !sortDays(batch.days).includes(weekdayOf(date) as never)

  const studentButton = (s: RosterStudent, present: boolean, dropIn = false) => {
    const also = elsewhereLine(s)
    return (
    <li key={s.id}>
      <button type="button" onClick={() => askOrTap(s)} aria-pressed={present} disabled={busy.has(s.id)}
        className={`w-full flex items-center gap-3 rounded-xl px-4 py-3 border text-left transition min-h-[52px] ${present
          ? 'bg-green-950/50 border-green-800 text-white' : 'bg-gray-900 border-gray-800 text-gray-300 hover:border-gray-600'} disabled:opacity-60`}>
        <span className={`w-6 h-6 rounded-full flex items-center justify-center text-sm shrink-0 ${present ? 'bg-green-500 text-white' : 'border border-gray-600'}`}>
          {present ? '✓' : ''}
        </span>
        <span className="flex-1 min-w-0">
          <span className="block truncate text-sm font-medium">{s.full_name}</span>
          {also && <span className="block text-[11px] text-amber-300 truncate">⚠ {present ? 'Also came today' : 'Already came today'} · {also}</span>}
        </span>
        {dropIn && <span className="text-[11px] text-sky-300 border border-sky-900 bg-sky-950/60 px-1.5 py-0.5 rounded">Drop-in</span>}
      </button>
    </li>
    )
  }

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
            {notClassDay && <p className="text-xs text-amber-300 bg-amber-950/40 border border-amber-900 rounded-xl px-3 py-2">This batch doesn&apos;t usually meet on {weekdayOf(date)}. You can still mark an extra class.</p>}
            <p className="text-xs text-gray-500">Tap each {mw.one.toLowerCase()} who came. Tap again to undo. Not tapped = absent.</p>

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

            {showDropIn ? (
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

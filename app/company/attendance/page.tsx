'use client'

// Monthly attendance (Dojo Build 3, ROADMAP #78): each student's classes attended this month vs their home
// batch's classes so far ("9 of 12"), grouped by branch and batch, plus today's batches to open a roll call.
// Owner, partners and senseis (no money on this page). Read-only here: marking happens on the roll call page.

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { type Country, normalizeCountry, formatDate, localDateIso } from '@/lib/locale'
import { memberWord } from '@/lib/labels'
import { type Batch, type Branch, BATCH_COLUMNS, BRANCH_COLUMNS, batchWhen, sortBatches } from '@/lib/batches'
import { type AttendanceRow, ATTENDANCE_COLUMNS, monthRange, monthStats, statsText, batchesOn, addDays } from '@/lib/attendance'

type Student = { id: string; full_name: string; branch_id: string | null; batch_id: string | null }

export default function AttendanceMonthPage() {
  const router = useRouter()
  const today = localDateIso()
  const [month, setMonth] = useState(today)          // any date in the month shown
  const [role, setRole] = useState<string | null>(null)
  const [country, setCountry] = useState<Country>('IN')
  const [businessType, setBusinessType] = useState<string | null>(null)
  const [companyName, setCompanyName] = useState('')
  const [branches, setBranches] = useState<Branch[]>([])
  const [batches, setBatches] = useState<Batch[]>([])
  const [students, setStudents] = useState<Student[]>([])
  const [rows, setRows] = useState<AttendanceRow[]>([])
  const [branchFilter, setBranchFilter] = useState('all')
  const [loading, setLoading] = useState(true)
  const [missing, setMissing] = useState(false)
  const mw = memberWord(businessType)
  const range = monthRange(month)

  useEffect(() => {
    let live = true
    ;(async () => {
      setLoading(true)
      const { data: { session } } = await supabase.auth.getSession()
      const user = session?.user
      if (!user) { router.push('/login'); return }
      const { data: profile } = await supabase.from('profiles')
        .select('role, company_id, companies:company_id(*)').eq('id', user.id).single()
      if (!profile?.company_id) { router.push('/login'); return }
      const co = (profile as unknown as { companies: { name?: string | null; country?: string | null; business_type?: string | null } | null }).companies
      const cId = profile.company_id as string
      const [br, ba, people, att] = await Promise.all([
        supabase.from('branches').select(BRANCH_COLUMNS).eq('company_id', cId).order('name'),
        supabase.from('batches').select(BATCH_COLUMNS).eq('company_id', cId),
        supabase.from('profiles').select('id, full_name, branch_id, batch_id').eq('company_id', cId)
          .eq('role', 'client').is('archived_at', null).order('full_name'),
        supabase.from('attendance').select(ATTENDANCE_COLUMNS).eq('company_id', cId)
          .gte('class_date', range.from).lte('class_date', range.to).eq('present', true).limit(20000),
      ])
      if (!live) return
      setRole(profile.role as string)
      setCompanyName(co?.name || '')
      setCountry(normalizeCountry(co?.country))
      setBusinessType(co?.business_type ?? null)
      if (att.error || br.error || ba.error) { setMissing(true); setLoading(false); return }
      setBranches((br.data || []) as Branch[])
      setBatches((ba.data || []) as Batch[])
      setStudents((people.data || []) as Student[])
      setRows((att.data || []) as AttendanceRow[])
      setLoading(false)
    })()
    return () => { live = false }
  }, [router, range.from, range.to])

  const batchById = useMemo(() => Object.fromEntries(batches.map(b => [b.id, b])), [batches])
  const shownBranches = branches.filter(b => (branchFilter === 'all' || b.id === branchFilter) && (!b.is_archived || students.some(s => s.branch_id === b.id)))
  const todays = batchesOn(batches.filter(b => !branches.find(x => x.id === b.branch_id)?.is_archived), today)

  // A student's line: "9 of 12 classes" + the share of their home batch's classes
  const line = (s: Student) => {
    const st = monthStats({ profileId: s.id, homeBatch: s.batch_id ? batchById[s.batch_id] : null, rows, month, today })
    const pctVal = st.scheduled ? Math.round((Math.min(st.attended, st.scheduled) / st.scheduled) * 100) : null
    return { text: statsText(st), pct: pctVal }
  }
  const pctCls = (p: number | null) => p == null ? 'text-gray-400' : p >= 75 ? 'text-green-400' : p >= 50 ? 'text-amber-400' : 'text-red-400'

  const group = (title: string, list: Student[], sub?: string) => list.length === 0 ? null : (
    <div key={title + (sub || '')} className="space-y-1">
      <p className="text-xs text-gray-400">{title}{sub ? <span className="text-gray-600"> · {sub}</span> : null} <span className="text-gray-600">({list.length})</span></p>
      <ul className="divide-y divide-gray-800 bg-gray-950/50 rounded-xl border border-gray-800">
        {list.map(s => {
          const l = line(s)
          return (
            <li key={s.id}>
              <button type="button" data-nav onClick={() => router.push(`/company/client/${s.id}?tab=sessions`)}
                className="w-full flex items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-gray-800/60 rounded-xl">
                <span className="text-sm text-white truncate">{s.full_name}</span>
                <span className="text-sm shrink-0"><span className={`font-semibold ${pctCls(l.pct)}`}>{l.text}</span>{l.pct != null && <span className="text-xs text-gray-500"> · {l.pct}%</span>}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-950 text-white pb-10">
      <div className="bg-gray-900 border-b border-gray-800 px-4 sm:px-8 py-4">
        <div className="flex items-center gap-3 min-w-0">
          <button data-nav onClick={() => router.push(role === 'coach' ? '/coach' : '/company')}
            className="text-xs text-gray-400 hover:text-white border border-gray-700 hover:border-gray-500 px-3 py-1.5 rounded-lg shrink-0">← Back</button>
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-bold">Attendance</h1>
            {companyName && <p className="text-xs text-gray-500 truncate">{companyName}</p>}
          </div>
        </div>
      </div>

      <div className="px-4 sm:px-8 py-5 max-w-3xl mx-auto space-y-4">
        {loading ? (
          <div className="h-32 rounded-2xl bg-gray-900 border border-gray-800 animate-pulse" aria-label="Loading" />
        ) : missing ? (
          <p className="bg-gray-900 border border-gray-800 rounded-2xl p-5 text-sm text-gray-400">Attendance isn&apos;t set up yet.</p>
        ) : (
          <>
            {/* Today's batches: open the roll call */}
            {month >= monthRange(today).from && (
              <section className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
                <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Today&apos;s batches</p>
                {todays.length === 0 ? <p className="text-sm text-gray-500">No batches today.</p> : (
                  <div className="flex flex-wrap gap-2">
                    {todays.map(b => (
                      <button key={b.id} type="button" data-nav onClick={() => router.push(`/company/attendance/${b.id}`)}
                        className="text-xs px-3 py-2 rounded-lg border border-gray-700 bg-gray-800 text-gray-200 hover:border-orange-600">
                        {branches.length > 1 ? `${branches.find(x => x.id === b.branch_id)?.name} · ` : ''}{b.name} <span className="text-gray-400">{batchWhen(b, country).split(' · ')[1] || ''}</span>
                      </button>
                    ))}
                  </div>
                )}
              </section>
            )}

            <div className="flex items-center justify-between">
              <button type="button" onClick={() => setMonth(addDays(range.from, -1))} aria-label="Previous month"
                className="w-10 h-10 rounded-lg border border-gray-700 text-gray-300 hover:border-gray-500">‹</button>
              <p className="text-sm font-medium">{formatDate(range.from, country, 'monthLong')} {range.from.slice(0, 4)}</p>
              <button type="button" onClick={() => setMonth(addDays(range.to, 1))} disabled={range.to >= today} aria-label="Next month"
                className="w-10 h-10 rounded-lg border border-gray-700 text-gray-300 hover:border-gray-500 disabled:opacity-30">›</button>
            </div>

            {branches.filter(b => !b.is_archived).length > 1 && (
              <div className="flex gap-1.5 flex-wrap">
                {[{ id: 'all', name: 'All branches' }, ...branches.filter(b => !b.is_archived)].map(b => (
                  <button key={b.id} type="button" onClick={() => setBranchFilter(b.id)} aria-pressed={branchFilter === b.id}
                    className={`text-xs px-3 py-1.5 rounded-full border ${branchFilter === b.id ? 'bg-orange-500 border-orange-500 text-white' : 'bg-gray-900 border-gray-700 text-gray-300 hover:border-gray-500'}`}>
                    {b.name}
                  </button>
                ))}
              </div>
            )}

            <p className="text-xs text-gray-500">Classes attended (any batch) vs their home batch&apos;s classes so far this month.</p>

            {shownBranches.map(br => (
              <section key={br.id} className="bg-gray-900 border border-gray-800 rounded-2xl p-4 space-y-3">
                <p className="text-base font-semibold">{br.name}{br.is_archived ? ' (archived)' : ''}</p>
                {sortBatches(batches.filter(b => b.branch_id === br.id && (!b.is_archived || students.some(s => s.batch_id === b.id)))).map(b =>
                  group(b.name + (b.is_archived ? ' (archived)' : ''), students.filter(s => s.batch_id === b.id), batchWhen(b, country)))}
                {group(`No home batch`, students.filter(s => s.branch_id === br.id && !s.batch_id))}
              </section>
            ))}
            {branchFilter === 'all' && students.some(s => !s.branch_id) && (
              <section className="bg-gray-900 border border-gray-800 rounded-2xl p-4 space-y-3">
                {group(`No branch`, students.filter(s => !s.branch_id))}
              </section>
            )}
            {students.length === 0 && <p className="text-sm text-gray-500">No {mw.many.toLowerCase()} yet.</p>}
          </>
        )}
      </div>
    </div>
  )
}

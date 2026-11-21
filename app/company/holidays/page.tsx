'use client'

// Dojo holidays (owner / partner; db/2026-11-19-dojo-activities-absences.md; rules in lib/holidays.ts).
// A month calendar. Branch chips (2+ branches): All branches or one branch. Tap a date to add a named holiday for
// the chosen scope, or to remove one. A holiday closes the whole day for that branch (or every branch): the roll
// call, All of today and the sensei home show "No classes — <name>" and don't save, nobody counts as absent.
// Remove = removed_at (never deleted, CLAUDE.md Rule #1). Before the SQL ran, the page says so.

import PageNav from '@/app/page-nav'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { type Country, normalizeCountry, formatDate, localDateIso } from '@/lib/locale'
import { isDojo } from '@/lib/labels'
import { type Branch, BRANCH_COLUMNS, WEEKDAYS } from '@/lib/batches'
import {
  type Holiday, HOLIDAY_COLUMNS, HOLIDAY_NAME_MAX, holidaysShown, canAdd, holidayProblem, tidyHolidayName,
  monthGrid, shiftMonth, monthBounds,
} from '@/lib/holidays'
import { saveErrorText } from '@/lib/dojo-activities'

export default function HolidaysPage() {
  const router = useRouter()
  const today = localDateIso()
  const [loading, setLoading] = useState(true)
  const [missing, setMissing] = useState(false)
  const [notDojo, setNotDojo] = useState(false)
  const [me, setMe] = useState<{ id: string; companyId: string } | null>(null)
  const [companyName, setCompanyName] = useState('')
  const [country, setCountry] = useState<Country>('IN')
  const [branches, setBranches] = useState<Branch[]>([])
  const [scope, setScope] = useState<string>('all')
  const [month, setMonth] = useState(shiftMonth(today, 0))
  const [holidays, setHolidays] = useState<Holiday[]>([])
  const [monthLoading, setMonthLoading] = useState(false)
  const [openDate, setOpenDate] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<{ text: string; kind: 'success' | 'error' } | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const showToast = (text: string, kind: 'success' | 'error' = 'success') => {
    if (toastTimer.current) clearTimeout(toastTimer.current)
    setToast({ text, kind })
    toastTimer.current = setTimeout(() => setToast(null), 2500)
  }

  useEffect(() => {
    let live = true
    ;(async () => {
      const { data: { session } } = await supabase.auth.getSession()
      const user = session?.user
      if (!user) { router.push('/login'); return }
      const { data: profile } = await supabase
        .from('profiles').select('company_id, companies:company_id(*)').eq('id', user.id).single()
      if (!profile?.company_id) { router.push('/login'); return }
      const co = (profile as unknown as { companies: { name?: string | null; country?: string | null; business_type?: string | null } | null }).companies
      const br = await supabase.from('branches').select(BRANCH_COLUMNS).eq('company_id', profile.company_id).order('created_at')
      if (!live) return
      setMe({ id: user.id, companyId: profile.company_id as string })
      setCompanyName(co?.name || '')
      setCountry(normalizeCountry(co?.country))
      if (!isDojo(co?.business_type)) setNotDojo(true)
      setBranches(((br.data || []) as Branch[]).filter(b => !b.is_archived))
      setLoading(false)
    })()
    return () => { live = false }
  }, [router])

  // The shown month's holidays (any branch); an error = the table isn't there yet
  useEffect(() => {
    if (!me) return
    let live = true
    ;(async () => {
      setMonthLoading(true)
      const { from, to } = monthBounds(month)
      const res = await supabase.from('holidays').select(HOLIDAY_COLUMNS).eq('company_id', me.companyId)
        .is('removed_at', null).gte('holiday_date', from).lte('holiday_date', to)
      if (!live) return
      if (res.error) setMissing(true)
      else setHolidays((res.data || []) as Holiday[])
      setMonthLoading(false)
    })()
    return () => { live = false }
  }, [me, month])

  const branchName = (id: string | null) => (id ? branches.find(b => b.id === id)?.name || 'Branch' : 'All branches')
  const scopeLabel = scope === 'all' ? 'all branches' : branchName(scope)

  const open = (d: string) => { setOpenDate(d); setName(''); setError('') }

  const add = async () => {
    if (!me || !openDate || saving) return
    const problem = holidayProblem(name)
    if (problem) { setError(problem); return }
    setSaving(true)
    const { data, error } = await supabase.from('holidays').insert({
      company_id: me.companyId, branch_id: scope === 'all' ? null : scope, holiday_date: openDate,
      name: tidyHolidayName(name), created_by: me.id,
    }).select(HOLIDAY_COLUMNS)
    setSaving(false)
    if (error || !data?.length) {
      setError(error?.code === '23505' ? 'There is already a holiday on this day for ' + scopeLabel + '.' : saveErrorText(error))
      return
    }
    setHolidays(l => [...l, data[0] as Holiday])
    showToast(`${tidyHolidayName(name)} added ✓`)
    setOpenDate(null)
  }

  const remove = async (h: Holiday) => {
    if (!me || saving) return
    setSaving(true)
    const { data, error } = await supabase.from('holidays')
      .update({ removed_at: new Date().toISOString(), removed_by: me.id }).eq('id', h.id).select('id')
    setSaving(false)
    if (error || !data?.length) { setError(saveErrorText(error)); return }
    setHolidays(l => l.filter(x => x.id !== h.id))
    showToast(`${h.name} removed`)
  }

  const weeks = monthGrid(month)
  const shownOpen = openDate ? holidaysShown(holidays, scope, openDate) : []

  return (
    <div className="min-h-screen bg-gray-950 text-white pb-10">
      <PageNav />
      {toast && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center px-6 pointer-events-none">
          <div role="status" className={`min-w-[280px] max-w-sm text-center px-10 py-6 rounded-2xl text-lg font-semibold shadow-2xl ${toast.kind === 'success' ? 'bg-green-600' : 'bg-red-600'}`}>{toast.text}</div>
        </div>
      )}

      {openDate && (
        <div className="fixed inset-0 z-[55] bg-black/70 flex items-end sm:items-center justify-center p-4" onClick={() => setOpenDate(null)}>
          <div role="dialog" aria-modal="true" aria-label="Holiday" onClick={e => e.stopPropagation()}
            className="w-full max-w-sm bg-gray-900 border border-gray-700 rounded-2xl p-5 space-y-3">
            <p className="text-base font-semibold">{formatDate(openDate, country, 'weekday')}</p>
            {shownOpen.length > 0 && (
              <ul className="space-y-2">
                {shownOpen.map(h => (
                  <li key={h.id} data-testid="holiday-item" className="flex items-center gap-2 bg-gray-800/60 rounded-xl px-3 py-2">
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm text-white truncate">{h.name}</span>
                      <span className="block text-[11px] text-gray-500">{branchName(h.branch_id)}</span>
                    </span>
                    <button type="button" onClick={() => remove(h)} disabled={saving}
                      className="text-xs text-gray-300 border border-gray-700 hover:border-red-700 hover:text-red-300 px-3 py-1.5 rounded-lg disabled:opacity-50">Remove</button>
                  </li>
                ))}
              </ul>
            )}
            {canAdd(holidays, scope, openDate) ? (
              <div className="space-y-2">
                <input value={name} autoFocus maxLength={HOLIDAY_NAME_MAX} onChange={e => setName(e.target.value)} aria-label="Holiday name"
                  placeholder="Holiday name (e.g. Diwali)" onKeyDown={e => { if (e.key === 'Enter') add() }}
                  className="w-full bg-gray-800 text-white rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm placeholder-gray-500" />
                <p className="text-[11px] text-gray-500">No classes at {scopeLabel} on this day. Nobody counts as absent.</p>
              </div>
            ) : (
              <p className="text-[11px] text-gray-500">This day is already a holiday for {scopeLabel}.</p>
            )}
            {error && <p className="text-xs text-red-400">{error}</p>}
            <div className="flex gap-2 pt-1">
              <button type="button" onClick={() => setOpenDate(null)}
                className="flex-1 py-2.5 rounded-xl border border-gray-700 text-gray-300 hover:border-gray-500 text-sm">Close</button>
              {canAdd(holidays, scope, openDate) && (
                <button type="button" onClick={add} disabled={saving}
                  className="flex-1 py-2.5 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-semibold text-sm disabled:opacity-50">{saving ? 'Saving…' : 'Add holiday'}</button>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="bg-gray-900 border-b border-gray-800 px-4 sm:px-8 py-4">
        <div className="flex items-center gap-3 min-w-0">
          <button data-nav onClick={() => router.push('/company')}
            className="text-xs text-gray-400 hover:text-white border border-gray-700 hover:border-gray-500 px-3 py-1.5 rounded-lg transition shrink-0">← Back</button>
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-bold text-white">Holidays</h1>
            {companyName && <p className="text-xs text-gray-500 truncate">{companyName}</p>}
          </div>
        </div>
      </div>

      <div className="px-4 sm:px-8 py-5 max-w-2xl mx-auto space-y-4">
        {loading ? (
          <div className="h-64 rounded-2xl bg-gray-900 border border-gray-800 animate-pulse" aria-label="Loading" />
        ) : missing || notDojo ? (
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 text-sm text-gray-400">
            {notDojo ? 'Holidays are for dojos.' : "Holidays aren't set up yet. CoachBoard will switch them on for your account."}
          </div>
        ) : (
          <div data-testid="page-holidays" className="space-y-4">
            <p className="text-xs text-gray-400">Tap a date to add a holiday or remove one. On a holiday there are no classes and nobody counts as absent.</p>

            {branches.length > 1 && (
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Branch">
                {[{ id: 'all', name: 'All branches' }, ...branches].map(b => (
                  <button key={b.id} type="button" aria-pressed={scope === b.id} onClick={() => setScope(b.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${scope === b.id ? 'bg-orange-500 text-white' : 'bg-gray-800 text-gray-400 border border-gray-700 hover:border-gray-500'}`}>
                    {b.name}
                  </button>
                ))}
              </div>
            )}

            <div className="flex items-center justify-between">
              <button type="button" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Previous month"
                className="w-10 h-10 rounded-lg border border-gray-700 text-gray-300 hover:border-gray-500">‹</button>
              <p className="text-sm font-semibold" data-testid="holiday-month">{formatDate(month, country, 'monthYear')}</p>
              <button type="button" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Next month"
                className="w-10 h-10 rounded-lg border border-gray-700 text-gray-300 hover:border-gray-500">›</button>
            </div>

            <div className={`bg-gray-900 border border-gray-800 rounded-2xl p-2 ${monthLoading ? 'opacity-60' : ''}`}>
              <div className="grid grid-cols-7 text-center text-[10px] text-gray-500 uppercase pb-1">
                {WEEKDAYS.map(d => <span key={d}>{d}</span>)}
              </div>
              {weeks.map((w, i) => (
                <div key={i} className="grid grid-cols-7 gap-1">
                  {w.map((d, j) => {
                    if (!d) return <span key={j} />
                    const hs = holidaysShown(holidays, scope, d)
                    return (
                      <button key={d} type="button" data-date={d} onClick={() => open(d)}
                        aria-label={`${formatDate(d, country, 'weekday')}${hs.length ? `: ${hs.map(h => h.name).join(', ')}` : ''}`}
                        className={`min-h-[52px] rounded-lg px-1 py-1 text-left border transition ${hs.length
                          ? 'bg-amber-950/50 border-amber-800' : 'bg-gray-950/40 border-gray-800 hover:border-gray-600'} ${d === today ? 'ring-1 ring-orange-500' : ''}`}>
                        <span className={`block text-xs ${hs.length ? 'text-amber-200 font-semibold' : 'text-gray-300'}`}>{Number(d.slice(8))}</span>
                        {hs.length > 0 && <span className="block text-[9px] leading-tight text-amber-300 line-clamp-2 break-words">{hs[0].name}{hs.length > 1 ? ` +${hs.length - 1}` : ''}</span>}
                      </button>
                    )
                  })}
                </div>
              ))}
            </div>

            {holidays.length > 0 && (
              <ul className="space-y-1.5">
                {[...holidays].filter(h => scope === 'all' || !h.branch_id || h.branch_id === scope)
                  .sort((a, b) => a.holiday_date.localeCompare(b.holiday_date)).map(h => (
                    <li key={h.id} className="flex items-center gap-3 text-sm">
                      <span className="w-20 text-xs text-gray-500 shrink-0">{formatDate(h.holiday_date, country, 'dayMonth')}</span>
                      <span className="flex-1 min-w-0 truncate text-white">{h.name}</span>
                      <span className="text-[11px] text-gray-500 shrink-0">{branchName(h.branch_id)}</span>
                    </li>
                  ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

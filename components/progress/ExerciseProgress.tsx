'use client'

// Per-exercise progress list (19 Nov, client view build Part A): a summary strip (new bests / stalled /
// not done in 2+ weeks), one compact row per exercise with a sparkline, filters (plan day, muscle group,
// search, who logged it) and a detail sheet with the chart and the set-by-set history.
// mode: 'coach' = owner / partner / coach on the client page; 'client' = a PT client's own app (read-only,
// no "logged by" filter); 'self' = a self-training member (Part C). Same numbers in every mode, all from
// lib/progress.ts. Replaces app/exercise-progress.tsx on the client page (that file is kept, Rule #1).
// Load it with next/dynamic: Chart.js is only downloaded when the list is shown.
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Chart as ChartJS, CategoryScale, LinearScale, LineElement, PointElement, Tooltip,
} from 'chart.js'
import { Line } from 'react-chartjs-2'
import { type Exercise, muscleLabel } from '@/lib/exercises'
import { type PlanJson } from '@/lib/plan-structure'
import { type Country, formatDate } from '@/lib/locale'
import {
  type ProgressLog, type ExerciseRow, type ProgressEntry, type Period, progressRange, exerciseRows,
  progressSummary, bestSetText, changeAmountText, compactSets, chartAxis, planWorkoutDays, entryValue,
  NOT_DONE_DAYS, weightText,
} from '@/lib/progress'

ChartJS.register(CategoryScale, LinearScale, LineElement, PointElement, Tooltip)

export type ProgressMode = 'coach' | 'client' | 'self'
type Focus = 'all' | 'newBest' | 'stalled' | 'notDone'

const SEARCH_FROM = 12 // a search box when there are more exercises than this

export default function ExerciseProgress({
  mode, logs, library, plan, today, country, loggerName, title = 'Strength by exercise',
}: {
  mode: ProgressMode
  logs: ProgressLog[]
  library: Exercise[]
  plan: PlanJson | null          // the current plan (Day chips, "not done in 2+ weeks")
  today: string                  // YYYY-MM-DD (local)
  country: Country
  loggerName: (loggedBy: string | null) => string // "Coach Ravi", "Anand", "Client", "You"
  title?: string
}) {
  const [by, setBy] = useState<Period>('week')
  const [focus, setFocus] = useState<Focus>('all')
  const [day, setDay] = useState<number | null>(null)
  const [muscle, setMuscle] = useState<string | null>(null)
  const [logger, setLogger] = useState<string | null>(null) // coach mode: "who logged" filter (loggerName text)
  const [query, setQuery] = useState('')
  const [openKey, setOpenKey] = useState<string | null>(null)

  const range = useMemo(() => progressRange(today, by), [today, by])
  const loggers = useMemo(() => [...new Set(logs.map(l => loggerName(l.logged_by ?? null)))].sort(), [logs, loggerName])
  const shownLogs = useMemo(
    () => (mode === 'coach' && logger ? logs.filter(l => loggerName(l.logged_by ?? null) === logger) : logs),
    [logs, logger, mode, loggerName],
  )
  const rows = useMemo(() => exerciseRows({ logs: shownLogs, library, range, plan }), [shownLogs, library, range, plan])
  const summary = progressSummary(rows)
  const days = planWorkoutDays(plan)
  const muscles = [...new Set(rows.map(r => r.muscleGroup).filter((m): m is string => !!m))]
    .sort((a, b) => muscleLabel(a).localeCompare(muscleLabel(b)))

  const q = query.trim().toLowerCase()
  const list = rows.filter(r =>
    (focus === 'all' || (focus === 'newBest' && r.newBest) || (focus === 'stalled' && r.stalled) || (focus === 'notDone' && r.notDone))
    && (day == null || r.planDays.includes(day))
    && (!muscle || r.muscleGroup === muscle)
    && (!q || r.name.toLowerCase().includes(q)))
  const open = rows.find(r => r.key === openKey) ?? null

  if (!logs.length && !rows.length) return null

  const periodLabel = (p: string) => (by === 'week' ? formatDate(p, country, 'dayMonth') : formatDate(`${p}-01`, country, 'month'))
  const toggle = (on: boolean) => `px-3 py-1 rounded-full text-xs transition ${on ? 'bg-gray-700 text-white font-semibold' : 'text-gray-400'}`
  const chip = (on: boolean) => `text-xs px-3 py-1.5 rounded-full border transition ${on ? 'bg-orange-500 border-orange-500 text-white font-semibold' : 'border-gray-700 text-gray-300'}`
  const tile = (key: Focus, count: number, label: string, tone: string) => (
    <button type="button" aria-pressed={focus === key} onClick={() => setFocus(focus === key ? 'all' : key)}
      data-testid={`progress-summary-${key}`}
      className={`rounded-xl px-2 py-2.5 text-center border transition ${focus === key ? 'border-orange-500 bg-orange-500/10' : 'border-gray-800 bg-gray-950/40'}`}>
      <p className={`text-xl font-bold ${count ? tone : 'text-gray-600'}`}>{count}</p>
      <p className="text-[11px] text-gray-400 leading-tight mt-0.5">{label}</p>
    </button>
  )

  return (
    <div className="bg-gray-900 rounded-2xl p-4 sm:p-5 border border-gray-800" data-testid="exercise-progress">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs text-gray-500 uppercase tracking-wider">{title}</p>
          <p className="text-[11px] text-gray-600 mt-0.5">
            {by === 'week' ? `Last ${range.periods.length} weeks` : `Last ${range.periods.length} months`} · heaviest set
          </p>
        </div>
        <div className="flex shrink-0 bg-gray-800 rounded-full p-0.5" role="group" aria-label="Show by">
          <button type="button" aria-pressed={by === 'week'} onClick={() => setBy('week')} className={toggle(by === 'week')}>Weeks</button>
          <button type="button" aria-pressed={by === 'month'} onClick={() => setBy('month')} className={toggle(by === 'month')}>Months</button>
        </div>
      </div>

      {/* A1: summary strip; a tile filters the list, tap again for all */}
      <div className="grid grid-cols-3 gap-2 mt-3">
        {tile('newBest', summary.newBests, 'New bests', 'text-green-400')}
        {tile('stalled', summary.stalled, 'Stalled', 'text-amber-400')}
        {tile('notDone', summary.notDone, `Not done in ${NOT_DONE_DAYS / 7}+ weeks`, 'text-red-400/80')}
      </div>

      {/* A3: filters (wrap, no scrollbar) */}
      {(days.length > 0 || muscles.length > 1 || (mode === 'coach' && loggers.length > 1)) && (
        <div className="flex flex-wrap gap-1.5 mt-3" aria-label="Filter exercises">
          <button type="button" className={chip(day == null && !muscle && !logger)} onClick={() => { setDay(null); setMuscle(null); setLogger(null) }}>All</button>
          {days.map((d, i) => (
            <button key={d.day} type="button" aria-pressed={day === i} className={chip(day === i)} title={d.focus || undefined}
              onClick={() => setDay(day === i ? null : i)}>
              Day {i + 1} <span className={day === i ? 'text-white/80' : 'text-gray-500'}>· {d.day}</span>
            </button>
          ))}
          {muscles.length > 1 && muscles.map(m => (
            <button key={m} type="button" aria-pressed={muscle === m} className={chip(muscle === m)} onClick={() => setMuscle(muscle === m ? null : m)}>
              {muscleLabel(m)}
            </button>
          ))}
          {mode === 'coach' && loggers.length > 1 && loggers.map(name => (
            <button key={`by-${name}`} type="button" aria-pressed={logger === name} className={chip(logger === name)} onClick={() => setLogger(logger === name ? null : name)}>
              By {name}
            </button>
          ))}
        </div>
      )}
      {rows.length > SEARCH_FROM && (
        <input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search exercises"
          className="mt-3 w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-orange-500" />
      )}

      {/* A2: one row per exercise */}
      <ul className="mt-3 divide-y divide-gray-800 border-t border-gray-800">
        {list.length === 0 && (
          <li className="py-4 text-sm text-gray-500">No exercises match.{' '}
            <button type="button" className="text-orange-400" onClick={() => { setFocus('all'); setDay(null); setMuscle(null); setLogger(null); setQuery('') }}>Show all</button>
          </li>
        )}
        {list.map(r => <ExerciseListRow key={r.key} row={r} country={country} onOpen={() => setOpenKey(r.key)} />)}
      </ul>

      {open && (
        <DetailSheet row={open} mode={mode} labels={range.periods.map(periodLabel)} country={country}
          loggerName={loggerName} rangeWord={by === 'week' ? 'weeks' : 'months'} onClose={() => setOpenKey(null)} />
      )}
    </div>
  )
}

function changeClass(change: number | null) {
  return change == null || change === 0 ? 'text-gray-500' : change > 0 ? 'text-green-400' : 'text-red-400/80'
}

function ExerciseListRow({ row, country, onOpen }: { row: ExerciseRow; country: Country; onOpen: () => void }) {
  const best = bestSetText(row.latest, row.bodyweight)
  const late = row.daysSince != null && row.daysSince >= NOT_DONE_DAYS
  return (
    <li>
      <button type="button" onClick={onOpen} data-testid="progress-row"
        className="w-full min-h-[56px] py-2.5 flex items-center gap-3 text-left active:bg-gray-800/60 transition">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-white truncate">{row.name}</p>
          <p className="text-[11px] mt-0.5 truncate">
            {row.lastDone
              ? <span className={late ? 'text-amber-400' : 'text-gray-500'}>{formatDate(row.lastDone, country, 'dayMonth')}</span>
              : <span className="text-amber-400">Not logged yet</span>}
            {row.newBest && <span className="text-green-400"> · New best</span>}
            {row.stalled && <span className="text-amber-400"> · Stalled</span>}
          </p>
        </div>
        <Sparkline values={row.series} />
        <div className="w-[88px] shrink-0 text-right">
          <p className="text-sm text-gray-200 whitespace-nowrap">{best || '—'}</p>
          <p className={`text-[11px] whitespace-nowrap ${changeClass(row.change)}`}>{changeAmountText(row.change, row.bodyweight)}</p>
        </div>
      </button>
    </li>
  )
}

// Best value per period, no axes; a period without a session breaks the line
function Sparkline({ values }: { values: (number | null)[] }) {
  const W = 56, H = 22, P = 2
  const vs = values.filter((v): v is number => v != null)
  if (!vs.length) return <span className="w-14 shrink-0" aria-hidden />
  const hi = Math.max(...vs), lo = Math.min(...vs)
  const span = hi - lo || hi || 1
  const x = (i: number) => P + (values.length === 1 ? (W - 2 * P) / 2 : (i * (W - 2 * P)) / (values.length - 1))
  const y = (v: number) => (hi === lo ? H / 2 : H - P - ((v - lo) / span) * (H - 2 * P))
  const segments: { i: number; v: number }[][] = []
  let cur: { i: number; v: number }[] = []
  values.forEach((v, i) => {
    if (v == null) { if (cur.length) segments.push(cur); cur = [] } else cur.push({ i, v })
  })
  if (cur.length) segments.push(cur)
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="shrink-0 text-orange-400" aria-hidden>
      {segments.map((seg, k) => (seg.length === 1
        ? <circle key={k} cx={x(seg[0].i)} cy={y(seg[0].v)} r={1.8} fill="currentColor" />
        : <polyline key={k} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round"
            points={seg.map(p => `${x(p.i)},${y(p.v)}`).join(' ')} />))}
    </svg>
  )
}

function DetailSheet({
  row, mode, labels, country, loggerName, rangeWord, onClose,
}: {
  row: ExerciseRow
  mode: ProgressMode
  labels: string[]
  country: Country
  loggerName: (loggedBy: string | null) => string
  rangeWord: string
  onClose: () => void
}) {
  // Escape closes; the page behind doesn't scroll while the sheet is open (once per opening)
  const closeRef = useRef(onClose)
  useEffect(() => { closeRef.current = onClose })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRef.current() }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [])

  const axis = chartAxis(row.series)
  const latest = row.latest
  const unit = row.bodyweight ? 'reps' : 'kg'
  const history: ProgressEntry[] = [...row.entries].reverse()
  const first = row.inRange[0]

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={row.name} data-testid="progress-detail"
        onClick={e => e.stopPropagation()}
        className="bg-gray-900 w-full h-full sm:h-auto sm:max-h-[85vh] sm:max-w-lg sm:rounded-2xl border-gray-800 sm:border flex flex-col">
        <div className="flex items-start justify-between gap-3 px-4 pt-4 pb-3 border-b border-gray-800">
          <div className="min-w-0">
            <p className="text-base font-semibold text-white truncate">{row.name}</p>
            {/* A4: the header says what the chart shows: latest best set · its volume · change vs first in range */}
            <p className="text-xs mt-1">
              {latest
                ? <span className="text-gray-300">{bestSetText(latest, row.bodyweight)}</span>
                : <span className="text-amber-400">Not logged yet</span>}
              {latest && !row.bodyweight && latest.volume > 0 && <span className="text-gray-500"> · volume {weightText(latest.volume)} kg</span>}
              {row.change != null
                ? <span className={changeClass(row.change)}> · {changeAmountText(row.change, row.bodyweight)} since {formatDate(first.date, country, 'dayMonth')}</span>
                : latest && <span className="text-gray-500"> · {row.inRange.length ? `one session in the last ${labels.length} ${rangeWord}` : `none in the last ${labels.length} ${rangeWord}`}</span>}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close"
            className="shrink-0 w-9 h-9 -mr-1 rounded-full text-gray-400 hover:text-white hover:bg-gray-800 text-xl leading-none">×</button>
        </div>

        <div className="overflow-y-auto px-4 py-4 space-y-4">
          {row.series.some(v => v != null) ? (
            <div className="h-48">
              <Line
                data={{
                  labels,
                  datasets: [{
                    label: row.bodyweight ? 'Best reps' : 'Heaviest set (kg)',
                    data: row.series,
                    borderColor: 'rgba(249, 115, 22, 1)',
                    pointBackgroundColor: 'rgba(249, 115, 22, 1)',
                    borderWidth: 2,
                    pointRadius: 4,
                    tension: 0,
                    spanGaps: false, // an empty week is a gap, not a line
                    fill: false,
                  }],
                }}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: {
                    legend: { display: false },
                    tooltip: { callbacks: { label: ctx => (ctx.parsed.y == null ? '' : `${weightText(ctx.parsed.y)} ${unit}`) } },
                  },
                  scales: {
                    x: { ticks: { color: '#6b7280', font: { size: 11 } }, grid: { color: '#1f2937' } },
                    y: { min: axis.min, max: axis.max, ticks: { stepSize: axis.step, color: '#6b7280', font: { size: 11 } }, grid: { color: '#1f2937' } },
                  },
                }}
              />
            </div>
          ) : (
            <p className="text-sm text-gray-500">Nothing logged in the last {labels.length} {rangeWord}.</p>
          )}

          {history.length > 0 && (
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">History</p>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-500 text-left">
                    <th className="font-normal py-1 pr-2">Date</th>
                    <th className="font-normal py-1 pr-2">Sets {row.bodyweight ? '(reps)' : '(kg × reps)'}</th>
                    {!row.bodyweight && <th className="font-normal py-1 pr-2 text-right">Volume</th>}
                    <th className="font-normal py-1 text-right">Logged by</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {history.map(e => {
                    const best = entryValue(e, row.bodyweight) === Math.max(...row.entries.map(x => entryValue(x, row.bodyweight)))
                    return (
                      <tr key={e.sessionId} className="align-top">
                        <td className="py-1.5 pr-2 text-gray-400 whitespace-nowrap">{formatDate(e.date, country, 'dayMonth')}</td>
                        <td className="py-1.5 pr-2 text-gray-200">{compactSets(e.sets)}{best && <span className="text-green-400"> ★</span>}</td>
                        {!row.bodyweight && <td className="py-1.5 pr-2 text-gray-400 text-right whitespace-nowrap">{e.volume ? `${weightText(e.volume)} kg` : '—'}</td>}
                        <td className="py-1.5 text-gray-400 text-right whitespace-nowrap">{loggerName(e.loggedBy)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              <p className="text-[11px] text-gray-600 mt-2">★ {mode === 'coach' ? 'best so far' : 'your best so far'}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

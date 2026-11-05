'use client'

// Per-exercise progress on the coach's Progress tab (#80): the heaviest weight per week (last 8 Monday
// weeks, like the other Progress charts) or per month (last 6 months), one exercise at a time (chips to
// switch), with "+X% this week / month" next to each exercise. Numbers come from lib/exercise-logs.ts.
// Loaded with next/dynamic like app/progress-charts.tsx, so Chart.js is only downloaded when shown.
import { useState } from 'react'
import {
  Chart as ChartJS, CategoryScale, LinearScale, LineElement, PointElement, Tooltip, Filler,
} from 'chart.js'
import { Line } from 'react-chartjs-2'
import { type Exercise } from '@/lib/exercises'
import { type Country, formatDate } from '@/lib/locale'
import {
  type DatedLog, type Period, progressBy, withWeightIn, changeThisPeriod, changeText, topWeightSeries,
  weightText, lastMonths, lastWeeks, periodOf,
} from '@/lib/exercise-logs'

ChartJS.register(CategoryScale, LinearScale, LineElement, PointElement, Tooltip, Filler)

const axis = {
  x: { ticks: { color: '#6b7280', font: { size: 11 } }, grid: { color: '#1f2937' } },
  y: { ticks: { color: '#6b7280', font: { size: 11 } }, grid: { color: '#1f2937' }, beginAtZero: false },
}

const SHOWN = 8   // exercises listed (most logged in the shown weeks / months first)
const WEEKS = 8
const MONTHS = 6

export default function ExerciseProgressChart({
  logs, library, today, country,
}: {
  logs: DatedLog[]
  library: Exercise[]
  today: string     // YYYY-MM-DD (local)
  country: Country
}) {
  const [by, setBy] = useState<Period>('week')
  const [picked, setPicked] = useState<string | null>(null)

  const periods = by === 'week' ? lastWeeks(today, WEEKS) : lastMonths(today.slice(0, 7), MONTHS)
  const current = periodOf(today, by)
  const list = withWeightIn(progressBy(logs, library, by), periods).slice(0, SHOWN)
  // The card shows when there is anything in the last 6 months, so switching to Weeks can be empty
  const anyMonths = withWeightIn(progressBy(logs, library, 'month'), lastMonths(today.slice(0, 7), MONTHS)).length > 0
  if (!anyMonths) return null

  const sel = list.find(p => p.key === picked) ?? list[0] ?? null
  const word = by === 'week' ? 'week' : 'month'
  const labels = periods.map(p => (by === 'week' ? formatDate(p, country, 'dayMonth') : formatDate(`${p}-01`, country, 'month')))
  const changeCls = (pct: number) => (pct > 0 ? 'text-green-400' : pct < 0 ? 'text-red-400' : 'text-gray-400')
  const toggle = (on: boolean) => `px-3 py-1 rounded-full text-xs transition ${on ? 'bg-gray-700 text-white font-semibold' : 'text-gray-400'}`

  return (
    <div className="bg-gray-900 rounded-2xl p-5 border border-gray-800">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs text-gray-500 uppercase tracking-wider">Strength by exercise</p>
          <p className="text-[11px] text-gray-600 mt-0.5">Heaviest weight logged each {word}</p>
        </div>
        <div className="flex shrink-0 bg-gray-800 rounded-full p-0.5" role="group" aria-label="Show by">
          <button type="button" aria-pressed={by === 'week'} onClick={() => setBy('week')} className={toggle(by === 'week')}>Weeks</button>
          <button type="button" aria-pressed={by === 'month'} onClick={() => setBy('month')} className={toggle(by === 'month')}>Months</button>
        </div>
      </div>

      {!sel ? (
        <p className="text-sm text-gray-500 mt-4">No weights logged in the last {WEEKS} weeks. Tap Months to see earlier ones.</p>
      ) : (() => {
        const selChange = changeThisPeriod(sel, current)
        const latestTop = [...sel.points].reverse().find(m => m.topWeight && periods.includes(m.period))?.topWeight ?? null
        return (
          <>
            <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1 mt-3" role="tablist" aria-label="Exercise">
              {list.map(p => {
                const on = p.key === sel.key
                const pct = changeThisPeriod(p, current)
                return (
                  <button key={p.key} type="button" role="tab" aria-selected={on} onClick={() => setPicked(p.key)}
                    className={`shrink-0 text-xs px-3 py-1.5 rounded-full border transition ${on ? 'bg-orange-500 border-orange-500 text-white font-semibold' : 'border-gray-700 text-gray-300'}`}>
                    {p.name}
                    {pct !== null && <span className={on ? 'text-white/90' : changeCls(pct)}> {changeText(pct)}</span>}
                  </button>
                )
              })}
            </div>

            <div className="flex items-baseline justify-between gap-3 mt-3 mb-2">
              <p className="text-sm font-medium text-white truncate">{sel.name}</p>
              <p className="text-xs shrink-0">
                {latestTop !== null && <span className="text-gray-300">{weightText(latestTop)} kg</span>}
                {selChange !== null
                  ? <span className={changeCls(selChange)}> · {changeText(selChange)} this {word}</span>
                  : <span className="text-gray-500"> · no change to show yet</span>}
              </p>
            </div>

            <Line
              data={{
                labels,
                datasets: [{
                  label: 'Top weight (kg)',
                  data: topWeightSeries(sel, periods),
                  borderColor: 'rgba(249, 115, 22, 1)',
                  backgroundColor: 'rgba(249, 115, 22, 0.1)',
                  borderWidth: 2,
                  pointBackgroundColor: 'rgba(249, 115, 22, 1)',
                  pointRadius: 4,
                  tension: 0.3,
                  spanGaps: true,
                  fill: true,
                }],
              }}
              options={{
                responsive: true,
                plugins: {
                  legend: { display: false },
                  tooltip: { callbacks: { label: ctx => (ctx.parsed.y == null ? '' : `${weightText(ctx.parsed.y)} kg`) } },
                },
                scales: axis,
              }}
            />
          </>
        )
      })()}
    </div>
  )
}

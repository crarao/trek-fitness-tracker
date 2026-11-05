'use client'

// Per-exercise progress on the coach's Progress tab (#80): top weight per month for one exercise at a
// time (chips to switch), with "+X% this month" next to each exercise. Numbers come from
// lib/exercise-logs.ts (monthlyProgress, changeThisMonth). Loaded with next/dynamic like
// app/progress-charts.tsx, so Chart.js is only downloaded when the tab is shown.
import { useState } from 'react'
import {
  Chart as ChartJS, CategoryScale, LinearScale, LineElement, PointElement, Tooltip, Filler,
} from 'chart.js'
import { Line } from 'react-chartjs-2'
import { type ExerciseProgress, changeThisMonth, changeText, topWeightSeries, weightText } from '@/lib/exercise-logs'

ChartJS.register(CategoryScale, LinearScale, LineElement, PointElement, Tooltip, Filler)

const axis = {
  x: { ticks: { color: '#6b7280', font: { size: 11 } }, grid: { color: '#1f2937' } },
  y: { ticks: { color: '#6b7280', font: { size: 11 } }, grid: { color: '#1f2937' }, beginAtZero: false },
}

const SHOWN = 8 // exercises listed (most logged first)

export default function ExerciseProgressChart({
  progress, months, labels, thisMonth,
}: {
  progress: ExerciseProgress[] // only exercises with a weight logged
  months: string[]             // "2026-06" … "2026-11", oldest first
  labels: string[]             // the same months as shown on the axis ("Jun" …)
  thisMonth: string            // "2026-11"
}) {
  const [picked, setPicked] = useState<string | null>(null)
  if (!progress.length) return null
  const list = progress.slice(0, SHOWN)
  const sel = list.find(p => p.key === picked) ?? list[0]
  const series = topWeightSeries(sel, months)
  const selChange = changeThisMonth(sel, thisMonth)
  const latestTop = [...sel.months].reverse().find(m => m.topWeight)?.topWeight ?? null
  const changeCls = (pct: number) => (pct > 0 ? 'text-green-400' : pct < 0 ? 'text-red-400' : 'text-gray-400')

  return (
    <div className="bg-gray-900 rounded-2xl p-5 border border-gray-800">
      <p className="text-xs text-gray-500 uppercase tracking-wider">Strength by exercise</p>
      <p className="text-[11px] text-gray-600 mt-0.5 mb-3">Heaviest weight logged each month</p>

      <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1" role="tablist" aria-label="Exercise">
        {list.map(p => {
          const on = p.key === sel.key
          const pct = changeThisMonth(p, thisMonth)
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
            ? <span className={changeCls(selChange)}> · {changeText(selChange)} this month</span>
            : <span className="text-gray-500"> · no change to show yet</span>}
        </p>
      </div>

      <Line
        data={{
          labels,
          datasets: [{
            label: 'Top weight (kg)',
            data: series,
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
    </div>
  )
}

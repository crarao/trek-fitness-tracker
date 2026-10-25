'use client'

// Progress charts (activities and minutes per week), shared by the coach's client page
// and the client's own screen. Loaded with next/dynamic so the Chart.js library is only
// downloaded when a Progress view is actually shown.
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js'
import { Bar, Line } from 'react-chartjs-2'

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, Title, Tooltip, Legend, Filler)

const axis = {
  x: { ticks: { color: '#6b7280', font: { size: 11 } }, grid: { color: '#1f2937' } },
  y: { ticks: { color: '#6b7280', font: { size: 11 } }, grid: { color: '#1f2937' }, beginAtZero: true },
}

export default function ProgressCharts({
  labels,
  sessionCounts,
  minuteCounts,
}: {
  labels: string[]
  sessionCounts: number[]
  minuteCounts: number[]
}) {
  return (
    <>
      <div className="bg-gray-900 rounded-2xl p-5 border border-gray-800">
        <p className="text-xs text-gray-500 uppercase tracking-wider mb-4">Activities per Week</p>
        <Bar
          data={{
            labels,
            datasets: [{
              label: 'Activities',
              data: sessionCounts,
              backgroundColor: 'rgba(249, 115, 22, 0.7)',
              borderColor: 'rgba(249, 115, 22, 1)',
              borderWidth: 1,
              borderRadius: 4,
            }],
          }}
          options={{ responsive: true, plugins: { legend: { display: false } }, scales: axis }}
        />
      </div>

      <div className="bg-gray-900 rounded-2xl p-5 border border-gray-800">
        <p className="text-xs text-gray-500 uppercase tracking-wider mb-4">Minutes per Week</p>
        <Line
          data={{
            labels,
            datasets: [{
              label: 'Minutes',
              data: minuteCounts,
              borderColor: 'rgba(249, 115, 22, 1)',
              backgroundColor: 'rgba(249, 115, 22, 0.1)',
              borderWidth: 2,
              pointBackgroundColor: 'rgba(249, 115, 22, 1)',
              tension: 0.3,
              fill: true,
            }],
          }}
          options={{ responsive: true, plugins: { legend: { display: false } }, scales: axis }}
        />
      </div>
    </>
  )
}

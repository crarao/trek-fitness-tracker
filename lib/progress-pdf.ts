// Progress report as a PDF the coach downloads and sends however they like (WhatsApp, email…).
// Drawn on A4-sized canvases (header, the week's numbers, the coach's message, charts for the
// last 8 weeks) and saved with lib/pdf.ts. Browser only: load it with `await import()` when the
// coach taps Download PDF, so Chart.js and this code aren't in the page's first download.

import { type Country, formatDate } from './locale'
import { imagesToPdf, type PdfPage } from './pdf'
import type { WeekSummary } from './progress-share'
import { type PlanJson, daysInWeekOrder, exerciseDetail } from './plan-structure'
import { type StrengthReport, changeText, weightText } from './exercise-logs'
import { withoutCalories } from './progress-share'

// The line chart of one exercise under the Strength table (off since 14 Nov, see the strength section)
const SHOW_EXERCISE_CHART = false

export type ProgressPdfInput = {
  companyName: string
  clientName: string
  weekStart: string                                  // 'YYYY-MM-DD'
  country: Country
  text: string                                       // the coach's (edited) message
  week: WeekSummary
  fourWeeks: { done: number; planned: number } | null // plan days done over the last 4 weeks
  totals: { start: string; sessions: number; minutes: number }[] // per week, oldest first
  plan?: { weekStart: string; json: PlanJson } | null // the week's day-by-day plan, if it has one
  strength?: StrengthReport | null                    // weight per exercise per month (#80), from lib/exercise-logs.ts
  showCalories?: boolean                              // calorie tile and the message's calorie part; off unless true (5 Nov)
}

// 150 dpi A4
const W = 1240
const H = 1754
const M = 90                 // side margin
const BOTTOM = H - 120       // content stops here; the footer goes below
const FONT = '-apple-system, "Segoe UI", Roboto, "Noto Sans", Arial, sans-serif'
const ORANGE = '#f97316'
const DARK = '#111827'
const GRAY = '#6b7280'
const GREEN = '#16a34a'
const RED = '#dc2626'
const LINE = '#e5e7eb'

const font = (size: number, weight = 400) => `${weight} ${size}px ${FONT}`

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r)
  else ctx.rect(x, y, w, h)
  ctx.fill()
}

// Splits text into lines that fit maxWidth (keeps the coach's line breaks; '' = blank line)
function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const out: string[] = []
  for (const para of text.replace(/\r/g, '').split('\n')) {
    let line = ''
    for (const word of para.split(/ +/)) {
      const next = line ? `${line} ${word}` : word
      if (line && ctx.measureText(next).width > maxWidth) { out.push(line); line = word }
      else line = next
    }
    out.push(line)
  }
  return out
}

async function chartImage(kind: 'bar' | 'line', labels: string[], data: (number | null)[], width: number, height: number, fromZero = true) {
  const { Chart, CategoryScale, LinearScale, BarElement, LineElement, PointElement, Filler, BarController, LineController } = await import('chart.js')
  Chart.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, Filler, BarController, LineController)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ticks = { color: GRAY, font: { size: 17, family: FONT } }
  const chart = new Chart(canvas, {
    type: kind,
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: kind === 'bar' ? 'rgba(249, 115, 22, 0.75)' : 'rgba(249, 115, 22, 0.12)',
        borderColor: ORANGE,
        borderWidth: kind === 'bar' ? 0 : 4,
        borderRadius: 6,
        pointRadius: 6,
        pointBackgroundColor: ORANGE,
        tension: 0.3,
        cubicInterpolationMode: 'monotone', // no dip below zero between points
        spanGaps: true,                     // weeks / months with nothing logged: join the points around them
        fill: kind === 'line',
      }],
    },
    options: {
      responsive: false,
      animation: false,
      devicePixelRatio: 1,
      events: [],
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      scales: {
        x: { ticks, grid: { display: false } },
        y: { ticks: { ...ticks, precision: 0 }, grid: { color: '#e5e7eb' }, beginAtZero: fromZero },
      },
    },
  })
  // Copy the drawing before closing the chart (destroy() clears its canvas)
  const copy = document.createElement('canvas')
  copy.width = width
  copy.height = height
  copy.getContext('2d')!.drawImage(canvas, 0, 0)
  chart.destroy()
  return copy
}

// Small trend line in a table row: orange line, a dot on the last point, a break where a month has
// no weight. Scaled between the row's lowest and highest weight (flat line in the middle if equal).
// `slots` = months in the longest row, so every row uses the same month width and ends at the right edge.
function sparkline(ctx: CanvasRenderingContext2D, data: (number | null)[], slots: number, x: number, y: number, w: number, h: number) {
  const vals = data.filter((v): v is number => v != null)
  if (vals.length < 2) return
  const lo = Math.min(...vals), hi = Math.max(...vals)
  const pad = 5
  const step = (w - 2 * pad) / Math.max(slots - 1, 1)
  const px = (i: number) => x + w - pad - (data.length - 1 - i) * step
  const py = (v: number) => (hi === lo ? y + h / 2 : y + h - pad - ((v - lo) / (hi - lo)) * (h - 2 * pad))
  ctx.save()
  ctx.strokeStyle = ORANGE
  ctx.fillStyle = ORANGE
  ctx.lineWidth = 3
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.beginPath()
  let drawing = false
  data.forEach((v, i) => {
    if (v == null) { drawing = false; return }
    if (drawing) ctx.lineTo(px(i), py(v))
    else { ctx.moveTo(px(i), py(v)); drawing = true }
  })
  ctx.stroke()
  // A point with no neighbour on either side (gaps around it) still shows as a small dot
  data.forEach((v, i) => {
    if (v != null && data[i - 1] == null && data[i + 1] == null && i !== data.length - 1) {
      ctx.beginPath(); ctx.arc(px(i), py(v), 4, 0, Math.PI * 2); ctx.fill()
    }
  })
  let last = data.length - 1
  while (data[last] == null) last--
  ctx.beginPath()
  ctx.arc(px(last), py(data[last]!), 5, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

export async function buildProgressPdf(input: ProgressPdfInput): Promise<Blob> {
  const pages: HTMLCanvasElement[] = []
  let ctx!: CanvasRenderingContext2D
  let y = 0
  const newPage = () => {
    const c = document.createElement('canvas')
    c.width = W
    c.height = H
    ctx = c.getContext('2d')!
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, W, H)
    ctx.fillStyle = ORANGE
    ctx.fillRect(0, 0, W, 14)
    ctx.textBaseline = 'alphabetic'
    pages.push(c)
    y = 100
  }
  const ensure = (h: number) => { if (y + h > BOTTOM) newPage() }
  const heading = (text: string) => {
    ensure(70)
    ctx.fillStyle = GRAY
    ctx.font = font(22, 600)
    ctx.fillText(text.toUpperCase(), M, y + 22)
    y += 50
  }

  // Header
  newPage()
  ctx.fillStyle = DARK
  ctx.font = font(46, 700)
  ctx.fillText(input.companyName || 'Progress report', M, y + 40)
  ctx.fillStyle = GRAY
  ctx.font = font(24, 500)
  ctx.textAlign = 'right'
  ctx.fillText('Progress report', W - M, y + 38)
  ctx.textAlign = 'left'
  y += 100
  ctx.fillStyle = DARK
  ctx.font = font(36, 600)
  ctx.fillText(input.clientName, M, y)
  y += 46
  ctx.fillStyle = GRAY
  ctx.font = font(26)
  ctx.fillText(`Week of ${formatDate(input.weekStart, input.country, 'medium')}`, M, y)
  y += 40
  ctx.fillStyle = '#e5e7eb'
  ctx.fillRect(M, y, W - 2 * M, 2)
  y += 50

  // The week's numbers
  const { week, fourWeeks } = input
  const tiles: [string, string][] = [
    week.planned ? ['This week', `${week.done} of ${week.planned} days`] : ['This week', `${week.sessions.length} session${week.sessions.length === 1 ? '' : 's'}`],
    ...(fourWeeks && fourWeeks.planned ? [['Last 4 weeks', `${Math.round((fourWeeks.done / fourWeeks.planned) * 100)}%`] as [string, string]] : []),
    ['Minutes', week.minutes.toLocaleString('en-US')],
    ...(input.showCalories && week.kcal ? [['Calories (est.)', `~${week.kcal.toLocaleString('en-US')}`] as [string, string]] : []),
  ]
  const gap = 24
  const tileW = (W - 2 * M - gap * (tiles.length - 1)) / tiles.length
  tiles.forEach(([label, value], i) => {
    const x = M + i * (tileW + gap)
    ctx.fillStyle = '#fff7ed'
    roundRect(ctx, x, y, tileW, 150, 20)
    ctx.fillStyle = GRAY
    ctx.font = font(21, 600)
    ctx.fillText(label.toUpperCase(), x + 26, y + 48)
    ctx.fillStyle = ORANGE
    ctx.font = font(tiles.length > 3 ? 38 : 44, 700)
    ctx.fillText(value, x + 26, y + 112, tileW - 40)
  })
  y += 150 + 60

  // The coach's message, as edited (without the calorie estimate unless showCalories)
  const message = (input.showCalories ? input.text : withoutCalories(input.text)).trim()
  if (message) {
    heading('Message from your coach')
    ctx.font = font(28)
    const lines = wrap(ctx, message, W - 2 * M)
    for (const line of lines) {
      const h = line ? 42 : 22
      ensure(h)
      ctx.fillStyle = DARK
      ctx.font = font(28)
      if (line) ctx.fillText(line, M, y + 30)
      y += h
    }
    y += 40
  }

  // Charts: last 8 weeks
  const labels = input.totals.map(t => formatDate(t.start, input.country, 'dayMonth'))
  // Side by side, so a usual week fits on one page
  const chartGap = 40
  const chartW = (W - 2 * M - chartGap) / 2
  const chartH = 320
  ensure(50 + chartH)
  const charts = [
    ['Sessions per week', 'bar', input.totals.map(t => t.sessions)],
    ['Minutes per week', 'line', input.totals.map(t => t.minutes)],
  ] as const
  for (const [i, [title, kind, data]] of charts.entries()) {
    const x = M + i * (chartW + chartGap)
    ctx.fillStyle = GRAY
    ctx.font = font(22, 600)
    ctx.fillText(title.toUpperCase(), x, y + 22)
    ctx.drawImage(await chartImage(kind, labels, [...data], chartW, chartH), x, y + 50)
  }
  y += 50 + chartH + 40

  // Strength by exercise (#80): heaviest weight per month, last 3 months, change since the first
  // month and a small trend line per row (the chart of the most logged exercise is off, SHOW_EXERCISE_CHART). Kept together on one page.
  const st = input.strength
  if (st && st.rows.length) {
    const rowH = 50
    const colW = 130
    const changeW = 160
    const trendW = 150
    const nameW = W - 2 * M - colW * st.months.length - changeW - trendW
    const changeX = W - M - trendW // right edge of the change column
    const trendSlots = Math.max(...st.rows.map(r => r.trend?.length ?? 0))
    ensure(70 + rowH * (st.rows.length + 1) + 20)
    heading('Strength by exercise')
    ctx.fillStyle = GRAY
    ctx.font = font(20)
    ctx.textAlign = 'right'
    ctx.fillText('heaviest weight each month (kg)', W - M, y - 28)
    // Header row
    ctx.font = font(21, 600)
    ctx.textAlign = 'left'
    ctx.fillText('Exercise', M, y + 30)
    ctx.textAlign = 'right'
    st.months.forEach((m, i) => ctx.fillText(formatDate(`${m}-01`, input.country, 'month'), M + nameW + colW * (i + 1) - 10, y + 30))
    ctx.fillText(st.since ? `Since ${formatDate(`${st.since}-01`, input.country, 'month')}` : 'Progress', changeX, y + 30)
    ctx.fillText('Trend', W - M, y + 30)
    ctx.textAlign = 'left'
    y += rowH
    ctx.fillStyle = LINE
    ctx.fillRect(M, y - 8, W - 2 * M, 2)
    for (const r of st.rows) {
      ctx.fillStyle = DARK
      ctx.font = font(25, 500)
      ctx.fillText(r.name, M, y + 28, nameW - 20)
      ctx.textAlign = 'right'
      ctx.font = font(25)
      r.values.forEach((v, i) => {
        ctx.fillStyle = v == null ? GRAY : DARK
        ctx.fillText(v == null ? '—' : weightText(v), M + nameW + colW * (i + 1) - 10, y + 28)
      })
      const [txt, color] = r.sinceStart != null
        ? [changeText(r.sinceStart), r.sinceStart > 0 ? GREEN : r.sinceStart < 0 ? RED : GRAY]
        : [r.first ? 'New' : '—', GRAY]
      ctx.fillStyle = color
      ctx.font = font(24, r.sinceStart != null ? 700 : 400)
      ctx.fillText(txt, changeX, y + 28)
      ctx.textAlign = 'left'
      if (r.trend) sparkline(ctx, r.trend, trendSlots, W - M - 120, y + 2, 120, 32)
      y += rowH
      ctx.fillStyle = LINE
      ctx.fillRect(M, y - 8, W - 2 * M, 1)
    }
    y += 30
    // 14 Nov: the single-exercise chart is switched off (the table above already shows each
    // exercise month by month). Kept, not deleted: set SHOW_EXERCISE_CHART to true to bring it back.
    if (SHOW_EXERCISE_CHART && st.chart) {
      const h = 280
      ensure(50 + h + 30)
      ctx.fillStyle = GRAY
      ctx.font = font(22, 600)
      ctx.fillText(`${st.chart.name.toUpperCase()} · ${st.chart.months.length === 1 ? 'THIS MONTH' : `LAST ${st.chart.months.length} MONTHS`} (KG)`, M, y + 22, W - 2 * M)
      const chartLabels = st.chart.months.map(m => formatDate(`${m}-01`, input.country, 'month'))
      ctx.drawImage(await chartImage('line', chartLabels, st.chart.data, W - 2 * M, h, false), M, y + 50)
      y += 50 + h + 40
    }
  }

  // The week's plan, day by day (structured plans only; text plans are left out)
  if (input.plan) {
    const days = daysInWeekOrder(input.plan.json, input.plan.weekStart).filter(d => !d.rest || d.exercises.length)
    if (days.length) {
      heading(`Plan for the week of ${formatDate(input.plan.weekStart.slice(0, 10), input.country, 'dayMonth')}`)
      for (const d of days) {
        ensure(48 + Math.min(d.exercises.length, 3) * 38)
        ctx.fillStyle = ORANGE
        ctx.font = font(26, 700)
        ctx.fillText(d.day, M, y + 28)
        ctx.fillStyle = DARK
        ctx.font = font(26, 600)
        ctx.fillText(d.rest ? 'Rest day' : d.focus || 'Workout', M + 90, y + 28, W - 2 * M - 90)
        y += 46
        for (const e of d.exercises) {
          ensure(38)
          const detail = exerciseDetail(e)
          ctx.font = font(23)
          ctx.fillStyle = GRAY
          ctx.textAlign = 'right'
          if (detail) ctx.fillText(detail, W - M, y + 24)
          ctx.textAlign = 'left'
          const detailW = detail ? ctx.measureText(detail).width + 30 : 0
          ctx.fillStyle = DARK
          ctx.fillText(e.name, M + 90, y + 24, W - 2 * M - 90 - detailW)
          y += 38
        }
        y += 16
      }
      if (input.plan.json.note) {
        ctx.font = font(22)
        for (const line of wrap(ctx, input.plan.json.note, W - 2 * M)) {
          ensure(32)
          ctx.fillStyle = GRAY
          ctx.font = font(22)
          ctx.fillText(line, M, y + 22)
          y += 32
        }
      }
    }
  }

  // Footer on every page
  const made = formatDate(new Date(), input.country, 'medium')
  pages.forEach((c, i) => {
    const g = c.getContext('2d')!
    g.fillStyle = GRAY
    g.font = font(20)
    g.fillText(`${input.companyName} · made ${made}`, M, H - 60)
    g.textAlign = 'right'
    g.fillText(`Page ${i + 1} of ${pages.length}`, W - M, H - 60)
    g.textAlign = 'left'
  })

  const pdfPages: PdfPage[] = []
  for (const c of pages) {
    const blob = await new Promise<Blob | null>(res => c.toBlob(res, 'image/jpeg', 0.9))
    if (!blob) throw new Error('Could not draw the report')
    pdfPages.push({ jpeg: new Uint8Array(await blob.arrayBuffer()), width: c.width, height: c.height })
  }
  return imagesToPdf(pdfPages)
}

// Saves the PDF to the phone / computer (Downloads)
export async function downloadProgressPdf(input: ProgressPdfInput, fileName: string) {
  const blob = await buildProgressPdf(input)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

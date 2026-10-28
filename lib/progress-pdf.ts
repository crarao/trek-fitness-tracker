// Progress report as a PDF the coach downloads and sends however they like (WhatsApp, email…).
// Drawn on A4-sized canvases (header, the week's numbers, the coach's message, charts for the
// last 8 weeks) and saved with lib/pdf.ts. Browser only: load it with `await import()` when the
// coach taps Download PDF, so Chart.js and this code aren't in the page's first download.

import { type Country, formatDate } from './locale'
import { imagesToPdf, type PdfPage } from './pdf'
import type { WeekSummary } from './progress-share'

export type ProgressPdfInput = {
  companyName: string
  clientName: string
  weekStart: string                                  // 'YYYY-MM-DD'
  country: Country
  text: string                                       // the coach's (edited) message
  week: WeekSummary
  fourWeeks: { done: number; planned: number } | null // plan days done over the last 4 weeks
  totals: { start: string; sessions: number; minutes: number }[] // per week, oldest first
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

async function chartImage(kind: 'bar' | 'line', labels: string[], data: number[], width: number, height: number) {
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
        y: { ticks: { ...ticks, precision: 0 }, grid: { color: '#e5e7eb' }, beginAtZero: true },
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
    ...(week.kcal ? [['Calories (est.)', `~${week.kcal.toLocaleString('en-US')}`] as [string, string]] : []),
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

  // The coach's message, as edited
  if (input.text.trim()) {
    heading('Message from your coach')
    ctx.font = font(28)
    const lines = wrap(ctx, input.text.trim(), W - 2 * M)
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

// Server only (#37): how many AI plans a client has had this calendar month, against the cap in
// lib/ai-pricing.ts. Counted from ai_usage rows (feature 'plan', client_id = the member).
// The month is the company's local month: India time for IN, US Eastern for US.
import type { SupabaseClient } from '@supabase/supabase-js'
import { AI_PLANS_PER_CLIENT_PER_MONTH } from './ai-pricing'
import type { Country } from './locale'

export type AiPlanUsage = {
  used: number
  limit: number
  resetsOn: string // 'YYYY-MM-DD', the 1st of next month (company's local date)
}

const TIME_ZONE: Record<Country, string> = { IN: 'Asia/Kolkata', US: 'America/New_York' }

// Minutes the time zone is ahead of UTC at a given moment ("GMT+05:30" → 330)
function offsetMinutes(timeZone: string, at: Date): number {
  const name = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
    .formatToParts(at).find(p => p.type === 'timeZoneName')?.value || ''
  const m = name.match(/GMT([+-])(\d{1,2}):?(\d{2})?/)
  if (!m) return 0
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] || 0))
}

// Midnight on the 1st of a month in the time zone, as a UTC moment
function monthStart(timeZone: string, year: number, month1to12: number): Date {
  const utcGuess = Date.UTC(year, month1to12 - 1, 1)
  return new Date(utcGuess - offsetMinutes(timeZone, new Date(utcGuess)) * 60000)
}

export function monthWindow(country: Country, now = new Date()) {
  const timeZone = TIME_ZONE[country]
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit' }).formatToParts(now)
  const year = Number(parts.find(p => p.type === 'year')?.value)
  const month = Number(parts.find(p => p.type === 'month')?.value)
  const nextYear = month === 12 ? year + 1 : year
  const nextMonth = month === 12 ? 1 : month + 1
  return {
    start: monthStart(timeZone, year, month),
    resetsOn: `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`,
  }
}

// null when it can't be counted (e.g. query error): callers then allow the request and show no count
export async function getAiPlanUsage(admin: SupabaseClient, clientId: string, country: Country): Promise<AiPlanUsage | null> {
  const { start, resetsOn } = monthWindow(country)
  const { count, error } = await admin
    .from('ai_usage')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', clientId)
    .eq('feature', 'plan')
    .gte('created_at', start.toISOString())
  if (error) {
    console.warn('AI plan count unavailable:', error.message)
    return null
  }
  return { used: count ?? 0, limit: AI_PLANS_PER_CLIENT_PER_MONTH, resetsOn }
}

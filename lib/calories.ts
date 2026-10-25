import { activityMet } from './activities'

// Calorie ESTIMATE for a logged session: effort level (MET) × body weight (kg) × hours.
// Shown to clients and coaches as "~260 kcal (estimate)": real burn varies by 20–30%.
// Computed when displayed (nothing stored), from the client's current weight in their profile.

// Effort from the day's focus words (e.g. "Tue · HIIT Conditioning"); first match wins
const BY_WORDS: [RegExp, number][] = [
  [/\b(hiit|interval|circuit|conditioning|plyo|crossfit|metcon|power|sprint|tabata)/i, 8],
  [/\b(run(ning)?|cardio|cycl(e|ing)|spin|bike|trek|hike|hiking|stair|row(ing)?|swim|endurance|altitude)/i, 7],
  [/\b(strength|upper|lower|push|pull|legs?|full body|chest|back|shoulders?|arms?|glutes?|weights?|gym)/i, 5],
  [/\b(yoga|pilates|core|posture|balance)/i, 3.5],
  [/\b(rest|recovery|light|walk(ing)?|stretch(ing)?|mobility|flexibility|breath)/i, 3],
]

// When the session has no day focus (logged from the normal Log form)
const BY_BUSINESS: Record<string, number> = {
  gym: 5, trek: 6, cycling: 7, pilates: 3.5, yoga: 3, general: 4.5,
}

export function effortMet(label: string | null | undefined, businessType: string | null | undefined): number {
  const focus = (label || '').split(' · ').slice(1).join(' ')
  for (const [re, met] of BY_WORDS) if (re.test(focus)) return met
  return BY_BUSINESS[businessType || ''] ?? 4.5
}

// Rounded to the nearest 5 kcal; null when weight or minutes are missing
export function estimateKcal(opts: {
  minutes: number | null | undefined
  weightKg: number | null | undefined
  label?: string | null      // logged_sessions.plan_day
  activity?: string | null   // logged_sessions.activity (Log tab): its own effort level wins
  businessType?: string | null
}): number | null {
  const { minutes, weightKg } = opts
  if (!minutes || minutes <= 0 || !weightKg || weightKg <= 0) return null
  const met = activityMet(opts.activity) ?? effortMet(opts.label, opts.businessType)
  const kcal = met * weightKg * (Math.min(minutes, 600) / 60)
  return Math.round(kcal / 5) * 5
}

export const kcalText = (kcal: number | null) => (kcal == null ? '' : `~${kcal.toLocaleString('en-US')} kcal`)

// Monday of the current week (local), as YYYY-MM-DD, for "this week" totals
export function thisWeekMonday(): string {
  const d = new Date()
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// "45 min · ~265 kcal" per day key ("Tue") for a plan's done days (several sessions on a day add up)
export function doneDayNotes<T extends { weekly_plan_id?: string | null; plan_day?: string | null; duration_minutes: number | null }>(
  planId: string,
  sessions: T[],
  kcalOf: (s: T) => number | null,
): Record<string, string> {
  const totals: Record<string, { min: number; kcal: number }> = {}
  for (const s of sessions) {
    if (s.weekly_plan_id !== planId || !s.plan_day) continue
    const key = s.plan_day.split(' · ')[0].trim()
    const t = (totals[key] ??= { min: 0, kcal: 0 })
    t.min += s.duration_minutes || 0
    t.kcal += kcalOf(s) || 0
  }
  return Object.fromEntries(Object.entries(totals).map(([k, t]) =>
    [k, [t.min ? `${t.min} min` : '', t.kcal ? `${kcalText(t.kcal)} (est.)` : ''].filter(Boolean).join(' · ')]))
}

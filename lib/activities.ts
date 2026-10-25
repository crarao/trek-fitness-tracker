// What a client did in a session logged from the Log tab (logged_sessions.activity).
// Stored as the key ("run"), or "sport:Badminton" / "other:Zumba" when a name is typed.
// Sessions ticked off from a plan day leave it empty: the day's focus says what was done.

export type Activity = { key: string; emoji: string; label: string; met: number; askName?: string }

// MET = effort level used for the calorie estimate (lib/calories.ts)
export const ACTIVITIES: Activity[] = [
  { key: 'gym', emoji: '🏋️', label: 'Gym / Weights', met: 5 },
  { key: 'walk', emoji: '🚶', label: 'Walk', met: 3.5 },
  { key: 'run', emoji: '🏃', label: 'Run', met: 9 },
  { key: 'cycling', emoji: '🚴', label: 'Cycling', met: 7 },
  { key: 'yoga', emoji: '🧘', label: 'Yoga', met: 3 },
  { key: 'pilates', emoji: '🤸', label: 'Pilates', met: 3.5 },
  { key: 'swim', emoji: '🏊', label: 'Swim', met: 7 },
  { key: 'trek', emoji: '⛰️', label: 'Trek / Hike', met: 6.5 },
  { key: 'sport', emoji: '🏸', label: 'Sport', met: 6, askName: 'Which sport? e.g. Badminton' },
  { key: 'other', emoji: '✨', label: 'Other', met: 4.5, askName: 'What was it? e.g. Zumba' },
]

const byKey = Object.fromEntries(ACTIVITIES.map(a => [a.key, a]))

export function parseActivity(value: string | null | undefined): { activity: Activity; name: string } | null {
  if (!value) return null
  const [key, ...rest] = value.split(':')
  const activity = byKey[key]
  return activity ? { activity, name: rest.join(':').trim() } : null
}

// "run" / "sport" + "Badminton" -> the stored value
export function activityValue(key: string, name: string): string {
  const a = byKey[key]
  if (!a) return ''
  return a.askName && name.trim() ? `${key}:${name.trim().slice(0, 40)}` : key
}

// "🏃 Run", "🏸 Badminton"
export function activityText(value: string | null | undefined): string {
  const p = parseActivity(value)
  if (!p) return ''
  return `${p.activity.emoji} ${p.name || p.activity.label}`
}

export function activityMet(value: string | null | undefined): number | null {
  return parseActivity(value)?.activity.met ?? null
}

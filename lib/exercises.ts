// Exercise library (public.exercises, db/2026-11-01-exercise-library.md).
// company_id null = the shared starter list (read-only); set = the gym's own exercise.
// Plans keep a copy of the name (plan_json), so renaming or archiving here never changes old plans.

import { normalizePlan } from './plan-structure'

export type Exercise = {
  id: string
  company_id: string | null
  name: string
  aliases: string[] | null
  muscle_group: string | null
  equipment: string | null
  is_archived?: boolean
}

export const EXERCISE_COLUMNS = 'id, company_id, name, aliases, muscle_group, equipment, is_archived'

export const MUSCLE_GROUPS = [
  ['chest', 'Chest'], ['back', 'Back'], ['legs', 'Legs'], ['shoulders', 'Shoulders'], ['arms', 'Arms'],
  ['core', 'Core'], ['full_body', 'Full body'], ['cardio', 'Cardio'], ['mobility', 'Mobility'],
] as const
export const EQUIPMENT = [
  ['barbell', 'Barbell'], ['dumbbell', 'Dumbbell'], ['machine', 'Machine'], ['cable', 'Cable'],
  ['bodyweight', 'Bodyweight'], ['kettlebell', 'Kettlebell'], ['band', 'Band'], ['other', 'Other'],
] as const

export const muscleLabel = (v: string | null | undefined) => MUSCLE_GROUPS.find(([k]) => k === v)?.[1] ?? ''
export const equipmentLabel = (v: string | null | undefined) => EQUIPMENT.find(([k]) => k === v)?.[1] ?? ''

// "Lat Pull-Down" and "lat pulldown" both become "lat pulldown"; "push-up" → "pushup"
export function normalizeName(s: string): string {
  return s.toLowerCase().replace(/[-'’.]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
}
const squash = (s: string) => normalizeName(s).replace(/ /g, '')

// Name typed for a new exercise: trimmed, single spaces, first letter of each word capitalised
// only when the coach typed it all in lower case ("lat pulldown" → "Lat Pulldown"; "TRX Row" kept)
export function tidyName(s: string): string {
  const t = s.replace(/\s+/g, ' ').trim().slice(0, 120)
  return t === t.toLowerCase() ? t.replace(/\b[a-z]/g, c => c.toUpperCase()) : t
}

// How well an exercise matches the search (0 = no match). Every typed word must appear in the
// name or an alias; names beat aliases, starts beat middles.
function score(e: Exercise, words: string[], whole: string): number {
  const name = normalizeName(e.name)
  const aliases = (e.aliases || []).map(normalizeName)
  const hay = [name, ...aliases]
  const all = hay.join(' | ')
  const allSquashed = hay.map(h => h.replace(/ /g, '')).join('|')
  if (!words.every(w => all.includes(w) || allSquashed.includes(w))) return 0
  if (name === whole || squash(e.name) === whole.replace(/ /g, '')) return 100
  if (aliases.includes(whole)) return 90
  if (name.startsWith(whole)) return 80
  if (aliases.some(a => a.startsWith(whole))) return 70
  if (name.split(' ').some(p => p.startsWith(words[0]))) return 60
  if (name.includes(whole)) return 50
  return 30
}

export type ExerciseFilter = { query: string; muscle: string | null; equipment: string | null; includeArchived?: boolean }

// Picker list: matches the search and chips, best first. Without a search: recently used first
// (in the order used), then A–Z. `recent` holds normalised names or ids, most recent first.
export function searchExercises(list: Exercise[], f: ExerciseFilter, recent: string[] = []): Exercise[] {
  const rank = (e: Exercise) => {
    const i = recent.findIndex(r => r === e.id || r === normalizeName(e.name))
    return i < 0 ? Infinity : i
  }
  const pool = list.filter(e => (f.includeArchived || !e.is_archived)
    && (!f.muscle || e.muscle_group === f.muscle)
    && (!f.equipment || e.equipment === f.equipment))
  const whole = normalizeName(f.query)
  if (!whole) {
    return [...pool].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
  }
  const words = whole.split(' ')
  return pool
    .map(e => ({ e, s: score(e, words, whole) }))
    .filter(x => x.s > 0)
    .sort((a, b) => b.s - a.s || rank(a.e) - rank(b.e) || a.e.name.localeCompare(b.e.name))
    .map(x => x.e)
}

// True when the typed text is already an exercise in the list (so "+ Add as new" isn't offered)
export function hasExactName(list: Exercise[], typed: string): boolean {
  const t = squash(typed)
  return !!t && list.some(e => squash(e.name) === t)
}

// Exercises used in the gym's recent plans, most recent first: ids where the plan has them,
// else normalised names. Plans come newest first (weekly_plans ordered by created_at desc).
export function recentFromPlans(plans: { plan_json?: unknown }[], max = 40): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const p of plans) {
    const plan = p.plan_json ? normalizePlan(p.plan_json) : null
    if (!plan) continue
    for (const d of plan.days) {
      for (const e of d.exercises) {
        const key = e.exercise_id || normalizeName(e.name)
        if (!key || seen.has(key)) continue
        seen.add(key)
        out.push(key)
        if (out.length >= max) return out
      }
    }
  }
  return out
}

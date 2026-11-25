// Exercise library (public.exercises, db/2026-11-01-exercise-library.md).
// company_id null = the shared starter list (read-only); set = the gym's own exercise.
// Plans keep a copy of the name (plan_json), so renaming or archiving here never changes old plans.

import { normalizePlan, type PlanJson } from './plan-structure'

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

// The database's exercises.name_key (db/2026-11-17-exercises-name-key.md), exactly:
// lower(regexp_replace(name, '[^a-zA-Z0-9]', '', 'g')). "Bar-Bell Squat" → "barbellsquat".
// Same result as squash() for plain names; this one follows the SQL order (strip, then lower case).
export const nameKey = (name: string) => (name || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase()

// Edit distance (insert / delete / change one letter), stopping early above `max`
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    let best = i
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
      best = Math.min(best, cur[j])
    }
    if (best > max) return max + 1
    prev = cur
  }
  return prev[b.length]
}

// Typos allowed for a key of this length: 2 from 6 letters, 1 from 4, none for shorter keys
// (so "row" never turns into "rdl")
const typosAllowed = (len: number) => (len >= 6 ? 2 : len >= 4 ? 1 : 0)

export type ExerciseMatch = {
  exercise: Exercise
  // name / alias: the same exercise (same key); reordered: the same words in another order;
  // close: a likely typo, offered as "Did you mean …?" and never used without asking
  kind: 'name' | 'alias' | 'reordered' | 'close'
}

// The exercise a typed or AI name means: same key as the name, else as an alias, else the same words
// in a different order, else a close spelling (edit distance on the key). Archived exercises are skipped;
// the gym's own exercise wins over the starter list. null = nothing like it.
export function findExercise(name: string, list: Exercise[], opts: { close?: boolean } = {}): ExerciseMatch | null {
  const key = nameKey(name)
  if (!key) return null
  const pool = list.filter(e => !e.is_archived)
  const first = (xs: Exercise[]) => [...xs].sort((a, b) => (a.company_id ? 0 : 1) - (b.company_id ? 0 : 1))[0]
  const byName = pool.filter(e => nameKey(e.name) === key)
  if (byName.length) return { exercise: first(byName), kind: 'name' }
  const byAlias = pool.filter(e => (e.aliases || []).some(a => nameKey(a) === key))
  if (byAlias.length) return { exercise: first(byAlias), kind: 'alias' }
  const words = (s: string) => normalizeName(s).split(' ').filter(Boolean).sort().join(' ')
  const w = words(name)
  if (w.includes(' ')) {
    const reordered = pool.filter(e => [e.name, ...(e.aliases || [])].some(n => words(n) === w))
    if (reordered.length) return { exercise: first(reordered), kind: 'reordered' }
  }
  if (opts.close === false) return null // callers that never use a typo match skip the slow part
  let best: { e: Exercise; d: number } | null = null
  for (const e of pool) {
    for (const n of [e.name, ...(e.aliases || [])]) {
      const k = nameKey(n)
      const max = typosAllowed(Math.min(k.length, key.length))
      if (!max) continue
      const d = editDistance(key, k, max)
      if (d > max) continue
      if (!best || d < best.d || (d === best.d && e.company_id && !best.e.company_id)) best = { e, d }
    }
  }
  return best ? { exercise: best.e, kind: 'close' } : null
}

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

// AI plan save (17 Nov): each exercise without an id gets one when findExercise is sure (the same key as a
// name or alias, or the same words in another order). A close spelling stays unlinked: that needs a person
// ("Did you mean" in the picker). Names are never changed.
export function linkPlanExercises(plan: PlanJson, list: Exercise[]): PlanJson {
  return {
    ...plan,
    days: plan.days.map(d => ({
      ...d,
      exercises: d.exercises.map(e => {
        if (e.exercise_id || !e.name.trim()) return e
        const m = findExercise(e.name, list)
        return m && m.kind !== 'close' ? { ...e, exercise_id: m.exercise.id } : e
      }),
    })),
  }
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

// Yoga companies (25 Nov): the shared starter list is gym moves with English names, so a yoga company sees only
// its own exercises (the asana list, db/2026-11-25-yoga-asanas.md, Sanskrit names) plus Surya Namaskar.
// Display only: matching names, saved plans, logs and reports still use the full list.
const YOGA_STARTER_KEEP = new Set(['suryanamaskar'])

export function shownForBusiness(e: Pick<Exercise, 'company_id' | 'name' | 'muscle_group' | 'equipment'>, businessType: string | null | undefined): boolean {
  if (businessType !== 'yoga' || e.company_id) return true
  return YOGA_STARTER_KEEP.has(nameKey(e.name))
}

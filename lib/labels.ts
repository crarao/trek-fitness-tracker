// Business type (companies.business_type, set by super admin) and the words that depend on it.
// A dojo = Company type 'gym' + Business type 'martial_arts' (Dojo Build 1, ROADMAP #53).
// Every other business type keeps today's wording exactly. Safe in the browser and on the server (no imports).

export type BusinessType = 'gym' | 'martial_arts' | 'yoga' | 'pilates' | 'cycling' | 'trek' | 'general'

export const BUSINESS_TYPES: { value: BusinessType; label: string }[] = [
  { value: 'gym', label: 'Gym' },
  { value: 'martial_arts', label: 'Martial arts / dojo' },
  { value: 'yoga', label: 'Yoga' },
  { value: 'pilates', label: 'Pilates' },
  { value: 'cycling', label: 'Cycling' },
  { value: 'trek', label: 'Trek' },
  { value: 'general', label: 'General' },
]

// The stored value as a known business type; empty / unknown = 'general' (what the login page already falls back to)
export function businessType(value: string | null | undefined): BusinessType {
  return BUSINESS_TYPES.some(t => t.value === value) ? (value as BusinessType) : 'general'
}

// Short label for the super admin list tag ("Martial arts", not "Martial arts / dojo")
export function businessTypeLabel(value: string | null | undefined): string {
  const t = businessType(value)
  return t === 'martial_arts' ? 'Martial arts' : BUSINESS_TYPES.find(b => b.value === t)!.label
}

// A dojo (martial arts school): Students, parent details, fee reminders to the parent
export function isDojo(value: string | null | undefined): boolean {
  return value === 'martial_arts'
}

// A yoga studio / teacher (business type 'yoga'). Runs as classes once it has a branch (isClassBased)
export function isYoga(value: string | null | undefined): boolean {
  return value === 'yoga'
}

// Business types that can run as classes (branches, batches, roll call, attendance): martial arts and yoga.
// Used to decide whether to ask for branches at all; whether the classes screens are on is isClassBased.
export function canRunClasses(value: string | null | undefined): boolean {
  return isDojo(value) || isYoga(value)
}

// Class mode (yoga demo slice, 21 Nov): branches, batches, roll call and attendance instead of plans and sessions.
// Martial arts: always, exactly what isDojo() returns (DSSKA unchanged). Yoga: only with at least one active branch
// (super admin adds the first branch = classes on; a yoga teacher without branches keeps plans and sessions).
// Everything else: never. Karate-only items (parent ticked by default, Student / Sensei, belts, 🥋) stay on isDojo().
// Check: scripts/check-class-based.ts
export function isClassBased(value: string | null | undefined, activeBranches: number | null | undefined): boolean {
  if (isDojo(value)) return true
  return isYoga(value) && (activeBranches ?? 0) > 0
}

// The visible word for a client on staff screens. Only words people read: never rename columns, routes, types or variables.
// New UI must use this instead of hard-coding "Member".
export function memberWord(value: string | null | undefined): { one: string; many: string } {
  return isDojo(value) ? { one: 'Student', many: 'Students' } : { one: 'Member', many: 'Members' }
}

// The visible word for a coach login (role 'coach'): Sensei / Senseis in a dojo, else Coach / Coaches.
// Words only: the role, routes (/coach) and variables keep their names.
export function staffWord(value: string | null | undefined): { one: string; many: string } {
  if (isDojo(value)) return { one: 'Sensei', many: 'Senseis' }
  return isYoga(value) ? { one: 'Trainer', many: 'Trainers' } : { one: 'Coach', many: 'Coaches' }
}

// The word for the place on staff screens: Dojo (martial arts), Studio (yoga), else Gym
export function placeWord(value: string | null | undefined): string {
  return isDojo(value) ? 'Dojo' : isYoga(value) ? 'Studio' : 'Gym'
}

// How the PT clients are named on staff screens. In a dojo every student is a PT client (create-user saves them as
// client_type 'pt' so senseis see them and progress can be shared), so the PT label would be noise: they're "students".
// classMode (isClassBased): a yoga studio with branches makes every member PT too, so "members" there.
export function ptWord(value: string | null | undefined, classMode = false): string {
  if (isDojo(value)) return 'students'
  return classMode ? 'members' : 'PT clients'
}

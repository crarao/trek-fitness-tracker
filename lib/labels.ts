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

// The visible word for a client on staff screens. Only words people read: never rename columns, routes, types or variables.
// New UI must use this instead of hard-coding "Member".
export function memberWord(value: string | null | undefined): { one: string; many: string } {
  return isDojo(value) ? { one: 'Student', many: 'Students' } : { one: 'Member', many: 'Members' }
}

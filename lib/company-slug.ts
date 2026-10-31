// Company slug: the short name in a company's branded login link, getcoachboard.com/login/<slug>
// (app/login/[slug] forwards to /login?company=<slug>). Planned to become <slug>.getcoachboard.com,
// so the rules keep it a valid subdomain: lowercase letters, numbers and hyphens, starts with a
// letter, doesn't end with a hyphen. DB side: db/2026-10-31-company-slug.md (unique index + format check).
import type { SupabaseClient } from '@supabase/supabase-js'

export const SLUG_MIN = 3
export const SLUG_MAX = 30
export const RESERVED_SLUGS = ['www', 'app', 'admin', 'api', 'login', 'mail', 'support', 'help']

export const LOGIN_HOST = 'getcoachboard.com'
export const loginLinkPreview = (slug: string) => `${LOGIN_HOST}/login/${slug || '<slug>'}`

// While the admin types in the slug field: lowercase, spaces become hyphens, anything else dropped
export const cleanSlugInput = (value: string) =>
  value.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-{2,}/g, '-')

// Suggested slug from the company name ("Syed's Fitness Studio" → "syeds-fitness-studio")
export function slugFromName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '') // é → e
    .replace(/['’]/g, '')                               // syed's → syeds
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^[^a-z]+/, '')                            // must start with a letter
    .slice(0, SLUG_MAX)
    .replace(/-+$/, '')
}

// Problem with the slug's format, or '' when it's fine
export function slugProblem(slug: string): string {
  if (!slug) return 'Enter a slug for the login link'
  if (slug.length < SLUG_MIN || slug.length > SLUG_MAX) return `Slug must be ${SLUG_MIN}–${SLUG_MAX} characters`
  if (!/^[a-z]/.test(slug)) return 'Slug must start with a letter'
  if (!/^[a-z0-9-]+$/.test(slug)) return 'Slug can only have lowercase letters, numbers and hyphens'
  if (slug.endsWith('-')) return 'Slug can’t end with a hyphen'
  if (RESERVED_SLUGS.includes(slug)) return `“${slug}” is reserved, pick another slug`
  return ''
}

export const slugTakenMessage = (slug: string) => `“${slug}” is already used by another company`

// True when another company (not excludeId) already has this slug. Super admin can read every company.
export async function slugTaken(supabase: SupabaseClient, slug: string, excludeId?: string | null) {
  let query = supabase.from('companies').select('id').eq('slug', slug).limit(1)
  if (excludeId) query = query.neq('id', excludeId)
  const { data, error } = await query
  if (error) throw error
  return (data?.length ?? 0) > 0
}

// Postgres unique violation (two saves at once slipped past slugTaken; the unique index caught it)
export const isSlugConflict = (error: { code?: string; message?: string } | null) =>
  !!error && error.code === '23505' && /slug/i.test(error.message || '')

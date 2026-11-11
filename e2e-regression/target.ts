// Where the regression suite may run (CLAUDE.md → Regression tests). These tests WRITE, so they must only ever
// touch the dev Supabase project. Checked three times:
//  1. at start-up (playwright.regression.config.ts): the base URL and E2E_SUPABASE_URL below;
//  2. in global setup: after a real login, every Supabase request the app made went to the dev project;
//  3. on every request in every test (fixtures.ts): a request to any other Supabase project is aborted and fails the test.

export const DEV_REF = 'nnxrmaiinbmxfwzefbwx'   // coachboard-dev
export const PROD_REF = 'nptxjfvkqjuekgkspemu'  // coachboard-mumbai (prod): never
export const DEV_LINK_HOST = 'getcoachboard-git-dev-craraos-projects.vercel.app'
// Vercel Preview builds of a branch off dev (Preview env vars = dev Supabase), e.g. getcoachboard-git-claude-x-craraos-projects.vercel.app.
// Production deployments have similar URLs, which is why check 2 and 3 exist: a prod build would fail at global setup.
const PREVIEW_HOST = /^getcoachboard-[a-z0-9-]+-craraos-projects\.vercel\.app$/

export function isLocalHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname.endsWith('.localhost')
}

// Throws (and so stops the whole run) unless the target is safe
export function checkTarget(env = process.env): { baseUrl: string; supabaseUrl: string } {
  const problems: string[] = []
  const rawBase = env.E2E_BASE_URL || ''
  const rawSupabase = env.E2E_SUPABASE_URL || ''
  let base: URL | null = null
  try { base = new URL(rawBase) } catch { problems.push(`E2E_BASE_URL is not a URL: "${rawBase}"`) }
  if (base) {
    const h = base.hostname.toLowerCase()
    if (h.includes('getcoachboard.com')) problems.push(`E2E_BASE_URL is production (${h}). Regression tests write data: dev link or localhost only.`)
    else if (!(h === DEV_LINK_HOST || isLocalHost(h) || PREVIEW_HOST.test(h))) {
      problems.push(`E2E_BASE_URL host "${h}" is not the dev link (${DEV_LINK_HOST}), a Vercel preview of a dev branch, or localhost.`)
    }
  }
  if (!rawSupabase.includes(DEV_REF)) problems.push(`E2E_SUPABASE_URL must be the dev project (${DEV_REF}); got "${rawSupabase || '(not set)'}".`)
  if (rawSupabase.includes(PROD_REF)) problems.push('E2E_SUPABASE_URL is the Mumbai (prod) project.')
  if (problems.length) throw new Error('Regression tests refused to start:\n  - ' + problems.join('\n  - '))
  return { baseUrl: base!.origin, supabaseUrl: new URL(rawSupabase).origin }
}

// A Supabase project host other than dev? (any *.supabase.co / *.supabase.in)
export function isForeignSupabase(url: string): boolean {
  let host: string
  try { host = new URL(url).hostname } catch { return false }
  if (!/\.supabase\.(co|in)$/.test(host)) return false
  return host !== `${DEV_REF}.supabase.co`
}

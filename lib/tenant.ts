// Gym subdomains: syedfitness.getcoachboard.com runs the whole app for the company whose slug is
// "syedfitness" (branded login, dashboard, PWA). proxy.ts reads the gym from the host; the login page
// reads it from window.location. In local dev, syedfitness.localhost:3000 works the same way.
// The bare domain (getcoachboard.com, www.getcoachboard.com, *.vercel.app previews) has no gym.

export const ROOT_DOMAIN = 'getcoachboard.com'
const ROOTS = [ROOT_DOMAIN, 'localhost']

// The gym slug in a host like "syedfitness.getcoachboard.com" or "syedfitness.localhost:3000", else null
export function tenantSlugFromHost(host: string | null | undefined): string | null {
  if (!host) return null
  const hostname = host.split(':')[0].toLowerCase()
  for (const root of ROOTS) {
    if (!hostname.endsWith('.' + root)) continue
    const sub = hostname.slice(0, -(root.length + 1))
    if (!sub || sub === 'www') return null
    return sub
  }
  return null
}

// Same host with the gym part removed ("syedfitness.localhost:3000" → "localhost:3000")
export function rootHost(host: string): string {
  const slug = tenantSlugFromHost(host)
  return slug ? host.slice(slug.length + 1) : host
}

// What the super admin sends a gym: its own address
export const gymAddress = (slug: string) => `${slug || '<slug>'}.${ROOT_DOMAIN}`

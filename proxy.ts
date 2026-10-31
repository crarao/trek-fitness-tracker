import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { NextResponse, type NextRequest } from 'next/server'
import { tenantSlugFromHost, rootHost } from '@/lib/tenant'

// Next.js 16 "proxy" (formerly middleware): runs on the server before app pages load.
// 1. Must be logged in (Supabase session cookie, verified with Supabase).
// 2. Must have the right role for the section; otherwise sent to their own home screen.
// 3. A coach whose login was turned off (archived_at set) is sent to /login.
// 4. Gym subdomains (syedfitness.getcoachboard.com, lib/tenant.ts): the whole app runs there.
//    Unknown gym → main site. "/" → /dashboard (logged out → branded /login). A login from another
//    gym is sent to /login?off=gym (signed out there). Super admin may use any gym's address.
//
//   Section            Roles
//   /admin             super_admin
//   /coach             coach
//   /company/client    company_admin, partner, coach   (coaches open PT clients; RLS limits them to PT)
//   /company           company_admin, partner          (incl. /company/leads)
//   /client            client
//   /dashboard         any logged-in user (routes by role)

type Role = 'super_admin' | 'company_admin' | 'partner' | 'client' | 'coach'

const HOME: Record<Role, string> = {
  super_admin: '/admin',
  company_admin: '/company',
  partner: '/company',
  client: '/client',
  coach: '/coach',
}

// Which roles may open each section. /dashboard is open to any logged-in user (it routes by role).
// SECTIONS.find takes the first match, so /company/client must come before /company.
// Pages that need a login. Everything else (/, /login, ...) is public; on a gym subdomain the proxy
// still runs there to check the gym exists.
const PROTECTED = ['/admin', '/coach', '/company', '/client', '/dashboard']

const SECTIONS: { prefix: string; roles: Role[] }[] = [
  { prefix: '/admin', roles: ['super_admin'] },
  { prefix: '/coach', roles: ['coach'] },
  { prefix: '/company/client', roles: ['company_admin', 'partner', 'coach'] },
  { prefix: '/company', roles: ['company_admin', 'partner'] },
  { prefix: '/client', roles: ['client'] },
]

const adminClient = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname
  const host = request.headers.get('host') || request.nextUrl.host
  const tenantSlug = tenantSlugFromHost(host)
  const isProtected = PROTECTED.some(p => path === p || path.startsWith(p + '/'))

  // Main site, public page: nothing to check
  if (!tenantSlug && !isProtected) return NextResponse.next()

  // Gym subdomain: the gym must exist
  let tenantId: string | null = null
  if (tenantSlug) {
    const { data: company, error } = await adminClient().from('companies').select('id').eq('slug', tenantSlug).maybeSingle()
    // Lookup failed (not "no such gym"): carry on without the gym checks rather than send people away
    if (error) return isProtected ? checkLogin(request, null) : NextResponse.next()
    if (!company) {
      // No such gym: main site. Built from the Host header and set by hand: NextResponse.redirect
      // shortens a URL on nextUrl's own origin to "/", which would keep the visitor on this address.
      return new NextResponse(null, { status: 307, headers: { Location: `${request.nextUrl.protocol}//${rootHost(host)}/` } })
    }
    tenantId = company.id
    if (path === '/') {
      const url = request.nextUrl.clone()
      url.pathname = '/dashboard'
      return NextResponse.redirect(url)
    }
    if (!isProtected) return NextResponse.next()
  }

  return checkLogin(request, tenantId)
}

// Login + role checks for the PROTECTED pages. tenantId = the gym whose subdomain this is, if any.
async function checkLogin(request: NextRequest, tenantId: string | null) {
  const path = request.nextUrl.pathname
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  const section = SECTIONS.find(s => path === s.prefix || path.startsWith(s.prefix + '/'))
  if (!section) return supabaseResponse // e.g. /dashboard (it sends the user into a section, checked then)

  // Role lookup with the server key so it keeps working once RLS is switched on
  const { data: profile } = await adminClient().from('profiles').select('role, archived_at, company_id').eq('id', user.id).single()
  const role = profile?.role as Role | undefined

  if (!role || !HOME[role]) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  // Turned-off coach with a session still open: the login page signs them out and explains
  if (role === 'coach' && profile?.archived_at) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.search = '?off=coach'
    return NextResponse.redirect(url)
  }

  // Logged in to another gym's address: the login page signs them out and explains
  if (tenantId && role !== 'super_admin' && profile?.company_id !== tenantId) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.search = '?off=gym'
    return NextResponse.redirect(url)
  }

  if (!section.roles.includes(role)) {
    const url = request.nextUrl.clone()
    url.pathname = HOME[role]
    url.search = ''
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}

export const config = {
  // Every page (gym subdomains need the check everywhere), not API routes or static files.
  // API routes check the caller themselves (lib/auth-server.ts).
  matcher: ['/((?!api/|_next/static|_next/image|favicon.ico|sw.js|manifest.json|icon-192.png|icon-512.png|.*\\.svg$).*)'],
}

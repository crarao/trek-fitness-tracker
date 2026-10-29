import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { NextResponse, type NextRequest } from 'next/server'

// Next.js 16 "proxy" (formerly middleware): runs on the server before app pages load.
// 1. Must be logged in (Supabase session cookie, verified with Supabase).
// 2. Must have the right role for the section; otherwise sent to their own home screen.
// 3. A coach whose login was turned off (archived_at set) is sent to /login.
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
const SECTIONS: { prefix: string; roles: Role[] }[] = [
  { prefix: '/admin', roles: ['super_admin'] },
  { prefix: '/coach', roles: ['coach'] },
  { prefix: '/company/client', roles: ['company_admin', 'partner', 'coach'] },
  { prefix: '/company', roles: ['company_admin', 'partner'] },
  { prefix: '/client', roles: ['client'] },
]

export async function proxy(request: NextRequest) {
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

  const path = request.nextUrl.pathname
  const section = SECTIONS.find(s => path === s.prefix || path.startsWith(s.prefix + '/'))
  if (!section) return supabaseResponse // e.g. /dashboard

  // Role lookup with the server key so it keeps working once RLS is switched on
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
  const { data: profile } = await admin.from('profiles').select('role, archived_at').eq('id', user.id).single()
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

  if (!section.roles.includes(role)) {
    const url = request.nextUrl.clone()
    url.pathname = HOME[role]
    url.search = ''
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}

export const config = {
  matcher: ['/admin/:path*', '/coach/:path*', '/company/:path*', '/client/:path*', '/dashboard/:path*'],
}

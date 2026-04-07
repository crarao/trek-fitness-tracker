import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Allow all these through without checking
  if (
    pathname.startsWith('/login') ||
    pathname.startsWith('/api') ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    pathname === '/'
  ) {
    return NextResponse.next()
  }

  // Check for any supabase auth cookie
  const cookies = request.cookies.getAll()
  const hasAuthCookie = cookies.some(cookie => 
    cookie.name.includes('auth-token') || 
    cookie.name.includes('sb-')
  )

  if (!hasAuthCookie) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ]
}
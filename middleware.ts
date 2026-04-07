import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (pathname.startsWith('/login') || 
      pathname.startsWith('/api') ||
      pathname.startsWith('/_next') ||
      pathname === '/') {
    return NextResponse.next()
  }

  const authCookie = request.cookies.get('sb-rzndxzhmgxkxihnwqnoy-auth-token')
  
  if (!authCookie) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ]
}
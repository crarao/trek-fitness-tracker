// Server-only: who is calling an API route, and are they allowed?
// Every /api route must call getCaller() first and return its error if there is one.
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'

export type Role = 'super_admin' | 'company_admin' | 'partner' | 'client'

export type Caller = {
  userId: string
  role: Role
  companyId: string | null
}

export const STAFF: Role[] = ['super_admin', 'company_admin', 'partner']

// Same admin-client pattern as the routes use; only for reading profiles here.
function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

// Reads the Supabase login cookie the browser sends with every same-site request
// and confirms it with Supabase. Returns the caller, or a ready-to-return error.
export async function getCaller(
  allowedRoles: Role[]
): Promise<{ caller: Caller; error: null } | { caller: null; error: NextResponse }> {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          // Lets Supabase refresh an expiring session; safe to ignore if not allowed here
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
          } catch { /* read-only context */ }
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { caller: null, error: NextResponse.json({ error: 'Not logged in' }, { status: 401 }) }
  }

  const { data: profile } = await adminClient()
    .from('profiles')
    .select('role, company_id')
    .eq('id', user.id)
    .single()

  const role = profile?.role as Role | undefined
  if (!role || !allowedRoles.includes(role)) {
    return { caller: null, error: forbidden() }
  }

  return { caller: { userId: user.id, role, companyId: profile?.company_id ?? null }, error: null }
}

export function forbidden() {
  return NextResponse.json({ error: 'Not allowed' }, { status: 403 })
}

// Staff may act on a client only inside their own gym; super admin may act on anyone.
// Returns null if allowed, or an error response.
export async function checkCanManageClient(caller: Caller, targetUserId: string): Promise<NextResponse | null> {
  if (caller.role === 'super_admin') return null
  if (!caller.companyId) return forbidden()

  const { data: target } = await adminClient()
    .from('profiles')
    .select('role, company_id')
    .eq('id', targetUserId)
    .single()

  if (!target || target.role !== 'client' || target.company_id !== caller.companyId) {
    return forbidden()
  }
  return null
}

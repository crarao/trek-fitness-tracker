// Server-only: who is calling an API route, and are they allowed?
// Every /api route must call getCaller() first and return its error if there is one.
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'

export type Role = 'super_admin' | 'company_admin' | 'partner' | 'client' | 'coach'

export type Caller = {
  userId: string
  role: Role
  companyId: string | null
}

export const STAFF: Role[] = ['super_admin', 'company_admin', 'partner']

// Routes coaches may also call (plans only; ROADMAP #40). Every other route stays STAFF.
export const PLAN_ROLES: Role[] = [...STAFF, 'coach']

// Shown when a coach whose login was turned off still has an open session
export const COACH_OFF_MESSAGE = 'Your coach login is turned off. Ask the gym owner.'

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
    .select('role, company_id, archived_at')
    .eq('id', user.id)
    .single()

  const role = profile?.role as Role | undefined
  if (!role || !allowedRoles.includes(role)) {
    return { caller: null, error: forbidden() }
  }
  // A turned-off coach (archived_at set) is refused even if their session is still open
  if (role === 'coach' && profile?.archived_at) {
    return { caller: null, error: NextResponse.json({ error: COACH_OFF_MESSAGE }, { status: 403 }) }
  }

  return { caller: { userId: user.id, role, companyId: profile?.company_id ?? null }, error: null }
}

export function forbidden() {
  return NextResponse.json({ error: 'Not allowed' }, { status: 403 })
}

// Staff may act on a client only inside their own gym; super admin may act on anyone.
// Coaches may act only on PT clients of their own gym.
// Returns null if allowed, or an error response.
export async function checkCanManageClient(caller: Caller, targetUserId: string): Promise<NextResponse | null> {
  if (caller.role === 'super_admin') return null
  if (!caller.companyId) return forbidden()

  const { data: target } = await adminClient()
    .from('profiles')
    .select('role, company_id, client_type')
    .eq('id', targetUserId)
    .single()

  if (caller.role === 'coach' && target?.client_type !== 'pt') return forbidden()
  if (!target || target.role !== 'client' || target.company_id !== caller.companyId) {
    return forbidden()
  }
  return null
}

// Primary coach (profiles.primary_coach_id) must be null or an active coach of the client's gym.
// Returns null if fine, or an error response.
export async function checkPrimaryCoach(companyId: string | null, coachId: unknown): Promise<NextResponse | null> {
  if (coachId === null || coachId === undefined || coachId === '') return null
  if (typeof coachId !== 'string' || !companyId) {
    return NextResponse.json({ error: 'Primary coach must be an active coach of this gym' }, { status: 400 })
  }
  const { data: coach } = await adminClient()
    .from('profiles')
    .select('role, company_id, archived_at')
    .eq('id', coachId)
    .single()
  if (!coach || coach.role !== 'coach' || coach.company_id !== companyId || coach.archived_at) {
    return NextResponse.json({ error: 'Primary coach must be an active coach of this gym' }, { status: 400 })
  }
  return null
}

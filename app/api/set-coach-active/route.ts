// Turn a coach login off or on (ROADMAP #40). Coaches are never deleted, so their past sessions keep
// showing "by Coach <name>".
// POST { coachId, active } → { success: true }
//  - Off: profiles.archived_at = now and the auth login is banned (stops new logins; proxy.ts and getCaller
//    stop a session that's already open)
//  - On: archived_at cleared and the ban lifted
import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { getCaller, STAFF, forbidden } from '@/lib/auth-server'
import { isCoachCompany, COACH_COMPANY_NO_STAFF } from '@/lib/company-type'

export async function POST(request: Request) {
  const { caller, error: callerError } = await getCaller(STAFF)
  if (callerError) return callerError

  const { coachId, active } = await request.json()
  if (typeof coachId !== 'string' || typeof active !== 'boolean') {
    return NextResponse.json({ error: 'coachId and active required' }, { status: 400 })
  }

  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  // Only a coach of the caller's own gym (super admin: any coach)
  const { data: target } = await supabaseAdmin.from('profiles').select('role, company_id').eq('id', coachId).single()
  if (!target || target.role !== 'coach') return forbidden()
  if (caller.role !== 'super_admin' && target.company_id !== caller.companyId) return forbidden()

  // Individual coach company: a coach login left over from when it was a gym can be turned off, not back on
  if (active) {
    const { data: co } = await supabaseAdmin.from('companies').select('*').eq('id', target.company_id).maybeSingle()
    if (isCoachCompany(co)) return NextResponse.json({ error: COACH_COMPANY_NO_STAFF }, { status: 400 })
  }

  const { error: profileError } = await supabaseAdmin
    .from('profiles')
    .update({ archived_at: active ? null : new Date().toISOString() })
    .eq('id', coachId)
  if (profileError) return NextResponse.json({ error: profileError.message }, { status: 400 })

  const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(coachId, {
    ban_duration: active ? 'none' : '876000h',
  })
  if (authError) {
    return NextResponse.json({ error: 'Saved, but the login could not be ' + (active ? 'unblocked' : 'blocked') + ': ' + authError.message }, { status: 400 })
  }

  return NextResponse.json({ success: true })
}

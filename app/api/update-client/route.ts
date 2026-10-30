import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { getCaller, STAFF, checkCanManageClient, checkPrimaryCoach } from '@/lib/auth-server'
import { isCoachCompany, COACH_COMPANY_NO_STAFF } from '@/lib/company-type'

export async function POST(request: Request) {
  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const body = await request.json()
  const { user_id, full_name, phone } = body
  if (!user_id) return NextResponse.json({ error: 'user_id required' }, { status: 400 })

  // Only staff of the client's own gym (or super admin)
  const { caller, error: callerError } = await getCaller(STAFF)
  if (callerError) return callerError
  const notAllowed = await checkCanManageClient(caller, user_id)
  if (notAllowed) return notAllowed

  // Fields sent in this request only: the Profile tab saves the primary coach on its own
  const updates: Record<string, string | null> = {}
  if ('full_name' in body || 'phone' in body) {
    updates.full_name = full_name || null
    updates.phone = phone || null
  }
  // Primary coach: owner/partner/super admin only (coaches get 403 above); null or an active coach of the client's gym
  if ('primary_coach_id' in body) {
    const { data: target } = await supabaseAdmin.from('profiles').select('company_id').eq('id', user_id).single()
    const badCoach = await checkPrimaryCoach(target?.company_id ?? null, body.primary_coach_id)
    if (badCoach) return badCoach
    // Individual coach company: the owner is the coach, so no primary coach can be set (clearing it is fine)
    if (body.primary_coach_id && target?.company_id) {
      const { data: co } = await supabaseAdmin.from('companies').select('*').eq('id', target.company_id).maybeSingle()
      if (isCoachCompany(co)) return NextResponse.json({ error: COACH_COMPANY_NO_STAFF }, { status: 400 })
    }
    updates.primary_coach_id = body.primary_coach_id || null
  }

  // Update profile row
  if (Object.keys(updates).length) {
    const { error: profileError } = await supabaseAdmin
      .from('profiles')
      .update(updates)
      .eq('id', user_id)

    if (profileError) return NextResponse.json({ error: profileError.message }, { status: 400 })
  }

  // If phone changed and account is phone-based, update auth email to match
  if (phone && /^\d{10}$/.test(phone.trim())) {
    const { data: { user } } = await supabaseAdmin.auth.admin.getUserById(user_id)
    if (user?.email?.endsWith('@getcoachboard.in')) {
      const newEmail = `${phone.trim()}@getcoachboard.in`
      if (user.email !== newEmail) {
        const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(user_id, { email: newEmail })
        if (authError) return NextResponse.json({ error: 'Profile saved but auth email update failed: ' + authError.message }, { status: 400 })
      }
    }
  }

  return NextResponse.json({ success: true })
}

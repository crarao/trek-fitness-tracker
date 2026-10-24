import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { getCaller, STAFF, checkCanManageClient } from '@/lib/auth-server'

export async function POST(request: Request) {
  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const { user_id } = await request.json()
  if (!user_id) return NextResponse.json({ error: 'user_id required' }, { status: 400 })

  // Only staff of the client's own gym (or super admin)
  const { caller, error: callerError } = await getCaller(STAFF)
  if (callerError) return callerError
  const notAllowed = await checkCanManageClient(caller, user_id)
  if (notAllowed) return notAllowed

  const { data: sessions } = await supabaseAdmin
    .from('logged_sessions')
    .select('id')
    .eq('client_id', user_id)

  const sessionIds = sessions?.map(s => s.id) || []
  if (sessionIds.length) {
    await supabaseAdmin.from('session_feedback').delete().in('session_id', sessionIds)
  }

  await supabaseAdmin.from('logged_sessions').delete().eq('client_id', user_id)
  await supabaseAdmin.from('weekly_plans').delete().eq('client_id', user_id)
  await supabaseAdmin.from('memberships').delete().eq('profile_id', user_id)
  await supabaseAdmin.from('profiles').delete().eq('id', user_id)
  await supabaseAdmin.auth.admin.deleteUser(user_id)

  return NextResponse.json({ success: true })
}

import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const { company_id } = await request.json()
  if (!company_id) return NextResponse.json({ error: 'company_id required' }, { status: 400 })

  // Get all profile IDs for this company
  const { data: profiles } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .eq('company_id', company_id)

  const profileIds = profiles?.map(p => p.id) || []

  // Clean up all user data before deleting profiles
  if (profileIds.length) {
    const { data: sessions } = await supabaseAdmin
      .from('logged_sessions')
      .select('id')
      .in('client_id', profileIds)

    const sessionIds = sessions?.map(s => s.id) || []
    if (sessionIds.length) {
      await supabaseAdmin.from('session_feedback').delete().in('session_id', sessionIds)
    }

    await supabaseAdmin.from('logged_sessions').delete().in('client_id', profileIds)
    await supabaseAdmin.from('weekly_plans').delete().in('client_id', profileIds)
  }

  await supabaseAdmin.from('memberships').delete().eq('company_id', company_id)
  await supabaseAdmin.from('profiles').delete().eq('company_id', company_id)

  // Delete auth users after profiles are gone
  await Promise.all(profileIds.map(id => supabaseAdmin.auth.admin.deleteUser(id)))

  await supabaseAdmin.from('companies').delete().eq('id', company_id)

  return NextResponse.json({ success: true })
}

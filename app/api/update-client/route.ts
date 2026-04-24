import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const { user_id, full_name, phone } = await request.json()
  if (!user_id) return NextResponse.json({ error: 'user_id required' }, { status: 400 })

  // Update profile row
  const { error: profileError } = await supabaseAdmin
    .from('profiles')
    .update({
      full_name: full_name || null,
      phone: phone || null
    })
    .eq('id', user_id)

  if (profileError) return NextResponse.json({ error: profileError.message }, { status: 400 })

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

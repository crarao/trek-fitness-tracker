import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { getCaller, STAFF, forbidden } from '@/lib/auth-server'

export async function POST(request: Request) {
  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    }
  )

const { email, password, full_name, company_id, role, phone, trainer_name, diet_plan, client_type } = await request.json()

  // Super admin can create any login. Gym staff can only add clients to their own gym.
  const { caller, error: callerError } = await getCaller(STAFF)
  if (callerError) return callerError
  if (caller.role !== 'super_admin' && (role !== 'client' || company_id !== caller.companyId)) {
    return forbidden()
  }

  const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name }
  })

  if (authError) {
    return NextResponse.json({ error: authError.message }, { status: 400 })
  }

const { error: profileError } = await supabaseAdmin.from('profiles').insert({
  id: authData.user.id,
  company_id,
  full_name,
  email,
  role,
  phone: phone || null,
  trainer_name: trainer_name || null,
  diet_plan: diet_plan || null,
  client_type: client_type || 'member'
})

  if (profileError) {
    await supabaseAdmin.auth.admin.deleteUser(authData.user.id)
    return NextResponse.json({ error: profileError.message }, { status: 400 })
  }

  return NextResponse.json({ success: true, userId: authData.user.id })
}
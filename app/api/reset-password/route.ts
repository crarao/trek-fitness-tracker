import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { getCaller, STAFF, checkCanManageClient } from '@/lib/auth-server'

export async function POST(request: Request) {
  try {
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

    const { userId, newPassword } = await request.json()
    if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })

    if (typeof newPassword !== 'string' || newPassword.length < 6) {
      return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 })
    }

    // Only staff of the client's own gym (or super admin) can reset a password.
    // Owner / partners may also reset a coach login of their own gym (coaches have no reset otherwise).
    const { caller, error: callerError } = await getCaller(STAFF)
    if (callerError) return callerError
    const { data: target } = await supabaseAdmin.from('profiles').select('role, company_id').eq('id', userId).single()
    if (target?.role === 'coach') {
      if (caller.role !== 'super_admin' && (!caller.companyId || target.company_id !== caller.companyId)) {
        return NextResponse.json({ error: 'Not allowed' }, { status: 403 })
      }
    } else {
      const notAllowed = await checkCanManageClient(caller, userId)
      if (notAllowed) return notAllowed
    }

    const { error } = await supabaseAdmin.auth.admin.updateUserById(
      userId,
      { password: newPassword }
    )

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    return NextResponse.json({ success: true })

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
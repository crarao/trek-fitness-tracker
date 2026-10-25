import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { getCaller } from '@/lib/auth-server'

// Super admin dashboard: plans assigned per company in the last 60 days.
// Plans are hidden from the super admin's browser by the access rules (staff see only their
// own gym), so this route reads them with the server key and returns only company + date.
export async function GET() {
  const { error: callerError } = await getCaller(['super_admin'])
  if (callerError) return callerError

  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const since = new Date(Date.now() - 60 * 86400000).toISOString()
  const { data: plans, error } = await supabaseAdmin
    .from('weekly_plans')
    .select('client_id, created_at')
    .gte('created_at', since)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const clientIds = [...new Set((plans || []).map(p => p.client_id))]
  const companyOf = new Map<string, string>()
  for (let i = 0; i < clientIds.length; i += 500) {
    const { data: profiles, error: pErr } = await supabaseAdmin
      .from('profiles')
      .select('id, company_id')
      .in('id', clientIds.slice(i, i + 500))
    if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 })
    for (const p of profiles || []) if (p.company_id) companyOf.set(p.id, p.company_id)
  }

  const rows = (plans || [])
    .filter(p => companyOf.has(p.client_id))
    .map(p => ({ company_id: companyOf.get(p.client_id)!, created_at: p.created_at }))
  return NextResponse.json({ plans: rows })
}

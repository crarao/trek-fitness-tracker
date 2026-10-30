import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { getCaller, STAFF, forbidden, checkPrimaryCoach } from '@/lib/auth-server'
import { isCoachCompany, COACH_COMPANY_NO_STAFF } from '@/lib/company-type'

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

const { email, password, full_name, company_id, role, phone, trainer_name, diet_plan, client_type, primary_coach_id } = await request.json()

  // Super admin can create any login. Gym staff can only add clients and coaches to their own gym.
  // Coaches don't count toward client_limit (that count filters role = 'client').
  const { caller, error: callerError } = await getCaller(STAFF)
  if (callerError) return callerError
  if (caller.role !== 'super_admin' && (!['client', 'coach'].includes(role) || company_id !== caller.companyId)) {
    return forbidden()
  }

  // Individual coach companies (companies.company_type = 'coach') have no coach or partner logins, for super admin too.
  // select('*') so this still works before the company_type column exists (then every company is a gym).
  let coachCompany = false
  if (company_id) {
    const { data: co } = await supabaseAdmin.from('companies').select('*').eq('id', company_id).maybeSingle()
    coachCompany = isCoachCompany(co)
  }
  if (coachCompany && (role === 'coach' || role === 'partner')) {
    return NextResponse.json({ error: COACH_COMPANY_NO_STAFF }, { status: 400 })
  }

  // Primary coach (PT clients only): null or an active coach of the same gym. Never set for an individual coach company.
  const primaryCoachId: string | null = !coachCompany && role === 'client' && client_type === 'pt' && primary_coach_id ? primary_coach_id : null
  const badCoach = await checkPrimaryCoach(company_id, primaryCoachId)
  if (badCoach) return badCoach

  // Owner-level partner logins are capped per company (companies.partner_limit, default 2), for super admin too
  if (role === 'partner') {
    const [{ data: company }, { count }] = await Promise.all([
      supabaseAdmin.from('companies').select('partner_limit').eq('id', company_id).single(),
      supabaseAdmin.from('profiles').select('id', { count: 'exact', head: true })
        .eq('company_id', company_id).eq('role', 'partner').is('archived_at', null),
    ])
    const limit = company?.partner_limit ?? 2
    if ((count ?? 0) >= limit) {
      return NextResponse.json({ error: `Partner limit reached (${limit})` }, { status: 400 })
    }
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
  client_type: client_type || 'member',
  ...(primaryCoachId ? { primary_coach_id: primaryCoachId } : {})
})

  if (profileError) {
    await supabaseAdmin.auth.admin.deleteUser(authData.user.id)
    return NextResponse.json({ error: profileError.message }, { status: 400 })
  }

  return NextResponse.json({ success: true, userId: authData.user.id })
}
// #37: how many AI plans a client has had this month (for "3 of 5 AI plans used this month").
// GET /api/ai-plan-usage?clientId=<uuid> → { aiPlans: { used, limit, resetsOn } | null }
import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getCaller, STAFF, checkCanManageClient } from '@/lib/auth-server'
import { getAiPlanUsage } from '@/lib/ai-plan-limit'
import { normalizeCountry } from '@/lib/locale'

export async function GET(request: NextRequest) {
  const { caller, error: authError } = await getCaller(STAFF)
  if (authError) return authError

  const clientId = request.nextUrl.searchParams.get('clientId')
  if (!clientId) return NextResponse.json({ error: 'Client missing' }, { status: 400 })

  const notAllowed = await checkCanManageClient(caller, clientId)
  if (notAllowed) return notAllowed

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
  const { data: row } = await admin
    .from('profiles')
    .select('companies:company_id(country)')
    .eq('id', clientId)
    .single()
  const companies = (row as { companies?: { country?: string | null } | { country?: string | null }[] | null } | null)?.companies
  const country = normalizeCountry(Array.isArray(companies) ? companies[0]?.country : companies?.country)

  const aiPlans = await getAiPlanUsage(admin, clientId, country)
  return NextResponse.json({ aiPlans })
}

// Rename a coach or change their phone (ROADMAP #40). Owner, partners (own gym) or super admin.
// POST { coachId, full_name, phone } → { success: true }
// Coaches with a phone login (lib/phone.ts loginEmailFor) follow their phone: a new phone changes their login too.
// The phone may be sent as local digits (the gym's own country) or as +<code><digits>.
// Their password is not changed (it stays whatever it was, e.g. the old phone number).
import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { getCaller, STAFF, forbidden } from '@/lib/auth-server'
import { splitE164, loginEmailFor, isPhoneLogin, staffPhoneValue, PHONE_COUNTRIES, phoneCountry } from '@/lib/phone'

export async function POST(request: Request) {
  const { caller, error: callerError } = await getCaller(STAFF)
  if (callerError) return callerError

  const { coachId, full_name, phone } = await request.json()
  const name = typeof full_name === 'string' ? full_name.trim() : ''
  const newPhone = typeof phone === 'string' ? phone.trim() : ''
  if (typeof coachId !== 'string' || !name) {
    return NextResponse.json({ error: 'Name is required' }, { status: 400 })
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

  // Phone login: the phone must stay a valid number, and the login email follows it.
  // Done before the profile so a clash with another login leaves nothing half-changed.
  const { data: company } = await supabaseAdmin.from('companies').select('country').eq('id', target.company_id).maybeSingle()
  const home = phoneCountry(company?.country)
  const parts = splitE164(newPhone, home)
  const { data: { user } } = await supabaseAdmin.auth.admin.getUserById(coachId)
  const phoneLogin = isPhoneLogin(user?.email)
  let loginEmail: string | null = null
  let savedPhone = newPhone
  if (parts) savedPhone = staffPhoneValue(parts.country, parts.local)
  if (phoneLogin) {
    if (!parts) {
      return NextResponse.json({ error: `Enter a valid phone number (${PHONE_COUNTRIES[home].digits} digits): this coach logs in with it` }, { status: 400 })
    }
    loginEmail = loginEmailFor(parts.country, parts.local)
    if (user!.email !== loginEmail) {
      const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(coachId, { email: loginEmail })
      if (authError) {
        const taken = /already|registered|exists/i.test(authError.message)
        return NextResponse.json({ error: taken ? 'That phone number is already used by another login' : authError.message }, { status: 400 })
      }
    }
  }

  const { error: profileError } = await supabaseAdmin
    .from('profiles')
    .update({ full_name: name, phone: savedPhone || null, ...(loginEmail ? { email: loginEmail } : {}) })
    .eq('id', coachId)
  if (profileError) return NextResponse.json({ error: profileError.message }, { status: 400 })

  return NextResponse.json({ success: true })
}

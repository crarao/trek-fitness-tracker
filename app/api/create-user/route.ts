import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { getCaller, STAFF, forbidden, checkPrimaryCoach } from '@/lib/auth-server'
import { isCoachCompany, COACH_COMPANY_NO_STAFF } from '@/lib/company-type'
import { COUNTRIES } from '@/lib/locale'
import { NO_LOGIN_DOMAIN, generatedStudentLogin, splitE164, toE164, normalizeUsername, usernameEmail, usernameProblem } from '@/lib/phone'
import { takenUsernames, freeSuggestions, isDuplicateLogin } from '@/lib/username-server'
import { GUARDIAN_RELATIONS } from '@/lib/guardian'
import { isDojo } from '@/lib/labels'
import { checkPlacement } from '@/lib/placement-server'
import { gradingOn, validIsoDate } from '@/lib/belts'
import { checkBelt, addGradeHistory } from '@/lib/belts-server'
import { randomUUID, randomBytes } from 'crypto'

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

const body = await request.json()
const { full_name, company_id, role, phone, trainer_name, diet_plan, client_type, primary_coach_id, country, currency } = body
// Client without a login (no_login: true): a placeholder nobody can sign in with, made here (lib/phone.ts NO_LOGIN_DOMAIN)
const noLogin = body.no_login === true && role === 'client'
// Parent / guardian (clients only; sent only once db/2026-11-03-guardian.md has run). A child with no phone of their own
// gets a generated login (lib/phone.ts generatedStudentLogin): the parent's phone is never a login, so siblings can share it.
const hasGuardianFields = role === 'client' && ('guardian_phone' in body || 'guardian_name' in body || 'guardian_relation' in body)
const childNoPhone = noLogin && hasGuardianFields && !!body.guardian_phone && !phone
// Username login (clients): the login email is built here from the username (lib/phone.ts usernameEmail), never sent
const username = role === 'client' && !noLogin && typeof body.username === 'string' && body.username.trim() ? normalizeUsername(body.username) : null
const email: string = childNoPhone ? generatedStudentLogin() : noLogin ? `client-${randomUUID()}${NO_LOGIN_DOMAIN}` : username ? usernameEmail(username) : body.email
const password: string = childNoPhone ? randomBytes(12).toString('base64url') : noLogin ? randomBytes(24).toString('base64url') : body.password

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
  let companyRow: Record<string, unknown> | null = null
  if (company_id) {
    const { data: co } = await supabaseAdmin.from('companies').select('*').eq('id', company_id).maybeSingle()
    coachCompany = isCoachCompany(co)
    companyRow = co
  }

  // Client's own country / currency (multi-country gyms, db/2026-11-01-multi-country.md). Sent only once that SQL has run.
  // The currency must be one the gym allows (companies.allowed_currencies, set by super admin).
  const clientPlace: { country?: string; currency?: string } = {}
  if (role === 'client' && (country || currency)) {
    if (country && !COUNTRIES.some(c => c.code === country)) {
      return NextResponse.json({ error: 'Unknown country' }, { status: 400 })
    }
    const allowed = Array.isArray(companyRow?.allowed_currencies) ? (companyRow!.allowed_currencies as string[]) : null
    if (currency && (!allowed || !allowed.includes(currency))) {
      return NextResponse.json({ error: `This gym doesn't take payments in ${currency}` }, { status: 400 })
    }
    if (country) clientPlace.country = country
    if (currency) clientPlace.currency = currency
  }
  // Parent phone: validated here too (same rule as the form, lib/phone.ts), saved like phone (+<code><digits>)
  const guardian: { guardian_name?: string | null; guardian_phone?: string | null; guardian_relation?: string | null } = {}
  if (hasGuardianFields) {
    const rawParent = typeof body.guardian_phone === 'string' ? body.guardian_phone.trim() : ''
    let parentPhone: string | null = null
    if (rawParent) {
      const parts = splitE164(rawParent, (companyRow?.country as string | null) ?? 'IN')
      if (!parts) return NextResponse.json({ error: 'Enter a valid parent phone number' }, { status: 400 })
      parentPhone = toE164(parts.country, parts.local)
    }
    const relation = typeof body.guardian_relation === 'string' ? body.guardian_relation.trim() : ''
    if (relation && !(GUARDIAN_RELATIONS as readonly string[]).includes(relation)) {
      return NextResponse.json({ error: 'Relation must be Mother, Father or Guardian' }, { status: 400 })
    }
    guardian.guardian_name = typeof body.guardian_name === 'string' && body.guardian_name.trim() ? body.guardian_name.trim() : null
    guardian.guardian_phone = parentPhone
    guardian.guardian_relation = relation || null
  }
  // Short profile entered on the Add form (dojos: age, gender, medical conditions on one screen). Clients only, only when sent.
  const clientBasics: { age?: number | null; gender?: string | null; medical_conditions?: string | null } = {}
  if (role === 'client') {
    if ('age' in body) {
      const age = body.age === null || body.age === '' ? null : Number(body.age)
      if (age !== null && (!Number.isInteger(age) || age < 1 || age > 120)) {
        return NextResponse.json({ error: 'Enter an age between 1 and 120' }, { status: 400 })
      }
      clientBasics.age = age
    }
    if ('gender' in body) {
      const gender = typeof body.gender === 'string' ? body.gender.trim() : ''
      if (gender && !['Male', 'Female', 'Other'].includes(gender)) return NextResponse.json({ error: 'Unknown gender' }, { status: 400 })
      clientBasics.gender = gender || null
    }
    if ('medical_conditions' in body) {
      clientBasics.medical_conditions = typeof body.medical_conditions === 'string' && body.medical_conditions.trim() ? body.medical_conditions.trim() : null
    }
  }
  // Branch and home batch (dojos, db/2026-11-03-branches-batches.md; sent only once those tables exist).
  // Both must belong to this gym, and the batch to the branch; a batch alone sets its branch.
  const placement: { branch_id?: string | null; batch_id?: string | null } = {}
  if (role === 'client' && ('branch_id' in body || 'batch_id' in body)) {
    const placed = await checkPlacement(supabaseAdmin, company_id, body.branch_id || null, body.batch_id || null)
    if ('error' in placed) return NextResponse.json({ error: placed.error }, { status: 400 })
    Object.assign(placement, placed)
  }
  // Belt (dojos with Grading on, lib/belts.ts): the student's belt when they join + since when; history row 'joined' below
  const belt: { current_rank_id?: string; rank_achieved_on?: string | null } = {}
  if (role === 'client' && body.current_rank_id) {
    if (!gradingOn(companyRow as { grading_enabled?: boolean | null } | null)) {
      return NextResponse.json({ error: 'Grading is off for this gym' }, { status: 400 })
    }
    const ok = await checkBelt(supabaseAdmin, company_id, String(body.current_rank_id))
    if ('error' in ok) return NextResponse.json({ error: ok.error }, { status: 400 })
    if (body.rank_achieved_on && !validIsoDate(body.rank_achieved_on)) {
      return NextResponse.json({ error: 'Enter a valid "Belt since" date' }, { status: 400 })
    }
    belt.current_rank_id = String(body.current_rank_id)
    belt.rank_achieved_on = body.rank_achieved_on || null
  }
  // Username: same rules as the form, and free across every gym (Supabase Auth's unique email is the final check below)
  if (username) {
    const problem = usernameProblem(username)
    if (problem) return NextResponse.json({ error: problem }, { status: 400 })
    if (typeof password !== 'string' || password.length < 6) return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 })
    if ((await takenUsernames(supabaseAdmin, [username])).has(username)) {
      return NextResponse.json({ error: `Username ${username} is taken`, suggestions: await freeSuggestions(supabaseAdmin, username, full_name || '') }, { status: 409 })
    }
  }
  if (coachCompany && (role === 'coach' || role === 'partner')) {
    return NextResponse.json({ error: COACH_COMPANY_NO_STAFF }, { status: 400 })
  }

  // Coach for a client (PT: primary coach; regular member: optional trainer): null or an active coach of the same gym,
  // picked from the dropdown. Never set for an individual coach company.
  const primaryCoachId: string | null = !coachCompany && role === 'client' && primary_coach_id ? primary_coach_id : null
  const badCoach = await checkPrimaryCoach(company_id, primaryCoachId)
  if (badCoach) return badCoach

  // Client limit (companies.client_limit, set by super admin; 50 if empty, same as the dashboard): active clients only.
  // Checked here too so a direct API call can't go past it.
  if (role === 'client' && caller.role !== 'super_admin') {
    const [{ data: company }, { count }] = await Promise.all([
      supabaseAdmin.from('companies').select('client_limit').eq('id', company_id).single(),
      supabaseAdmin.from('profiles').select('id', { count: 'exact', head: true })
        .eq('company_id', company_id).eq('role', 'client').is('archived_at', null),
    ])
    const limit = company?.client_limit || 50
    if ((count ?? 0) >= limit) {
      return NextResponse.json({ error: `Client limit reached (${limit}). Contact CoachBoard to increase your limit.` }, { status: 400 })
    }
  }

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
    if (username && isDuplicateLogin(authError.message)) {
      return NextResponse.json({ error: `Username ${username} is taken`, suggestions: await freeSuggestions(supabaseAdmin, username, full_name || '') }, { status: 409 })
    }
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
  // Dojo (business type martial_arts): every student is a PT client, so senseis see them and progress can be shared
  client_type: role === 'client' && isDojo(companyRow?.business_type as string | null) ? 'pt' : client_type || 'member',
  ...clientPlace,
  ...guardian,
  ...clientBasics,
  ...placement,
  ...belt,
  ...(primaryCoachId ? { primary_coach_id: primaryCoachId } : {})
})

  if (profileError) {
    await supabaseAdmin.auth.admin.deleteUser(authData.user.id)
    return NextResponse.json({ error: profileError.message }, { status: 400 })
  }

  // Belt history: the first row ('joined'). The student is kept if this fails; the form says so
  if (belt.current_rank_id) {
    const historyError = await addGradeHistory(supabaseAdmin, {
      company_id, student_id: authData.user.id, rank_id: belt.current_rank_id,
      achieved_on: belt.rank_achieved_on ?? null, source: 'joined', created_by: caller.userId,
    })
    if (historyError) {
      console.error('Belt history insert error:', historyError)
      return NextResponse.json({ success: true, userId: authData.user.id, warning: "Belt saved, but its history row wasn't" })
    }
  }

  return NextResponse.json({ success: true, userId: authData.user.id })
}
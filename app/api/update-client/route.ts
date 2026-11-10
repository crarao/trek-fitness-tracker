import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { getCaller, STAFF, checkCanManageClient, checkPrimaryCoach } from '@/lib/auth-server'
import { isCoachCompany, COACH_COMPANY_NO_STAFF } from '@/lib/company-type'
import { COUNTRIES } from '@/lib/locale'
import { splitE164, loginEmailFor, isPhoneLogin, toE164 } from '@/lib/phone'
import { GUARDIAN_RELATIONS } from '@/lib/guardian'
import { checkPlacement } from '@/lib/placement-server'
import { gradingOn, gradeSource, validIsoDate } from '@/lib/belts'
import { checkBelt, addGradeHistory } from '@/lib/belts-server'

export async function POST(request: Request) {
  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const body = await request.json()
  const { user_id, full_name, phone } = body
  if (!user_id) return NextResponse.json({ error: 'user_id required' }, { status: 400 })

  // Only staff of the client's own gym (or super admin)
  const { caller, error: callerError } = await getCaller(STAFF)
  if (callerError) return callerError
  const notAllowed = await checkCanManageClient(caller, user_id)
  if (notAllowed) return notAllowed

  // Fields sent in this request only: the Profile tab saves the primary coach on its own
  const updates: Record<string, string | null> = {}
  if ('full_name' in body || 'phone' in body) {
    updates.full_name = full_name || null
    updates.phone = phone || null
  }
  // Primary coach: owner/partner/super admin only (coaches get 403 above); null or an active coach of the client's gym
  if ('primary_coach_id' in body) {
    const { data: target } = await supabaseAdmin.from('profiles').select('company_id').eq('id', user_id).single()
    const badCoach = await checkPrimaryCoach(target?.company_id ?? null, body.primary_coach_id)
    if (badCoach) return badCoach
    // Individual coach company: the owner is the coach, so no primary coach can be set (clearing it is fine)
    if (body.primary_coach_id && target?.company_id) {
      const { data: co } = await supabaseAdmin.from('companies').select('*').eq('id', target.company_id).maybeSingle()
      if (isCoachCompany(co)) return NextResponse.json({ error: COACH_COMPANY_NO_STAFF }, { status: 400 })
    }
    updates.primary_coach_id = body.primary_coach_id || null
  }

  // Client's own country / currency (multi-country gyms only; sent only once db/2026-11-01-multi-country.md has run).
  // Only the client's default changes: saved memberships keep the currency they were paid in (never touched here).
  let company: Record<string, unknown> | null = null
  const loadCompany = async () => {
    if (company) return company
    const { data: target } = await supabaseAdmin.from('profiles').select('company_id').eq('id', user_id).single()
    if (target?.company_id) {
      const { data: co } = await supabaseAdmin.from('companies').select('*').eq('id', target.company_id).maybeSingle()
      company = co
    }
    return company
  }
  if ('country' in body || 'currency' in body) {
    const co = await loadCompany()
    if (!co?.multi_country_enabled) {
      return NextResponse.json({ error: 'Multi-country is off for this gym' }, { status: 400 })
    }
    if ('country' in body) {
      if (!COUNTRIES.some(c => c.code === body.country)) return NextResponse.json({ error: 'Unknown country' }, { status: 400 })
      updates.country = body.country
    }
    if ('currency' in body) {
      const allowed = Array.isArray(co.allowed_currencies) ? (co.allowed_currencies as string[]) : []
      if (!allowed.includes(body.currency)) {
        return NextResponse.json({ error: `This gym doesn't take payments in ${body.currency}` }, { status: 400 })
      }
      updates.currency = body.currency
    }
  }

  // Parent / guardian (db/2026-11-03-guardian.md; sent only once those columns exist). Phone saved like phone (+<code><digits>).
  if ('guardian_name' in body) {
    updates.guardian_name = typeof body.guardian_name === 'string' && body.guardian_name.trim() ? body.guardian_name.trim() : null
  }
  if ('guardian_relation' in body) {
    const relation = typeof body.guardian_relation === 'string' ? body.guardian_relation.trim() : ''
    if (relation && !(GUARDIAN_RELATIONS as readonly string[]).includes(relation)) {
      return NextResponse.json({ error: 'Relation must be Mother, Father or Guardian' }, { status: 400 })
    }
    updates.guardian_relation = relation || null
  }
  if ('guardian_phone' in body) {
    const raw = typeof body.guardian_phone === 'string' ? body.guardian_phone.trim() : ''
    if (raw) {
      const co = await loadCompany()
      const parts = splitE164(raw, (co?.country as string | null) ?? 'IN')
      if (!parts) return NextResponse.json({ error: 'Enter a valid parent phone number' }, { status: 400 })
      updates.guardian_phone = toE164(parts.country, parts.local)
    } else {
      updates.guardian_phone = null
    }
  }

  // Branch and home batch (dojos, db/2026-11-03-branches-batches.md; sent only once those tables exist).
  // Must be in the client's gym, the batch at the branch; a saved archived value may be kept, not newly picked.
  if ('branch_id' in body || 'batch_id' in body) {
    const { data: target } = await supabaseAdmin.from('profiles').select('*').eq('id', user_id).single()
    const t = target as { company_id?: string | null; branch_id?: string | null; batch_id?: string | null } | null
    const placed = await checkPlacement(supabaseAdmin, t?.company_id, body.branch_id || null, body.batch_id || null, t ?? undefined)
    if ('error' in placed) return NextResponse.json({ error: placed.error }, { status: 400 })
    updates.branch_id = placed.branch_id
    updates.batch_id = placed.batch_id
  }

  // Belt + "Belt since" (dojos with Grading on, lib/belts.ts). A set belt can be changed, not cleared.
  // History (student_grades) is written after the profile saves: a new belt = a new row ('backfill' if there was none,
  // else 'manual'); the same belt with a corrected date = the date fixed on its latest row.
  let beltChange: { companyId: string; previous: string | null; rankId: string; date: string | null; rankChanged: boolean; dateChanged: boolean } | null = null
  if ('current_rank_id' in body || 'rank_achieved_on' in body) {
    const co = await loadCompany()
    if (!gradingOn(co as { grading_enabled?: boolean | null } | null)) {
      return NextResponse.json({ error: 'Grading is off for this gym' }, { status: 400 })
    }
    const { data: target } = await supabaseAdmin.from('profiles').select('*').eq('id', user_id).single()
    const t = target as { company_id?: string | null; current_rank_id?: string | null; rank_achieved_on?: string | null } | null
    const previous = t?.current_rank_id ?? null
    const rankId: string | null = 'current_rank_id' in body ? (body.current_rank_id || null) : previous
    const date: string | null = 'rank_achieved_on' in body ? (body.rank_achieved_on || null) : (t?.rank_achieved_on ?? null)
    if (!rankId) {
      if (previous) return NextResponse.json({ error: 'Pick a belt' }, { status: 400 })
      if (date) return NextResponse.json({ error: 'Pick the belt first, then the date' }, { status: 400 })
    } else {
      const ok = await checkBelt(supabaseAdmin, t?.company_id, rankId, previous)
      if ('error' in ok) return NextResponse.json({ error: ok.error }, { status: 400 })
      if (date && !validIsoDate(date)) return NextResponse.json({ error: 'Enter a valid "Belt since" date' }, { status: 400 })
      updates.current_rank_id = rankId
      updates.rank_achieved_on = date
      beltChange = {
        companyId: t!.company_id!, previous, rankId, date,
        rankChanged: rankId !== previous, dateChanged: date !== (t?.rank_achieved_on ?? null),
      }
    }
  }

  // Update profile row. .select() so a save that touched no row (wrong id) shows as an error, not "Saved"
  if (Object.keys(updates).length) {
    const { data: saved, error: profileError } = await supabaseAdmin
      .from('profiles')
      .update(updates)
      .eq('id', user_id)
      .select('id')

    if (profileError) return NextResponse.json({ error: profileError.message }, { status: 400 })
    if (!saved?.length) return NextResponse.json({ error: "Couldn't save: the client wasn't found" }, { status: 400 })
  }

  let warning: string | undefined
  if (beltChange?.rankChanged) {
    const historyError = await addGradeHistory(supabaseAdmin, {
      company_id: beltChange.companyId, student_id: user_id, rank_id: beltChange.rankId,
      achieved_on: beltChange.date, source: gradeSource(beltChange.previous), created_by: caller.userId,
    })
    if (historyError) { console.error('Belt history insert error:', historyError); warning = "Belt saved, but its history row wasn't" }
  } else if (beltChange?.dateChanged) {
    const { data: latest } = await supabaseAdmin.from('student_grades').select('id')
      .eq('student_id', user_id).eq('rank_id', beltChange.rankId)
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (latest) {
      const { error: dateError } = await supabaseAdmin.from('student_grades').update({ achieved_on: beltChange.date }).eq('id', latest.id)
      if (dateError) { console.error('Belt history date error:', dateError); warning = "Belt date saved, but its history row wasn't updated" }
    }
  }

  // If phone changed and account is phone-based, update auth email to match.
  // Phones are stored as +919876543210 (old rows: 9876543210); the login identifier comes from lib/phone.ts.
  // Only Indian numbers are client logins (lib/locale.ts loginMethod), so other numbers never move a login.
  const co = phone ? await loadCompany() : null
  const parts = phone ? splitE164(phone, (co?.country as string | null) ?? 'IN') : null
  if (parts && parts.country === 'IN') {
    const { data: { user } } = await supabaseAdmin.auth.admin.getUserById(user_id)
    if (isPhoneLogin(user?.email)) {
      const newEmail = loginEmailFor(parts.country, parts.local)
      if (user!.email !== newEmail) {
        const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(user!.id, { email: newEmail })
        if (authError) return NextResponse.json({ error: 'Profile saved but auth email update failed: ' + authError.message }, { status: 400 })
      }
    }
  }

  return NextResponse.json({ success: true, ...(warning ? { warning } : {}) })
}

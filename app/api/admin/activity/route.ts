import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { getCaller } from '@/lib/auth-server'

// Super admin dashboard: is each gym really using the app?
// Returns, per company, (1) everyday work from the last 60 days that the super admin's browser
// can't read (sessions logged, attendance marked, leads added / updated) and (2) the most recent
// sign-in of any of its logins. Work done by a super admin login (demos, setup) is left out.
// Read-only; returns only company ids and dates.
export async function GET() {
  const { error: callerError } = await getCaller(['super_admin'])
  if (callerError) return callerError

  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  // Every login's company and role (super admins have no company)
  const { data: profiles, error: pErr } = await db.from('profiles').select('id, company_id, role')
  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 })
  const companyOf = new Map<string, string>()
  const superAdmins = new Set<string>()
  for (const p of profiles || []) {
    if (p.role === 'super_admin') superAdmins.add(p.id)
    else if (p.company_id) companyOf.set(p.id, p.company_id)
  }
  const byMe = (id?: string | null) => !!id && superAdmins.has(id)

  const since = new Date(Date.now() - 60 * 86400000).toISOString()
  const work: { company_id: string; created_at: string }[] = []

  // Each read is optional: a table that isn't there yet (or fails) just adds nothing.
  const [sessions, attendance, leads] = await Promise.all([
    db.from('logged_sessions').select('client_id, logged_by, created_at').gte('created_at', since),
    db.from('attendance').select('company_id, marked_by, marked_at').gte('marked_at', since),
    db.from('leads').select('company_id, created_by, updated_at').gte('updated_at', since),
  ])
  for (const s of sessions.data || []) {
    const c = companyOf.get(s.client_id)
    if (c && !byMe(s.logged_by)) work.push({ company_id: c, created_at: s.created_at })
  }
  for (const a of attendance.data || []) {
    if (a.company_id && a.marked_at && !byMe(a.marked_by)) work.push({ company_id: a.company_id, created_at: a.marked_at })
  }
  for (const l of leads.data || []) {
    if (l.company_id && l.updated_at && !byMe(l.created_by)) work.push({ company_id: l.company_id, created_at: l.updated_at })
  }

  // Latest sign-in per company (Supabase records a password login, not an app that stays logged in)
  const lastLogin: Record<string, string> = {}
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) break
    for (const u of data.users) {
      const c = companyOf.get(u.id)
      if (c && u.last_sign_in_at && (!lastLogin[c] || u.last_sign_in_at > lastLogin[c])) lastLogin[c] = u.last_sign_in_at
    }
    if (data.users.length < 1000) break
  }

  return NextResponse.json({ work, lastLogin })
}

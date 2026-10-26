import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { getCaller } from '@/lib/auth-server'

// Super admin Dashboard: AI cost rows and data stored, per gym.
// Plans, sessions and AI usage are hidden from the super admin's browser by the access rules,
// so this reads them with the server key and returns only per-gym figures.

// Rough average size of one row, in bytes (data + index), for the storage estimate
const ROW_BYTES = { profiles: 2000, memberships: 400, weekly_plans: 6000, logged_sessions: 600 }

export async function GET() {
  const { error: callerError } = await getCaller(['super_admin'])
  if (callerError) return callerError

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  // AI calls since the start of last month (enough for "this month" and "last month")
  const now = new Date()
  const since = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString()
  const { data: ai, error: aiError } = await admin
    .from('ai_usage')
    .select('*') // includes client_id once that column exists
    .gte('created_at', since)
    .limit(50000)
  const aiReady = !aiError

  // Storage: rows per gym in the tables that hold a gym's data
  const pageAll = async <T,>(table: string, cols: string): Promise<T[]> => {
    const out: T[] = []
    for (let from = 0; ; from += 1000) {
      const { data, error } = await admin.from(table).select(cols).range(from, from + 999)
      if (error) throw new Error(`${table}: ${error.message}`)
      out.push(...((data || []) as T[]))
      if (!data || data.length < 1000) return out
    }
  }
  try {
    const [profiles, memberships, plans, sessions] = await Promise.all([
      pageAll<{ id: string; company_id: string | null }>('profiles', 'id, company_id'),
      pageAll<{ company_id: string | null }>('memberships', 'company_id'),
      pageAll<{ client_id: string }>('weekly_plans', 'client_id'),
      pageAll<{ client_id: string }>('logged_sessions', 'client_id'),
    ])
    const companyOf = new Map(profiles.map(p => [p.id, p.company_id]))
    const storage: Record<string, { rows: number; bytes: number }> = {}
    const add = (companyId: string | null | undefined, bytes: number) => {
      if (!companyId) return
      const s = (storage[companyId] ??= { rows: 0, bytes: 0 })
      s.rows += 1
      s.bytes += bytes
    }
    for (const p of profiles) add(p.company_id, ROW_BYTES.profiles)
    for (const m of memberships) add(m.company_id, ROW_BYTES.memberships)
    for (const p of plans) add(companyOf.get(p.client_id), ROW_BYTES.weekly_plans)
    for (const s of sessions) add(companyOf.get(s.client_id), ROW_BYTES.logged_sessions)

    return NextResponse.json({
      aiReady,
      ai: aiReady ? ai : [],
      storage,
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not read storage' }, { status: 500 })
  }
}

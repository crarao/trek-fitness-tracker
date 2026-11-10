// Is a client username free? Owner / partners (and super admin) only. Usernames are unique across all gyms.
// Body: { username, full_name? } → { problem } | { available, suggestions }
import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { getCaller, STAFF } from '@/lib/auth-server'
import { normalizeUsername, usernameProblem } from '@/lib/phone'
import { takenUsernames, freeSuggestions } from '@/lib/username-server'

export async function POST(request: Request) {
  const { error: callerError } = await getCaller(STAFF)
  if (callerError) return callerError
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  try {
    const body = await request.json().catch(() => ({}))
    const username = normalizeUsername(typeof body.username === 'string' ? body.username : '')
    const fullName = typeof body.full_name === 'string' ? body.full_name : ''
    const problem = username ? usernameProblem(username) : null
    if (problem) return NextResponse.json({ problem, suggestions: await freeSuggestions(admin, '', fullName) })
    const available = username ? !(await takenUsernames(admin, [username])).has(username) : false
    const suggestions = available ? [] : await freeSuggestions(admin, username, fullName)
    return NextResponse.json({ available, suggestions })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Check failed' }, { status: 500 })
  }
}

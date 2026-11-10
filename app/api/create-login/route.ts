// Give a client who was added without a login (lib/phone.ts isNoLogin: placeholder or generated child login) a
// username + password. Owner / partners of the client's gym (and super admin) only. Changes the existing Auth user's
// email and password (nothing is deleted) and copies the new login to profiles.email.
// Body: { userId, username, password }
import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { getCaller, STAFF, checkCanManageClient } from '@/lib/auth-server'
import { isNoLogin, normalizeUsername, usernameEmail, usernameProblem } from '@/lib/phone'
import { takenUsernames, freeSuggestions, isDuplicateLogin } from '@/lib/username-server'

export async function POST(request: Request) {
  const { caller, error: callerError } = await getCaller(STAFF)
  if (callerError) return callerError
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  try {
    const body = await request.json().catch(() => ({}))
    const userId = typeof body.userId === 'string' ? body.userId : ''
    const username = normalizeUsername(typeof body.username === 'string' ? body.username : '')
    const password = typeof body.password === 'string' ? body.password : ''
    if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })
    const notAllowed = await checkCanManageClient(caller, userId)
    if (notAllowed) return notAllowed

    const problem = usernameProblem(username)
    if (problem) return NextResponse.json({ error: problem }, { status: 400 })
    if (password.length < 6) return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 })

    // Only for clients with no login yet: a real login is changed with Reset password, never replaced here
    const { data: { user }, error: userError } = await admin.auth.admin.getUserById(userId)
    if (userError || !user) return NextResponse.json({ error: 'Client login not found' }, { status: 400 })
    if (!isNoLogin(user.email)) return NextResponse.json({ error: 'This client already has a login. Use Reset password.' }, { status: 400 })

    const { data: profile } = await admin.from('profiles').select('full_name').eq('id', userId).single()
    const taken = async () => NextResponse.json({
      error: `Username ${username} is taken`,
      suggestions: await freeSuggestions(admin, username, profile?.full_name || ''),
    }, { status: 409 })
    if ((await takenUsernames(admin, [username])).has(username)) return taken()

    const email = usernameEmail(username)
    const { error: authError } = await admin.auth.admin.updateUserById(userId, { email, password, email_confirm: true })
    if (authError) return isDuplicateLogin(authError.message) ? taken() : NextResponse.json({ error: authError.message }, { status: 400 })

    const { error: profileError } = await admin.from('profiles').update({ email }).eq('id', userId)
    if (profileError) return NextResponse.json({ error: 'Login created, but the profile was not updated: ' + profileError.message }, { status: 400 })

    return NextResponse.json({ success: true, username })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Create login failed' }, { status: 500 })
  }
}

// Server only: which usernames are already taken (in any gym). Usernames are unique across all of CoachBoard
// (lib/phone.ts USERNAME_DOMAIN). profiles.email holds the login email, so one query answers for many candidates;
// Supabase Auth's unique email is the final guarantee if two coaches pick the same name at the same moment.
import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizeUsername, usernameEmail, usernameProblem, suggestUsernames, numberedUsernames } from './phone'

export async function takenUsernames(admin: SupabaseClient, usernames: string[]): Promise<Set<string>> {
  const list = [...new Set(usernames.map(normalizeUsername))].filter(u => !usernameProblem(u))
  if (!list.length) return new Set()
  const { data, error } = await admin.from('profiles').select('email').in('email', list.map(usernameEmail))
  if (error) throw new Error(error.message)
  return new Set((data || []).map(r => (r.email as string).toLowerCase().split('@')[0]))
}

// Free usernames to offer: ideas from the name, then numbered versions of what was typed (up to `count`)
export async function freeSuggestions(admin: SupabaseClient, typed: string, fullName: string, count = 3): Promise<string[]> {
  const ideas = [...new Set([...suggestUsernames(fullName), ...(typed && !usernameProblem(typed) ? numberedUsernames(typed) : []), ...suggestUsernames(fullName).flatMap(x => numberedUsernames(x, 3))])]
    .filter(x => x !== normalizeUsername(typed))
  const taken = await takenUsernames(admin, ideas)
  return ideas.filter(x => !taken.has(x)).slice(0, count)
}

// Supabase Auth's message when the email (= username) already exists
export const isDuplicateLogin = (message: string) => /already (been )?registered|already exists|duplicate/i.test(message)

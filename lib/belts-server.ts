// Server checks for a student's belt (create-user, update-client; belt grading Phase 1, lib/belts.ts).
// Uses the admin client the route already made (secret key, so RLS doesn't apply here: this is the check).

import { type SupabaseClient } from '@supabase/supabase-js'

// The belt must be one of this gym's; a turned-off belt can be kept when it's the saved one, not newly picked
export async function checkBelt(
  admin: SupabaseClient,
  companyId: string | null | undefined,
  rankId: string,
  currentRankId?: string | null,
): Promise<{ ok: true } | { error: string }> {
  if (!companyId) return { error: 'Unknown gym' }
  const { data: rank } = await admin.from('belt_ranks').select('id, company_id, is_active').eq('id', rankId).maybeSingle()
  if (!rank || rank.company_id !== companyId) return { error: 'That belt is not in this dojo' }
  if (!rank.is_active && rankId !== currentRankId) return { error: 'That belt is turned off' }
  return { ok: true }
}

// One history row (student_grades). Returns an error message, or null when saved.
export async function addGradeHistory(
  admin: SupabaseClient,
  row: {
    company_id: string
    student_id: string
    rank_id: string
    achieved_on: string | null
    source: 'joined' | 'backfill' | 'manual'
    created_by: string
  },
): Promise<string | null> {
  const { error } = await admin.from('student_grades').insert(row)
  return error ? error.message : null
}

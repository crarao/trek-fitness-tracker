// Server check for a client's branch and home batch (create-user, update-client; Dojo Build 2, #77).
// Uses the admin client the route already made (secret key, so RLS doesn't apply here: this is the check).
// Both must belong to the client's gym and not be archived (a saved archived value can be kept, but not newly picked);
// the batch must be at the branch. A batch alone sets its branch.

import { type SupabaseClient } from '@supabase/supabase-js'

export async function checkPlacement(
  admin: SupabaseClient,
  companyId: string | null | undefined,
  branchId: string | null,
  batchId: string | null,
  current?: { branch_id?: string | null; batch_id?: string | null },
): Promise<{ branch_id: string | null; batch_id: string | null } | { error: string }> {
  if (!companyId) return { error: 'Unknown gym' }
  let branch = branchId
  if (batchId) {
    const { data: batch } = await admin.from('batches').select('id, company_id, branch_id, is_archived').eq('id', batchId).maybeSingle()
    if (!batch || batch.company_id !== companyId) return { error: 'That batch is not in this gym' }
    if (batch.is_archived && current?.batch_id !== batchId) return { error: 'That batch is archived' }
    if (branch && branch !== batch.branch_id) return { error: 'That batch is at another branch' }
    branch = batch.branch_id
  }
  if (branch) {
    const { data: br } = await admin.from('branches').select('id, company_id, is_archived').eq('id', branch).maybeSingle()
    if (!br || br.company_id !== companyId) return { error: 'That branch is not in this gym' }
    if (br.is_archived && current?.branch_id !== branch) return { error: 'That branch is archived' }
  }
  return { branch_id: branch, batch_id: batchId }
}

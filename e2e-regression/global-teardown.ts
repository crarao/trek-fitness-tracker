// After the run, whatever happened: archive (never delete) every record the suite left active.
// Only rows whose name starts with "E2E " are touched; the seeded QA data never is.
import { checkTarget } from './target'
import { rest } from './fixtures'
import type { Role } from './session'

const OWNERS: Role[] = ['gymOwner', 'soloOwner', 'dojoOwner']

export default async function globalTeardown() {
  checkTarget()
  const now = new Date().toISOString()
  for (const role of OWNERS) {
    let r
    try { r = rest(role) } catch { continue } // that role never logged in
    const members = await r.patch('profiles?role=eq.client&full_name=like.E2E%20*&archived_at=is.null', { archived_at: now })
    const leads = await r.patch('leads?name=like.E2E%20*&status=in.(new,trial)', { status: 'lost', lost_reason: 'E2E test' })
    const batches = await r.patch('batches?name=like.E2E%20*&is_archived=eq.false', { is_archived: true })
    const n = members.rows.length + leads.rows.length + batches.rows.length
    if (n) console.log(`Teardown (${role}): archived ${members.rows.length} member(s), closed ${leads.rows.length} lead(s), archived ${batches.rows.length} batch(es)`)
  }
}

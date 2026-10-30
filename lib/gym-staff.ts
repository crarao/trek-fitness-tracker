// The gym's staff (owner, partners, coaches): id, name, role, login off — for "by Coach X", "Primary: Ravi"
// and the primary-coach dropdown. Browser only.
//
// Reads through the database function gym_staff() (RLS hardening, 30 Oct): coaches may no longer read owner /
// partner profile rows (phone, email), only these four fields. Until that function exists the old direct read
// is used, so this works before and after the SQL runs.
import { supabase } from './supabase'

export type GymStaff = { id: string; full_name: string; role: string; archived_at: string | null }

export async function loadGymStaff(companyId?: string | null): Promise<GymStaff[]> {
  const { data, error } = await supabase.rpc('gym_staff')
  if (!error) {
    return ((data || []) as GymStaff[]).sort((a, b) => (a.full_name || '').localeCompare(b.full_name || ''))
  }
  // Function not there yet (SQL not run): the read that worked before
  let q = supabase.from('profiles')
    .select('id, full_name, role, archived_at')
    .in('role', ['company_admin', 'partner', 'coach'])
  if (companyId) q = q.eq('company_id', companyId)
  const { data: rows, error: readError } = await q.order('full_name')
  if (readError) console.error('Staff load error:', readError)
  return (rows || []) as GymStaff[]
}

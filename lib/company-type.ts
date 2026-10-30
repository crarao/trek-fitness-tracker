// Company type (set by super admin): 'gym' or 'coach' (an individual / personal coach).
// A 'coach' company is one person: no coach logins, no partner logins, no coach assignment.
// Separate from in-gym vs online coaching mode (not built here).
// Use these helpers everywhere; don't compare company_type strings in pages or routes.
// Safe in the browser and on the server (no imports).

export type CompanyType = 'gym' | 'coach'

export const COMPANY_TYPES: { value: CompanyType; label: string }[] = [
  { value: 'gym', label: 'Gym' },
  { value: 'coach', label: 'Individual coach' },
]

// Missing / unknown values count as 'gym' (the column default), so nothing changes before the SQL runs
export function companyType(company: { company_type?: string | null } | null | undefined): CompanyType {
  return company?.company_type === 'coach' ? 'coach' : 'gym'
}

export function isCoachCompany(company: { company_type?: string | null } | null | undefined): boolean {
  return companyType(company) === 'coach'
}

export function isGym(company: { company_type?: string | null } | null | undefined): boolean {
  return companyType(company) === 'gym'
}

export function companyTypeLabel(company: { company_type?: string | null } | null | undefined): string {
  return isCoachCompany(company) ? 'Individual coach' : 'Gym'
}

// Shown by the APIs that refuse coach / partner logins for an individual coach's company
export const COACH_COMPANY_NO_STAFF = 'This is an individual coach account: it has no coach or partner logins. Super admin can change the company type to Gym.'

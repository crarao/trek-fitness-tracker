// Per-gym client app switches (19 Nov, client view build Part B). Set by Super Admin only, in the company edit
// screen's "Client app setup" card, during the setup consultation with the gym. Stored in
// companies.client_settings (jsonb, db/2026-11-19-client-view.md Step 1); a key that isn't stored takes the
// default for the company type below. The database applies the same table in public.client_setting(key)
// (RLS), so a switch that is off is refused there too, not only hidden here: keep the two in step.
//
// Before the SQL has run (no client_settings column on the company row) everything works as it did before
// Part B (LEGACY), so shipping the app first locks nobody out.

import { isCoachCompany } from './company-type'

export type ClientSettingKey =
  | 'client_login'
  | 'client_can_log_sessions'
  | 'client_can_log_activities'
  | 'client_sees_plan'
  | 'client_sees_detailed_progress'
  | 'client_can_edit_profile'
  | 'self_training_enabled'

export type ClientSettings = Record<ClientSettingKey, boolean>

export const GYM_DEFAULTS: ClientSettings = {
  client_login: false,
  client_can_log_sessions: false,
  client_can_log_activities: true,
  client_sees_plan: true,
  client_sees_detailed_progress: true,
  client_can_edit_profile: true,
  self_training_enabled: false,
}

export const COACH_DEFAULTS: ClientSettings = { ...GYM_DEFAULTS, client_can_log_sessions: true }

// The app before Part B: clients could do everything (self-training didn't exist)
export const LEGACY: ClientSettings = {
  client_login: true,
  client_can_log_sessions: true,
  client_can_log_activities: true,
  client_sees_plan: true,
  client_sees_detailed_progress: false, // the client app showed no weights before Part B
  client_can_edit_profile: true,
  self_training_enabled: false,
}

// The card's rows, in order, each with one plain-English line
export const CLIENT_SETTING_ROWS: { key: ClientSettingKey; label: string; help: string }[] = [
  { key: 'client_login', label: 'Client app', help: 'Clients can log in to the app. Off means they see "Your gym hasn\'t turned on the client app yet."' },
  { key: 'client_can_log_sessions', label: 'Log own sessions', help: 'Clients can mark their plan days done themselves. Off means only coaches log workouts.' },
  { key: 'client_can_log_activities', label: 'Log other activities', help: 'Clients can add a run, a sport or a class from the Log tab.' },
  { key: 'client_sees_plan', label: 'See their plan', help: 'Clients see the plan their coach made, day by day (read-only).' },
  { key: 'client_sees_detailed_progress', label: 'See strength progress', help: 'Clients see weights and sets per exercise. Off means only the weekly activity charts.' },
  { key: 'client_can_edit_profile', label: 'Edit their profile', help: 'Clients can change their age, weight, goal and other fitness details.' },
]
// self_training_enabled joins the card with Part C (self-training members); until then it stays off

type CompanyLike = { company_type?: string | null; client_settings?: unknown } | null | undefined

// The stored values over the defaults for the company type. Only booleans are taken from storage.
export function getClientSettings(company: CompanyLike): ClientSettings {
  if (!company || !('client_settings' in company)) return { ...LEGACY }
  const base = isCoachCompany(company) ? COACH_DEFAULTS : GYM_DEFAULTS
  const stored = company.client_settings && typeof company.client_settings === 'object'
    ? company.client_settings as Record<string, unknown> : {}
  const out = { ...base }
  for (const k of Object.keys(base) as ClientSettingKey[]) {
    if (typeof stored[k] === 'boolean') out[k] = stored[k] as boolean
  }
  return out
}

// What Super Admin saves: every switch, so the gym keeps exactly what was agreed even if defaults change later
export const clientSettingsToStore = (s: ClientSettings): ClientSettings => ({ ...s })

export const CLIENT_APP_OFF_MESSAGE = "Your gym hasn't turned on the client app yet."

// Is this client a self-training member? (Part C: not PT, and the gym has self-training on)
export const isSelfTraining = (clientType: string | null | undefined, s: ClientSettings) =>
  s.self_training_enabled && (clientType ?? 'member') !== 'pt'

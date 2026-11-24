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
  { key: 'self_training_enabled', label: 'Self-training members', help: 'Members ticked as Self-training build their own weekly plan, log weights per set and see their progress, whatever the PT switches say. The gym sends the monthly report.' },
]

// The card's groups: who each switch is for (the self-training switch overrides the PT ones for those members)
export const CLIENT_SETTING_GROUPS: { title: string; help: string; keys: ClientSettingKey[] }[] = [
  { title: 'Everyone', help: 'Off = no client can log in, PT or self-training.', keys: ['client_login'] },
  { title: 'PT clients', help: 'What PT clients can do. Typical: see plan and progress, coach logs the workouts.',
    keys: ['client_can_log_sessions', 'client_can_log_activities', 'client_sees_plan', 'client_sees_detailed_progress', 'client_can_edit_profile'] },
  { title: 'Self-training members', help: 'Members ticked as Self-training always plan, log and see their progress.', keys: ['self_training_enabled'] },
]

// Why self-training won't work yet for this gym, or '' when it will
export function selfTrainingProblem(s: ClientSettings, trainModule: boolean): string {
  if (!s.self_training_enabled) return ''
  const off = [!s.client_login && 'Client app', !trainModule && 'Client Training Module'].filter(Boolean)
  return off.length ? `Self-training is on, but ${off.join(' and ')} ${off.length === 1 ? 'is' : 'are'} off: members can't use it yet.` : ''
}

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

// Is this client a self-training member? (Part C: not PT, and the gym has self-training on.) Since 24 Nov a
// member is self-training only when ticked as one (profiles.self_training,
// supabase/migrations/20261124120000_self_training_flag.sql); before that column exists every non-PT member
// of the gym counts, as on 19 Nov. The database applies the same rule in public.is_self_training_client().
export type TrainingPerson = { client_type?: string | null; self_training?: boolean | null } | null | undefined
export const isSelfTraining = (person: TrainingPerson, s: ClientSettings) =>
  !!person && s.self_training_enabled && (person.client_type ?? 'member') !== 'pt'
  && (!('self_training' in person) || person.self_training === true)

// The three kinds of client in a gym with self-training on (Add / Edit member, badges)
export type TrainingType = 'pt' | 'self' | 'member'
export const trainingTypeOf = (person: TrainingPerson): TrainingType =>
  person?.client_type === 'pt' ? 'pt' : person?.self_training === true ? 'self' : 'member'
export const TRAINING_TYPES: { value: TrainingType; label: string; help: string }[] = [
  { value: 'pt', label: 'PT', help: 'Coach makes the plan and logs workouts.' },
  { value: 'self', label: 'Self-training', help: 'Plans and logs their own workouts in the app.' },
  { value: 'member', label: 'Membership only', help: 'Membership and payments only, no training in the app.' },
]
// What a training type saves: client_type + self_training (self_training only once the column exists)
export const trainingFields = (t: TrainingType, withColumn: boolean) => ({
  client_type: t === 'pt' ? 'pt' : 'member',
  ...(withColumn ? { self_training: t === 'self' } : {}),
})

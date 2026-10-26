// Server only: records one row per AI call in public.ai_usage (gym, feature, tokens, cost),
// read by the super admin Dashboard. Never throws: a failed record must not break the AI feature.
import { createClient } from '@supabase/supabase-js'
import { aiCostUsd } from './ai-pricing'

export type AiFeature = 'plan' | 'diet' | 'insights'

export async function recordAiUsage(opts: {
  companyId: string | null | undefined
  userId: string | null | undefined
  feature: AiFeature
  model: string
  usage: { input_tokens?: number | null; output_tokens?: number | null } | null | undefined
}) {
  try {
    const input = opts.usage?.input_tokens ?? 0
    const output = opts.usage?.output_tokens ?? 0
    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SECRET_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )
    const { error } = await admin.from('ai_usage').insert({
      company_id: opts.companyId || null,
      user_id: opts.userId || null,
      feature: opts.feature,
      model: opts.model,
      input_tokens: input,
      output_tokens: output,
      cost_usd: aiCostUsd(opts.model, input, output),
    })
    // Before the ai_usage table exists this fails quietly; the AI feature itself is unaffected
    if (error) console.warn('AI usage not recorded:', error.message)
  } catch (e) {
    console.warn('AI usage not recorded:', e)
  }
}

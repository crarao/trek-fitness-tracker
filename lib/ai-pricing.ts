// AI prices and the ₹ rate used for the super admin's cost figures. Change them here.
// Claude Haiku 4.5: $1 per million input tokens, $5 per million output tokens (checked 25 Oct 2026).
export const AI_PRICES_USD_PER_MILLION: Record<string, { input: number; output: number }> = {
  'claude-haiku-4-5-20251001': { input: 1, output: 5 },
}
const FALLBACK = { input: 1, output: 5 }

// Fixed conversion for display only (not a live rate)
export const USD_TO_INR = 88

export const AI_FEATURES: Record<string, string> = {
  plan: 'AI plans',
  diet: 'Diet charts',
  insights: 'Client insights',
}

// Flag a gym when its AI cost this month passes this (₹); there is no price per gym in the app yet
export const AI_COST_ALERT_INR = 500

// #37: AI plan generations allowed per client per calendar month (hand-written plans and edits are unlimited).
// Counted from ai_usage rows with feature 'plan'. Could become per gym later.
export const AI_PLANS_PER_CLIENT_PER_MONTH = 5

export function aiCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const p = AI_PRICES_USD_PER_MILLION[model] ?? FALLBACK
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000
}

// "₹38" (or "₹0.42" under ₹10)
export function inr(usd: number): string {
  const v = usd * USD_TO_INR
  return '₹' + (v < 10 ? v.toFixed(2) : Math.round(v).toLocaleString('en-IN'))
}

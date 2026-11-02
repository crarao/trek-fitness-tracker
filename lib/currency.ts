// Money display. Every amount is shown in its own currency: a membership row keeps the currency it was paid in
// (memberships.currency, db/2026-11-01-multi-country.md). Supported: INR, AED, USD, CAD.

export type Currency = 'INR' | 'AED' | 'USD' | 'CAD'

export const CURRENCIES: { code: Currency; label: string }[] = [
  { code: 'INR', label: 'Indian rupee (₹)' },
  { code: 'AED', label: 'UAE dirham (AED)' },
  { code: 'USD', label: 'US dollar ($)' },
  { code: 'CAD', label: 'Canadian dollar (CA$)' },
]

const SYMBOL: Record<Currency, string> = { INR: '₹', AED: 'AED ', USD: '$', CAD: 'CA$' }
const LOCALE: Record<Currency, string> = { INR: 'en-IN', AED: 'en-AE', USD: 'en-US', CAD: 'en-CA' }

// Unknown or empty → INR (the original default)
export function normalizeCurrency(value: string | null | undefined): Currency {
  return value === 'AED' || value === 'USD' || value === 'CAD' ? value : 'INR'
}

export function currencySymbol(currency: string | null) {
  if (currency === null) return ''
  return SYMBOL[normalizeCurrency(currency)].trim()
}

const group = (amount: number, code: Currency) =>
  new Intl.NumberFormat(LOCALE[code], { maximumFractionDigits: 0, minimumFractionDigits: 0 }).format(amount)

// null = company not loaded yet → neutral placeholder, no INR default
// ₹48,000 · AED 3,200 · $1,200 · CA$1,500
export function formatMoney(amount: number, currency: string | null) {
  if (currency === null) return '—'
  const code = normalizeCurrency(currency)
  const sign = amount < 0 ? '-' : ''
  return `${sign}${SYMBOL[code]}${group(Math.abs(amount), code)}`
}

// Short form for stat cards: INR uses L (lakh) / K, the others M / K
export function formatMoneyCompact(amount: number, currency: string | null) {
  if (currency === null) return '—'
  const code = normalizeCurrency(currency)
  const symbol = SYMBOL[code]
  if (code === 'INR') {
    if (amount >= 100000) return `${symbol}${(amount / 100000).toFixed(1)}L`
    if (amount >= 1000) return `${symbol}${(amount / 1000).toFixed(1)}K`
  } else {
    if (amount >= 1000000) return `${symbol}${(amount / 1000000).toFixed(1)}M`
    if (amount >= 1000) return `${symbol}${(amount / 1000).toFixed(1)}K`
  }
  return formatMoney(amount, currency)
}

// Totals per currency, only currencies with an amount, the base currency first, then the CURRENCIES order.
// Rows without a currency count as the base currency (rows saved before the multi-country SQL).
export function groupByCurrency<T>(
  rows: T[],
  amountOf: (row: T) => number,
  currencyOf: (row: T) => string | null | undefined,
  base: string | null,
): { currency: Currency; amount: number }[] {
  const baseCode = normalizeCurrency(base)
  const totals = new Map<Currency, number>()
  for (const row of rows) {
    const amount = Number(amountOf(row)) || 0
    if (!amount) continue
    const code = normalizeCurrency(currencyOf(row) || baseCode)
    totals.set(code, (totals.get(code) || 0) + amount)
  }
  const order = [baseCode, ...CURRENCIES.map(c => c.code).filter(c => c !== baseCode)]
  return order.filter(c => totals.has(c)).map(c => ({ currency: c, amount: totals.get(c)! }))
}

// "₹48,000 · AED 3,200". No amounts → zero in the base currency.
export function formatMoneyByCurrency(
  groups: { currency: string; amount: number }[],
  base: string | null,
  compact = false,
): string {
  if (base === null) return '—'
  const fmt = compact ? formatMoneyCompact : formatMoney
  if (!groups.length) return fmt(0, base)
  return groups.map(g => fmt(g.amount, g.currency)).join(' · ')
}

export function currencySymbol(currency: string | null) {
  if (currency === null) return ''
  return currency === 'USD' ? '$' : '₹'
}

// null = company not loaded yet → neutral placeholder, no INR default
export function formatMoney(amount: number, currency: string | null) {
  if (currency === null) return '—'
  const code = currency === 'USD' ? 'USD' : 'INR'
  return new Intl.NumberFormat(code === 'USD' ? 'en-US' : 'en-IN', {
    style: 'currency',
    currency: code,
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  }).format(amount)
}

// Short form for stat cards: INR uses L (lakh) / K, USD uses M / K
export function formatMoneyCompact(amount: number, currency: string | null) {
  if (currency === null) return '—'
  const symbol = currencySymbol(currency)
  if (currency === 'USD') {
    if (amount >= 1000000) return `${symbol}${(amount / 1000000).toFixed(1)}M`
    if (amount >= 1000) return `${symbol}${(amount / 1000).toFixed(1)}K`
  } else {
    if (amount >= 100000) return `${symbol}${(amount / 100000).toFixed(1)}L`
    if (amount >= 1000) return `${symbol}${(amount / 1000).toFixed(1)}K`
  }
  return formatMoney(amount, currency)
}

'use client'

// Country-code picker shown in front of a phone input (login, Add member, staff logins).
// The one shared component in /app: country table and rules live in lib/phone.ts.
// Default +91. US and Canada share +1, so both are listed by name.

import { type PhoneCountry, PHONE_COUNTRIES, PHONE_COUNTRY_CODES } from '@/lib/phone'

export default function CountryCodePicker({
  value = 'IN',
  onChange,
  className = '',
  ariaLabel = 'Country code',
}: {
  value?: PhoneCountry
  onChange: (country: PhoneCountry) => void
  className?: string
  ariaLabel?: string
}) {
  return (
    <select
      aria-label={ariaLabel}
      value={value}
      onChange={e => onChange(e.target.value as PhoneCountry)}
      className={`shrink-0 bg-gray-800 text-white rounded-lg px-2 outline-none focus:ring-2 focus:ring-white border border-gray-700 text-sm ${className}`}>
      {PHONE_COUNTRY_CODES.map(code => (
        <option key={code} value={code}>
          {PHONE_COUNTRIES[code].flag} +{PHONE_COUNTRIES[code].dial}{code === 'US' || code === 'CA' ? ` ${code}` : ''}
        </option>
      ))}
    </select>
  )
}

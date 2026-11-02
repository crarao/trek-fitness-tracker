// Prints the phone / login-identifier rules (lib/phone.ts) and per-currency totals (lib/currency.ts)
// for sample inputs, to read the results. Also checks no page builds a phone login inline.
// No test framework needed (uses the TypeScript compiler already in devDependencies):
//   npx tsc scripts/check-phone.ts --outDir /tmp/cp --module commonjs --target es2020 --skipLibCheck && node /tmp/cp/scripts/check-phone.js

import * as fs from 'fs'
import * as path from 'path'
import { loginEmailFor, validLocalDigits, toE164, splitE164, waDigits, displayPhone, clientPhoneValue, staffLogin, type PhoneCountry } from '../lib/phone'
import { groupByCurrency, formatMoneyByCurrency, formatMoney, formatMoneyCompact } from '../lib/currency'
import { loginMethod } from '../lib/locale'

let failures = 0
const check = (label: string, got: unknown, expect: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(expect)
  if (!ok) failures++
  console.log(`   ${ok ? 'ok  ' : 'FAIL'} ${label.padEnd(46)} → ${JSON.stringify(got)}${ok ? '' : `   (expected ${JSON.stringify(expect)})`}`)
}

console.log('1. Login identifier (loginEmailFor)')
check('IN 9876543210 (unchanged)', loginEmailFor('IN', '9876543210'), '9876543210@getcoachboard.in')
check('AE 501234567', loginEmailFor('AE', '501234567'), '971501234567@getcoachboard.in')
check('US 5551234567', loginEmailFor('US', '5551234567'), '15551234567@getcoachboard.in')
check('CA 4165551234', loginEmailFor('CA', '4165551234'), '14165551234@getcoachboard.in')

console.log('\n2. Digit check (validLocalDigits)')
const digits: [PhoneCountry, string, string | null][] = [
  ['IN', '98765 43210', '9876543210'],
  ['IN', '+91 98765 43210', '9876543210'],
  ['IN', '09876543210', '9876543210'],
  ['IN', '987654321', null],
  ['AE', '050 123 4567', '501234567'],
  ['AE', '+971 50 123 4567', '501234567'],
  ['AE', '5012345678', null],
  ['US', '(555) 123-4567', '5551234567'],
  ['US', '+1 555 123 4567', '5551234567'],
  ['CA', '416-555-1234', '4165551234'],
]
for (const [c, raw, expect] of digits) check(`${c} ${JSON.stringify(raw)}`, validLocalDigits(c, raw), expect)

console.log('\n3. Stored format (toE164 / splitE164)')
check('toE164 IN', toE164('IN', '9876543210'), '+919876543210')
check('toE164 AE', toE164('AE', '501234567'), '+971501234567')
check('split +919876543210 (home IN)', splitE164('+919876543210', 'IN'), { country: 'IN', local: '9876543210' })
check('split +971501234567 (home IN)', splitE164('+971501234567', 'IN'), { country: 'AE', local: '501234567' })
check('split +15551234567 (home US)', splitE164('+15551234567', 'US'), { country: 'US', local: '5551234567' })
check('split +14165551234 (home CA)', splitE164('+14165551234', 'CA'), { country: 'CA', local: '4165551234' })
check('split old 9876543210 (home IN)', splitE164('9876543210', 'IN'), { country: 'IN', local: '9876543210' })
check('split old 5551234567 (home US)', splitE164('5551234567', 'US'), { country: 'US', local: '5551234567' })
check('split "call reception"', splitE164('call reception', 'IN'), null)
check('client phone IN gym', clientPhoneValue('IN', '98765 43210'), '+919876543210')
check('client phone, odd value kept as typed', clientPhoneValue('US', ' 555-0100 ext 2 '), '555-0100 ext 2')

console.log('\n4. WhatsApp digits (waDigits: India / US only) — dashboard Remind / Follow Up')
check('+919876543210 (after the backfill)', waDigits('+919876543210', 'IN'), '919876543210')
check('9876543210 (before the backfill)', waDigits('9876543210', 'IN'), '919876543210')
check('+15551234567 US gym', waDigits('+15551234567', 'US'), '15551234567')
check('5551234567 US gym, old', waDigits('5551234567', 'US'), '15551234567')
check('+971501234567 (not set up: null)', waDigits('+971501234567', 'AE'), null)

console.log('\n5. Shown phone (displayPhone)')
check('IN gym, Indian number', displayPhone('+919876543210', 'IN'), '9876543210')
check('IN gym, UAE number', displayPhone('+971501234567', 'IN'), '+971 501234567')
check('AE gym, Indian number', displayPhone('+919876543210', 'AE'), '+91 9876543210')

console.log('\n6. Who logs in how')
check('client login IN', loginMethod('IN'), 'phone')
check('client login AE / US / CA', [loginMethod('AE'), loginMethod('US'), loginMethod('CA')], ['email', 'email', 'email'])
check('staff, IN gym, phone', staffLogin('IN', { phoneCountry: 'IN', phone: '9876543210' }),
  { email: '9876543210@getcoachboard.in', password: '9876543210', phone: '9876543210', method: 'phone' })
check('staff, AE gym, no email → phone login', staffLogin('AE', { phoneCountry: 'AE', phone: '50 123 4567' }),
  { email: '971501234567@getcoachboard.in', password: '501234567', phone: '+971501234567', method: 'phone' })
check('staff, US gym, email', staffLogin('US', { phoneCountry: 'US', phone: '', email: 'Sam@Gym.com', password: 'secret1' }),
  { email: 'sam@gym.com', password: 'secret1', phone: null, method: 'email' })
check('staff, IN gym, bad phone', 'error' in staffLogin('IN', { phoneCountry: 'IN', phone: '12345' }), true)

console.log('\n7. Money per currency (D3)')
type Row = { amount_paid: number; currency?: string | null }
const rows: Row[] = [
  { amount_paid: 30000, currency: 'INR' }, { amount_paid: 18000, currency: null },
  { amount_paid: 3200, currency: 'AED' }, { amount_paid: 0, currency: 'USD' },
]
const groups = groupByCurrency(rows, r => r.amount_paid, r => r.currency, 'INR')
check('groups (null = base, zero left out)', groups, [{ currency: 'INR', amount: 48000 }, { currency: 'AED', amount: 3200 }])
check('grouped line', formatMoneyByCurrency(groups, 'INR'), '₹48,000 · AED 3,200')
check('AED base first (no-currency row = AED)', formatMoneyByCurrency(groupByCurrency(rows, r => r.amount_paid, r => r.currency, 'AED'), 'AED'), 'AED 21,200 · ₹30,000')
check('single currency stays one figure', groupByCurrency([rows[0]], r => r.amount_paid, r => r.currency, 'INR').length, 1)
check('nothing → zero in base', formatMoneyByCurrency([], 'USD'), '$0')
check('formats', [formatMoney(150000, 'INR'), formatMoney(1200, 'USD'), formatMoney(1500, 'CAD'), formatMoneyCompact(150000, 'INR'), formatMoneyCompact(3200, 'AED')],
  ['₹1,50,000', '$1,200', 'CA$1,500', '₹1.5L', 'AED 3.2K'])

console.log('\n8. No inline phone-login emails outside lib/phone.ts')
const root = path.resolve(__dirname, '..', '..', '..', 'app')
const appDir = fs.existsSync(root) ? root : path.resolve(process.cwd(), 'app')
const offenders: string[] = []
const walk = (dir: string) => {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name)
    if (fs.statSync(full).isDirectory()) walk(full)
    else if (/\.(ts|tsx)$/.test(name)) {
      fs.readFileSync(full, 'utf8').split('\n').forEach((line, i) => {
        if (line.includes('@getcoachboard.in') && !line.trim().startsWith('//')) offenders.push(`${path.relative(appDir, full)}:${i + 1}`)
      })
    }
  }
}
walk(appDir)
check('inline copies in app/', offenders, [])

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed')
if (failures) process.exitCode = 1

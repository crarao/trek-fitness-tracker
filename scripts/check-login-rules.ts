// Checks the server login rules (lib/login-rules.ts) used by create-user / create-login.
//   npx tsc scripts/check-login-rules.ts --outDir /tmp/clr --module commonjs --target es2020 --skipLibCheck && node /tmp/clr/scripts/check-login-rules.js

import { normalizeEmail, isOwnDomain, clientEmailProblem, passwordProblem, clientEmailAllowed, authErrorMessage } from '../lib/login-rules'
import { usernameProblem } from '../lib/phone'

let failures = 0
const check = (label: string, got: unknown, expect: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(expect)
  if (!ok) failures++
  console.log(`   ${ok ? 'ok  ' : 'FAIL'} ${label.padEnd(48)} → ${JSON.stringify(got)}${ok ? '' : `   (expected ${JSON.stringify(expect)})`}`)
}

console.log('1. normalizeEmail')
check('trim + lowercase', normalizeEmail('  Priya.K@Gmail.COM '), 'priya.k@gmail.com')
check('not a string', normalizeEmail(42), '')

console.log('2. Own domains refused (getcoachboard.in + every subdomain)')
for (const e of ['x@user.getcoachboard.in', '9876543210@getcoachboard.in', 'x@nologin.getcoachboard.in', 'a@b.c.getcoachboard.in', 'x@GETCOACHBOARD.IN'])
  check(`${e} is ours`, isOwnDomain(normalizeEmail(e)) && clientEmailProblem(normalizeEmail(e)) !== null, true)
for (const e of ['x@getcoachboard.com', 'x@notgetcoachboard.in', 'x@getcoachboard.in.evil.com', 'x@gmail.com'])
  check(`${e} is not ours`, isOwnDomain(e), false)

console.log('3. Email format')
check('good email', clientEmailProblem('priya@gmail.com'), null)
for (const bad of ['', 'priya', 'priya@', '@gmail.com', 'priya@gmail', 'pri ya@gmail.com', 'a@b@c.com'])
  check(`${JSON.stringify(bad)} refused`, clientEmailProblem(bad) !== null, true)

console.log('4. Password (≥ 6)')
check('5 chars refused', passwordProblem('12345') !== null, true)
check('6 chars ok', passwordProblem('123456'), null)
check('missing refused', passwordProblem(undefined) !== null, true)
check('number refused', passwordProblem(123456) !== null, true)

console.log('5. Email login allowed only outside India')
check('client IN', clientEmailAllowed('IN', 'AE'), false)
check('client AE in an IN gym', clientEmailAllowed('AE', 'IN'), true)
check('no client country, gym IN', clientEmailAllowed(undefined, 'IN'), false)
check('no client country, gym US', clientEmailAllowed('', 'US'), true)
check('nothing known = India', clientEmailAllowed(null, null), false)

console.log('6. Usernames sent straight to the API (same rule as the form)')
for (const bad of ['admin', 'ab', '9876543210', 'x@user.getcoachboard.in', 'bad name']) check(`${bad} refused`, usernameProblem(bad) !== null, true)

console.log('7. Supabase errors → plain messages')
check('duplicate', authErrorMessage('A user with this email address has already been registered'), 'That login is already used by someone else')
check('unknown', authErrorMessage('Database error saving new user'), "Couldn't create the login. Check the details and try again")

console.log(failures ? `\n${failures} FAILED` : '\nAll passed')
process.exit(failures ? 1 : 0)

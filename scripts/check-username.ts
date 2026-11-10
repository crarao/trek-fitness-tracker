// Checks the client username login rules (lib/phone.ts): validation, login email, login-page detection, suggestions,
// and that username logins never count as phone / no-login / shown emails.
//   npx tsc scripts/check-username.ts --outDir /tmp/cu --module commonjs --target es2020 --skipLibCheck && node /tmp/cu/scripts/check-username.js

import { usernameProblem, usernameEmail, usernameOf, isUsernameLogin, loginInputKind, suggestUsernames, numberedUsernames, isPhoneLogin, isNoLogin, shownEmail, normalizeUsername } from '../lib/phone'

let failures = 0
const check = (label: string, got: unknown, expect: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(expect)
  if (!ok) failures++
  console.log(`   ${ok ? 'ok  ' : 'FAIL'} ${label.padEnd(44)} → ${JSON.stringify(got)}${ok ? '' : `   (expected ${JSON.stringify(expect)})`}`)
}

console.log('1. Rules (usernameProblem: null = fine)')
for (const ok of ['anand.k', 'anand_k', 'anand-k', 'a12', 'priya2026', 'ANAND.K']) check(ok, usernameProblem(ok), null)
for (const bad of ['ab', 'a'.repeat(21), 'anand@x', 'anand k', '.anand', 'anand.', '9876543210', '123', 'admin', 'añand']) check(`${bad} is refused`, usernameProblem(bad) !== null, true)

console.log('2. Login email')
check('usernameEmail', usernameEmail(' Anand.K '), 'anand.k@user.getcoachboard.in')
check('usernameOf', usernameOf('anand.k@user.getcoachboard.in'), 'anand.k')
check('usernameOf a phone login', usernameOf('9876543210@getcoachboard.in'), null)
check('isUsernameLogin', isUsernameLogin('anand.k@user.getcoachboard.in'), true)
check('not a phone login (update-client never moves it)', isPhoneLogin('anand.k@user.getcoachboard.in'), false)
check('not a no-login', isNoLogin('anand.k@user.getcoachboard.in'), false)
check('not shown as an email', shownEmail('anand.k@user.getcoachboard.in'), '')
check('real email still shown', shownEmail('anand@gmail.com'), 'anand@gmail.com')
check('normalize', normalizeUsername('  Anand.K '), 'anand.k')

console.log('3. Login page: what was typed')
check('9876543210', loginInputKind('9876543210'), 'phone')
check('+91 98765 43210', loginInputKind('+91 98765 43210'), 'phone')
check('anand.k', loginInputKind('anand.k'), 'username')
check('priya2026', loginInputKind('priya2026'), 'username')
check('anand@gmail.com', loginInputKind('anand@gmail.com'), 'email')

console.log('4. Suggestions')
check('Anand Kumar Rao', suggestUsernames('Anand Kumar Rao'), ['anand.r', 'anand.rao', 'anandr', 'anandrao', 'anand'])
check('Priya', suggestUsernames('Priya'), ['priya', 'priya.fit'])
check('Al (too short alone)', suggestUsernames('Al'), ['al.fit'])
check('empty', suggestUsernames(''), [])
check('numbered', numberedUsernames('anand.k', 3), ['anand.k2', 'anand.k3', 'anand.k4'])
check('every suggestion is valid', [...suggestUsernames('Sai Krishna Reddy'), ...numberedUsernames('sai.r')].every(x => usernameProblem(x) === null), true)

if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1) }
console.log('\nAll checks passed')

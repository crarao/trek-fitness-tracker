// Prints the dojo / parent rules (lib/guardian.ts, lib/labels.ts, generated child logins in lib/phone.ts)
// for sample inputs, to read the results. Fails (exit 1) if a rule gives the wrong answer.
// No test framework needed (uses the TypeScript compiler already in devDependencies):
//   npx tsc scripts/check-guardian.ts --outDir /tmp/cg --module commonjs --target es2020 --skipLibCheck && node /tmp/cg/scripts/check-guardian.js

import { reminderText, reminderRecipient, hasGuardian, feeReminder, upiProblem, cleanUpiId } from '../lib/guardian'
import { memberWord, isDojo, staffWord, ptWord } from '../lib/labels'
import { generatedStudentLogin, isGeneratedLogin, isPhoneLogin, isNoLogin } from '../lib/phone'

let failed = 0
const check = (label: string, value: unknown, ok: boolean) => {
  if (!ok) failed++
  console.log(`   ${ok ? 'ok  ' : 'FAIL'} ${label.padEnd(46)} → ${JSON.stringify(value)}`)
}

console.log('1. reminderText')
const base = { memberFirst: 'Aarav', parentFirst: 'Priya', companyName: 'Demo Dojo', endDate: '2026-11-10' }
for (const status of ['expiring', 'expired'] as const) {
  for (const toParent of [true, false]) {
    const t = reminderText({ ...base, status, toParent, businessType: 'martial_arts', country: 'IN' })
    console.log(`   ${status} · ${toParent ? 'to the parent' : 'no parent'} (martial arts, India):\n     ${t}`)
  }
}
const gymExpiring = reminderText({ ...base, memberFirst: 'Rohan', companyName: 'Iron Gym', status: 'expiring', toParent: false, businessType: 'gym', country: 'IN' })
const gymExpired = reminderText({ ...base, memberFirst: 'Rohan', companyName: 'Iron Gym', status: 'expired', toParent: false, businessType: 'gym', country: 'IN' })
console.log(`   gym · no parent (India):\n     ${gymExpiring}\n     ${gymExpired}`)
// Exactly the dashboard's wording before this change (app/company/page.tsx handleAction, 2 Nov)
check('gym expiring (India: Namaste)', gymExpiring, gymExpiring === 'Namaste Rohan 🙏\nYour membership at Iron Gym expires on 10 Nov. Renew now to keep going! 💪')
check('gym expired (India: Namaste)', gymExpired, gymExpired === "Namaste Rohan 🙏\nYour membership at Iron Gym has expired. We'd love to have you back — reach out to renew! 💪")
const dojoParent = reminderText({ ...base, status: 'expiring', toParent: true, businessType: 'martial_arts', country: 'IN' })
check('dojo parent expiring', dojoParent, dojoParent === "Namaste Priya 🙏\nAarav's fees at Demo Dojo are due on 10 Nov. Please renew to continue classes. 🥋")
check('martial_arts emoji 🥋', '', reminderText({ ...base, status: 'expired', toParent: false, businessType: 'martial_arts', country: 'IN' }).endsWith('🥋'))
check('gym emoji 💪', '', gymExpired.endsWith('💪'))
const us = reminderText({ ...base, memberFirst: 'Sam', parentFirst: 'Jordan', companyName: 'Peak Dojo', status: 'expiring', toParent: true, businessType: 'martial_arts', country: 'US' })
console.log(`   US date (parent):\n     ${us}`)
check('US date reads month first', us, us.includes('Nov 10'))
check('no parent name → "Namaste 🙏"', '', reminderText({ ...base, parentFirst: '', status: 'expired', toParent: true, country: 'IN' }).startsWith('Namaste 🙏\n'))
check('US keeps "Hi <name>,"', us, us.startsWith('Hi Jordan, '))

console.log('\n2. reminderRecipient')
const kid = { full_name: 'Aarav Reddy', phone: null }
const r1 = reminderRecipient({ ...kid, guardian_name: 'Priya Reddy', guardian_phone: '+919876543210', guardian_relation: 'Mother' }, 'IN')
check('parent phone set → parent', r1, r1.waDigits === '919876543210' && r1.toParent && r1.greetName === 'Priya')
const r2 = reminderRecipient({ full_name: 'Rohan Mehta', phone: '+919123456789' }, 'IN')
check('no parent → member (as today)', r2, r2.waDigits === '919123456789' && !r2.toParent && r2.greetName === 'Rohan')
const r3 = reminderRecipient({ full_name: 'Meera Iyer', phone: '9123456789', guardian_name: 'Ravi', guardian_phone: '12345' }, 'IN')
check('invalid parent phone → member', r3, r3.waDigits === '919123456789' && !r3.toParent && r3.greetName === 'Meera')
const r4 = reminderRecipient({ full_name: 'Sam Carter', phone: '+14155550134', guardian_phone: '+14155550199', guardian_name: 'Jordan Carter' }, 'US')
check('US parent', r4, r4.waDigits === '14155550199' && r4.toParent)
const r5 = reminderRecipient(kid, 'IN')
check('child, no parent, no phone → none', r5, r5.waDigits === null && !r5.toParent)
check('hasGuardian valid / invalid / none', [hasGuardian({ guardian_phone: '+919876543210' }), hasGuardian({ guardian_phone: '123' }), hasGuardian({})],
  hasGuardian({ guardian_phone: '+919876543210' }) && !hasGuardian({ guardian_phone: '123' }) && !hasGuardian({}))

console.log('\n3. generatedStudentLogin')
const samples = [generatedStudentLogin(), generatedStudentLogin(), generatedStudentLogin()]
for (const s of samples) check(`sample ${s}`, isGeneratedLogin(s), isGeneratedLogin(s) && /^student-[a-z0-9]{8}@getcoachboard\.in$/.test(s))
check('samples differ', '', new Set(samples).size === 3)
check('generated: not a phone login, counts as no login', [isPhoneLogin(samples[0]), isNoLogin(samples[0])], !isPhoneLogin(samples[0]) && isNoLogin(samples[0]))
for (const e of ['9876543210@getcoachboard.in', 'priya@gmail.com', 'client-abc@nologin.getcoachboard.in', 'student-ABCDEFGH@getcoachboard.in', null]) {
  check(`isGeneratedLogin(${e})`, isGeneratedLogin(e), isGeneratedLogin(e) === false)
}
check('phone login unchanged', isPhoneLogin('9876543210@getcoachboard.in'), isPhoneLogin('9876543210@getcoachboard.in'))

console.log('\n4. memberWord')
for (const [bt, one, many] of [['martial_arts', 'Student', 'Students'], ['gym', 'Member', 'Members'], [null, 'Member', 'Members']] as const) {
  const w = memberWord(bt)
  check(`memberWord(${bt}) isDojo=${isDojo(bt)}`, w, w.one === one && w.many === many && isDojo(bt) === (bt === 'martial_arts'))
}

console.log('\n5. staffWord / ptWord (Dojo Build 1.1)')
for (const [bt, one, many, pt] of [['martial_arts', 'Sensei', 'Senseis', 'students'], ['gym', 'Coach', 'Coaches', 'PT clients'], [null, 'Coach', 'Coaches', 'PT clients']] as const) {
  const w = staffWord(bt)
  check(`staffWord(${bt}) / ptWord`, [w, ptWord(bt)], w.one === one && w.many === many && ptWord(bt) === pt)
}

console.log('\n6. feeReminder (dojo "Send reminder", due within 7 days)')
const stu = { full_name: 'Aarav  Reddy', phone: '+919123456789', guardian_name: 'Priya Reddy', guardian_phone: '+919876543210' }
const feeBase = { student: stu, dueDate: '2026-11-15', daysLeft: 3, amount: 1500, currency: 'INR', dojoName: 'Demo Dojo', country: 'IN' as const }
const f1 = feeReminder(feeBase)
console.log(`   message (no UPI ID):\n${f1?.text}`)
check('exact message, no UPI lines', f1, f1?.waDigits === '919876543210' && f1.text === [
  'Namaste Priya 🙏', '',
  "A gentle reminder from *Demo Dojo*: Aarav Reddy's fee of *₹1,500* is due on *15 Nov 2026*.", '',
  'If already paid, please ignore. Thank you! 🥋'].join('\n'))
const f2 = feeReminder({ ...feeBase, upiId: 'demodojo@upi' })
check('with UPI ID → two UPI lines', f2?.text, !!f2?.text.includes('Pay via UPI: *demodojo@upi*\nPlease add "Aarav Reddy" in the payment note.\n\nIf already paid'))
check('no parent name → "Parent"', '', !!feeReminder({ ...feeBase, student: { ...stu, guardian_name: '' } })?.text.startsWith('Namaste Parent 🙏'))
check('Indian grouping 1,25,000', '', !!feeReminder({ ...feeBase, amount: 125000 })?.text.includes('*₹1,25,000*'))
check('due today (0) → shown', '', feeReminder({ ...feeBase, daysLeft: 0 }) !== null)
check('due in 7 days → shown', '', feeReminder({ ...feeBase, daysLeft: 7 }) !== null)
check('due in 8 days → hidden', '', feeReminder({ ...feeBase, daysLeft: 8 }) === null)
check('overdue → hidden', '', feeReminder({ ...feeBase, daysLeft: -1 }) === null)
check('no parent phone → hidden (no fallback to student)', '', feeReminder({ ...feeBase, student: { ...stu, guardian_phone: null } }) === null)
check('invalid parent phone → hidden', '', feeReminder({ ...feeBase, student: { ...stu, guardian_phone: '123' } }) === null)
check('no amount → hidden', '', feeReminder({ ...feeBase, amount: 0 }) === null)

check('UPI ok: demodojo@okicici, demo.dojo-1@ybl, empty', '', !upiProblem('demodojo@okicici') && !upiProblem('demo.dojo-1@ybl') && !upiProblem(''))
check('UPI refused: abc, a@b, x@y.com, @okicici', '', !!upiProblem('abc') && !!upiProblem('a@b') && !!upiProblem('x@y.com') && !!upiProblem('@okicici'))
check('cleanUpiId removes spaces', cleanUpiId(' demo dojo@upi '), cleanUpiId(' demo dojo@upi ') === 'demodojo@upi')

console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll checks passed')
if (failed) process.exit(1)

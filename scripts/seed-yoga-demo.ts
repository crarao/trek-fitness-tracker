// Yoga demo data on DEV only (yoga demo slice, 21 Nov). Anand runs it on his machine; Claude can't (no dev key).
// Creates two test companies with logins, branches, batches, members, memberships, the yoga activity list and
// two weeks of attendance + class activity logs:
//   QA Yoga Solo   (qayogasolo)   individual coach + yoga + 1 branch, 2 batches, 10 members
//   QA Yoga Studio (qayogastudio) gym + yoga + 2 branches, 5 batches, 2 trainers, 16 members
//
// Before: Step 1 of db/2026-11-21-activity-category.md on dev (the category column).
// Run from the repo root with the DEV .env.local (NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SECRET_KEY):
//   npx tsc scripts/seed-yoga-demo.ts --outDir /tmp/yoga --module commonjs --target es2020 --skipLibCheck --esModuleInterop
//   NODE_PATH=$PWD/node_modules node /tmp/yoga/scripts/seed-yoga-demo.js
//
// Safety (CLAUDE.md Rule #1): refuses any Supabase project but dev (nnxrmaiinbmxfwzefbwx); never deletes or
// updates anything that exists; a company whose slug is already there is skipped whole. Running it again only adds
// what is missing (nothing, once both companies exist). Logins are phone logins (India): password = the number.

import { readFileSync, existsSync } from 'fs'
import { randomUUID, randomBytes } from 'crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { loginEmailFor, NO_LOGIN_DOMAIN } from '../lib/phone'
import { YOGA_STARTER_ACTIVITIES } from '../lib/dojo-activities'

const DEV_REF = 'nnxrmaiinbmxfwzefbwx'

// ── env (.env.local when not set) ─────────────────────────────────────────────────────────────────────────────
if (existsSync('.env.local')) {
  for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const key = process.env.SUPABASE_SECRET_KEY || ''
if (!url.includes(DEV_REF)) {
  console.error(`Refusing to run: NEXT_PUBLIC_SUPABASE_URL is not the dev project (${DEV_REF}). Got: ${url || '(empty)'}`)
  process.exit(1)
}
if (!key) { console.error('SUPABASE_SECRET_KEY is missing (dev .env.local)'); process.exit(1) }
const db: SupabaseClient = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })

// ── helpers ────────────────────────────────────────────────────────────────────────────────────────────────────
// Today in India, 'YYYY-MM-DD' (the app's dates are the device's; dojo_today() is IST too)
const istToday = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10)
const addDays = (iso: string, n: number) => {
  const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10)
}
const addMonths = (iso: string, n: number) => {
  const d = new Date(iso + 'T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 10)
}
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const weekday = (iso: string) => DOW[new Date(iso + 'T00:00:00Z').getUTCDay()]
// Same numbers on every run (no Math.random): a small seeded generator
let seed = 20261121
const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
const pick = <T,>(list: T[], n: number) => [...list].sort(() => rand() - 0.5).slice(0, n)

function must<T>(res: { data: T | null; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`)
  return res.data as T
}

async function staffLogin(companyId: string, role: 'company_admin' | 'coach', fullName: string, phone10: string) {
  const email = loginEmailFor('IN', phone10)
  const auth = await db.auth.admin.createUser({ email, password: phone10, email_confirm: true, user_metadata: { full_name: fullName } })
  if (auth.error) throw new Error(`login ${email}: ${auth.error.message} (already used on dev? change the phone in this script)`)
  must(await db.from('profiles').insert({ id: auth.data.user.id, company_id: companyId, full_name: fullName, email, role, phone: phone10 }), `profile ${fullName}`)
  return auth.data.user.id
}

const PLAN_MONTHS: Record<string, number> = { '1 Month': 1, '3 Months': 3, '6 Months': 6, '1 Year': 12 }
const PRICE: Record<string, number> = { '1 Month': 2500, '3 Months': 6500, '6 Months': 12000, '1 Year': 22000 }

type BatchSpec = { name: string; days: string[]; start: string; end: string; markedBy?: 'owner' | 'trainer1' | 'trainer2' }
type CompanySpec = {
  name: string; slug: string; companyType: 'gym' | 'coach'
  owner: { name: string; phone: string }
  trainers: { name: string; phone: string }[]
  branches: { name: string; address: string; batches: BatchSpec[] }[]
  members: { name: string; gender: 'Female' | 'Male'; age: number }[]
  memberPhoneBase: number   // members get +91<base + i> (contact only, no login)
}

const SPECS: CompanySpec[] = [
  {
    name: 'QA Yoga Solo', slug: 'qayogasolo', companyType: 'coach',
    owner: { name: 'Meera Iyer', phone: '9000011001' },
    trainers: [],
    branches: [{
      name: 'Home studio', address: 'Demo address (QA)',
      batches: [
        { name: 'Morning Hatha', days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], start: '06:30', end: '07:30' },
        { name: 'Evening Flow', days: ['Mon', 'Wed', 'Fri'], start: '18:00', end: '19:00' },
      ],
    }],
    members: [
      { name: 'Ananya Rao', gender: 'Female', age: 34 }, { name: 'Kavya Menon', gender: 'Female', age: 29 },
      { name: 'Rohit Sharma', gender: 'Male', age: 41 }, { name: 'Lakshmi Narayan', gender: 'Female', age: 52 },
      { name: 'Vikram Reddy', gender: 'Male', age: 37 }, { name: 'Sneha Kulkarni', gender: 'Female', age: 26 },
      { name: 'Arjun Nair', gender: 'Male', age: 45 }, { name: 'Priya Desai', gender: 'Female', age: 31 },
      { name: 'Suresh Babu', gender: 'Male', age: 58 }, { name: 'Divya Pillai', gender: 'Female', age: 38 },
    ],
    memberPhoneBase: 9000011101,
  },
  {
    name: 'QA Yoga Studio', slug: 'qayogastudio', companyType: 'gym',
    owner: { name: 'Nisha Kapoor', phone: '9000012001' },
    trainers: [{ name: 'Ravi Shankar', phone: '9000012002' }, { name: 'Pooja Hegde', phone: '9000012003' }],
    branches: [
      {
        name: 'Jubilee Hills', address: 'Demo address (QA)',
        batches: [
          { name: 'Sunrise Hatha', days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], start: '06:00', end: '07:00', markedBy: 'trainer1' },
          { name: 'Power Vinyasa', days: ['Tue', 'Thu', 'Sat'], start: '07:15', end: '08:15', markedBy: 'trainer2' },
          { name: 'Evening Gentle', days: ['Mon', 'Wed', 'Fri'], start: '18:30', end: '19:30', markedBy: 'trainer1' },
        ],
      },
      {
        name: 'Kondapur', address: 'Demo address (QA)',
        batches: [
          { name: 'Morning Hatha', days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], start: '06:30', end: '07:30', markedBy: 'trainer2' },
          { name: 'Weekend Flow', days: ['Sat', 'Sun'], start: '08:00', end: '09:00', markedBy: 'owner' },
        ],
      },
    ],
    members: [
      { name: 'Aditi Joshi', gender: 'Female', age: 28 }, { name: 'Rahul Verma', gender: 'Male', age: 35 },
      { name: 'Meghna Shah', gender: 'Female', age: 44 }, { name: 'Karthik Subramanian', gender: 'Male', age: 39 },
      { name: 'Fatima Sheikh', gender: 'Female', age: 33 }, { name: 'Sanjay Gupta', gender: 'Male', age: 55 },
      { name: 'Ishita Bose', gender: 'Female', age: 24 }, { name: 'Naveen Kumar', gender: 'Male', age: 30 },
      { name: 'Revathi Krishnan', gender: 'Female', age: 49 }, { name: 'Aman Malhotra', gender: 'Male', age: 27 },
      { name: 'Shruti Agarwal', gender: 'Female', age: 36 }, { name: 'Deepak Rao', gender: 'Male', age: 61 },
      { name: 'Tanvi Patil', gender: 'Female', age: 32 }, { name: 'Harish Chandra', gender: 'Male', age: 47 },
      { name: 'Neha Saxena', gender: 'Female', age: 40 }, { name: 'Gopal Iyengar', gender: 'Male', age: 66 },
    ],
    memberPhoneBase: 9000012101,
  },
]

async function seedCompany(spec: CompanySpec) {
  const existing = must(await db.from('companies').select('id').eq('slug', spec.slug).maybeSingle(), 'slug check')
  if (existing) { console.log(`• ${spec.name}: slug ${spec.slug} already exists, skipped (nothing changed)`); return }

  const today = istToday()
  const ownerEmail = loginEmailFor('IN', spec.owner.phone)
  const company = must(await db.from('companies').insert({
    name: spec.name, email: ownerEmail, phone: spec.owner.phone, country: 'IN', currency: 'INR',
    trial_start: addDays(today, -30), trial_end: addDays(today, 90), is_trial: true, is_active: true,
    slug: spec.slug, company_type: spec.companyType, business_type: 'yoga', is_test: true,
    client_module_enabled: true, client_limit: 50,
  }).select('id').single(), 'company') as { id: string }
  const cId = company.id
  console.log(`• ${spec.name} (${spec.slug}) created`)

  const ownerId = await staffLogin(cId, 'company_admin', spec.owner.name, spec.owner.phone)
  const trainerIds: string[] = []
  for (const t of spec.trainers) trainerIds.push(await staffLogin(cId, 'coach', t.name, t.phone))
  const markerFor = (b: BatchSpec) => b.markedBy === 'trainer1' ? trainerIds[0] ?? ownerId : b.markedBy === 'trainer2' ? trainerIds[1] ?? ownerId : ownerId

  // Branches + batches
  const batches: { id: string; branchId: string; spec: BatchSpec }[] = []
  for (const br of spec.branches) {
    const branch = must(await db.from('branches').insert({ company_id: cId, name: br.name, address: br.address }).select('id').single(), `branch ${br.name}`) as { id: string }
    for (const b of br.batches) {
      const row = must(await db.from('batches').insert({
        company_id: cId, branch_id: branch.id, name: b.name, days: b.days, start_time: b.start, end_time: b.end,
      }).select('id').single(), `batch ${b.name}`) as { id: string }
      batches.push({ id: row.id, branchId: branch.id, spec: b })
    }
  }

  // Yoga activity list (with categories: Step 1 of db/2026-11-21-activity-category.md must have run)
  const acts = must(await db.from('dojo_activities').insert(YOGA_STARTER_ACTIVITIES.map((a, i) => ({
    company_id: cId, name: a.name, description: a.description, sort_order: i + 1, is_default: a.is_default,
    category: a.category, created_by: ownerId,
  }))).select('id, name, is_default'), 'activities (did Step 1 of db/2026-11-21-activity-category.md run on dev?)') as { id: string; name: string; is_default: boolean }[]

  // Members: no login (placeholder Auth user, like create-user's no_login), PT (class mode: trainers see everyone),
  // a branch and home batch, joined 5–8 weeks ago, one membership each
  const plans = ['1 Month', '3 Months', '1 Month', '6 Months', '3 Months', '1 Year']
  const members: { id: string; batchId: string }[] = []
  for (let i = 0; i < spec.members.length; i++) {
    const m = spec.members[i]
    const home = batches[i % batches.length]
    const email = `client-${randomUUID()}${NO_LOGIN_DOMAIN}`
    const auth = await db.auth.admin.createUser({ email, password: randomBytes(24).toString('base64url'), email_confirm: true, user_metadata: { full_name: m.name } })
    if (auth.error) throw new Error(`member ${m.name}: ${auth.error.message}`)
    const joined = addDays(today, -(35 + Math.floor(rand() * 21)))
    must(await db.from('profiles').insert({
      id: auth.data.user.id, company_id: cId, full_name: m.name, email, role: 'client', client_type: 'pt',
      phone: `+91${spec.memberPhoneBase + i}`, country: 'IN', currency: 'INR',
      gender: m.gender, age: m.age, branch_id: home.branchId, batch_id: home.id,
      primary_coach_id: trainerIds.length ? trainerIds[i % trainerIds.length] : null,
      created_at: joined + 'T04:00:00Z',
    }), `profile ${m.name}`)
    // Fees: member 0 due in 3 days, member 1 due in 6, member 2 lapsed 10 days ago; the rest paid up
    const plan = plans[i % plans.length]
    let start = joined
    if (i === 0) start = addMonths(addDays(today, 3), -PLAN_MONTHS[plan])
    else if (i === 1) start = addMonths(addDays(today, 6), -PLAN_MONTHS[plan])
    else if (i === 2) start = addMonths(addDays(today, -10), -PLAN_MONTHS[plan])
    let end = addMonths(start, PLAN_MONTHS[plan])
    if (i > 2 && end <= addDays(today, 7)) { start = addDays(today, -7); end = addMonths(start, PLAN_MONTHS[plan]) }
    must(await db.from('memberships').insert({
      profile_id: auth.data.user.id, company_id: cId, plan_type: plan, amount_paid: PRICE[plan],
      start_date: start, end_date: end, currency: 'INR',
    }), `membership ${m.name}`)
    members.push({ id: auth.data.user.id, batchId: home.id })
  }

  // Two weeks of classes (the 14 days before today; today is left for the live demo): each batch day gets a
  // logged class with the pre-ticked activities + 3–5 others, and ~80% of its home members present.
  // Member 3 stays away the last 10 days (shows under "not seen" later, and as absences).
  const defaults = acts.filter(a => a.is_default)
  const others = acts.filter(a => !a.is_default)
  let classCount = 0, presentCount = 0
  for (let d = 14; d >= 1; d--) {
    const date = addDays(today, -d)
    for (const b of batches) {
      if (!b.spec.days.includes(weekday(date))) continue
      const marker = markerFor(b.spec)
      const at = `${date}T${b.spec.end}:00+05:30`
      const cls = must(await db.from('batch_classes').insert({
        company_id: cId, batch_id: b.id, class_date: date, logged_by: marker, logged_at: at,
      }).select('id').single(), `class ${b.spec.name} ${date}`) as { id: string }
      const ticked = [...defaults, ...pick(others, 3 + Math.floor(rand() * 3))]
      must(await db.from('batch_class_activities').insert(ticked.map(a => ({
        company_id: cId, class_id: cls.id, activity_id: a.id, activity_name: a.name, removed_at: null,
      }))), `class activities ${date}`)
      const home = members.filter(m => m.batchId === b.id)
      const present = home.filter((m, i) => !(members.indexOf(m) === 3 && d <= 10) && (rand() < 0.8 || i === 0))
      if (present.length) {
        must(await db.from('attendance').insert(present.map(m => ({
          company_id: cId, batch_id: b.id, profile_id: m.id, class_date: date, present: true, is_drop_in: false,
          marked_by: marker, marked_at: at,
        }))), `attendance ${date}`)
      }
      classCount++; presentCount += present.length
    }
  }
  console.log(`  owner ${spec.owner.name}: login ${spec.owner.phone} / password ${spec.owner.phone}`)
  for (const t of spec.trainers) console.log(`  trainer ${t.name}: login ${t.phone} / password ${t.phone}`)
  console.log(`  ${spec.branches.length} branch(es), ${batches.length} batches, ${members.length} members, ${acts.length} activities, ${classCount} classes, ${presentCount} present marks`)
}

;(async () => {
  console.log(`Dev project ${DEV_REF} — today (IST) ${istToday()}`)
  for (const spec of SPECS) await seedCompany(spec)
  console.log('Done. Login links: /login/qayogasolo and /login/qayogastudio on the dev link.')
})().catch(e => { console.error('Stopped:', (e as Error).message, '\nNothing is undone or deleted: fix the cause, then look at what was created before running again.'); process.exit(1) })

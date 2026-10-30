import type { Metadata } from 'next'
import { Archivo } from 'next/font/google'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { createServerClient } from '@supabase/ssr'
import Link from 'next/link'
import { TESTIMONIALS, INSTAGRAM_HANDLE, INSTAGRAM_URL, WALKTHROUGHS } from './landing-content'
import ContactForm from './contact-form'

// Public home page for getcoachboard.com.
// Logged-in users skip it and go straight to their dashboard.
// Redesign (30 Oct 2026): two clear audiences (gym owners, personal trainers), each with a short "how it works" flow, a specific demo CTA, and only claims the product supports today.

const archivo = Archivo({ subsets: ['latin'], axes: ['wdth'], display: 'swap' })

export const metadata: Metadata = {
  metadataBase: new URL('https://getcoachboard.com'),
  title: 'CoachBoard — memberships for gyms, training plans for coaches',
  description:
    'Gyms: see who is due for renewal, remind them on WhatsApp in one tap and follow up enquiries. Coaches: draft weekly plans with AI, log sessions and share a progress report with each client.',
  openGraph: {
    title: 'CoachBoard',
    description: 'Run your gym. Coach your clients. One place, on your phone.',
    url: 'https://getcoachboard.com',
    siteName: 'CoachBoard',
    type: 'website',
  },
}

// All contact buttons scroll to the form; the owner's email is never shown on the page
const contactHref = '#contact'

// Colours: chalk floor, iron text, brand orange for memberships, plate blue for training
const C = {
  chalk: '#F6F6F3',
  paper: '#FFFFFF',
  iron: '#1B1E23',
  steel: '#5E646E',
  line: '#E2E2DC',
  orange: '#EA620C',
  blue: '#2350B8',
  green: '#1F8A4C',
  orangeSoft: '#FDF0E7',
  blueSoft: '#EAF0FB',
}

const wide = { fontStretch: '125%' } as const

const desk = [
  { name: 'Rohan M.', plan: '3 months', due: 'Expires Mon' },
  { name: 'Emily R.', plan: '1 month', due: 'Expires Tue' },
  { name: 'Aarav K.', plan: '6 months', due: 'Expires Thu' },
  { name: 'Marcus T.', plan: '1 year', due: 'Expired 3 days ago' },
]

// "Choose your use case" cards under the hero; each jumps to its section
const paths = [
  { id: 'gyms', label: 'For gym owners', line: 'Memberships, renewals, enquiries and staff logins.', color: C.orange, bg: C.orangeSoft },
  { id: 'coaches', label: 'For personal trainers', line: 'AI-drafted plans, session logs and progress reports.', color: C.blue, bg: C.blueSoft },
]

// "For gym owners": how it works, then the extras
const gymSteps = [
  ['Add members and their plans', 'Name, phone, plan, amount paid and dates. Every renewal is kept as history.'],
  ['See who is due', 'Expiring this week, already lapsed, and what came in this month — on the home screen.'],
  ['Remind in one tap', 'Tap Remind and WhatsApp opens with the message already written. You just hit send.'],
]

const gymExtras = [
  ['Enquiries don’t slip', 'Log walk-ins and Instagram enquiries, set a follow-up date, and convert them to members when they join.'],
  ['Logins for your team', 'Up to two partners see everything with you. Coaches get their own view of PT clients — no payments or amounts.'],
  ['Payments at a glance', 'This month’s collections and the renewal value coming up next.'],
]

// "For personal trainers": how it works, then what progress means
const coachSteps = [
  ['Enter the client’s details', 'Goal, fitness level, available days, equipment and any injuries.'],
  ['Get a draft weekly plan', 'AI drafts the week in seconds. You review it, edit anything, then assign it.'],
  ['Log sessions as they train', 'Mark exercises done and add notes during the session — the client doesn’t need to log anything.'],
  ['Share their progress', 'Download a PDF with your note and the last 8 weeks of charts, and send it on WhatsApp.'],
]

const progressSignals = [
  ['Sessions per week', 'Spot a client who is slipping before they quit.'],
  ['Minutes trained per week', 'See whether the load is building as planned.'],
  ['Your notes on each session', 'Remember what happened last time, even if another coach covered.'],
]

const faqs = [
  ['How long does setup take?', 'About 20 minutes on a call. We create your account and you add your first members or clients while we talk.'],
  ['Do I need to download an app?', 'No. CoachBoard opens in your phone’s browser and can be added to the home screen like an app.'],
  ['Is it for gyms or for individual coaches?', 'Both. A gym gets memberships, enquiries and coach logins. An individual coach gets a simpler view focused on clients, plans and progress.'],
  ['Can my coaches use it?', 'Yes. Each coach gets their own login, sees today’s PT clients and can log sessions and edit plans. They don’t see payments or enquiries.'],
  ['Does it work outside India?', 'Yes. Dates, currency and phone numbers follow your country (India or the US).'],
  ['How much does it cost?', 'It depends on the size of your gym or client list. Send us a message below and we’ll share the details.'],
]

// Numbered "how it works" cards: 3 across on desktop (4 when there are 4 steps), stacked on phone
function Steps({ steps, color }: { steps: string[][]; color: string }) {
  return (
    <ol className={`grid gap-4 ${steps.length === 4 ? 'sm:grid-cols-2 lg:grid-cols-4' : 'md:grid-cols-3'}`}>
      {steps.map(([t, d], i) => (
        <li key={t} className="rounded-2xl border p-5 sm:p-6" style={{ background: C.paper, borderColor: C.line }}>
          <span className="grid h-9 w-9 place-items-center rounded-full text-sm font-extrabold text-white" style={{ background: color }} aria-hidden>{i + 1}</span>
          <p className="mt-4 font-bold">{t}</p>
          <p className="mt-1.5 leading-relaxed" style={{ color: C.steel }}>{d}</p>
        </li>
      ))}
    </ol>
  )
}

// Product walkthrough video; hidden until its YouTube ID is filled in (app/landing-content.ts)
function Walkthrough({ id, label }: { id: string; label: string }) {
  if (!id) return null
  return (
    <figure className="mt-10 overflow-hidden rounded-2xl border" style={{ background: C.paper, borderColor: C.line }}>
      <div className="aspect-video">
        <iframe src={`https://www.youtube-nocookie.com/embed/${id}`} title={label} loading="lazy" allowFullScreen
          allow="accelerometer; encrypted-media; gyroscope; picture-in-picture" className="h-full w-full" />
      </div>
      <figcaption className="px-4 py-3 text-sm" style={{ background: C.paper, color: C.steel }}>{label}</figcaption>
    </figure>
  )
}

async function isLoggedIn() {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
  )
  const { data: { user } } = await supabase.auth.getUser()
  return !!user
}

export default async function Home() {
  if (await isLoggedIn()) redirect('/dashboard')

  return (
    <div className={`${archivo.className} min-h-screen`} style={{ background: C.chalk, color: C.iron }}>
      <style>{`
        @keyframes cb-sent { from { opacity: 0; transform: scale(.9) } to { opacity: 1; transform: none } }
        @keyframes cb-hide { to { opacity: 0; visibility: hidden } }
        .cb-remind { animation: cb-hide .01s forwards; }
        .cb-sent { opacity: 0; animation: cb-sent .35s ease-out forwards; }
        @media (prefers-reduced-motion: reduce) {
          .cb-remind { animation: none; opacity: 0; visibility: hidden; }
          .cb-sent { animation: none; opacity: 1; }
        }
        html { scroll-behavior: smooth; }
        @media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } }
        .cb-focus:focus-visible { outline: 3px solid ${C.blue}; outline-offset: 3px; }
        details > summary { list-style: none; }
        details > summary::-webkit-details-marker { display: none; }
        details[open] .cb-plus { transform: rotate(45deg); }
      `}</style>

      {/* Header */}
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5 sm:px-8">
        <Link href="/" className="cb-focus flex items-center gap-2.5 rounded-md">
          <span className="grid h-8 w-8 place-items-center rounded-md text-sm font-extrabold text-white" style={{ background: C.orange }}>C</span>
          <span className="text-lg font-extrabold tracking-tight" style={wide}>CoachBoard</span>
        </Link>
        <nav className="flex items-center gap-2 sm:gap-4">
          <a href="#gyms" className="cb-focus hidden rounded-md px-3 py-2 text-sm font-semibold hover:underline md:inline">For gyms</a>
          <a href="#coaches" className="cb-focus hidden rounded-md px-3 py-2 text-sm font-semibold hover:underline md:inline">For coaches</a>
          <Link href="/login" className="cb-focus whitespace-nowrap rounded-md px-2 sm:px-3 py-2 text-sm font-semibold hover:underline">Log in</Link>
          <a href={contactHref} className="cb-focus whitespace-nowrap rounded-md px-3 sm:px-4 py-2 text-sm font-semibold text-white" style={{ background: C.iron }}>Book a demo</a>
        </nav>
      </header>

      <main>
        {/* Hero */}
        <section className="mx-auto grid max-w-6xl items-center gap-8 px-5 pb-10 pt-4 sm:px-8 md:grid-cols-[1.1fr_1fr] md:gap-12 md:pb-16 md:pt-14">
          <div>
            <h1 className="text-[1.9rem] font-extrabold leading-[1.08] tracking-tight sm:text-5xl md:text-6xl md:leading-[1.02]" style={wide}>
              Run your gym. Coach your clients. One place.
            </h1>
            <p className="mt-4 max-w-[34rem] text-base leading-relaxed sm:mt-6 sm:text-lg" style={{ color: C.steel }}>
              Keep membership renewals on track with one-tap WhatsApp reminders, and create, log and share every client’s training plan — all from your phone.
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-3 sm:mt-8">
              <a href={contactHref} className="cb-focus rounded-lg px-6 py-3.5 text-base font-semibold text-white" style={{ background: C.orange }}>
                Book a 20-minute demo
              </a>
              <Link href="/login" className="cb-focus rounded-lg border px-6 py-3.5 text-base font-semibold" style={{ borderColor: C.iron }}>
                Log in
              </Link>
            </div>
            <p className="mt-4 text-sm" style={{ color: C.steel }}>Nothing to download. Opens in your phone’s browser.</p>
          </div>

          {/* The front-desk board: the one moving moment on the page */}
          <div className="rounded-2xl border p-5 shadow-[0_24px_60px_-30px_rgba(27,30,35,.35)] sm:p-6" style={{ background: C.paper, borderColor: C.line }} aria-label="Example: renewals due this week">
            <div className="flex items-baseline justify-between">
              <p className="text-base font-bold">Renewals due this week</p>
              <p className="text-sm" style={{ color: C.steel }}><span className="sm:hidden">3 members</span><span className="hidden sm:inline">4 members</span></p>
            </div>
            <ul className="mt-4 divide-y" style={{ borderColor: C.line }}>
              {desk.map((m, i) => (
                <li key={m.name} className={`${i === 3 ? 'hidden sm:flex' : 'flex'} items-center justify-between gap-3 py-3.5`} style={{ borderColor: C.line }}>
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{m.name}</p>
                    <p className="text-sm" style={{ color: i === 3 ? '#B42318' : C.steel }}>{m.plan}, {m.due.toLowerCase()}</p>
                  </div>
                  <div className="relative h-9 w-[7.5rem] shrink-0">
                    <span className="cb-remind absolute inset-0 grid place-items-center rounded-lg border text-sm font-semibold"
                      style={{ borderColor: C.green, color: C.green, animationDelay: `${1.2 + i * 0.7}s` }}>
                      Remind
                    </span>
                    <span className="cb-sent absolute inset-0 grid place-items-center rounded-lg text-sm font-semibold text-white"
                      style={{ background: C.green, animationDelay: `${1.2 + i * 0.7}s` }}>
                      Reminder sent
                    </span>
                  </div>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs" style={{ color: C.steel }}>Each reminder opens WhatsApp with the message already written.</p>
          </div>
        </section>

        {/* Choose your use case: orange = gyms, blue = coaches */}
        <section className="mx-auto max-w-6xl px-5 pb-12 sm:px-8 md:pb-20">
          <div className="grid gap-4 md:grid-cols-2">
            {paths.map(p => (
              <a key={p.id} href={`#${p.id}`} className="cb-focus group flex items-center justify-between gap-4 rounded-2xl border-l-4 px-5 py-5 sm:px-6"
                style={{ background: p.bg, borderColor: p.color }}>
                <div>
                  <p className="text-lg font-bold" style={{ color: p.color }}>{p.label}</p>
                  <p className="mt-1" style={{ color: C.iron }}>{p.line}</p>
                </div>
                <span className="text-2xl leading-none transition-transform group-hover:translate-y-1" style={{ color: p.color }} aria-hidden>↓</span>
              </a>
            ))}
          </div>
        </section>

        {/* For gym owners (orange): memberships, renewals, enquiries */}
        <section id="gyms" className="scroll-mt-4 border-y" style={{ background: C.chalk, borderColor: C.line }}>
          <div className="mx-auto max-w-6xl px-5 py-12 sm:px-8 md:py-20">
            <p className="text-sm font-bold uppercase tracking-wider" style={{ color: C.orange }}>For gym owners</p>
            <h2 className="mt-3 max-w-2xl text-3xl font-extrabold leading-tight tracking-tight sm:text-4xl" style={wide}>
              Stop losing members to forgotten renewals.
            </h2>
            <div className="mt-8 md:mt-10">
              <Steps steps={gymSteps} color={C.orange} />
            </div>
            <dl className="mt-10 grid gap-6 border-t-4 pt-6 md:grid-cols-3 md:gap-10" style={{ borderColor: C.orange }}>
              {gymExtras.map(([t, d]) => (
                <div key={t}>
                  <dt className="font-semibold">{t}</dt>
                  <dd className="mt-1 max-w-md leading-relaxed" style={{ color: C.steel }}>{d}</dd>
                </div>
              ))}
            </dl>
            <Walkthrough id={WALKTHROUGHS.renewals} label="Walkthrough: a membership renewal, from due to reminder sent" />
          </div>
        </section>

        {/* For personal trainers (blue): plans, session logs, progress */}
        <section id="coaches" className="scroll-mt-4 border-b" style={{ background: C.paper, borderColor: C.line }}>
          <div className="mx-auto max-w-6xl px-5 py-12 sm:px-8 md:py-20">
            <p className="text-sm font-bold uppercase tracking-wider" style={{ color: C.blue }}>For personal trainers</p>
            <h2 className="mt-3 max-w-2xl text-3xl font-extrabold leading-tight tracking-tight sm:text-4xl" style={wide}>
              Create a draft plan, personalise it, assign it.
            </h2>
            <p className="mt-4 max-w-2xl text-lg leading-relaxed" style={{ color: C.steel }}>
              For online coaches and coaches inside a gym. Clients who see their progress stay longer.
            </p>
            <div className="mt-8 md:mt-10">
              <Steps steps={coachSteps} color={C.blue} />
            </div>
            <div className="mt-10 grid gap-6 border-t-4 pt-6 md:grid-cols-[1fr_1.4fr] md:gap-10" style={{ borderColor: C.blue }}>
              <div>
                <h3 className="text-xl font-bold" style={{ color: C.blue }}>What “progress” means here</h3>
                <p className="mt-2 max-w-sm leading-relaxed" style={{ color: C.steel }}>Three things you can see for every client, and put in the report you send them.</p>
              </div>
              <dl className="space-y-4 sm:space-y-5">
                {progressSignals.map(([t, d]) => (
                  <div key={t}>
                    <dt className="font-semibold">{t}</dt>
                    <dd className="mt-1 leading-relaxed" style={{ color: C.steel }}>{d}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <Walkthrough id={WALKTHROUGHS.plans} label="Walkthrough: drafting, editing and assigning a weekly training plan" />
          </div>
        </section>

        {/* Testimonials: only shown once there is at least one */}
        {TESTIMONIALS.length > 0 && (
          <section className="mx-auto max-w-6xl px-5 py-12 sm:px-8 md:py-20">
            <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl" style={wide}>What coaches say</h2>
            <div className="mt-8 grid gap-6 md:grid-cols-2">
              {TESTIMONIALS.map(t => (
                <figure key={t.name + t.place} className="rounded-2xl border p-6" style={{ background: C.paper, borderColor: C.line }}>
                  <blockquote className="text-lg leading-relaxed">“{t.quote}”</blockquote>
                  <figcaption className="mt-4 text-sm" style={{ color: C.steel }}>
                    <span className="font-semibold" style={{ color: C.iron }}>{t.name}</span>, {t.role}, {t.place}
                  </figcaption>
                </figure>
              ))}
            </div>
          </section>
        )}

        {/* FAQ */}
        <section className="mx-auto max-w-3xl px-5 py-12 sm:px-8 md:py-20">
          <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl" style={wide}>Questions</h2>
          <div className="mt-8 divide-y border-y" style={{ borderColor: C.line }}>
            {faqs.map(([q, a]) => (
              <details key={q} className="group py-1" style={{ borderColor: C.line }}>
                <summary className="cb-focus flex cursor-pointer items-center justify-between gap-4 rounded-md py-4 text-lg font-semibold">
                  {q}
                  <span className="cb-plus text-2xl leading-none transition-transform" style={{ color: C.orange }} aria-hidden>+</span>
                </summary>
                <p className="pb-5 leading-relaxed" style={{ color: C.steel }}>{a}</p>
              </details>
            ))}
          </div>
        </section>

        {/* Contact */}
        <section id="contact" className="mx-auto max-w-6xl scroll-mt-4 px-5 pb-16 sm:px-8 md:pb-20">
          <div className="rounded-2xl px-5 py-10 text-white sm:px-12 sm:py-12" style={{ background: C.orange }}>
            <h2 className="max-w-2xl text-3xl font-extrabold leading-tight tracking-tight sm:text-4xl" style={wide}>
              Book a 20-minute demo.
            </h2>
            <p className="mt-4 max-w-xl text-lg leading-relaxed text-white/90">
              We’ll show you a membership renewal and a client training plan, live, using your own gym or clients. You talk directly to the person who builds CoachBoard.
            </p>
            <div className="mt-8 max-w-2xl">
              <ContactForm />
            </div>
            <p className="mt-6 flex flex-wrap items-center gap-x-2 gap-y-1 text-base text-white/90">
              Prefer Instagram?
              <a href={INSTAGRAM_URL} target="_blank" rel="noopener noreferrer"
                className="cb-focus inline-flex items-center gap-1.5 rounded font-semibold text-white underline underline-offset-4 decoration-white/50 hover:decoration-white"
                aria-label={`Message CoachBoard on Instagram, @${INSTAGRAM_HANDLE}`}>
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <rect x="3" y="3" width="18" height="18" rx="5" />
                  <circle cx="12" cy="12" r="4" />
                  <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
                </svg>
                Message @{INSTAGRAM_HANDLE}
              </a>
            </p>
          </div>
        </section>
      </main>

      <footer className="border-t" style={{ borderColor: C.line }}>
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-6 text-sm sm:px-8" style={{ color: C.steel }}>
          <p>© {new Date().getFullYear()} CoachBoard</p>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            <a href="#gyms" className="cb-focus rounded hover:underline">For gyms</a>
            <a href="#coaches" className="cb-focus rounded hover:underline">For coaches</a>
            <Link href="/login" className="cb-focus rounded hover:underline">Log in</Link>
            <a href={contactHref} className="cb-focus rounded hover:underline">Contact</a>
          </div>
        </div>
      </footer>
    </div>
  )
}

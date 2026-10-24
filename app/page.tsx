import type { Metadata } from 'next'
import { Archivo } from 'next/font/google'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { createServerClient } from '@supabase/ssr'
import Link from 'next/link'
import { TESTIMONIALS } from './landing-content'
import ContactForm from './contact-form'

// Public home page for getcoachboard.com.
// Logged-in users skip it and go straight to their dashboard.

const archivo = Archivo({ subsets: ['latin'], axes: ['wdth'], display: 'swap' })

export const metadata: Metadata = {
  metadataBase: new URL('https://getcoachboard.com'),
  title: 'CoachBoard — memberships, renewals and training for gyms and coaches',
  description:
    'See who is due for renewal, send a one-tap WhatsApp reminder, and keep every client’s plan and progress in one place. For gyms, studios and personal trainers.',
  openGraph: {
    title: 'CoachBoard',
    description: 'Memberships, renewals and training plans for gyms and coaches — on your phone.',
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
}

const wide = { fontStretch: '125%' } as const

const desk = [
  { name: 'Rohan M.', plan: '3 months', due: 'Expires Mon' },
  { name: 'Emily R.', plan: '1 month', due: 'Expires Tue' },
  { name: 'Aarav K.', plan: '6 months', due: 'Expires Thu' },
  { name: 'Marcus T.', plan: '1 year', due: 'Expired 3 days ago' },
]

const manage = [
  ['Renewals due this week', 'Who is about to expire, and who has already lapsed, without scrolling a register.'],
  ['One-tap reminders', 'A ready-written WhatsApp message to the member, sent from your phone.'],
  ['This month’s collections', 'What came in, and what is due for renewal next.'],
]

const train = [
  ['Weekly plans in minutes', 'AI drafts a plan from the client’s goal, level, available days and injuries. You edit it before it goes out.'],
  ['Session logs and feedback', 'Clients log each workout from their phone, and you reply against that session.'],
  ['Progress you can see', 'Workouts per week, minutes trained and streaks.'],
]

const faqs = [
  ['How long does setup take?', 'About 20 minutes on a call. We create your account, and you can add your first members while we talk.'],
  ['Do my members need to download an app?', 'No. CoachBoard opens in the phone’s browser and can be added to the home screen like an app.'],
  ['Can my staff use it?', 'Yes. Front desk staff and managers get their own logins for your gym.'],
  ['Does it work outside India?', 'Yes. Gyms in India and the US use it; dates, currency and phone numbers follow your country.'],
  ['How much does it cost?', 'It depends on the size of your gym. Email us and we’ll share the details.'],
]

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
          <Link href="/login" className="cb-focus rounded-md px-3 py-2 text-sm font-semibold hover:underline">Log in</Link>
          <a href={contactHref} className="cb-focus rounded-md px-4 py-2 text-sm font-semibold text-white" style={{ background: C.iron }}>Contact us</a>
        </nav>
      </header>

      <main>
        {/* Hero */}
        <section className="mx-auto grid max-w-6xl items-center gap-8 px-5 pb-12 pt-4 sm:px-8 md:grid-cols-[1.1fr_1fr] md:gap-12 md:pb-24 md:pt-14">
          <div>
            <h1 className="text-[1.75rem] font-extrabold leading-[1.1] tracking-tight sm:text-5xl md:text-6xl md:leading-[1.02]" style={wide}>
              Your gym’s renewals, reminders and training plans. On one phone.
            </h1>
            <p className="mt-4 max-w-[34rem] text-base leading-relaxed sm:mt-6 sm:text-lg" style={{ color: C.steel }}>
              CoachBoard shows who is due for renewal, sends the reminder on WhatsApp in one tap, and keeps every client’s plan and progress in one place.
            </p>
            <p className="mt-3 max-w-[34rem] text-sm font-medium sm:text-base">
              For gyms, studios, personal trainers and trek coaches, in India and the US.
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-3 sm:mt-8">
              <a href={contactHref} className="cb-focus rounded-lg px-6 py-3.5 text-base font-semibold text-white" style={{ background: C.orange }}>
                Book a demo
              </a>
              <Link href="/login" className="cb-focus rounded-lg border px-6 py-3.5 text-base font-semibold" style={{ borderColor: C.iron }}>
                Log in
              </Link>
            </div>
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

        {/* What it does: two modules, colour-coded */}
        <section className="border-y" style={{ background: C.paper, borderColor: C.line }}>
          <div className="mx-auto max-w-6xl px-5 py-12 sm:px-8 md:py-20">
            <h2 className="max-w-2xl text-3xl font-extrabold leading-tight tracking-tight sm:text-4xl" style={wide}>
              Two jobs, one app.
            </h2>
            <div className="mt-8 grid gap-8 md:mt-10 md:grid-cols-2 md:gap-14">
              {[
                { title: 'Manage your members', color: C.orange, items: manage },
                { title: 'Train your clients', color: C.blue, items: train },
              ].map(col => (
                <div key={col.title} className="border-t-4 pt-6" style={{ borderColor: col.color }}>
                  <h3 className="text-xl font-bold" style={{ color: col.color }}>{col.title}</h3>
                  <dl className="mt-4 space-y-3 sm:mt-5 sm:space-y-5">
                    {col.items.map(([t, d]) => (
                      <div key={t}>
                        <dt className="font-semibold">{t}</dt>
                        <dd className="mt-1 hidden max-w-md leading-relaxed sm:block" style={{ color: C.steel }}>{d}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ))}
            </div>
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
              See it with your own members.
            </h2>
            <p className="mt-4 max-w-xl text-lg leading-relaxed text-white/90">
              Tell us about your gym and we’ll set up a 20-minute walkthrough. Members just open it in their phone browser, nothing to download. You talk directly to the person who builds CoachBoard.
            </p>
            <div className="mt-8 max-w-2xl">
              <ContactForm />
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t" style={{ borderColor: C.line }}>
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-6 text-sm sm:px-8" style={{ color: C.steel }}>
          <p>© {new Date().getFullYear()} CoachBoard</p>
          <div className="flex gap-5">
            <Link href="/login" className="cb-focus rounded hover:underline">Log in</Link>
            <a href={contactHref} className="cb-focus rounded hover:underline">Contact</a>
          </div>
        </div>
      </footer>
    </div>
  )
}

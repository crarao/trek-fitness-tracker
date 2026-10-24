'use client'

import { useState } from 'react'

// Landing page contact form. Posts to /api/contact; the owner's email is never shown.
export default function ContactForm() {
  const [form, setForm] = useState({ name: '', email: '', phone: '', business: '', message: '', website: '' })
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent'>('idle')
  const [error, setError] = useState('')

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm({ ...form, [k]: e.target.value })

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setStatus('sending')
    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || 'Could not send right now. Please try again in a minute.')
        setStatus('idle')
        return
      }
      setStatus('sent')
    } catch {
      setError('Network problem. Check your connection and try again.')
      setStatus('idle')
    }
  }

  if (status === 'sent') {
    return (
      <div role="status" className="rounded-xl bg-white px-6 py-8 text-[#1B1E23]">
        <p className="text-xl font-bold">Thanks, {form.name.split(' ')[0]}.</p>
        <p className="mt-2 leading-relaxed text-[#5E646E]">We’ll reply to {form.email} within a day to set up your walkthrough.</p>
      </div>
    )
  }

  const field = 'w-full rounded-lg border border-white/40 bg-white px-4 py-3 text-base text-[#1B1E23] placeholder-[#8A9099] outline-none focus:ring-4 focus:ring-white/50'

  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2" noValidate>
      <label className="sr-only" htmlFor="cf-name">Your name</label>
      <input id="cf-name" required autoComplete="name" placeholder="Your name" value={form.name} onChange={set('name')} className={field} />

      <label className="sr-only" htmlFor="cf-email">Email</label>
      <input id="cf-email" type="email" required autoComplete="email" placeholder="Email" value={form.email} onChange={set('email')} className={field} />

      <label className="sr-only" htmlFor="cf-phone">Phone</label>
      <input id="cf-phone" type="tel" required autoComplete="tel" placeholder="Phone" value={form.phone} onChange={set('phone')} className={field} />

      <label className="sr-only" htmlFor="cf-business">Gym or business name</label>
      <input id="cf-business" autoComplete="organization" placeholder="Gym or business name" value={form.business} onChange={set('business')} className={field} />

      <label className="sr-only" htmlFor="cf-message">Anything we should know? (optional)</label>
      <textarea id="cf-message" rows={3} placeholder="Anything we should know? (optional)" value={form.message} onChange={set('message')} className={`${field} resize-none sm:col-span-2`} />

      {/* Honeypot for bots: hidden from people and screen readers */}
      <input tabIndex={-1} autoComplete="off" aria-hidden="true" value={form.website} onChange={set('website')}
        className="absolute left-[-9999px] h-0 w-0 opacity-0" name="website" />

      {error && <p className="rounded-lg bg-white/15 px-4 py-2 text-sm font-medium text-white sm:col-span-2">{error}</p>}

      <button type="submit" disabled={status === 'sending'}
        className="rounded-lg bg-[#1B1E23] px-6 py-3.5 text-base font-semibold text-white focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-white disabled:opacity-60 sm:col-span-2 sm:justify-self-start">
        {status === 'sending' ? 'Sending…' : 'Send'}
      </button>
    </form>
  )
}

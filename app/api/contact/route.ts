import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

// Public endpoint for the landing page "Contact us" form.
// Saves the request to contact_requests; super admin sees them in /admin → Requests.
// Visitors never see the owner's email address.

const clean = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

export async function POST(request: Request) {
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  // Honeypot: real visitors never see or fill this field; bots usually do.
  if (clean(body.website, 200)) return NextResponse.json({ success: true })

  const name = clean(body.name, 100)
  const email = clean(body.email, 200)
  const phone = clean(body.phone, 30)
  const business = clean(body.business, 150)
  const message = clean(body.message, 2000)

  if (!name) return NextResponse.json({ error: 'Enter your name' }, { status: 400 })
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'Enter a valid email so we can reply' }, { status: 400 })
  }
  // Phone is required for follow-up; accept any format with 7–15 digits (India, US, with +, spaces or dashes)
  const phoneDigits = phone.replace(/\D/g, '')
  if (phoneDigits.length < 7 || phoneDigits.length > 15) {
    return NextResponse.json({ error: 'Enter your phone number so we can follow up' }, { status: 400 })
  }

  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const { error } = await supabaseAdmin.from('contact_requests').insert({
    name,
    email,
    phone,
    business: business || null,
    message: message || null,
  })

  if (error) {
    console.error('Contact request insert error:', error)
    return NextResponse.json({ error: 'Could not send right now. Please try again in a minute.' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}

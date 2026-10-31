'use client'

import { useState, useEffect, useSyncExternalStore, Suspense } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter, useSearchParams } from 'next/navigation'
import { tenantSlugFromHost } from '@/lib/tenant'
import { bannerFor, taglineFor, bannerShowsBranding } from '@/lib/login-branding'

const COACH_OFF_MESSAGE = 'Your coach login is turned off. Ask the gym owner.'
// The address and the remembered gym don't change while the page is open, so nothing to subscribe to
const noSubscribe = () => () => {}

// The gym of the last login on this device, so the login screen stays branded in an app installed
// from getcoachboard.com (no gym in the address). Kept after logout; replaced by the next login's gym.
const REMEMBERED_GYM_KEY = 'coachboard-gym'
const readRememberedGym = () => { try { return localStorage.getItem(REMEMBERED_GYM_KEY) } catch { return null } }
const rememberGym = (slug: string) => { try { localStorage.setItem(REMEMBERED_GYM_KEY, slug) } catch { /* private mode */ } }
const otherGymMessage = (gym: string | undefined) =>
  `This login isn't part of ${gym || 'this gym'}. Use your own gym's link, or sign in at getcoachboard.com/login.`

type CompanyBranding = {
  name: string
  logo_url: string | null
  banner_url: string | null
  business_type: string | null
  banner_has_branding?: boolean | null // absent until db/2026-10-31-banner-branding.md runs
}

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const coachOff = searchParams.get('off') === 'coach'
  const otherGym = searchParams.get('off') === 'gym'
  // Which gym's branding to show: the address (syedfitness.getcoachboard.com), else a ?company=<slug>
  // link, else the gym of the last login on this device. null while pre-rendering (no window there).
  const hostSlug = useSyncExternalStore(noSubscribe, () => tenantSlugFromHost(window.location.host), () => null)
  const rememberedSlug = useSyncExternalStore(noSubscribe, readRememberedGym, () => null)
  const companySlug = hostSlug || searchParams.get('company') || rememberedSlug

  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [branding, setBranding] = useState<CompanyBranding | null>(null)
  const [loadedSlug, setLoadedSlug] = useState<string | null>(null) // branding lookup finished for this slug
  const [tried, setTried] = useState(false) // a sign-in was attempted: the ?off=gym note has done its job

  // Sent here by proxy.ts because this coach login was turned off: end the open session
  useEffect(() => {
    if (coachOff) {
      supabase.auth.signOut()
      setError(COACH_OFF_MESSAGE)
    }
  }, [coachOff])

  // Sent here by proxy.ts because this login belongs to another gym than this address
  useEffect(() => {
    if (otherGym) supabase.auth.signOut()
  }, [otherGym])
  const shownError = error || (otherGym && !tried ? otherGymMessage(branding?.name) : '')

  useEffect(() => {
    if (!companySlug) return
    const fetchBranding = async (slug: string) => {
      // Logged-out visitors can't read companies; get_company_branding returns only the branding
      // columns of this one gym (db/2026-10-31-company-branding-rpc.md)
      let { data, error } = await supabase
        .rpc('get_company_branding', { p_slug: slug })
        .returns<CompanyBranding[]>()
        .maybeSingle<CompanyBranding>()
      // Function not created yet (Step 1 not run): read the table as before
      if (error && (error.code === 'PGRST202' || error.code === '42883')) {
        const columns = 'name, logo_url, banner_url, business_type'
        ;({ data, error } = await supabase.from('companies').select<string, CompanyBranding>(`${columns}, banner_has_branding`).eq('slug', slug).maybeSingle())
        if (error && (error.code === '42703' || error.code === '42501')) {
          ({ data, error } = await supabase.from('companies').select<string, CompanyBranding>(columns).eq('slug', slug).maybeSingle())
        }
      }
      if (error) console.error('Branding lookup failed:', error.message)
      setBranding(data ?? null)
      setLoadedSlug(slug)
    }
    fetchBranding(companySlug)
  }, [companySlug])

  const getBannerUrl = () => bannerFor(branding)
  const getTagline = () => taglineFor(branding)

  // Gym known but its branding still loading: show nothing yet rather than flash "CoachBoard"
  const brandingPending = !!companySlug && loadedSlug !== companySlug
  const gymName = branding?.name || (brandingPending ? '' : 'CoachBoard')
  const gymInitial = (branding?.name?.trim()[0] || 'C').toUpperCase()
  const bannerOnly = bannerShowsBranding(branding) // banner already has the name / logo: show it alone

  // The gym's logo, or its first letter on an orange tile
  const gymMark = (size: 'md' | 'lg', extra = '') => {
    if (brandingPending) return <div className={`${size === 'lg' ? 'w-14 h-14' : 'w-12 h-12'} rounded-2xl bg-gray-800/60 ${extra}`} />
    if (branding?.logo_url) return <img src={branding.logo_url} alt={branding.name} className={`${size === 'lg' ? 'h-14' : 'h-12'} max-w-[70%] object-contain ${extra}`} />
    return (
      <div className={`${size === 'lg' ? 'w-14 h-14 text-2xl' : 'w-12 h-12 text-xl'} bg-orange-500 rounded-2xl flex items-center justify-center text-white font-bold ${extra}`}>
        {gymInitial}
      </div>
    )
  }

  const toEmail = (input: string) => {
    const cleaned = input.trim()
    if (/^\d{10}$/.test(cleaned)) {
      return `${cleaned}@getcoachboard.in`
    }
    return cleaned
  }

  const handleLogin = async () => {
    setLoading(true)
    setError('')
    setTried(true)

    const { data, error } = await supabase.auth.signInWithPassword({ email: toEmail(identifier), password })

    if (error) {
      // A turned-off coach is banned in Supabase Auth (set-coach-active)
      setError(/banned/i.test(error.message) ? COACH_OFF_MESSAGE : error.message)
      setLoading(false)
      return
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('role, archived_at, company_id')
      .eq('id', data.user.id)
      .single()

    if (!profile) {
      setError('No profile found. Contact administrator.')
      setLoading(false)
      return
    }

    // On a gym's own address, only that gym's logins (and super admin) get in
    if (profile.role !== 'super_admin') {
      const { data: own } = await supabase.from('companies').select('slug').eq('id', profile.company_id).maybeSingle()
      if (hostSlug && own?.slug !== hostSlug) {
        await supabase.auth.signOut()
        setError(otherGymMessage(branding?.name))
        setLoading(false)
        return
      }
      // Next time this device opens the login (even from getcoachboard.com), show this gym
      if (own?.slug) rememberGym(own.slug)
    }

    if (profile.role === 'super_admin') router.push('/admin')
    else if (profile.role === 'company_admin' || profile.role === 'partner') router.push('/company')
    else if (profile.role === 'coach') {
      if (profile.archived_at) {
        await supabase.auth.signOut()
        setError(COACH_OFF_MESSAGE)
        setLoading(false)
        return
      }
      router.push('/coach')
    }
    else router.push('/client')
  }

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-gray-950">
      {/* Phones — a finished banner design (own name / logo), shown whole */}
      {bannerOnly && (
        <div className="md:hidden relative shrink-0 bg-gray-950">
          <img src={branding!.banner_url!} alt={gymName} className="w-full h-auto block" />
          <div className="absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-gray-950 to-transparent" />
          <h1 className="sr-only">{gymName}</h1>
        </div>
      )}

      {/* Phones — the gym's banner across the top, with logo, name and tagline */}
      {!bannerOnly && <div
        className="md:hidden relative h-64 shrink-0 bg-gray-900"
        style={brandingPending ? undefined : {
          backgroundImage: `url('${getBannerUrl()}')`,
          backgroundSize: 'cover',
          backgroundPosition: 'center'
        }}>
        <div className="absolute inset-0 bg-gradient-to-t from-gray-950 via-black/60 to-black/30" />
        <div className="relative z-10 h-full flex flex-col justify-end px-6 pb-5 text-white">
          {gymMark('lg', 'mb-3 self-start')}
          <h1 className="text-3xl font-bold leading-tight min-h-9">{gymName}</h1>
          <p className="text-gray-300 text-sm mt-1 min-h-5">{brandingPending ? '' : getTagline()}</p>
        </div>
      </div>}

      {/* Left side (tablet / desktop) — a finished banner design, uncropped */}
      {bannerOnly && (
        <div className="hidden md:flex md:w-1/2 items-center justify-center bg-gray-950 p-10">
          <img src={branding!.banner_url!} alt={gymName} className="max-w-full max-h-[80vh] object-contain rounded-2xl" />
        </div>
      )}

      {/* Left side — Banner (tablet / desktop) */}
      {!bannerOnly && <div
        className="hidden md:flex md:w-1/2 relative bg-gray-900"
        style={{
          backgroundImage: `url('${getBannerUrl()}')`,
          backgroundSize: 'cover',
          backgroundPosition: 'center'
        }}>
        <div className="absolute inset-0 bg-black opacity-55" />
        <div className="relative z-10 flex flex-col justify-end p-10 text-white w-full">
          <div className="mb-6">
            {gymMark('md', 'mb-4')}
            <h2 className="text-3xl font-bold mb-2">
              {gymName}
            </h2>
            <p className="text-gray-300 text-sm">{getTagline()}</p>
          </div>
          <div className="text-xs text-gray-400">Powered by CoachBoard</div>
        </div>
      </div>}

      {/* Right side — Login form */}
      <div className="w-full md:w-1/2 flex-1 bg-gray-950 flex items-start md:items-center justify-center px-6 pt-2 pb-8 md:p-8">
        <div className="w-full max-w-sm">
          <div className="hidden md:block text-center mb-8">
            {gymMark('lg', 'mx-auto mb-4')}
            <h1 className="text-2xl font-bold text-white min-h-8">
              {gymName}
            </h1>
            <p className="text-gray-500 text-sm mt-1">Sign in to your account</p>
          </div>
          <p className="md:hidden text-gray-400 text-sm mb-4">Sign in to your account</p>

          <div className="bg-gray-900 rounded-2xl p-6 border border-gray-800 space-y-4">
            <div>
              <label className="text-xs font-medium text-gray-400 mb-1.5 block uppercase tracking-wider">Phone or Email</label>
              <input
                type="text"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                className="w-full bg-gray-800 text-white rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm placeholder-gray-600"
                placeholder="9999999999 or you@example.com"
              />
            </div>

            <div>
              <label className="text-xs font-medium text-gray-400 mb-1.5 block uppercase tracking-wider">Password</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                  className="w-full bg-gray-800 text-white rounded-xl px-4 py-3 pr-10 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm placeholder-gray-600"
                  placeholder="••••••••"
                />
                <button type="button" onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition">
                  {showPassword
                    ? <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" /></svg>
                    : <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                  }
                </button>
              </div>
            </div>

            {shownError && (
              <div className="bg-red-950 border border-red-800 rounded-xl px-4 py-3">
                <p className="text-red-400 text-sm">{shownError}</p>
              </div>
            )}

            <button
              onClick={handleLogin}
              disabled={loading}
              className="w-full bg-orange-500 hover:bg-orange-400 text-white font-semibold py-3 rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed text-sm">
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </div>

          <p className="text-center text-gray-600 text-xs mt-6">
            Powered by CoachBoard
          </p>
        </div>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <p className="text-gray-400">Loading...</p>
      </div>
    }>
      <LoginForm />
    </Suspense>
  )
}
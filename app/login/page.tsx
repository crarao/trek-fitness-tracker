'use client'

import { useState, useEffect, Suspense } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter, useSearchParams } from 'next/navigation'

const defaultBanners: Record<string, string> = {
  gym: 'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=1200&q=80',
  pilates: 'https://images.unsplash.com/photo-1518611012118-696072aa579a?w=1200&q=80',
  yoga: 'https://images.unsplash.com/photo-1588286840104-8957b019727f?w=1200&q=80',
  trek: 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=1200&q=80',
  cycling: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=1200&q=80',
  general: 'https://images.unsplash.com/photo-1571902943202-507ec2618e8f?w=1200&q=80'
}

const defaultTaglines: Record<string, string> = {
  gym: 'Real Training. Real Results.',
  pilates: 'Strength From Within.',
  yoga: 'Find Your Balance.',
  trek: 'Every Summit Begins With A Single Step.',
  cycling: 'Push Your Limits.',
  general: 'Achieve Your Goals.'
}

type CompanyBranding = {
  name: string
  logo_url: string | null
  banner_url: string | null
  business_type: string | null
}

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const companySlug = searchParams.get('company')

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [branding, setBranding] = useState<CompanyBranding | null>(null)

  useEffect(() => {
    if (companySlug) {
      fetchBranding(companySlug)
    }
  }, [companySlug])

const fetchBranding = async (slug: string) => {
    console.log('Fetching branding for:', slug)
    const { data, error } = await supabase
      .from('companies')
      .select('name, logo_url, banner_url, business_type')
      .eq('slug', slug)
      .single()
    console.log('Branding data:', data, 'Error:', error)
    if (data) setBranding(data)
  }

  const getBannerUrl = () => {
    if (branding?.banner_url) return branding.banner_url
    const type = branding?.business_type || 'general'
    return defaultBanners[type] || defaultBanners.general
  }

  const getTagline = () => {
    const type = branding?.business_type || 'general'
    return defaultTaglines[type] || defaultTaglines.general
  }

  const handleLogin = async () => {
    setLoading(true)
    setError('')

    const { data, error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', data.user.id)
      .single()

    if (!profile) {
      setError('No profile found. Contact administrator.')
      setLoading(false)
      return
    }

    if (profile.role === 'super_admin') router.push('/admin')
    else if (profile.role === 'company_admin') router.push('/company')
    else router.push('/client')
  }

  return (
    <div className="min-h-screen flex">
      {/* Left side — Banner */}
      <div
        className="hidden md:flex md:w-1/2 relative bg-gray-900"
        style={{
          backgroundImage: `url('${getBannerUrl()}')`,
          backgroundSize: 'cover',
          backgroundPosition: 'center'
        }}>
        <div className="absolute inset-0 bg-black opacity-55" />
        <div className="relative z-10 flex flex-col justify-end p-10 text-white w-full">
          <div className="mb-6">
            {branding?.logo_url ? (
              <img
                src={branding.logo_url}
                alt={branding.name}
                className="h-12 mb-4 object-contain"
              />
            ) : (
              <div className="w-12 h-12 bg-orange-500 rounded-xl flex items-center justify-center mb-4">
                <span className="text-white text-xl font-bold">
                  {branding?.name?.[0] || 'C'}
                </span>
              </div>
            )}
            <h2 className="text-3xl font-bold mb-2">
              {branding?.name || 'CoachBoard'}
            </h2>
            <p className="text-gray-300 text-sm">{getTagline()}</p>
          </div>
          <div className="text-xs text-gray-400">Powered by CoachBoard</div>
        </div>
      </div>

      {/* Right side — Login form */}
      <div className="w-full md:w-1/2 bg-gray-950 flex items-center justify-center p-8">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            {branding?.logo_url ? (
              <img
                src={branding.logo_url}
                alt={branding.name}
                className="h-12 mx-auto mb-4 object-contain"
              />
            ) : (
              <div className="inline-flex items-center justify-center w-14 h-14 bg-orange-500 rounded-2xl mb-4">
                <span className="text-white text-2xl font-bold">C</span>
              </div>
            )}
            <h1 className="text-2xl font-bold text-white">
              {branding?.name || 'CoachBoard'}
            </h1>
            <p className="text-gray-500 text-sm mt-1">Sign in to your account</p>
          </div>

          <div className="bg-gray-900 rounded-2xl p-6 border border-gray-800 space-y-4">
            <div>
              <label className="text-xs font-medium text-gray-400 mb-1.5 block uppercase tracking-wider">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                className="w-full bg-gray-800 text-white rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm placeholder-gray-600"
                placeholder="you@example.com"
              />
            </div>

            <div>
              <label className="text-xs font-medium text-gray-400 mb-1.5 block uppercase tracking-wider">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                className="w-full bg-gray-800 text-white rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-orange-500 border border-gray-700 text-sm placeholder-gray-600"
                placeholder="••••••••"
              />
            </div>

            {error && (
              <div className="bg-red-950 border border-red-800 rounded-xl px-4 py-3">
                <p className="text-red-400 text-sm">{error}</p>
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
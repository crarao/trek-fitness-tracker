'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

export default function DashboardPage() {
  const router = useRouter()

  useEffect(() => {
    const redirect = async () => {
      const { data: { user } } = await supabase.auth.getUser()

      if (!user) {
        router.push('/login')
        return
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('role, archived_at')
        .eq('id', user.id)
        .single()

      if (!profile) {
        router.push('/login')
        return
      }

      if (profile.role === 'super_admin') router.push('/admin')
      else if (profile.role === 'company_admin' || profile.role === 'partner') router.push('/company')
      else if (profile.role === 'coach') router.push(profile.archived_at ? '/login?off=coach' : '/coach')
      else router.push('/client')
    }

    redirect()
  }, [router])

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <p className="text-white text-lg">Loading...</p>
    </div>
  )
}
'use client'

// Slim bar at the top of every inner screen (12 Nov): Home in one tap from any depth, and Log out.
// Each page keeps its own "← Back" (one level up). Home goes to /dashboard, which sends each role to its own home
// (owner / partner → /company, sensei / coach → /coach). Shared because every inner page needs the same control.

import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

export default function PageNav() {
  const router = useRouter()
  const logout = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }
  return (
    <nav aria-label="Home and log out" data-testid="page-nav"
      className="bg-gray-950 border-b border-gray-900 px-4 sm:px-8 py-1.5 flex items-center justify-between text-xs">
      <button type="button" data-nav onClick={() => router.push('/dashboard')}
        className="flex items-center gap-1.5 text-gray-400 hover:text-white px-2 py-1.5 -ml-2 rounded-lg">
        <span aria-hidden="true">⌂</span> Home
      </button>
      <button type="button" onClick={logout} className="text-gray-500 hover:text-white px-2 py-1.5 -mr-2 rounded-lg">
        Log out
      </button>
    </nav>
  )
}

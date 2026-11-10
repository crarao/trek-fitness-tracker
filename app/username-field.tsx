'use client'

// Client username box (Add member, Create login): checks the rules as you type (lib/phone.ts usernameProblem), asks
// /api/check-username whether it's free in any gym, and offers free usernames from the client's name to tap.
// Shared because two pages need the same control (see CLAUDE.md → Component structure).

import { useEffect, useState } from 'react'
import { normalizeUsername, usernameProblem } from '@/lib/phone'

export type UsernameStatus = 'empty' | 'checking' | 'free' | 'taken' | 'invalid' | 'error'

export default function UsernameField({ value, onChange, fullName, onStatus, placeholder = 'Username' }: {
  value: string
  onChange: (v: string) => void
  fullName: string
  onStatus?: (s: UsernameStatus) => void
  placeholder?: string
}) {
  const [status, setStatus] = useState<UsernameStatus>('empty')
  const [suggestions, setSuggestions] = useState<string[]>([])
  const u = normalizeUsername(value)
  const problem = u ? usernameProblem(u) : null

  useEffect(() => {
    let live = true
    const set = (s: UsernameStatus) => { if (live) { setStatus(s); onStatus?.(s) } }
    if (problem) { set('invalid'); return () => { live = false } }
    if (!u && !fullName.trim()) { set('empty'); setSuggestions([]); return () => { live = false } }
    if (u) set('checking')
    const t = setTimeout(async () => {
      try {
        const res = await fetch('/api/check-username', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: u, full_name: fullName }),
        })
        const r = await res.json()
        if (!live) return
        if (!res.ok || r.error) { set(u ? 'error' : 'empty'); return }
        setSuggestions(r.suggestions || [])
        set(!u ? 'empty' : r.available ? 'free' : 'taken')
      } catch { set(u ? 'error' : 'empty') }
    }, 450)
    return () => { live = false; clearTimeout(t) }
    // onStatus is a callback from the parent; re-running on its identity would re-check on every render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [u, fullName, problem])

  return (
    <div className="space-y-1.5">
      <input type="text" placeholder={placeholder} aria-label="Username" value={value}
        autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="off"
        onChange={e => onChange(e.target.value.toLowerCase().replace(/\s+/g, ''))}
        className={`w-full bg-gray-800 text-white rounded-lg px-4 py-2.5 outline-none focus:ring-2 focus:ring-white border text-sm placeholder-gray-600 ${status === 'taken' || status === 'invalid' ? 'border-red-800' : status === 'free' ? 'border-green-800' : 'border-gray-700'}`} />
      <p className="text-xs min-h-4">
        {status === 'invalid' && <span className="text-red-400">{problem}</span>}
        {status === 'checking' && <span className="text-gray-500">Checking…</span>}
        {status === 'free' && <span className="text-green-400">✓ {u} is free</span>}
        {status === 'taken' && <span className="text-red-400">{u} is taken</span>}
        {status === 'error' && <span className="text-amber-400">Couldn&apos;t check right now. It&apos;s checked again when you save.</span>}
      </p>
      {suggestions.length > 0 && status !== 'free' && (
        <div className="flex flex-wrap gap-1.5">
          <span className="text-[11px] text-gray-500 self-center">{u ? 'Try:' : 'Ideas:'}</span>
          {suggestions.map(sg => (
            <button key={sg} type="button" onClick={() => onChange(sg)}
              className="text-xs px-2.5 py-1 rounded-full border border-gray-700 bg-gray-900 text-gray-200 hover:border-gray-500">
              {sg}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

'use client'

// Shared because the plan day's set rows (app/company/client/[id]) and the plan builder's per-set targets
// (app/plan-editor.tsx) need the same box.

import { useState } from 'react'
import { numberFromInput } from '@/lib/exercise-logs'

// A number box for a set's kg / reps (17 Nov). Keeps what is typed ("12." on the way to "12.5") and
// reports the number on every key, so the Save bar summary follows live; shows the saved value again
// whenever it changes from outside (prefill loaded, a row removed above) while the box isn't being typed in.
export default function NumBox({ value, kind, label, onValue, className, placeholder }: {
  value: number | null
  kind: 'reps' | 'weight'
  label: string
  onValue: (n: number | null) => void
  className: string
  placeholder?: string
}) {
  const fmt = (v: number | null) => (v == null ? '' : String(v))
  const [text, setText] = useState(fmt(value))
  const [shown, setShown] = useState(value)
  const [typing, setTyping] = useState(false)
  if (!typing && value !== shown) { setShown(value); setText(fmt(value)) }
  return (
    <input type="text" inputMode={kind === 'weight' ? 'decimal' : 'numeric'} aria-label={label} placeholder={placeholder}
      className={className} value={text}
      onFocus={() => setTyping(true)}
      onBlur={() => { setTyping(false); setText(fmt(value)); setShown(value) }}
      onChange={ev => {
        const n = numberFromInput(ev.target.value, kind)
        setText(ev.target.value)
        setShown(n)
        onValue(n)
      }} />
  )
}

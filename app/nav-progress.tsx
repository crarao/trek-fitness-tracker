'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'

// Thin orange bar at the top of the screen while the app moves to another page.
// Starts when a button marked data-nav, or a link to another page on this site, is tapped;
// disappears as soon as the new page's address is shown (or after 12 s as a safety net).
export default function NavProgress() {
  const pathname = usePathname()
  // The page we were on when navigation started; the bar shows only while we're still there
  const [startedOn, setStartedOn] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // When the address changes, forget the old start (so returning later doesn't re-show the bar)
  const [prevPath, setPrevPath] = useState(pathname)
  if (pathname !== prevPath) {
    setPrevPath(pathname)
    setStartedOn(null)
  }

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return
      // The nearest tappable thing decides: a button inside a data-nav row (e.g. Remind) doesn't count
      const el = (e.target as HTMLElement | null)?.closest('button, a[href], [data-nav]') as HTMLElement | null
      if (!el || el.hasAttribute('disabled')) return
      if (el.tagName === 'A') {
        const a = el as HTMLAnchorElement
        if (a.target === '_blank' || a.hasAttribute('download')) return
        const url = new URL(a.href, window.location.href)
        if (url.origin !== window.location.origin || url.pathname === window.location.pathname) return
      } else if (!el.hasAttribute('data-nav')) {
        return
      }
      setStartedOn(window.location.pathname)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => setStartedOn(null), 12000)
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [])

  if (startedOn === null) return null
  return (
    <div className="fixed inset-x-0 top-0 z-[70] h-1 overflow-hidden bg-orange-500/20 pointer-events-none" role="progressbar" aria-label="Loading page">
      <div className="cb-nav-bar h-full w-1/3 bg-orange-500" />
    </div>
  )
}

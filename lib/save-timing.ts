// Timing of "Save session" on the client page (18 Nov: a save took ~7 s on a phone).
// Off by default. Turn it on with DEBUG_SAVE = true here, or on one phone without a rebuild:
//   localStorage.setItem('cb-debug-save', '1')   (remove the key to turn it off again)
// When on, each step is logged to the console ("[save] session insert 412 ms (total 640 ms)")
// and the "✓ Session saved" toast ends with the total time, so it can be read on the phone itself.
export const DEBUG_SAVE = false

const STORAGE_KEY = 'cb-debug-save'

export function saveTimingOn(): boolean {
  if (DEBUG_SAVE) return true
  try { return typeof window !== 'undefined' && localStorage.getItem(STORAGE_KEY) === '1' } catch { return false }
}

export type SaveTimer = {
  on: boolean
  // Marks the end of a step: logs how long since the previous mark
  step: (name: string) => void
  // Milliseconds since the timer started
  total: () => number
  // " (0.84 s)" when on, '' when off: added to the toast
  suffix: () => string
}

export function startSaveTimer(label = 'save'): SaveTimer {
  const on = saveTimingOn()
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())
  const t0 = now()
  let last = t0
  return {
    on,
    step: (name: string) => {
      if (!on) return
      const t = now()
      console.info(`[${label}] ${name} ${Math.round(t - last)} ms (total ${Math.round(t - t0)} ms)`)
      last = t
    },
    total: () => Math.round(now() - t0),
    suffix: () => (on ? ` (${((now() - t0) / 1000).toFixed(2)} s)` : ''),
  }
}

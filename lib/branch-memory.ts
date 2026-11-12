// The branch chip a person last picked, remembered on this phone (decision 12 Nov, option 2a): screens with branch
// chips (dashboard, Attendance month, All of today, grading exam) open on it next time. Nobody is limited to a branch:
// the other chips are one tap away. One key for all those screens; a saved branch is used only when it is an active
// branch of the gym being shown (branch ids are unique, so a phone used for two gyms never mixes them up).
// localStorage only (a per-device convenience); every read / write is wrapped, so private mode just means "All".

const KEY = 'coachboard-branch-chip'

export function rememberBranch(id: string): void {
  try { localStorage.setItem(KEY, id) } catch { /* storage unavailable */ }
}

// The chip to start on: the remembered branch when it's one of these active branches, else 'all'.
// Only with 2+ active branches: with one branch the chips are hidden, so a saved filter couldn't be cleared.
export function rememberedBranch(branches: { id: string; is_archived?: boolean | null }[]): string {
  const active = branches.filter(b => !b.is_archived)
  if (active.length < 2) return 'all'
  let saved: string | null = null
  try { saved = localStorage.getItem(KEY) } catch { /* storage unavailable */ }
  return saved && active.some(b => b.id === saved) ? saved : 'all'
}

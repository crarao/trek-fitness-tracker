'use client'

// Belt chip (belt grading Phase 2, PR A): a small circle in the belt's colour + "8 kyu" ("White" for White).
// Shared by the student list, sensei home, roll call, All of today and the student page header.
// Pages load the gym's belt_ranks once (beltsById in lib/belts.ts) and pass the student's belt; never one query per student.

import { type BeltRank, beltChipText, beltLabel, isLightBelt } from '@/lib/belts'

type Props = {
  rank: BeltRank | null | undefined
  // Show a faint "No belt" when the student has none (only where there is room); default: nothing
  showNone?: boolean
  size?: 'sm' | 'md'
}

export default function BeltChip({ rank, showNone = false, size = 'sm' }: Props) {
  const text = size === 'md' ? 'text-xs' : 'text-[11px]'
  if (!rank) {
    return showNone
      ? <span data-testid="belt-chip-none" className={`${text} text-gray-600 leading-none whitespace-nowrap`}>No belt</span>
      : null
  }
  const dot = size === 'md' ? 'w-3 h-3' : 'w-2.5 h-2.5'
  return (
    <span data-testid="belt-chip" title={beltLabel(rank)} aria-label={`Belt: ${beltLabel(rank)}`}
      className={`inline-flex items-center gap-1 ${text} text-gray-300 leading-none whitespace-nowrap`}>
      <span aria-hidden="true"
        className={`${dot} rounded-full flex-shrink-0 ${isLightBelt(rank.color_hex) ? 'ring-1 ring-gray-400' : 'ring-1 ring-white/20'}`}
        style={{ backgroundColor: rank.color_hex || '#FFFFFF' }} />
      {beltChipText(rank)}
    </span>
  )
}

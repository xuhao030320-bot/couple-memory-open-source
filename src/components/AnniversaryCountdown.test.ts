import { describe, expect, it } from 'vitest'
import { getAnniversaryOccurrence } from '../features/anniversaries/anniversary'
import type { AnniversaryEntry } from '../types'
import { anniversaryCycleProgress } from './AnniversaryCountdown'

const anniversary: AnniversaryEntry = {
  id: 'anniversary-progress',
  title: '我们在一起',
  date: '2023-10-19',
  repeatsYearly: true,
  kind: 'love',
  note: '',
  createdAt: '2023-10-19T00:00:00Z',
}

function progress(entry: AnniversaryEntry, today: Date) {
  const occurrence = getAnniversaryOccurrence(entry, today)
  if (!occurrence) throw new Error('This fixture must have an upcoming occurrence')
  return anniversaryCycleProgress(occurrence)
}

describe('anniversary cycle progress', () => {
  it('uses the real interval from the previous anniversary, including leap years', () => {
    // The 2023-10-19 to 2024-10-19 cycle includes February 29.
    expect(progress(anniversary, new Date(2024, 9, 18))).toBeCloseTo(365 / 366)
    expect(progress(anniversary, new Date(2024, 9, 19))).toBe(1)
    expect(progress(anniversary, new Date(2024, 9, 20))).toBeCloseTo(1 / 365)
  })

  it('preserves the existing February 29 occurrence rule in both yearly boundaries', () => {
    const leapAnniversary = { ...anniversary, date: '2024-02-29' }
    expect(progress(leapAnniversary, new Date(2025, 1, 27))).toBeCloseTo(364 / 365)
    expect(progress(leapAnniversary, new Date(2025, 1, 28))).toBe(1)
    expect(progress(leapAnniversary, new Date(2028, 1, 28))).toBeCloseTo(365 / 366)
  })

  it('does not invent a full cycle for a first occurrence or a one-time event', () => {
    expect(progress({ ...anniversary, date: '2028-10-19' }, new Date(2026, 9, 19))).toBeNull()
    expect(progress({ ...anniversary, date: '2026-10-20', repeatsYearly: false }, new Date(2026, 9, 19))).toBeNull()
    expect(progress({ ...anniversary, date: '2026-10-19', repeatsYearly: false }, new Date(2026, 9, 19))).toBeNull()
  })
})

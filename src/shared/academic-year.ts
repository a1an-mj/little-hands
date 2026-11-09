// The academic year is worked out from dates, never stored, so confirming it with the owner
// (still pending, see CLAUDE.md) only means changing this constant.

/** Month the academic year starts (1 = January). Assumed June until the owner confirms. */
export const ACADEMIC_YEAR_START_MONTH: number = 6

/** "2026-11-02" → "2026–27"; "2027-03-10" → "2026–27". */
export function academicYearOf(iso: string): string {
  const y = Number(iso.slice(0, 4))
  const m = Number(iso.slice(5, 7))
  const start = m >= ACADEMIC_YEAR_START_MONTH ? y : y - 1
  if (ACADEMIC_YEAR_START_MONTH === 1) return String(start)
  return `${start}–${String((start + 1) % 100).padStart(2, '0')}`
}

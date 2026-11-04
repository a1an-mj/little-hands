/** Readable student ID: LH-<joining year>-<sequence, at least 3 digits>, e.g. LH-2026-065. */
export function formatStudentCode(year: number, seq: number): string {
  return `LH-${year}-${String(seq).padStart(3, '0')}`
}

export function yearOf(isoDate: string): number {
  return Number(isoDate.slice(0, 4))
}

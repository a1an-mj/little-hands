// Dates are stored as "YYYY-MM-DD" and shown the Indian way: "3 Jun 2026".

const short = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
const long = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })

const asUtc = (iso: string) => new Date(iso + 'T00:00:00Z')

export const formatDate = (iso: string) => short.format(asUtc(iso))
export const formatDateLong = (iso: string) => long.format(asUtc(iso))

/** The date on this laptop's calendar (not UTC), as "YYYY-MM-DD". */
export function localIsoDate(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** Monday = 0 … Sunday = 6. */
export function weekdayOf(iso: string): number {
  return (asUtc(iso).getUTCDay() + 6) % 7
}

/** The time on this laptop's clock, as "HH:MM". */
export function localTime(d: Date = new Date()): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** "Mon 2 Nov" (short, for lists of days). */
export function formatDayShort(iso: string): string {
  const d = asUtc(iso)
  return `${dayShort.format(d)} ${d.getUTCDate()} ${monShort.format(d)}`
}
const dayShort = new Intl.DateTimeFormat('en-IN', { weekday: 'short', timeZone: 'UTC' })
const monShort = new Intl.DateTimeFormat('en-IN', { month: 'short', timeZone: 'UTC' })

/** "Monday, 2 November" */
export function formatDayLong(iso: string): string {
  return new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(asUtc(iso))
}

/** The ISO date n days before. */
export function addDays(iso: string, n: number): string {
  const d = asUtc(iso)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

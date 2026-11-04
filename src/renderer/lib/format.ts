// Display helpers. Dates are stored as "YYYY-MM-DD" and shown the Indian way: "3 Jun 2026".

const short = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
const long = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })

const asUtc = (iso: string) => new Date(iso + 'T00:00:00Z')

export const formatDate = (iso: string) => short.format(asUtc(iso))
export const formatDateLong = (iso: string) => long.format(asUtc(iso))

/** Today's date on this laptop, as "YYYY-MM-DD". */
export function todayIso(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const first = parts[0]?.[0] ?? ''
  const last = parts.length > 1 ? (parts.at(-1)?.[0] ?? '') : ''
  return (first + last).toUpperCase()
}

export const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`

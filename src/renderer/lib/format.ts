// Display helpers. Date formatting lives in @shared/dates so the main process words dates the same way.
import { formatDate, formatDateLong, localIsoDate } from '@shared/dates'

export { formatDate, formatDateLong }

/** Today's date on this laptop, as "YYYY-MM-DD". */
export const todayIso = (): string => localIsoDate()

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const first = parts[0]?.[0] ?? ''
  const last = parts.length > 1 ? (parts.at(-1)?.[0] ?? '') : ''
  return (first + last).toUpperCase()
}

export const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`

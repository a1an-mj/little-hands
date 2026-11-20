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

/** "5 years" (on `on`, default today); empty if no date of birth. */
export function ageText(dob: string | null, on: string = todayIso()): string {
  if (!dob || !/^\d{4}-\d{2}-\d{2}$/.test(dob)) return ''
  let years = Number(on.slice(0, 4)) - Number(dob.slice(0, 4))
  if (on.slice(5) < dob.slice(5)) years--
  if (years < 0) return ''
  if (years === 0) {
    const months = (Number(on.slice(0, 4)) * 12 + Number(on.slice(5, 7))) - (Number(dob.slice(0, 4)) * 12 + Number(dob.slice(5, 7))) - (on.slice(8) < dob.slice(8) ? 1 : 0)
    return `${Math.max(0, months)} month${months === 1 ? '' : 's'}`
  }
  return `${years} year${years === 1 ? '' : 's'}`
}

// Timings and fees are versioned: each version applies from its date until the next one starts.

export interface Versioned {
  effectiveFrom: string
}

/** The version that applies on `date` (list sorted oldest first), or undefined before the first one. */
export function versionOn<T extends Versioned>(sorted: readonly T[], date: string): T | undefined {
  let found: T | undefined
  for (const v of sorted) {
    if (v.effectiveFrom <= date) found = v
    else break
  }
  return found
}

/** What to show today: the version in force (or the first one, if it hasn't started yet) and any later one. */
export function shownVersions<T extends Versioned>(sorted: readonly T[], today: string): { current: T; next: T | undefined } {
  const current = versionOn(sorted, today) ?? sorted[0]
  if (!current) throw new Error('No versions')
  const next = sorted.find((v) => v.effectiveFrom > current.effectiveFrom)
  return { current, next }
}

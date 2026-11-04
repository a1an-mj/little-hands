import { useCallback, useEffect, useRef, useState } from 'react'
import type { Result } from '@shared/students'

/** A message meant for the owner (e.g. "This is the main contact for fees…"). */
export class UserFacingError extends Error {}

/** Unwraps a `Result` from the main process, throwing `UserFacingError` for `{ ok: false }`. */
export async function call<T>(p: Promise<Result<T>>): Promise<T> {
  const r = await p
  if (!r.ok) throw new UserFacingError(r.message)
  return r.value
}

export function messageOf(err: unknown): string {
  return err instanceof UserFacingError ? err.message : 'Something went wrong. Please try again.'
}

/** Loads data and reloads when `deps` change. Keeps showing the last data while reloading. */
export function useLoad<T>(load: () => Promise<Result<T>>, deps: unknown[]) {
  const [data, setData] = useState<T | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const seq = useRef(0)

  const reload = useCallback(async () => {
    const mine = ++seq.current
    try {
      const value = await call(load())
      if (mine === seq.current) {
        setData(value)
        setError(null)
      }
    } catch (err) {
      if (mine === seq.current) setError(messageOf(err))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  useEffect(() => {
    void reload()
  }, [reload])

  return { data, error, reload }
}

import { ipcMain } from 'electron'
import { ZodError } from 'zod'
import type { Result } from '@shared/students'
import { UserError } from '../errors'
import type { LockSession } from '../lock/session'

export type Impl<Api> = { [K in keyof Api]: (...args: unknown[]) => Promise<unknown> | unknown }

/**
 * Registers `<prefix>:<method>` handlers. Every call checks the app is unlocked; owner-fixable
 * problems become `{ ok: false, message }`, anything else is a real error.
 */
export function handleAll<Api>(prefix: string, impl: Impl<Api>, session: LockSession): void {
  for (const [name, fn] of Object.entries(impl) as [string, (...args: unknown[]) => unknown][]) {
    ipcMain.handle(`${prefix}:${name}`, async (_e, ...args: unknown[]): Promise<Result<unknown>> => {
      session.requireUnlocked()
      session.activity()
      try {
        const value = await fn(...args)
        return { ok: true, value: value ?? undefined }
      } catch (err) {
        if (err instanceof UserError) return { ok: false, message: err.message }
        if (err instanceof ZodError) return { ok: false, message: err.issues[0]?.message ?? 'Please check the form.' }
        throw err
      }
    })
  }
}

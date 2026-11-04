import { BrowserWindow, ipcMain } from 'electron'
import { ZodError, z } from 'zod'
import type { StudentsApi } from '@shared/ipc-contract'
import { admissionSchema, idSchema, isoDateSchema, studentListQuerySchema } from '@shared/schemas'
import type { Result } from '@shared/students'
import type { LockSession } from '../lock/session'
import { jpegFromDataUrl, pickPhoto, toDataUrl } from '../students/photo'
import { UserError, type StudentsRepo } from '../students/repo'

// Guardian, note and detail inputs are validated inside the repository (it parses them itself).
type Impl = { [K in keyof StudentsApi]: (...args: unknown[]) => Promise<unknown> | unknown }

/**
 * Registers `students:<method>` handlers. Every call checks the app is unlocked and validates its
 * arguments; owner-fixable problems become `{ ok: false, message }`, anything else is a real error.
 */
export function registerStudentsIpc(repo: StudentsRepo, session: LockSession): void {
  const impl: Impl = {
    list: (q) => repo.list(studentListQuerySchema.parse(q)),
    nextCode: (date) => repo.nextCode(isoDateSchema.parse(date)),
    profile: (id) => repo.profile(idSchema.parse(id)),
    admit: (input) => {
      const a = admissionSchema.parse(input)
      return repo.admit(a, a.photo ? jpegFromDataUrl(a.photo) : null)
    },
    updateDetails: (id, input) => repo.updateDetails(idSchema.parse(id), input as never),
    remove: (id) => repo.remove(idSchema.parse(id)),
    pickPhoto: async () => {
      const jpeg = await pickPhoto(BrowserWindow.getFocusedWindow())
      return jpeg ? toDataUrl(jpeg) : null
    },
    setPhoto: (id, photo) => {
      const p = z.string().nullable().parse(photo)
      repo.setPhoto(idSchema.parse(id), p ? jpegFromDataUrl(p) : null)
    },
    addGuardian: (studentId, input) => repo.addGuardian(idSchema.parse(studentId), input as never),
    updateGuardian: (linkId, input) => repo.updateGuardian(idSchema.parse(linkId), input as never),
    setFeeContact: (linkId) => repo.setFeeContact(idSchema.parse(linkId)),
    removeGuardian: (linkId) => repo.removeGuardian(idSchema.parse(linkId)),
    addNote: (studentId, input) => repo.addNote(idSchema.parse(studentId), input as never),
    updateNote: (noteId, input) => repo.updateNote(idSchema.parse(noteId), input as never),
    removeNote: (noteId) => repo.removeNote(idSchema.parse(noteId))
  }

  for (const [name, fn] of Object.entries(impl)) {
    ipcMain.handle(`students:${name}`, async (_e, ...args: unknown[]): Promise<Result<unknown>> => {
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

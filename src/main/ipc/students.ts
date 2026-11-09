import { BrowserWindow } from 'electron'
import { z } from 'zod'
import type { StudentsApi } from '@shared/ipc-contract'
import { admissionSchema, idSchema, isoDateSchema, studentListQuerySchema } from '@shared/schemas'
import type { LockSession } from '../lock/session'
import { jpegFromDataUrl, pickPhoto, toDataUrl } from '../students/photo'
import type { StudentsRepo } from '../students/repo'
import { handleAll, type Impl } from './handle'

// Guardian, note and detail inputs are validated inside the repository (it parses them itself).

/** Registers `students:<method>` handlers (unlocked only; arguments validated). */
export function registerStudentsIpc(repo: StudentsRepo, session: LockSession): void {
  const impl: Impl<StudentsApi> = {
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

  handleAll('students', impl, session)
}

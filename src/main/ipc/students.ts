import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { BrowserWindow, dialog } from 'electron'
import { z } from 'zod'
import type { StudentsApi } from '@shared/ipc-contract'
import { parseCsv, planImport, type ImportPlanItem } from '@shared/import'
import { UserError } from '../errors'
import type { PlannerRepo } from '../planner/repo'
import { makesTodo, runImport } from '../students/import'
import { admissionSchema, idSchema, isoDateSchema, studentListQuerySchema } from '@shared/schemas'
import type { LockSession } from '../lock/session'
import { jpegFromDataUrl, pickPhoto, toDataUrl } from '../students/photo'
import type { StudentsRepo } from '../students/repo'
import { handleAll, type Impl } from './handle'

// Guardian, note and detail inputs are validated inside the repository (it parses them itself).

/** Registers `students:<method>` handlers (unlocked only; arguments validated). */
export function registerStudentsIpc(repo: StudentsRepo, planner: PlannerRepo, session: LockSession): void {
  let plan: ImportPlanItem[] | null = null
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
    removeNote: (noteId) => repo.removeNote(idSchema.parse(noteId)),
    importPreview: async () => {
      const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]!
      const r = await dialog.showOpenDialog(win, {
        title: 'Choose the students spreadsheet',
        filters: [{ name: 'Spreadsheet (CSV)', extensions: ['csv'] }],
        properties: ['openFile']
      })
      const path = r.canceled ? undefined : r.filePaths[0]
      if (!path) return null
      try {
        plan = planImport(parseCsv(readFileSync(path, 'utf8')), repo.existingNames())
      } catch (e) {
        throw new UserError(e instanceof Error ? e.message : String(e))
      }
      return { fileName: basename(path), rows: plan.map((r) => ({ line: r.line, name: r.name, programs: r.programs, siblingOf: r.siblingOf, skip: r.skip, hasTodo: makesTodo(r, repo, planner) })) }
    },
    importRun: () => {
      if (!plan) throw new UserError('Choose the spreadsheet first.')
      const result = runImport(repo, planner, plan)
      plan = null
      return result
    }
  }

  handleAll('students', impl, session)
}

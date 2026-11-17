import type { AttendanceApi } from '@shared/ipc-contract'
import { idSchema, isoDateSchema } from '@shared/schemas'
import type { AttendanceRepo } from '../attendance/repo'
import type { LockSession } from '../lock/session'
import { handleAll, type Impl } from './handle'

/** Registers `attendance:<method>` handlers. Inputs are validated inside the repository. */
export function registerAttendanceIpc(repo: AttendanceRepo, session: LockSession): void {
  const impl: Impl<AttendanceApi> = {
    day: (date) => (date === undefined || date === null ? repo.day() : repo.day(isoDateSchema.parse(date))),
    history: (studentId) => repo.history(idSchema.parse(studentId)),
    summary: () => repo.summary(),
    tap: (id, input) => repo.tap(idSchema.parse(id), input as never),
    undo: (eventId) => repo.undo(idSchema.parse(eventId)),
    setDay: (id, date, input) => repo.setDay(idSchema.parse(id), isoDateSchema.parse(date), input as never),
    setMany: (date, items) => repo.setMany(isoDateSchema.parse(date), items as never)
  }
  handleAll('attendance', impl, session)
}

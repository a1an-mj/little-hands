import type { EnrollmentsApi } from '@shared/ipc-contract'
import { idSchema } from '@shared/schemas'
import type { EnrollmentsRepo } from '../enrollments/repo'
import type { LockSession } from '../lock/session'
import { handleAll, type Impl } from './handle'

/** Registers `enrollments:<method>` handlers. Inputs are validated inside the repository. */
export function registerEnrollmentsIpc(repo: EnrollmentsRepo, session: LockSession): void {
  const impl: Impl<EnrollmentsApi> = {
    defaults: () => repo.defaults(),
    add: (studentId, input) => repo.add(idSchema.parse(studentId), input as never),
    edit: (id, input) => repo.edit(idSchema.parse(id), input as never),
    end: (id, input) => repo.end(idSchema.parse(id), input as never),
    resume: (id) => repo.resume(idSchema.parse(id)),
    remove: (id) => repo.remove(idSchema.parse(id))
  }
  handleAll('enrollments', impl, session)
}

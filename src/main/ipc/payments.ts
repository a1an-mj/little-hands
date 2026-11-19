import type { PaymentsApi } from '@shared/ipc-contract'
import { idSchema, isoDateSchema } from '@shared/schemas'
import type { PaymentsRepo } from '../payments/repo'
import type { LockSession } from '../lock/session'
import { handleAll, type Impl } from './handle'

/** Registers `payments:<method>` handlers. Inputs are validated inside the repository. */
export function registerPaymentsIpc(repo: PaymentsRepo, session: LockSession): void {
  const impl: Impl<PaymentsApi> = {
    forStudent: (id) => repo.forStudent(idSchema.parse(id)),
    overview: () => repo.overview(),
    monthReport: (month) => repo.monthReport(String(month)),
    recorders: () => repo.recorders(),
    record: (input) => repo.record(input as never),
    reverse: (id, input) => repo.reverse(idSchema.parse(id), input as never),
    addCharge: (id, input) => repo.addCharge(idSchema.parse(id), input as never),
    cancelCharge: (id) => repo.cancelCharge(idSchema.parse(id)),
    waive: (id, start, input) => repo.waive(idSchema.parse(id), isoDateSchema.parse(start), input as never),
    unwaive: (id, start) => repo.unwaive(idSchema.parse(id), isoDateSchema.parse(start))
  }
  handleAll('payments', impl, session)
}

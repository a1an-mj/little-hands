import { z } from 'zod'
import type { PlannerApi } from '@shared/ipc-contract'
import type { LockSession } from '../lock/session'
import type { PlannerRepo } from '../planner/repo'
import { handleAll, type Impl } from './handle'

const str = (v: unknown) => z.string().parse(v)

/** Registers `planner:<method>` handlers. Inputs are validated inside the repository. */
export function registerPlannerIpc(repo: PlannerRepo, session: LockSession): void {
  const impl: Impl<PlannerApi> = {
    month: (month) => repo.month(str(month)),
    addEvent: (input) => repo.addEvent(input as never),
    updateEvent: (id, input) => repo.updateEvent(str(id), input as never),
    removeEvent: (id) => repo.removeEvent(str(id)),
    todos: () => repo.todos(),
    todosFor: (studentId) => repo.todosFor(str(studentId)),
    addTodo: (input) => repo.addTodo(input as never),
    updateTodo: (id, input) => repo.updateTodo(str(id), input as never),
    setDone: (id, done) => repo.setDone(str(id), z.boolean().parse(done)),
    removeTodo: (id) => repo.removeTodo(str(id))
  }
  handleAll('planner', impl, session)
}

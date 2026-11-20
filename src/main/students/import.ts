import { admissionSchema } from '@shared/schemas'
import { ALREADY_IN_APP, type ImportPlanItem, type ImportResult } from '@shared/import'
import type { PlannerRepo } from '../planner/repo'
import type { StudentsRepo } from './repo'

/** Whether importing this row makes its "Check" to-do: a child added now, or one already in the app without it. */
export function makesTodo(item: Pick<ImportPlanItem, 'todo' | 'skip' | 'name'>, repo: StudentsRepo, planner: PlannerRepo): boolean {
  if (!item.todo) return false
  if (item.skip === null) return true
  if (item.skip !== ALREADY_IN_APP) return false
  const id = repo.idByName(item.name)
  return id !== null && !planner.todosFor(id).some((t) => t.title === item.todo!.title)
}

/**
 * Admits every row that can be imported; siblings share the family of the child entered first.
 * Each form's "Check" notes become a to-do linked to the child, once (importing again adds no copy).
 */
export function runImport(repo: StudentsRepo, planner: PlannerRepo, plan: readonly ImportPlanItem[]): ImportResult {
  const ids = new Map<number, string>()
  const result: ImportResult = { added: 0, todos: 0, skipped: [] }
  const addTodo = (studentId: string, todo: { title: string; notes: string }) => {
    if (planner.todosFor(studentId).some((t) => t.title === todo.title)) return
    planner.addTodo({ title: todo.title, notes: todo.notes, dueDate: '', studentId })
    result.todos++
  }

  plan.forEach((item, i) => {
    if (item.skip === ALREADY_IN_APP && item.todo) {
      const id = repo.idByName(item.name)
      if (id) addTodo(id, item.todo)
    }
    if (item.skip || !item.admission) return result.skipped.push({ name: item.name, reason: item.skip ?? 'Not readable' })
    const siblingId = item.familyOf === null ? undefined : ids.get(item.familyOf)
    const input = siblingId ? { ...item.admission, family: { kind: 'sibling' as const, siblingId } } : item.admission
    const parsed = admissionSchema.safeParse(input)
    if (!parsed.success) return result.skipped.push({ name: item.name, reason: parsed.error.issues[0]?.message ?? 'Not readable' })
    try {
      const id = repo.admit(parsed.data, null)
      ids.set(i, id)
      result.added++
      if (item.todo) addTodo(id, item.todo)
    } catch (e) {
      result.skipped.push({ name: item.name, reason: e instanceof Error ? e.message : String(e) })
    }
  })
  return result
}

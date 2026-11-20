import { admissionSchema } from '@shared/schemas'
import type { ImportPlanItem, ImportResult } from '@shared/import'
import type { StudentsRepo } from './repo'

/** Admits every row that can be imported; siblings share the family of the child entered first. */
export function runImport(repo: StudentsRepo, plan: readonly ImportPlanItem[]): ImportResult {
  const ids = new Map<number, string>()
  const result: ImportResult = { added: 0, skipped: [] }
  plan.forEach((item, i) => {
    if (item.skip || !item.admission) return result.skipped.push({ name: item.name, reason: item.skip ?? 'Not readable' })
    const siblingId = item.familyOf === null ? undefined : ids.get(item.familyOf)
    const input = siblingId ? { ...item.admission, family: { kind: 'sibling' as const, siblingId } } : item.admission
    const parsed = admissionSchema.safeParse(input)
    if (!parsed.success) return result.skipped.push({ name: item.name, reason: parsed.error.issues[0]?.message ?? 'Not readable' })
    try {
      ids.set(i, repo.admit(parsed.data, null))
      result.added++
    } catch (e) {
      result.skipped.push({ name: item.name, reason: e instanceof Error ? e.message : String(e) })
    }
  })
  return result
}

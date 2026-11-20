import type { ProgramCode } from '@shared/enrollments'
import type { PaymentTarget } from '@shared/schemas'
import type { StudentStatus } from '@shared/students'
import type { Page } from './NavRail'

export type Route =
  | { name: 'home' | 'fees' | 'attendance' | 'settings' }
  | { name: 'students' }
  | { name: 'admit' }
  | { name: 'student'; id: string; tab?: ProfileTab }
  /** Record a payment, optionally for a child and a particular period or charge. */
  | { name: 'pay'; studentId?: string; target?: PaymentTarget }

export type ProfileTab = 'overview' | 'fees' | 'att' | 'notes'

/** The rail item to highlight for a route. */
export function pageOf(route: Route): Page {
  if (route.name === 'pay') return 'fees'
  return route.name === 'student' || route.name === 'admit' ? 'students' : route.name
}

/** Remembered while moving between the list and a profile, so "Back" returns to the same place. */
export interface ListState {
  search: string
  status: StudentStatus
  program: ProgramCode | 'all'
  page: number
}

export type Navigate = (route: Route) => void

import type { StudentStatus } from '@shared/students'
import type { Page } from './NavRail'

export type Route =
  | { name: 'home' | 'fees' | 'attendance' }
  | { name: 'students' }
  | { name: 'admit' }
  | { name: 'student'; id: string }

/** The rail item to highlight for a route. */
export function pageOf(route: Route): Page {
  return route.name === 'student' || route.name === 'admit' ? 'students' : route.name
}

/** Remembered while moving between the list and a profile, so "Back" returns to the same place. */
export interface ListState {
  search: string
  status: StudentStatus
  page: number
}

export type Navigate = (route: Route) => void

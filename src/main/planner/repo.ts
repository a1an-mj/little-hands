import type Database from 'better-sqlite3'
import { birthdayIn, type CalendarItem, type EventKind, type MonthView, type TodoList, type TodoView } from '@shared/planner'
import { eventInputSchema, idSchema, monthSchema, todoInputSchema, type EventInput, type TodoInput } from '@shared/schemas'
import type { Writer } from '../db/writer'
import { UserError } from '../errors'

type EventRow = { id: string; title: string; date: string; time: string | null; kind: EventKind; notes: string }
type TodoRow = { id: string; title: string; notes: string; due_date: string | null; student_id: string | null; student_name: string | null; done_at: string | null }

const toTodo = (r: TodoRow): TodoView => ({
  id: r.id,
  title: r.title,
  notes: r.notes,
  dueDate: r.due_date,
  studentId: r.student_id,
  studentName: r.student_name,
  doneAt: r.done_at
})

const TODO_SELECT = `SELECT t.id, t.title, t.notes, t.due_date, t.student_id, s.full_name AS student_name, t.done_at
  FROM todos t LEFT JOIN students s ON s.id = t.student_id AND s.deleted_at IS NULL
  WHERE t.deleted_at IS NULL`
/** Dated first (oldest due first), then undated (oldest first). */
const OPEN_ORDER = 'ORDER BY t.due_date IS NULL, t.due_date, t.created_at, t.rowid'

/** Calendar events (holidays also close the school) and the shared to-do list. */
export class PlannerRepo {
  private readonly db: Database.Database

  constructor(private readonly w: Writer) {
    this.db = w.db
  }

  // ---------- Calendar ----------

  month(month: string): MonthView {
    monthSchema.parse(month)
    const from = `${month}-01`
    const to = `${month}-31`
    const items: CalendarItem[] = []

    const events = this.db
      .prepare(`SELECT id, title, date, time, kind, notes FROM events WHERE deleted_at IS NULL AND date BETWEEN ? AND ? ORDER BY date, time IS NOT NULL, time, title`)
      .all(from, to) as EventRow[]
    for (const e of events) items.push({ kind: e.kind, id: e.id, date: e.date, title: e.title, time: e.time, notes: e.notes })

    // Closed days marked from Attendance; a holiday's own closed day is already shown as the holiday.
    const holidays = new Set(events.filter((e) => e.kind === 'holiday').map((e) => e.date))
    const closed = this.db.prepare('SELECT date, reason FROM closed_days WHERE deleted_at IS NULL AND date BETWEEN ? AND ?').all(from, to) as { date: string; reason: string }[]
    for (const c of closed) if (!holidays.has(c.date)) items.push({ kind: 'closed', date: c.date, title: c.reason ? `School closed · ${c.reason}` : 'School closed' })

    const year = Number(month.slice(0, 4))
    const kids = this.db
      .prepare(`SELECT id, full_name, date_of_birth FROM students WHERE deleted_at IS NULL AND status = 'active' AND date_of_birth IS NOT NULL AND date_of_birth <> ''`)
      .all() as { id: string; full_name: string; date_of_birth: string }[]
    for (const k of kids) {
      const day = birthdayIn(k.date_of_birth, year)
      if (!day.startsWith(month) || k.date_of_birth > day) continue
      const age = year - Number(k.date_of_birth.slice(0, 4))
      items.push({ kind: 'birthday', date: day, title: `${k.full_name} turns ${age}`, studentId: k.id })
    }

    const todos = this.db.prepare(`${TODO_SELECT} AND t.due_date BETWEEN ? AND ? ${OPEN_ORDER}`).all(from, to) as TodoRow[]
    for (const t of todos) items.push({ kind: 'todo', id: t.id, date: t.due_date!, title: t.title, done: t.done_at !== null, studentId: t.student_id })

    return { month, today: this.w.today(), items }
  }

  addEvent(input: EventInput): string {
    const e = eventInputSchema.parse(input)
    return this.w.transaction(() => {
      if (e.kind === 'holiday') this.close(e.date, e.title)
      return this.w.insert('events', { title: e.title, date: e.date, time: e.time || null, kind: e.kind, notes: e.notes })
    })
  }

  updateEvent(id: string, input: EventInput): void {
    idSchema.parse(id)
    const e = eventInputSchema.parse(input)
    this.w.transaction(() => {
      const before = this.event(id)
      if (before.kind === 'holiday') this.reopen(before.date)
      if (e.kind === 'holiday') this.close(e.date, e.title)
      this.w.update('events', id, { title: e.title, date: e.date, time: e.time || null, kind: e.kind, notes: e.notes })
    })
  }

  removeEvent(id: string): void {
    idSchema.parse(id)
    this.w.transaction(() => {
      const before = this.event(id)
      if (before.kind === 'holiday') this.reopen(before.date)
      this.w.softDelete('events', id)
    })
  }

  private event(id: string): EventRow {
    const e = this.db.prepare('SELECT id, title, date, time, kind, notes FROM events WHERE id = ? AND deleted_at IS NULL').get(id) as EventRow | undefined
    if (!e) throw new UserError('This event could not be found. It may have been removed.')
    return e
  }

  private close(date: string, reason: string) {
    const id = this.db.prepare('SELECT id FROM closed_days WHERE date = ? AND deleted_at IS NULL').pluck().get(date) as string | undefined
    if (id) this.w.update('closed_days', id, { reason })
    else this.w.insert('closed_days', { date, reason })
  }

  private reopen(date: string) {
    // Another holiday on the same day keeps the school closed.
    const others = this.db.prepare(`SELECT count(*) FROM events WHERE kind = 'holiday' AND date = ? AND deleted_at IS NULL`).pluck().get(date) as number
    if (others > 1) return
    const id = this.db.prepare('SELECT id FROM closed_days WHERE date = ? AND deleted_at IS NULL').pluck().get(date) as string | undefined
    if (id) this.w.softDelete('closed_days', id)
  }

  // ---------- To-do ----------

  todos(): TodoList {
    const open = this.db.prepare(`${TODO_SELECT} AND t.done_at IS NULL ${OPEN_ORDER}`).all() as TodoRow[]
    const done = this.db.prepare(`${TODO_SELECT} AND t.done_at IS NOT NULL ORDER BY t.done_at DESC LIMIT 50`).all() as TodoRow[]
    return { today: this.w.today(), open: open.map(toTodo), done: done.map(toTodo) }
  }

  /** A child's to-dos (open first). */
  todosFor(studentId: string): TodoView[] {
    idSchema.parse(studentId)
    return (this.db.prepare(`${TODO_SELECT} AND t.student_id = ? ORDER BY t.done_at IS NOT NULL, t.due_date IS NULL, t.due_date, t.created_at`).all(studentId) as TodoRow[]).map(toTodo)
  }

  addTodo(input: TodoInput): string {
    const t = todoInputSchema.parse(input)
    return this.w.transaction(() => {
      if (t.studentId) this.checkStudent(t.studentId)
      return this.w.insert('todos', { title: t.title, notes: t.notes, due_date: t.dueDate || null, student_id: t.studentId, done_at: null })
    })
  }

  updateTodo(id: string, input: TodoInput): void {
    idSchema.parse(id)
    const t = todoInputSchema.parse(input)
    this.w.transaction(() => {
      this.todo(id)
      if (t.studentId) this.checkStudent(t.studentId)
      this.w.update('todos', id, { title: t.title, notes: t.notes, due_date: t.dueDate || null, student_id: t.studentId })
    })
  }

  setDone(id: string, done: boolean): void {
    idSchema.parse(id)
    this.w.transaction(() => {
      const t = this.todo(id)
      if (done && t.done_at === null) this.w.update('todos', id, { done_at: this.w.now() })
      if (!done && t.done_at !== null) this.w.update('todos', id, { done_at: null })
    })
  }

  removeTodo(id: string): void {
    idSchema.parse(id)
    this.w.transaction(() => {
      this.todo(id)
      this.w.softDelete('todos', id)
    })
  }

  private todo(id: string): TodoRow {
    const t = this.db.prepare(`${TODO_SELECT} AND t.id = ?`).get(id) as TodoRow | undefined
    if (!t) throw new UserError('This to-do could not be found. It may have been removed.')
    return t
  }

  private checkStudent(id: string) {
    const ok = this.db.prepare('SELECT 1 FROM students WHERE id = ? AND deleted_at IS NULL').get(id)
    if (!ok) throw new UserError('That child could not be found.')
  }
}

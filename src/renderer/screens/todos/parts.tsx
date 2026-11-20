import { useState } from 'react'
import { dueText, type TodoView } from '@shared/planner'
import { todoInputSchema } from '@shared/schemas'
import { ConfirmDialog, Dialog } from '../../components/Dialog'
import { CheckIcon } from '../../components/icons'
import { TextField } from '../../components/TextField'
import { call, messageOf, useLoad } from '../../lib/api'
import { formatDate } from '../../lib/format'
import { useSubmit } from '../students/ProfileDialogs'

/** One to-do: a round tick, the title, and its date / child underneath. Clicking the text edits it. */
export function TodoRow(props: {
  t: TodoView
  today: string
  onToggle: (done: boolean) => void
  onOpen: () => void
  onChild?: (studentId: string) => void
  showChild?: boolean
}) {
  const { t, today } = props
  const done = t.doneAt !== null
  const late = !done && t.dueDate !== null && t.dueDate < today
  const when = t.dueDate ? (today && dueText(t.dueDate, today)) || formatDate(t.dueDate) : ''
  return (
    <li className={`todo${done ? ' done' : ''}`} data-testid="todo">
      <button
        type="button"
        className="tick"
        role="checkbox"
        aria-checked={done}
        aria-label={done ? `Not done: ${t.title}` : `Done: ${t.title}`}
        onClick={() => props.onToggle(!done)}
      >
        {done && <CheckIcon />}
      </button>
      <div style={{ flex: 1, minWidth: 0 }}>
        <button type="button" className="linkish todo-title" onClick={props.onOpen}>
          {t.title}
        </button>
        <div className="small muted todo-meta">
          {when && <span className={late ? 'late' : undefined}>{when}</span>}
          {props.showChild !== false && t.studentName && t.studentId && (
            <button type="button" className="linkish" onClick={() => props.onChild?.(t.studentId!)}>
              {t.studentName}
            </button>
          )}
          {t.notes && <span className="ellip todo-notes">{t.notes}</span>}
        </div>
      </div>
    </li>
  )
}

/** Ticks a to-do and shows a message with Undo. */
export async function toggleTodo(t: TodoView, done: boolean, reload: () => unknown, snack: (msg: string, action?: { label: string; run: () => void }) => void) {
  try {
    await call(window.lh.planner.setDone(t.id, done))
    await reload()
    if (done) {
      snack(`Done: ${t.title}`, {
        label: 'Undo',
        run: () =>
          void call(window.lh.planner.setDone(t.id, false))
            .then(() => reload())
            .catch((e) => snack(messageOf(e)))
      })
    }
  } catch (e) {
    snack(messageOf(e))
  }
}

/** Add or edit a to-do. `fixedChild` hides the child picker (on a child's profile). */
export function TodoDialog(props: {
  todo?: TodoView
  fixedChild?: { id: string; name: string }
  defaultDue?: string
  onClose: () => void
  onDone: (msg: string) => void
}) {
  const t = props.todo
  const [v, setV] = useState({
    title: t?.title ?? '',
    dueDate: t?.dueDate ?? props.defaultDue ?? '',
    notes: t?.notes ?? '',
    child: t?.studentName ?? ''
  })
  const [confirmRemove, setConfirmRemove] = useState(false)
  const { busy, errors, setErrors, submit } = useSubmit()
  const { data: matches } = useLoad(
    () => window.lh.students.list({ search: v.child.trim(), status: 'active', page: 0 }),
    [v.child]
  )

  /** The child typed in the field, looked up when saving (null = none; undefined = no such child). */
  async function childId(): Promise<string | null | undefined> {
    if (props.fixedChild) return props.fixedChild.id
    const name = v.child.trim()
    if (!name) return null
    if (t?.studentId && name === t.studentName) return t.studentId
    const found = await call(window.lh.students.list({ search: name, status: 'active', page: 0 }))
    return found.rows.find((r) => r.fullName.toLowerCase() === name.toLowerCase())?.id
  }

  async function save() {
    const studentId = await childId().catch(() => undefined)
    if (studentId === undefined) {
      setErrors({ child: 'Pick a child from the list, or leave this empty' })
      return
    }
    const input = { title: v.title, dueDate: v.dueDate, notes: v.notes, studentId }
    await submit(todoInputSchema, input, async () => {
      if (t) await call(window.lh.planner.updateTodo(t.id, input))
      else await call(window.lh.planner.addTodo(input))
      props.onDone(t ? 'To-do saved' : 'To-do added')
    })
  }

  if (confirmRemove && t) {
    return (
      <ConfirmDialog
        title="Remove this to-do?"
        message={t.title}
        confirmLabel="Remove"
        danger
        onClose={() => setConfirmRemove(false)}
        onConfirm={async () => {
          try {
            await call(window.lh.planner.removeTodo(t.id))
            props.onDone('To-do removed')
          } catch (e) {
            setErrors({ form: messageOf(e) })
            setConfirmRemove(false)
          }
        }}
      />
    )
  }

  return (
    <Dialog title={t ? 'Edit to-do' : 'New to-do'} onClose={props.onClose}>
      <form
        noValidate
        style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <TextField label="What needs doing" value={v.title} onChange={(x) => setV({ ...v, title: x })} error={errors.title} autoFocus />
        <div className="grid">
          <TextField label="Due date" type="date" value={v.dueDate} onChange={(x) => setV({ ...v, dueDate: x })} error={errors.dueDate} help="Optional" />
          {props.fixedChild ? (
            <TextField label="Child" value={props.fixedChild.name} onChange={() => undefined} readOnly />
          ) : (
            <TextField
              label="Child"
              value={v.child}
              onChange={(x) => setV({ ...v, child: x })}
              error={errors.child}
              help="Optional: who it's about"
              suggestions={matches?.rows.map((r) => r.fullName)}
            />
          )}
        </div>
        <TextField label="Notes" value={v.notes} onChange={(x) => setV({ ...v, notes: x })} error={errors.notes} multiline rows={3} />
        {errors.form && <div className="field-error" role="alert">{errors.form}</div>}
        <div className="dlg-actions">
          {t && (
            <button type="button" className="btn textb" style={{ marginRight: 'auto', color: 'var(--e)' }} onClick={() => setConfirmRemove(true)}>
              Remove
            </button>
          )}
          <button type="button" className="btn textb" onClick={props.onClose}>
            Cancel
          </button>
          <button type="submit" className="btn filled" disabled={busy}>
            {t ? 'Save' : 'Add to-do'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}

/** A child's to-dos, on their profile (Notes tab). */
export function ChildTodos({ studentId, name }: { studentId: string; name: string }) {
  const { data, reload } = useLoad(() => window.lh.planner.todosFor(studentId), [studentId])
  const { data: list } = useLoad(() => window.lh.planner.todos(), [studentId])
  const [editing, setEditing] = useState<TodoView | 'new' | null>(null)
  const { snack } = useSubmit()
  const today = list?.today ?? ''
  const open = data?.filter((t) => t.doneAt === null) ?? []
  const done = data?.filter((t) => t.doneAt !== null) ?? []
  return (
    <section aria-labelledby="td-h" className="card in" style={{ display: 'flex', flexDirection: 'column', gap: 8 }} data-testid="child-todos">
      <h2 id="td-h" className="h-md">To-dos</h2>
      {data && open.length === 0 && <p className="muted" style={{ margin: 0 }}>Nothing to do for {name.split(' ')[0]}.</p>}
      <ul className="plain">
        {today && [...open, ...done.slice(0, 3)].map((t) => (
          <TodoRow key={t.id} t={t} today={today} showChild={false} onToggle={(d) => void toggleTodo(t, d, reload, snack)} onOpen={() => setEditing(t)} />
        ))}
      </ul>
      <button type="button" className="btn tonal" style={{ alignSelf: 'flex-start' }} onClick={() => setEditing('new')}>
        Add a to-do
      </button>
      {editing && (
        <TodoDialog
          todo={editing === 'new' ? undefined : editing}
          fixedChild={{ id: studentId, name }}
          onClose={() => setEditing(null)}
          onDone={(msg) => {
            setEditing(null)
            snack(msg)
            void reload()
          }}
        />
      )}
    </section>
  )
}

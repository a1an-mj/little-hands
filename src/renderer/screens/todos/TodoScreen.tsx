import { useState } from 'react'
import type { Theme } from '@shared/ipc-contract'
import { TODO_GROUP_LABEL, todoGroup, type TodoGroup, type TodoView } from '@shared/planner'
import { PlusSmallIcon } from '../../components/icons'
import { useSnackbar } from '../../components/Snackbar'
import { ThemeSwitch } from '../../components/ThemeSwitch'
import { call, messageOf, useLoad } from '../../lib/api'
import type { Navigate } from '../../shell/routes'
import { TodoDialog, TodoRow, toggleTodo } from './parts'

interface Props {
  theme: Theme
  onToggleTheme: () => void
  navigate: Navigate
}

const GROUPS: TodoGroup[] = ['overdue', 'today', 'upcoming', 'nodate']

/** One shared list for the owner and the teachers: Overdue, Today, Upcoming, No date, then Done. */
export function TodoScreen({ theme, onToggleTheme, navigate }: Props) {
  const snack = useSnackbar()
  const { data, error, reload } = useLoad(() => window.lh.planner.todos(), [])
  const [quick, setQuick] = useState('')
  const [quickDue, setQuickDue] = useState('')
  const [editing, setEditing] = useState<TodoView | 'new' | null>(null)
  const [showDone, setShowDone] = useState(false)

  async function quickAdd() {
    if (!quick.trim()) return
    try {
      await call(window.lh.planner.addTodo({ title: quick, dueDate: quickDue }))
      setQuick('')
      setQuickDue('')
      await reload()
    } catch (e) {
      snack(messageOf(e))
    }
  }

  const today = data?.today ?? ''
  const open = data?.open ?? []
  const row = (t: TodoView) => (
    <TodoRow
      key={t.id}
      t={t}
      today={today}
      onToggle={(done) => void toggleTodo(t, done, reload, snack)}
      onOpen={() => setEditing(t)}
      onChild={(id) => navigate({ name: 'student', id, tab: 'notes' })}
    />
  )

  return (
    <>
      <header className="topbar in">
        <div style={{ flex: '1 1 240px', minWidth: 0 }}>
          <h1 className="h-lg">To-do</h1>
          <div className="muted" data-testid="todo-count">
            {data ? `${open.length} to do${open.filter((t) => todoGroup(t, today) === 'overdue').length ? ` · ${open.filter((t) => todoGroup(t, today) === 'overdue').length} overdue` : ''}` : ' '}
          </div>
        </div>
        <ThemeSwitch theme={theme} onToggle={onToggleTheme} />
      </header>

      <form
        className="card in quick-add"
        aria-label="Add a to-do"
        onSubmit={(e) => {
          e.preventDefault()
          void quickAdd()
        }}
      >
        <label className="sr" htmlFor="quick-todo">New to-do</label>
        <input id="quick-todo" className="quick-input" placeholder="Add a to-do, e.g. Call Nyla's mother about the emergency numbers" value={quick} onChange={(e) => setQuick(e.target.value)} maxLength={200} />
        <label className="sr" htmlFor="quick-due">Due date</label>
        <input id="quick-due" className="quick-date" type="date" value={quickDue} onChange={(e) => setQuickDue(e.target.value)} />
        <button type="submit" className="btn filled cta" disabled={!quick.trim()}>
          <PlusSmallIcon />
          Add
        </button>
        <button type="button" className="btn textb" onClick={() => setEditing('new')}>
          More…
        </button>
      </form>

      {error && <div className="alert" role="alert">{error}</div>}
      {data && open.length === 0 && (
        <section className="card in empty" style={{ animationDelay: '60ms' }}>
          Nothing to do. Add a to-do above.
        </section>
      )}

      {GROUPS.map((g, i) => {
        const list = open.filter((t) => todoGroup(t, today) === g)
        if (list.length === 0) return null
        return (
          <section key={g} className="card in" aria-labelledby={`tg-${g}`} style={{ animationDelay: `${60 * (i + 1)}ms` }} data-testid={`todo-group-${g}`}>
            <h2 id={`tg-${g}`} className={`h-md${g === 'overdue' ? ' late' : ''}`}>
              {TODO_GROUP_LABEL[g]} <span className="muted small">· {list.length}</span>
            </h2>
            <ul className="plain">{list.map(row)}</ul>
          </section>
        )
      })}

      {data && data.done.length > 0 && (
        <section className="card in" aria-labelledby="tg-done" style={{ animationDelay: '300ms' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <h2 id="tg-done" className="h-md">
              Done <span className="muted small">· {data.done.length}</span>
            </h2>
            <button type="button" className="btn textb" aria-expanded={showDone} onClick={() => setShowDone(!showDone)}>
              {showDone ? 'Hide' : 'Show'}
            </button>
          </div>
          {showDone && <ul className="plain">{data.done.map(row)}</ul>}
        </section>
      )}

      {editing && (
        <TodoDialog
          todo={editing === 'new' ? undefined : editing}
          defaultDue={editing === 'new' ? quickDue : undefined}
          onClose={() => setEditing(null)}
          onDone={(msg) => {
            setEditing(null)
            snack(msg)
            void reload()
          }}
        />
      )}
    </>
  )
}

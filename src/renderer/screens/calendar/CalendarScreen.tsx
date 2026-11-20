import { useEffect, useRef, useState } from 'react'
import { formatDayLong } from '@shared/dates'
import type { Theme } from '@shared/ipc-contract'
import { EVENT_KINDS, EVENT_KIND_LABEL, addMonths, monthGrid, type CalendarItem, type EventKind, type TodoView } from '@shared/planner'
import { eventInputSchema } from '@shared/schemas'
import { formatTime } from '@shared/schedule'
import { ConfirmDialog, Dialog } from '../../components/Dialog'
import { BackIcon, PlusSmallIcon } from '../../components/icons'
import { useSnackbar } from '../../components/Snackbar'
import { TextField } from '../../components/TextField'
import { ThemeSwitch } from '../../components/ThemeSwitch'
import { call, messageOf, useLoad } from '../../lib/api'
import { todayIso } from '../../lib/format'
import type { Navigate } from '../../shell/routes'
import { useSubmit } from '../students/ProfileDialogs'
import { TodoDialog, TodoRow, toggleTodo } from '../todos/parts'

interface Props {
  theme: Theme
  onToggleTheme: () => void
  navigate: Navigate
}

type EventItem = Extract<CalendarItem, { kind: EventKind }>
const isEvent = (i: CalendarItem): i is EventItem => (EVENT_KINDS as readonly string[]).includes(i.kind)

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const monthTitle = (m: string) => new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${m}-01T00:00:00Z`))
const KIND_LABEL: Record<CalendarItem['kind'], string> = { ...EVENT_KIND_LABEL, closed: 'School closed', birthday: 'Birthday', todo: 'To-do' }

/** Month view: events, holidays, "School closed" days, birthdays and dated to-dos. */
export function CalendarScreen({ theme, onToggleTheme, navigate }: Props) {
  const snack = useSnackbar()
  const [month, setMonth] = useState(todayIso().slice(0, 7))
  const [selected, setSelected] = useState(todayIso())
  const [dialog, setDialog] = useState<{ kind: 'event'; item?: EventItem } | { kind: 'todo' } | { kind: 'edit-todo'; todo: TodoView } | null>(null)
  const { data, error, reload } = useLoad(() => window.lh.planner.month(month), [month])

  const today = data?.today ?? todayIso()
  // Start on the app's own "today" (the main process's clock) once it is known.
  const synced = useRef(false)
  useEffect(() => {
    if (!data || synced.current) return
    synced.current = true
    if (data.today.slice(0, 7) !== month) setMonth(data.today.slice(0, 7))
    setSelected(data.today)
  }, [data, month])
  let grid = monthGrid(month)
  if (!grid[35]!.startsWith(month)) grid = grid.slice(0, 35)
  const byDay = new Map<string, CalendarItem[]>()
  for (const i of data?.items ?? []) byDay.set(i.date, [...(byDay.get(i.date) ?? []), i])
  const dayItems = byDay.get(selected) ?? []

  function go(n: number) {
    const m = addMonths(month, n)
    setMonth(m)
    setSelected(today.startsWith(m) ? today : `${m}-01`)
  }

  const todoView = (i: Extract<CalendarItem, { kind: 'todo' }>): TodoView => ({
    id: i.id,
    title: i.title,
    notes: '',
    dueDate: i.date,
    studentId: i.studentId,
    studentName: null,
    doneAt: i.done ? i.date : null
  })

  return (
    <>
      <header className="topbar in">
        <div style={{ flex: '1 1 240px', minWidth: 0 }}>
          <h1 className="h-lg">Calendar</h1>
          <div className="muted">Events, holidays, birthdays and to-dos</div>
        </div>
        <ThemeSwitch theme={theme} onToggle={onToggleTheme} />
      </header>

      <div className="cal-layout">
        <section className="card in cal-card" aria-labelledby="cal-h">
          <div className="cal-bar">
            <h2 id="cal-h" className="h-md" data-testid="cal-month">{monthTitle(month)}</h2>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <button type="button" className="iconb" aria-label="Previous month" onClick={() => go(-1)}>
                <BackIcon />
              </button>
              <button
                type="button"
                className="chip"
                onClick={() => {
                  setMonth(today.slice(0, 7))
                  setSelected(today)
                }}
              >
                Today
              </button>
              <button type="button" className="iconb flip" aria-label="Next month" onClick={() => go(1)}>
                <BackIcon />
              </button>
            </div>
          </div>
          {error && <div className="alert" role="alert">{error}</div>}
          <div className="cal-grid" role="grid" aria-label={monthTitle(month)}>
            {WEEKDAYS.map((d) => (
              <div key={d} className="cal-wd small muted" role="columnheader">
                {d}
              </div>
            ))}
            {grid.map((d) => {
              const items = byDay.get(d) ?? []
              const cls = ['cal-day', !d.startsWith(month) && 'other', d === today && 'today', d === selected && 'sel', items.some((i) => i.kind === 'holiday' || i.kind === 'closed') && 'closed']
                .filter(Boolean)
                .join(' ')
              return (
                <button
                  key={d}
                  type="button"
                  role="gridcell"
                  className={cls}
                  aria-selected={d === selected}
                  aria-label={`${formatDayLong(d)}${items.length ? `, ${items.length} ${items.length === 1 ? 'item' : 'items'}` : ''}`}
                  onClick={() => setSelected(d)}
                  data-testid={`day-${d}`}
                >
                  <span className="cal-num">{Number(d.slice(8))}</span>
                  {items.slice(0, 3).map((i, k) => (
                    <span key={k} className={`cal-chip k-${i.kind}${i.kind === 'todo' && i.done ? ' done' : ''}`}>
                      {i.title}
                    </span>
                  ))}
                  {items.length > 3 && <span className="cal-more small muted">+{items.length - 3} more</span>}
                </button>
              )
            })}
          </div>
        </section>

        <section className="card in cal-side" aria-labelledby="day-h" style={{ animationDelay: '80ms' }} data-testid="day-panel">
          <h2 id="day-h" className="h-md">
            {selected === today ? 'Today' : formatDayLong(selected)}
          </h2>
          {selected === today && <div className="muted" style={{ marginTop: -8 }}>{formatDayLong(selected)}</div>}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <button type="button" className="btn filled cta" onClick={() => setDialog({ kind: 'event' })}>
              <PlusSmallIcon />
              Add event
            </button>
            <button type="button" className="btn tonal" onClick={() => setDialog({ kind: 'todo' })}>
              <PlusSmallIcon />
              Add to-do
            </button>
          </div>
          {dayItems.length === 0 && <p className="muted" style={{ margin: 0 }}>Nothing on this day.</p>}
          <ul className="plain">
            {dayItems.map((i, k) =>
              i.kind === 'todo' ? (
                <TodoRow
                  key={k}
                  t={todoView(i)}
                  today={today}
                  showChild={false}
                  onToggle={(done) => void toggleTodo(todoView(i), done, reload, snack)}
                  onOpen={() => void call(window.lh.planner.todos()).then((l) => {
                    const t = [...l.open, ...l.done].find((x) => x.id === i.id)
                    if (t) setDialog({ kind: 'edit-todo', todo: t })
                  })}
                />
              ) : (
                <li key={k} className="day-item" data-testid="day-item">
                  <span className={`dot k-${i.kind}`} aria-hidden="true" />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {isEvent(i) ? (
                      <button type="button" className="linkish t-lg" onClick={() => setDialog({ kind: 'event', item: i })}>
                        {i.title}
                      </button>
                    ) : i.kind === 'birthday' ? (
                      <button type="button" className="linkish t-lg" onClick={() => navigate({ name: 'student', id: i.studentId })}>
                        {i.title}
                      </button>
                    ) : (
                      <span className="t-lg">{i.title}</span>
                    )}
                    <div className="small muted">
                      {KIND_LABEL[i.kind]}
                      {isEvent(i) && i.time ? ` · ${formatTime(i.time)}` : ''}
                      {i.kind === 'holiday' ? ' · school closed' : ''}
                    </div>
                    {isEvent(i) && i.notes && <div className="small" style={{ whiteSpace: 'pre-wrap', marginTop: 4 }}>{i.notes}</div>}
                  </div>
                </li>
              )
            )}
          </ul>
        </section>
      </div>

      {dialog?.kind === 'event' && (
        <EventDialog
          item={dialog.item}
          date={selected}
          onClose={() => setDialog(null)}
          onDone={(msg) => {
            setDialog(null)
            snack(msg)
            void reload()
          }}
        />
      )}
      {(dialog?.kind === 'todo' || dialog?.kind === 'edit-todo') && (
        <TodoDialog
          todo={dialog.kind === 'edit-todo' ? dialog.todo : undefined}
          defaultDue={selected}
          onClose={() => setDialog(null)}
          onDone={(msg) => {
            setDialog(null)
            snack(msg)
            void reload()
          }}
        />
      )}
    </>
  )
}

function EventDialog(props: { item?: EventItem; date: string; onClose: () => void; onDone: (msg: string) => void }) {
  const e = props.item
  const [v, setV] = useState({ title: e?.title ?? '', date: e?.date ?? props.date, time: e?.time ?? '', kind: (e?.kind ?? 'event') as EventKind, notes: e?.notes ?? '' })
  const [confirmRemove, setConfirmRemove] = useState(false)
  const { busy, errors, submit, snack } = useSubmit()

  if (confirmRemove && e) {
    return (
      <ConfirmDialog
        title="Remove this event?"
        message={e.kind === 'holiday' ? `${e.title}. The school will be open that day again.` : e.title}
        confirmLabel="Remove"
        danger
        onClose={() => setConfirmRemove(false)}
        onConfirm={async () => {
          try {
            await call(window.lh.planner.removeEvent(e.id))
            props.onDone('Event removed')
          } catch (err) {
            snack(messageOf(err))
          }
        }}
      />
    )
  }

  return (
    <Dialog title={e ? 'Edit event' : 'New event'} onClose={props.onClose}>
      <form
        noValidate
        style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
        onSubmit={(ev) => {
          ev.preventDefault()
          // A holiday is all day.
          const input = v.kind === 'holiday' ? { ...v, time: '' } : v
          void submit(eventInputSchema, input, async () => {
            if (e) await call(window.lh.planner.updateEvent(e.id, input))
            else await call(window.lh.planner.addEvent(input))
            props.onDone(e ? 'Event saved' : v.kind === 'holiday' ? 'Holiday added. The school is closed that day.' : 'Event added')
          })
        }}
      >
        <div className="seg" role="group" aria-label="Type" style={{ alignSelf: 'flex-start' }}>
          {EVENT_KINDS.map((k) => (
            <button key={k} type="button" className="segb" aria-pressed={v.kind === k} onClick={() => setV({ ...v, kind: k })}>
              {EVENT_KIND_LABEL[k]}
            </button>
          ))}
        </div>
        <TextField label="Title" value={v.title} onChange={(x) => setV({ ...v, title: x })} error={errors.title} autoFocus placeholder={v.kind === 'holiday' ? 'e.g. Christmas' : v.kind === 'meeting' ? "e.g. Parents' meeting" : 'e.g. Annual day'} />
        <div className="grid">
          <TextField label="Date" type="date" value={v.date} onChange={(x) => setV({ ...v, date: x })} error={errors.date} />
          {v.kind !== 'holiday' && <TextField label="Time" type="time" value={v.time} onChange={(x) => setV({ ...v, time: x })} error={errors.time} help="Optional" />}
        </div>
        {v.kind === 'holiday' && <p className="muted small" style={{ margin: 0 }}>The school is marked closed that day, so no one is expected on attendance.</p>}
        <TextField label="Notes" value={v.notes} onChange={(x) => setV({ ...v, notes: x })} error={errors.notes} multiline rows={3} />
        <div className="dlg-actions">
          {e && (
            <button type="button" className="btn textb" style={{ marginRight: 'auto', color: 'var(--e)' }} onClick={() => setConfirmRemove(true)}>
              Remove
            </button>
          )}
          <button type="button" className="btn textb" onClick={props.onClose}>
            Cancel
          </button>
          <button type="submit" className="btn filled" disabled={busy}>
            {e ? 'Save' : 'Add event'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}

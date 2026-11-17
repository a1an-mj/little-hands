import { useState } from 'react'
import { inOutText, type HistoryDay, type ProgramHistory } from '@shared/attendance'
import { formatDayShort } from '@shared/dates'
import { PROGRAM_NAME, type EnrollmentView } from '@shared/enrollments'
import { formatDays, formatTime } from '@shared/schedule'
import { attendanceDaySchema, type AttendanceDayInput } from '@shared/schemas'
import { Dialog } from '../../components/Dialog'
import { EditIcon } from '../../components/icons'
import { TextField } from '../../components/TextField'
import { call } from '../../lib/api'
import { punctualityTag, statusTag } from '../attendance/parts'
import { useSubmit } from './ProfileDialogs'

export type History = { today: string; now: string; programs: ProgramHistory[] }

/** Overview card: what each program says today (design: Profile.html, "Today"). */
export function TodayCard({ history, enrollments }: { history: History; enrollments: EnrollmentView[] }) {
  const current = enrollments.filter((e) => e.state === 'current')
  if (current.length === 0) return null
  return (
    <section aria-labelledby="tod-h" className="card in" style={{ animationDelay: '220ms' }} data-testid="today-card">
      <h2 id="tod-h" className="h-md" style={{ marginBottom: 8 }}>Today</h2>
      {current.map((e) => {
        const name = PROGRAM_NAME[e.program]
        const day = history.programs.find((p) => p.enrollmentId === e.id)?.days.find((d) => d.date === history.today)
        if (!day || !day.arrives) {
          const days = e.schedules.at(-1)?.days
          return <Line key={e.id} label={name} value={<span>Not today{days ? ` · ${formatDays(days)}` : ''}</span>} />
        }
        const s = day.state
        if (s.status === 'in' || s.status === 'out') {
          return (
            <div key={e.id}>
              <Line
                label={`${name} arrived`}
                value={
                  <span>
                    <span className="t-lg">{s.arrived ? formatTime(s.arrived) : 'Present'}</span>{' '}
                    <span className="muted">· expected {formatTime(day.arrives)}</span>
                  </span>
                }
              />
              <Line
                label={s.status === 'out' ? `${name} left` : `${name} leaves`}
                value={<span className="t-lg">{formatTime(s.status === 'out' ? s.left! : day.leaves!)}</span>}
              />
            </div>
          )
        }
        const tag = statusTag(s, day.arrives, { isToday: true, now: history.now })
        return (
          <Line
            key={e.id}
            label={name}
            value={
              <span>
                <span className={tag.cls}>{tag.text}</span> <span className="muted">· expected {formatTime(day.arrives)}</span>
              </span>
            }
          />
        )
      })}
    </section>
  )
}

function Line({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="row" style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '12px 0' }}>
      <span className="muted">{label}</span>
      {value}
    </div>
  )
}

/** Attendance tab: the last school days for each program, each one correctable. */
export function AttendanceHistory({ history, onEdit }: { history: History; onEdit: (p: ProgramHistory, d: HistoryDay) => void }) {
  if (history.programs.length === 0) {
    return (
      <section className="card in">
        <p className="muted" style={{ margin: 0 }}>No programs have started yet.</p>
      </section>
    )
  }
  return (
    <>
      {history.programs.map((p) => (
        <section key={p.enrollmentId} aria-labelledby={`att-${p.enrollmentId}`} className="card in" data-testid={`history-${p.program}`}>
          <h2 id={`att-${p.enrollmentId}`} className="h-md" style={{ marginBottom: 8 }}>
            Last {p.days.length} school day{p.days.length === 1 ? '' : 's'} · {PROGRAM_NAME[p.program]}
          </h2>
          {p.days.length === 0 && <p className="muted" style={{ margin: 0 }}>No school days yet.</p>}
          {p.days.map((d) => {
            const isToday = d.date === history.today
            const tag =
              d.state.status === 'absent' || d.state.status === 'none'
                ? statusTag(d.state, d.arrives, { isToday, now: history.now })
                : (punctualityTag(d.state, d.arrives) ?? { text: 'Present', cls: 'tag ok' })
            return (
              <div key={d.date} className="row hist" data-testid="history-day">
                <span className="t-lg" style={{ flex: '0 0 120px' }}>
                  {isToday ? 'Today' : formatDayShort(d.date)}
                </span>
                <span style={{ flex: 1 }}>{inOutText(d.state)}</span>
                <span className={tag.cls}>{tag.text}</span>
                <button type="button" className="iconb" aria-label={`Change ${formatDayShort(d.date)}, ${PROGRAM_NAME[p.program]}`} title="Change" onClick={() => onEdit(p, d)}>
                  <EditIcon size={20} />
                </button>
              </div>
            )
          })}
        </section>
      ))}
    </>
  )
}

/** Fix one day: present (with times), absent (with a reason), or not marked. */
export function DayDialog({ program, day, onClose, onDone }: { program: ProgramHistory; day: HistoryDay; onClose: () => void; onDone: (msg: string) => void }) {
  const s = day.state
  const [v, setV] = useState<Required<AttendanceDayInput>>({
    status: s.status === 'in' || s.status === 'out' ? 'present' : s.status === 'absent' ? 'absent' : 'none',
    arrived: s.arrived ?? '',
    left: s.left ?? '',
    note: s.note
  })
  const { busy, errors, submit } = useSubmit()
  const name = PROGRAM_NAME[program.program]
  const choices: [AttendanceDayInput['status'], string][] = [
    ['present', 'Present'],
    ['absent', 'Absent'],
    ['none', 'Not marked']
  ]
  return (
    <Dialog title={`${name} · ${formatDayShort(day.date)}`} onClose={onClose}>
      <form
        noValidate
        style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
        onSubmit={(e) => {
          e.preventDefault()
          void submit(attendanceDaySchema, v, async () => {
            await call(window.lh.attendance.setDay(program.enrollmentId, day.date, v))
            onDone('Attendance saved')
          })
        }}
      >
        <div role="radiogroup" aria-label="Attendance" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {choices.map(([value, label]) => (
            <label key={value} className="choice">
              <input type="radio" name="status" checked={v.status === value} onChange={() => setV({ ...v, status: value })} />
              <span className="t-lg">{label}</span>
            </label>
          ))}
        </div>
        {v.status === 'present' && (
          <div className="grid">
            <TextField label="Arrived at" type="time" value={v.arrived} onChange={(x) => setV({ ...v, arrived: x })} error={errors.arrived} help={day.arrives ? `Expected ${formatTime(day.arrives)}` : undefined} />
            <TextField label="Left at" type="time" value={v.left} onChange={(x) => setV({ ...v, left: x })} error={errors.left} help="Leave empty if not yet" />
          </div>
        )}
        {v.status === 'absent' && (
          <TextField label="Reason" value={v.note} onChange={(x) => setV({ ...v, note: x })} error={errors.note} placeholder="e.g. fever, family function" />
        )}
        <p className="small muted" style={{ margin: 0 }}>The earlier entry stays in the history; this is saved as a correction.</p>
        <div className="dlg-actions">
          <button type="button" className="btn textb" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn filled" disabled={busy}>
            Save
          </button>
        </div>
      </form>
    </Dialog>
  )
}

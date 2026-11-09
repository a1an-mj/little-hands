import { useState } from 'react'
import { academicYearOf } from '@shared/academic-year'
import { shownVersions } from '@shared/effective'
import {
  PROGRAM_NAME,
  isKindergarten,
  perLabel,
  type EnrollmentView,
  type FeeVersion,
  type ProgramCode,
  type ScheduleVersion
} from '@shared/enrollments'
import { formatRupees } from '@shared/money'
import { formatDays, formatTimeRange } from '@shared/schedule'
import { endEnrollmentSchema, enrollmentEditSchema, enrollmentInputSchema, type EndEnrollmentInput } from '@shared/schemas'
import type { StudentProfile } from '@shared/students'
import { ConfirmDialog, Dialog } from '../../components/Dialog'
import { AlertIcon, CheckIcon, EditIcon } from '../../components/icons'
import { TextField } from '../../components/TextField'
import { call, messageOf, useLoad } from '../../lib/api'
import { formatDate, todayIso } from '../../lib/format'
import { useSubmit } from './ProfileDialogs'
import {
  ProgramFields,
  ProgramTag,
  enrollmentInput,
  feeInput,
  formFromDefaults,
  formFromEnrollment,
  type ProgramForm
} from './ProgramFields'

export type ProgramDialog =
  | { kind: 'add' }
  | { kind: 'edit'; enrollment: EnrollmentView }
  | { kind: 'end'; enrollment: EnrollmentView }

const timingsText = (s: ScheduleVersion) => `${formatDays(s.days)} · ${formatTimeRange(s.arrives, s.leaves)}`
const feeText = (f: FeeVersion) => `${formatRupees(f.agreedPaise)} / ${perLabel(f.frequency, f.customLabel)}`

function concessionText(f: FeeVersion): string {
  if (f.concessionPaise === 0) return 'No concession'
  return `${formatRupees(f.standardPaise)} − ${formatRupees(f.concessionPaise)} concession (${f.concessionReason})`
}

// ---------- The card on the profile's Overview tab ----------

export function ProgramsCard({ p, onOpen, onResume }: { p: StudentProfile; onOpen: (d: ProgramDialog) => void; onResume: (e: EnrollmentView) => void }) {
  const today = todayIso()
  const open = p.enrollments.filter((e) => e.state !== 'ended')
  const ended = p.enrollments.filter((e) => e.state === 'ended')
  const canAdd = open.length < 4 && p.status === 'active'

  return (
    <section aria-labelledby="enr-h" className="card in" style={{ animationDelay: '180ms', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <h2 id="enr-h" className="h-md">
          Programs, timings &amp; fees
        </h2>
        {canAdd && (
          <button type="button" className="btn tonal" onClick={() => onOpen({ kind: 'add' })}>
            Add program
          </button>
        )}
      </div>

      {open.length === 0 && (
        <p className="muted" style={{ margin: 0 }}>
          {p.status === 'active' ? 'Not in any program at the moment. Use "Add program".' : `Not in any program (${p.status}).`}
        </p>
      )}

      {open.map((e) => {
        const s = shownVersions(e.schedules, today)
        const f = shownVersions(e.fees, today)
        const name = PROGRAM_NAME[e.program]
        return (
          <div key={e.id} className="enr" data-testid={`program-${e.program}`}>
            <div className="enr-head">
              <span className="t-lg" style={{ flex: 1 }}>
                {name} · {academicYearOf(e.state === 'upcoming' ? e.startDate : today)}
              </span>
              {e.state === 'upcoming' && <span className="tag nt">Starts {formatDate(e.startDate)}</span>}
              {e.endDate && <span className="tag part">Last day {formatDate(e.endDate)}</span>}
              <button type="button" className="iconb" aria-label={`Edit ${name}`} title="Edit" onClick={() => onOpen({ kind: 'edit', enrollment: e })}>
                <EditIcon size={20} />
              </button>
            </div>
            <div className="enr-grid">
              <div>
                <div className="small muted">Timings</div>
                <div className="t-lg">{timingsText(s.current)}</div>
              </div>
              <div>
                <div className="small muted">Agreed fee</div>
                <div className="t-lg">{feeText(f.current)}</div>
                <div className="small muted">
                  {concessionText(f.current)} · since {formatDate(f.current.effectiveFrom)}
                </div>
                {f.current.remarks && <div className="small muted">{f.current.remarks}</div>}
              </div>
            </div>
            {(s.next || f.next) && (
              <div className="next small">
                {s.next && (
                  <div>
                    From {formatDate(s.next.effectiveFrom)}: {timingsText(s.next)}
                  </div>
                )}
                {f.next && (
                  <div>
                    From {formatDate(f.next.effectiveFrom)}: {feeText(f.next)}
                    {f.next.concessionPaise > 0 ? ` (${concessionText(f.next)})` : ''}
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}

      {ended.length > 0 && (
        <>
          <div className="small muted" style={{ marginTop: 8 }}>
            Earlier programs
          </div>
          {ended.map((e) => (
            <div key={e.id} className="enr ended" data-testid={`ended-${e.program}`}>
              <div className="enr-head">
                <ProgramTag code={e.program} />
                <span style={{ flex: 1 }}>
                  {formatDate(e.startDate)} – {formatDate(e.endDate!)}
                  {e.endReason && <span className="muted"> · {e.endReason}</span>}
                </span>
                <button type="button" className="btn textb" onClick={() => onOpen({ kind: 'end', enrollment: e })}>
                  Change last day
                </button>
                {p.status === 'active' && (
                  <button type="button" className="btn textb" onClick={() => onResume(e)}>
                    Continue
                  </button>
                )}
              </div>
            </div>
          ))}
        </>
      )}
    </section>
  )
}

// ---------- Add a program ----------

export function AddProgramDialog({ p, onClose, onDone }: { p: StudentProfile; onClose: () => void; onDone: (message: string) => void }) {
  const { data: defaults } = useLoad(() => window.lh.enrollments.defaults(), [])
  const taken = new Set(p.enrollments.filter((e) => e.state !== 'ended').map((e) => e.program))
  const [code, setCode] = useState<ProgramCode | null>(null)
  const [form, setForm] = useState<ProgramForm | null>(null)
  const { busy, errors, setErrors, submit } = useSubmit()

  const pick = (c: ProgramCode) => {
    const d = defaults?.find((x) => x.code === c)
    if (!d) return
    setCode(c)
    setForm(formFromDefaults(d, todayIso() < p.joiningDate ? p.joiningDate : todayIso()))
    setErrors({})
  }
  const kgClash = code !== null && isKindergarten(code) && [...taken].some(isKindergarten)

  return (
    <Dialog title="Add a program" onClose={onClose}>
      <form
        noValidate
        style={{ display: 'flex', flexDirection: 'column', gap: 20 }}
        onSubmit={(e) => {
          e.preventDefault()
          if (!code || !form) return
          const input = enrollmentInput(code, form)
          void submit(enrollmentInputSchema, input, async () => {
            await call(window.lh.enrollments.add(p.id, input))
            onDone(`${PROGRAM_NAME[code]} added`)
          })
        }}
      >
        <div role="group" aria-label="Program" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {defaults
            ?.filter((d) => !taken.has(d.code))
            .map((d) => (
              <button key={d.code} type="button" className="chip" aria-pressed={code === d.code} onClick={() => pick(d.code)}>
                {code === d.code && <CheckIcon />}
                {d.name}
              </button>
            ))}
        </div>
        {kgClash && (
          <div className="alert pop" role="alert">
            <AlertIcon />
            <span>
              {p.fullName} is already in a kindergarten class. To move up a class, end the old one (pencil → "End program") and add the new one.
            </span>
          </div>
        )}
        {code && form && (
          <ProgramFields program={code} value={form} onChange={(patch) => setForm({ ...form, ...patch })} errors={errors} showRemarks />
        )}
        <div className="dlg-actions">
          <button type="button" className="btn textb" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn filled" disabled={busy || !code}>
            Add program
          </button>
        </div>
      </form>
    </Dialog>
  )
}

// ---------- Edit timings / fee ----------

export function EditProgramDialog(props: {
  enrollment: EnrollmentView
  onClose: () => void
  onDone: (message: string) => void
  onEnd: () => void
}) {
  const e = props.enrollment
  const name = PROGRAM_NAME[e.program]
  const [form, setForm] = useState<ProgramForm>(() => formFromEnrollment(e))
  // A program that hasn't started yet has no history worth keeping: default to correcting it.
  const [mode, setMode] = useState<'change' | 'fix'>(e.state === 'upcoming' ? 'fix' : 'change')
  const [from, setFrom] = useState(todayIso() < e.startDate ? e.startDate : todayIso())
  const [confirmRemove, setConfirmRemove] = useState(false)
  const { busy, errors, submit, snack } = useSubmit()
  const lastFee = e.fees.at(-1)!
  const lastSchedule = e.schedules.at(-1)!

  if (confirmRemove) {
    return (
      <ConfirmDialog
        title={`Remove ${name}?`}
        message={
          <>
            Only do this if {name} was added by mistake. Its timings and fees disappear from the profile. When a child stops coming,
            use <strong>End program</strong> instead, so the history is kept.
          </>
        }
        confirmLabel="Remove program"
        danger
        onClose={() => setConfirmRemove(false)}
        onConfirm={async () => {
          try {
            await call(window.lh.enrollments.remove(e.id))
            props.onDone(`${name} removed`)
          } catch (err) {
            snack(messageOf(err))
          }
        }}
      />
    )
  }

  const input = {
    startDate: form.startDate,
    schedule: { days: form.days, arrives: form.arrives, leaves: form.leaves },
    fee: feeInput(form),
    mode,
    from
  }

  return (
    <Dialog title={`Edit ${name}`} onClose={props.onClose}>
      <form
        noValidate
        style={{ display: 'flex', flexDirection: 'column', gap: 20 }}
        onSubmit={(ev) => {
          ev.preventDefault()
          void submit(enrollmentEditSchema, input, async () => {
            await call(window.lh.enrollments.edit(e.id, input))
            props.onDone(`${name} saved`)
          })
        }}
      >
        <ProgramFields
          program={e.program}
          value={form}
          onChange={(patch) => setForm({ ...form, ...patch })}
          errors={errors}
          startLabel="Started on"
          showRemarks
        />

        <fieldset style={{ border: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <legend className="t-lg" style={{ padding: 0, marginBottom: 8 }}>
            Changes to timings or fee
          </legend>
          <label className="choice">
            <input type="radio" name="mode" checked={mode === 'change'} onChange={() => setMode('change')} />
            <span>
              <span className="t-lg" style={{ display: 'block' }}>
                A change from a date
              </span>
              <span className="small muted">The old timings and fee stay for the days before it.</span>
            </span>
          </label>
          {mode === 'change' && (
            <div style={{ padding: '8px 0 8px 42px' }}>
              <TextField label="Change starts on" type="date" value={from} onChange={setFrom} error={errors.from} />
            </div>
          )}
          <label className="choice">
            <input type="radio" name="mode" checked={mode === 'fix'} onChange={() => setMode('fix')} />
            <span>
              <span className="t-lg" style={{ display: 'block' }}>
                Fix a mistake
              </span>
              <span className="small muted">
                Corrects what was saved
                {lastFee.effectiveFrom === lastSchedule.effectiveFrom
                  ? ` from ${formatDate(lastFee.effectiveFrom)}`
                  : ''}
                . The change history keeps a record of the correction.
              </span>
            </span>
          </label>
        </fieldset>

        <div className="dlg-actions" style={{ justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <button type="button" className="btn outlined" onClick={props.onEnd}>
              End program
            </button>
            <button type="button" className="btn textb" style={{ color: 'var(--e)' }} onClick={() => setConfirmRemove(true)}>
              Remove
            </button>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn textb" onClick={props.onClose}>
              Cancel
            </button>
            <button type="submit" className="btn filled" disabled={busy}>
              Save
            </button>
          </div>
        </div>
      </form>
    </Dialog>
  )
}

// ---------- End a program ----------

export function EndProgramDialog({ enrollment: e, onClose, onDone }: { enrollment: EnrollmentView; onClose: () => void; onDone: (message: string) => void }) {
  const name = PROGRAM_NAME[e.program]
  const [v, setV] = useState<EndEnrollmentInput>({
    endDate: e.endDate ?? (todayIso() < e.startDate ? e.startDate : todayIso()),
    reason: e.endReason
  })
  const { busy, errors, submit } = useSubmit()
  return (
    <Dialog title={e.endDate ? `Last day in ${name}` : `End ${name}`} onClose={onClose}>
      <form
        noValidate
        style={{ display: 'flex', flexDirection: 'column', gap: 20 }}
        onSubmit={(ev) => {
          ev.preventDefault()
          void submit(endEnrollmentSchema, v, async () => {
            await call(window.lh.enrollments.end(e.id, v))
            onDone(`${name} ends on ${formatDate(v.endDate)}`)
          })
        }}
      >
        <p className="muted" style={{ margin: 0 }}>
          The timings and fees stay in the history. To move up a class (e.g. LKG → UKG), end this one and then add the new class.
        </p>
        <div className="grid">
          <TextField label="Last day" required type="date" value={v.endDate} onChange={(x) => setV({ ...v, endDate: x })} error={errors.endDate} />
          <TextField label="Reason" value={v.reason} onChange={(x) => setV({ ...v, reason: x })} error={errors.reason} placeholder="e.g. Moved to UKG, Left" />
        </div>
        <div className="dlg-actions">
          <button type="button" className="btn textb" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn filled" disabled={busy}>
            {e.endDate ? 'Save' : `End ${name}`}
          </button>
        </div>
      </form>
    </Dialog>
  )
}

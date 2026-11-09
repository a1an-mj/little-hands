import {
  FEE_FREQUENCIES,
  FREQUENCY_LABEL,
  PROGRAM_NAME,
  perLabel,
  type EnrollmentView,
  type FeeFrequency,
  type ProgramCode,
  type ProgramDefaults
} from '@shared/enrollments'
import { formatRupees, parseRupees, rupeesInput } from '@shared/money'
import { DAY_LABELS, SCHOOL_DAYS, hasDay, toggleDay } from '@shared/schedule'
import type { EnrollmentInput, FeeInput } from '@shared/schemas'
import { CheckIcon } from '../../components/icons'
import { TextField } from '../../components/TextField'

/** What the owner types for one program: the same fields on the admission form and in the dialogs. */
export interface ProgramForm {
  startDate: string
  days: number
  arrives: string
  leaves: string
  frequency: FeeFrequency
  customLabel: string
  standard: string
  concession: string
  concessionReason: string
  remarks: string
}

export function formFromDefaults(d: ProgramDefaults, startDate: string): ProgramForm {
  return {
    startDate,
    days: d.days,
    arrives: d.arrives,
    leaves: d.leaves,
    frequency: 'monthly',
    customLabel: '',
    standard: d.lastStandardPaise === null ? '' : rupeesInput(d.lastStandardPaise),
    concession: '',
    concessionReason: '',
    remarks: ''
  }
}

/** The latest timings and fee of an existing program, ready to edit. */
export function formFromEnrollment(e: EnrollmentView): ProgramForm {
  const s = e.schedules.at(-1)!
  const f = e.fees.at(-1)!
  return {
    startDate: e.startDate,
    days: s.days,
    arrives: s.arrives,
    leaves: s.leaves,
    frequency: f.frequency,
    customLabel: f.customLabel,
    standard: rupeesInput(f.standardPaise),
    concession: f.concessionPaise ? rupeesInput(f.concessionPaise) : '',
    concessionReason: f.concessionReason,
    remarks: f.remarks
  }
}

export const feeInput = (f: ProgramForm): FeeInput => ({
  frequency: f.frequency,
  customLabel: f.customLabel,
  standard: f.standard,
  concession: f.concession,
  concessionReason: f.concessionReason,
  remarks: f.remarks
})

export const enrollmentInput = (program: ProgramCode, f: ProgramForm): EnrollmentInput => ({
  program,
  startDate: f.startDate,
  schedule: { days: f.days, arrives: f.arrives, leaves: f.leaves },
  fee: feeInput(f)
})

/** Agreed fee worked out live as the owner types (null while the amounts aren't valid yet). */
export function agreedPaise(f: ProgramForm): number | null {
  const std = parseRupees(f.standard)
  const conc = f.concession.trim() ? parseRupees(f.concession) : 0
  if (std === null || conc === null) return null
  return Math.max(0, std - conc)
}

export const agreedText = (f: ProgramForm) => {
  const a = agreedPaise(f)
  return a === null ? '₹—' : formatRupees(a)
}

export const perText = (f: ProgramForm) => perLabel(f.frequency, f.customLabel)

interface Props {
  program: ProgramCode
  value: ProgramForm
  onChange: (patch: Partial<ProgramForm>) => void
  /** Errors keyed like the schema: "startDate", "schedule.leaves", "fee.standard"… */
  errors: Record<string, string | undefined>
  startLabel?: string
  showStart?: boolean
  showRemarks?: boolean
}

/** Days, timings, start date and fee for one program (design: AddStudent.html, "Programs, timings & fees"). */
export function ProgramFields({ program, value: f, onChange, errors, startLabel = 'Starts on', showStart = true, showRemarks }: Props) {
  const name = PROGRAM_NAME[program]
  const hasConcession = (parseRupees(f.concession) ?? 0) > 0 || f.concessionReason !== ''
  return (
    <div className="pbody">
      <div role="group" aria-label={`${name} days`} data-error={errors['schedule.days'] ? 'true' : undefined} tabIndex={-1}>
        <div className="small muted" style={{ marginBottom: 8 }}>
          Days
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {DAY_LABELS.slice(0, SCHOOL_DAYS).map((label, i) => {
            const on = hasDay(f.days, i)
            return (
              <button key={label} type="button" className="chip" aria-pressed={on} onClick={() => onChange({ days: toggleDay(f.days, i) })}>
                {on && <CheckIcon />}
                {label}
              </button>
            )
          })}
        </div>
        {errors['schedule.days'] && (
          <div className="field-error" role="alert" style={{ marginTop: 6 }}>
            {errors['schedule.days']}
          </div>
        )}
      </div>

      <div className="grid">
        <TextField label={`${name} arrives`} type="time" value={f.arrives} onChange={(v) => onChange({ arrives: v })} error={errors['schedule.arrives']} />
        <TextField label={`${name} leaves`} type="time" value={f.leaves} onChange={(v) => onChange({ leaves: v })} error={errors['schedule.leaves']} />
        {showStart && (
          <TextField label={`${name} ${startLabel.toLowerCase()}`} type="date" value={f.startDate} onChange={(v) => onChange({ startDate: v })} error={errors.startDate} />
        )}
      </div>

      <div className="feebox">
        <label className={errors['fee.frequency'] ? 'tf err' : 'tf'}>
          <span className="lb">Charged</span>
          <select aria-label={`${name} charged`} value={f.frequency} onChange={(e) => onChange({ frequency: e.target.value as FeeFrequency })}>
            {FEE_FREQUENCIES.map((q) => (
              <option key={q} value={q}>
                {FREQUENCY_LABEL[q]}
              </option>
            ))}
          </select>
        </label>
        <TextField label={`${name} standard fee (₹)`} inputMode="decimal" value={f.standard} onChange={(v) => onChange({ standard: v })} error={errors['fee.standard']} />
        <TextField label={`${name} concession (₹)`} inputMode="decimal" value={f.concession} onChange={(v) => onChange({ concession: v })} error={errors['fee.concession']} placeholder="0" />
        <div aria-live="polite">
          <div className="small muted">Agreed fee</div>
          <div className="agreed" data-testid={`agreed-${program}`}>{agreedText(f)}</div>
          <div className="small muted">per {perText(f)}</div>
        </div>
        {f.frequency === 'custom' && (
          <div style={{ gridColumn: '1 / -1' }}>
            <TextField
              label={`How ${name} is charged`}
              value={f.customLabel}
              onChange={(v) => onChange({ customLabel: v })}
              error={errors['fee.customLabel']}
              placeholder="e.g. One-time, Every 2 months"
            />
          </div>
        )}
        {f.frequency === 'term' && (
          <div className="small muted" style={{ gridColumn: '1 / -1' }}>
            The term dates will be set up with the payments module.
          </div>
        )}
      </div>

      <TextField
        label={`${name} reason for concession`}
        value={f.concessionReason}
        onChange={(v) => onChange({ concessionReason: v })}
        error={errors['fee.concessionReason']}
        placeholder="e.g. Sibling, staff family"
        help={hasConcession ? undefined : 'Only if there is one'}
      />
      {showRemarks && (
        <TextField label="Remarks" multiline value={f.remarks} onChange={(v) => onChange({ remarks: v })} error={errors['fee.remarks']} />
      )}
    </div>
  )
}

export function ProgramTag({ code, large }: { code: ProgramCode; large?: boolean }) {
  return <span className={`tag ${large ? 'lg ' : ''}${code}`}>{PROGRAM_NAME[code]}</span>
}

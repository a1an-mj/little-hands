import {
  FEE_PERIODS,
  PROGRAM_NAME,
  isExtra,
  isKnownPeriod,
  perText as periodText,
  type EnrollmentView,
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
  /** 1 = monthly, 3 = every 3 months, 0 = one-time. */
  periodMonths: number
  /** Day of the month, as typed. */
  dueDay: string
  standard: string
  concession: string
  concessionReason: string
  remarks: string
}

const dayOf = (iso: string) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? String(Number(iso.slice(8, 10))) : '')

/** A new start date. The due day follows the start day, unless the owner has already changed it. */
export function withStartDate(f: ProgramForm, startDate: string): ProgramForm {
  const dueDay = f.dueDay === dayOf(f.startDate) ? dayOf(startDate) || f.dueDay : f.dueDay
  return { ...f, startDate, dueDay }
}

export function formFromDefaults(d: ProgramDefaults, startDate: string): ProgramForm {
  return {
    startDate,
    days: d.days,
    periodMonths: 1,
    dueDay: dayOf(startDate),
    standard: d.lastStandardPaise === null ? '' : rupeesInput(d.lastStandardPaise),
    concession: '',
    concessionReason: '',
    remarks: ''
  }
}

/** The latest days and fee of an existing program, ready to edit. */
export function formFromEnrollment(e: EnrollmentView): ProgramForm {
  const s = e.schedules.at(-1) // none for extras
  const f = e.fees.at(-1)!
  return {
    startDate: e.startDate,
    days: s?.days ?? 0,
    periodMonths: f.periodMonths,
    dueDay: String(f.dueDay),
    standard: rupeesInput(f.standardPaise),
    concession: f.concessionPaise ? rupeesInput(f.concessionPaise) : '',
    concessionReason: f.concessionReason,
    remarks: f.remarks
  }
}

export const feeInput = (f: ProgramForm): FeeInput => ({
  periodMonths: f.periodMonths,
  dueDay: f.dueDay,
  standard: f.standard,
  concession: f.concession,
  concessionReason: f.concessionReason,
  remarks: f.remarks
})

export const enrollmentInput = (program: ProgramCode, f: ProgramForm): EnrollmentInput => ({
  program,
  startDate: f.startDate,
  schedule: isExtra(program) ? undefined : { days: f.days },
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

/** "/ month", "every 3 months", "one-time". */
export const perText = (f: ProgramForm) => periodText(f.periodMonths)

interface Props {
  program: ProgramCode
  value: ProgramForm
  onChange: (patch: Partial<ProgramForm>) => void
  /** Errors keyed like the schema: "startDate", "schedule.days", "fee.standard"… */
  errors: Record<string, string | undefined>
  startLabel?: string
  showStart?: boolean
  showRemarks?: boolean
}

/** Days, start date and fee for one program (design: AddStudent.html, "Programs, days & fees"). */
export function ProgramFields({ program, value: f, onChange: change, errors, startLabel = 'Starts on', showStart = true, showRemarks }: Props) {
  const name = PROGRAM_NAME[program]
  const onChange = (patch: Partial<ProgramForm>) =>
    change(patch.startDate !== undefined ? { ...patch, dueDay: withStartDate(f, patch.startDate).dueDay } : patch)
  const day = Number(f.dueDay)
  const hasConcession = (parseRupees(f.concession) ?? 0) > 0 || f.concessionReason !== ''
  return (
    <div className="pbody">
      {!isExtra(program) && (
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
      )}

      <div className="grid">
        {showStart && (
          <TextField label={`${name} ${startLabel.toLowerCase()}`} type="date" value={f.startDate} onChange={(v) => onChange({ startDate: v })} error={errors.startDate} />
        )}
      </div>

      <div className="feebox">
        <label className={errors['fee.periodMonths'] ? 'tf err' : 'tf'}>
          <span className="lb">Pays every</span>
          <select aria-label={`${name} pays every`} value={f.periodMonths} onChange={(e) => onChange({ periodMonths: Number(e.target.value) })}>
            {!isKnownPeriod(f.periodMonths) && <option value={f.periodMonths}>Every {f.periodMonths} months</option>}
            {FEE_PERIODS.map((p) => (
              <option key={p.months} value={p.months}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <TextField
          label={`${name} due on day`}
          inputMode="numeric"
          value={f.dueDay}
          onChange={(v) => onChange({ dueDay: v })}
          error={errors['fee.dueDay']}
          help={day > 28 && day <= 31 ? 'Last day in shorter months' : 'Day of the month, e.g. 10'}
        />
        <TextField label={`${name} standard fee (₹)`} inputMode="decimal" value={f.standard} onChange={(v) => onChange({ standard: v })} error={errors['fee.standard']} />
        <TextField label={`${name} concession (₹)`} inputMode="decimal" value={f.concession} onChange={(v) => onChange({ concession: v })} error={errors['fee.concession']} placeholder="0" />
        <div aria-live="polite">
          <div className="small muted">Agreed fee</div>
          <div className="agreed" data-testid={`agreed-${program}`}>{agreedText(f)}</div>
          <div className="small muted">{perText(f).replace(/^\/ /, 'per ')}</div>
        </div>
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

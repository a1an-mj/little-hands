import { useEffect, useState } from 'react'
import { NEXT_CLASS, PROGRAM_NAME, type EnrollmentView, type ProgramCode } from '@shared/enrollments'
import { formatRupees, rupeesInput } from '@shared/money'
import { moveUpSchema } from '@shared/schemas'
import { Dialog } from '../../components/Dialog'
import { TextField } from '../../components/TextField'
import { call, useLoad } from '../../lib/api'
import { todayIso } from '../../lib/format'
import { useSubmit } from './ProfileDialogs'

/** The next 1 June (the school year starts in June). */
export function nextYearStart(today = todayIso()): string {
  const y = Number(today.slice(0, 4))
  return Number(today.slice(5, 7)) >= 6 ? `${y + 1}-06-01` : `${y}-06-01`
}

/** The fee to suggest for the next class: the last one agreed for it, else the current fee. */
function useSuggestedFee(next: ProgramCode, fallbackPaise: number | null) {
  const { data: defaults } = useLoad(() => window.lh.enrollments.defaults(), [])
  const last = defaults?.find((d) => d.code === next)?.lastStandardPaise ?? null
  return defaults ? (last ?? fallbackPaise) : undefined
}

/** One child moves up (e.g. LKG → UKG) from a date, at the new class's fee. */
export function MoveUpDialog({ enrollment: e, onClose, onDone }: { enrollment: EnrollmentView; onClose: () => void; onDone: (msg: string) => void }) {
  const next = NEXT_CLASS[e.program]!
  const current = e.fees.at(-1)!
  const suggested = useSuggestedFee(next, current.standardPaise)
  const [v, setV] = useState({ from: nextYearStart(), standard: '' })
  useEffect(() => {
    if (suggested !== undefined && !v.standard) setV((x) => ({ ...x, standard: suggested === null ? '' : rupeesInput(suggested) }))
  }, [suggested, v.standard])
  const { busy, errors, submit } = useSubmit()
  return (
    <Dialog title={`Move up to ${PROGRAM_NAME[next]}`} onClose={onClose}>
      <form
        noValidate
        style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
        onSubmit={(ev) => {
          ev.preventDefault()
          void submit(moveUpSchema, v, async () => {
            await call(window.lh.enrollments.moveUp(e.id, v))
            onDone(`Moves up to ${PROGRAM_NAME[next]}`)
          })
        }}
      >
        <p className="muted" style={{ margin: 0 }}>
          {PROGRAM_NAME[e.program]} ends the day before; {PROGRAM_NAME[next]} starts with the same days, payment period and due day.
          {current.concessionPaise > 0 && ` The concession (${formatRupees(current.concessionPaise)}, ${current.concessionReason}) stays.`}
        </p>
        <div className="grid">
          <TextField label={`${PROGRAM_NAME[next]} starts on`} type="date" value={v.from} onChange={(x) => setV({ ...v, from: x })} error={errors.from} />
          <TextField label={`${PROGRAM_NAME[next]} standard fee (₹)`} inputMode="decimal" value={v.standard} onChange={(x) => setV({ ...v, standard: x })} error={errors.standard} help="Per month" />
        </div>
        <div className="dlg-actions">
          <button type="button" className="btn textb" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn filled" disabled={busy}>
            Move up
          </button>
        </div>
      </form>
    </Dialog>
  )
}

/** Everyone in a class moves up together (June), at the new class's fee. */
export function MoveClassDialog({ code, count, onClose, onDone }: { code: ProgramCode; count: number; onClose: () => void; onDone: () => void }) {
  const next = NEXT_CLASS[code]!
  const suggested = useSuggestedFee(next, null)
  const [v, setV] = useState({ from: nextYearStart(), standard: '' })
  const [result, setResult] = useState<{ moved: number; skipped: { name: string; reason: string }[] } | null>(null)
  useEffect(() => {
    if (suggested !== undefined && suggested !== null && !v.standard) setV((x) => ({ ...x, standard: rupeesInput(suggested) }))
  }, [suggested, v.standard])
  const { busy, errors, submit } = useSubmit()

  if (result) {
    return (
      <Dialog title={`Moved up to ${PROGRAM_NAME[next]}`} onClose={onDone}>
        <p style={{ margin: 0 }} data-testid="move-result">
          {result.moved} {result.moved === 1 ? 'child' : 'children'} moved up to {PROGRAM_NAME[next]}.
        </p>
        {result.skipped.length > 0 && (
          <div>
            <div className="t-lg">Not moved</div>
            <ul>
              {result.skipped.map((s) => (
                <li key={s.name}>
                  {s.name}: <span className="muted">{s.reason}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="dlg-actions">
          <button type="button" className="btn filled" onClick={onDone}>
            Done
          </button>
        </div>
      </Dialog>
    )
  }

  return (
    <Dialog title={`Move all ${PROGRAM_NAME[code]} children to ${PROGRAM_NAME[next]}?`} onClose={onClose}>
      <form
        noValidate
        style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
        onSubmit={(ev) => {
          ev.preventDefault()
          void submit(moveUpSchema, v, async () => {
            setResult(await call(window.lh.enrollments.moveUpClass(code, v)))
          })
        }}
      >
        <p className="muted" style={{ margin: 0 }}>
          The {count} active {count === 1 ? 'child' : 'children'} in {PROGRAM_NAME[code]} move to {PROGRAM_NAME[next]}, each keeping their
          days, payment period, due day and concession. Children who are leaving can be marked Inactive or Graduated afterwards.
        </p>
        <div className="grid">
          <TextField label={`${PROGRAM_NAME[next]} starts on`} type="date" value={v.from} onChange={(x) => setV({ ...v, from: x })} error={errors.from} />
          <TextField label={`${PROGRAM_NAME[next]} standard fee (₹)`} inputMode="decimal" value={v.standard} onChange={(x) => setV({ ...v, standard: x })} error={errors.standard} help="Per month, for everyone" />
        </div>
        <div className="dlg-actions">
          <button type="button" className="btn textb" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn filled" disabled={busy}>
            Move {count} up
          </button>
        </div>
      </form>
    </Dialog>
  )
}

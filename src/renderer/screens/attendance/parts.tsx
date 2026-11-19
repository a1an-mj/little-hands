import { useState } from 'react'
import { closedText, type SessionState } from '@shared/attendance'
import { formatTime } from '@shared/schedule'
import { Dialog } from '../../components/Dialog'
import { TextField } from '../../components/TextField'

/** The coloured tag for a session: "Arrived 8:41 AM", "Left 12:35 PM", "Absent today", "Not marked yet". */
export function statusTag(s: SessionState, opts: { isToday: boolean }): { text: string; cls: string } {
  switch (s.status) {
    case 'in':
      return { text: s.arrived ? `Arrived ${formatTime(s.arrived)}` : 'Present', cls: 'tag ok' }
    case 'out':
      return { text: `Left ${formatTime(s.left!)}`, cls: 'tag nt' }
    case 'absent':
      return { text: s.note ? `Absent · ${s.note}` : opts.isToday ? 'Absent today' : 'Absent', cls: 'tag due' }
    case 'none':
      return { text: opts.isToday ? 'Not marked yet' : 'Not marked', cls: 'tag nt' }
  }
}

/** "School closed": asks for an optional reason (Onam, Christmas, strike…). */
export function CloseDayDialog({ dateText, onClose, onConfirm }: { dateText: string; onClose: () => void; onConfirm: (reason: string) => Promise<void> }) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <Dialog title={`School closed ${dateText}?`} onClose={onClose}>
      <form
        noValidate
        style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
        onSubmit={(e) => {
          e.preventDefault()
          setBusy(true)
          void onConfirm(reason.trim()).finally(() => setBusy(false))
        }}
      >
        <p className="muted" style={{ margin: 0 }}>
          Nobody will be expected, so no one shows as late or absent. Anything already marked is kept.
        </p>
        <TextField label="Reason" value={reason} onChange={setReason} placeholder="e.g. Onam, Christmas, strike" autoFocus />
        <div className="dlg-actions">
          <button type="button" className="btn textb" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn filled" disabled={busy}>
            Mark as closed
          </button>
        </div>
      </form>
    </Dialog>
  )
}

/** Shown instead of the list on a closed day. */
export function ClosedBanner({ closed, onReopen }: { closed: { reason: string }; onReopen: () => void }) {
  return (
    <div className="closed-banner" data-testid="closed-banner">
      <span className="t-lg" style={{ flex: 1 }}>{closedText(closed)}</span>
      <button type="button" className="btn textb" onClick={onReopen}>
        Open again
      </button>
    </div>
  )
}

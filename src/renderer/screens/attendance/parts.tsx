import { useState } from 'react'
import { closedText, durationText, minutesLate, waitingNote, type SessionState } from '@shared/attendance'
import { formatTime } from '@shared/schedule'
import { Dialog } from '../../components/Dialog'
import { TextField } from '../../components/TextField'

/** The coloured tag for a session: "Arrived 8:41 AM", "5 min late", "Absent today", "Later today"… */
export function statusTag(
  s: SessionState,
  expected: string | null,
  opts: { isToday: boolean; now: string }
): { text: string; cls: string } {
  switch (s.status) {
    case 'in':
      return { text: s.arrived ? `Arrived ${formatTime(s.arrived)}` : 'Present', cls: 'tag ok' }
    case 'out':
      return { text: `Left ${formatTime(s.left!)}`, cls: 'tag nt' }
    case 'absent':
      return { text: s.note ? `Absent · ${s.note}` : opts.isToday ? 'Absent today' : 'Absent', cls: 'tag due' }
    case 'none': {
      if (!opts.isToday || !expected) return { text: 'Not marked', cls: 'tag nt' }
      const w = waitingNote(expected, opts.now)
      if (w.kind === 'later') return { text: 'Later today', cls: 'tag nt' }
      if (w.kind === 'soon') return { text: 'Not yet', cls: 'tag nt' }
      return { text: `${durationText(w.mins)} late`, cls: 'tag due' }
    }
  }
}

/** For a past day: "On time" / "5 min late" (only when an arrival time was recorded). */
export function punctualityTag(s: SessionState, expected: string | null): { text: string; cls: string } | null {
  if ((s.status !== 'in' && s.status !== 'out') || !s.arrived || !expected) return null
  const late = minutesLate(expected, s.arrived)
  return late === 0 ? { text: 'On time', cls: 'tag ok' } : { text: `${durationText(late)} late`, cls: 'tag part' }
}

/** Is the session still waiting, and far enough away that "Absent" makes no sense yet? */
export const isLater = (s: SessionState, expected: string | null, now: string) =>
  s.status === 'none' && !!expected && waitingNote(expected, now).kind === 'later'

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

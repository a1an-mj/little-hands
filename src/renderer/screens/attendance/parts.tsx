import { durationText, minutesLate, waitingNote, type SessionState } from '@shared/attendance'
import { formatTime } from '@shared/schedule'

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

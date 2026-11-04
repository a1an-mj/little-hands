import { useState } from 'react'
import type { Theme } from '@shared/ipc-contract'
import { formatRecoveryCode } from '@shared/recovery-code'
import { CheckIcon } from '../components/icons'
import { LockLayout } from '../components/LockLayout'

interface Props {
  theme: Theme
  onToggleTheme: () => void
  code: string
  isNew: boolean
  onDone: () => void
}

/** Shows the recovery code once. The owner must confirm they wrote it down. */
export function RecoveryCodeScreen({ theme, onToggleTheme, code, isNew, onDone }: Props) {
  const [written, setWritten] = useState(false)
  return (
    <LockLayout
      theme={theme}
      onToggleTheme={onToggleTheme}
      title={isNew ? 'Your new recovery code' : 'Your recovery code'}
      subtitle="If you ever forget your PIN, this code lets you choose a new one."
      wide
    >
      <div className="code" data-testid="recovery-code">
        {formatRecoveryCode(code)}
      </div>
      <p className="muted" style={{ margin: 0, textAlign: 'center' }}>
        Write it on paper and keep it somewhere safe, away from this laptop.
        {isNew ? ' Your old code no longer works.' : ''} It will not be shown again.
      </p>
      <label className="check">
        <input type="checkbox" checked={written} onChange={(e) => setWritten(e.target.checked)} />
        <span className="cbox">{written && <CheckIcon />}</span>
        I have written the code down
      </label>
      <button type="button" className="btn lg filled" style={{ width: '100%' }} disabled={!written} onClick={onDone}>
        Continue
      </button>
    </LockLayout>
  )
}

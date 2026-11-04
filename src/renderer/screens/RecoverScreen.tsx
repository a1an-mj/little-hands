import { useState } from 'react'
import type { Theme } from '@shared/ipc-contract'
import { normalizeRecoveryCode } from '@shared/recovery-code'
import { LockLayout, useSecondsLeft, waitMessage } from '../components/LockLayout'
import { ChoosePinScreen } from './ChoosePinScreen'

interface Props {
  theme: Theme
  onToggleTheme: () => void
  initialWaitUntil: number | null
  onBack: () => void
  /** Called with the new recovery code after a new PIN is saved. */
  onReset: (newRecoveryCode: string) => void
}

/** "Forgot PIN?": type the recovery code, then choose a new PIN. */
export function RecoverScreen({ theme, onToggleTheme, initialWaitUntil, onBack, onReset }: Props) {
  const [code, setCode] = useState('')
  const [verified, setVerified] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [waitUntil, setWaitUntil] = useState(initialWaitUntil)
  const secondsLeft = useSecondsLeft(waitUntil)
  const waiting = secondsLeft > 0

  if (verified !== null) {
    return (
      <ChoosePinScreen
        theme={theme}
        onToggleTheme={onToggleTheme}
        title="Choose a new PIN"
        onCancel={onBack}
        onChosen={async (pin) => {
          const result = await window.lh.lock.resetWithRecovery(verified, pin)
          if (!result.ok) throw new Error('Recovery code no longer accepted')
          onReset(result.recoveryCode)
        }}
      />
    )
  }

  async function check(e: React.FormEvent) {
    e.preventDefault()
    if (busy || waiting) return
    if (!normalizeRecoveryCode(code)) {
      setError('A recovery code has 16 letters and numbers, like 7KQ4-M9TX-2HPV-WN3C.')
      return
    }
    setBusy(true)
    const result = await window.lh.lock.checkRecovery(code)
    setBusy(false)
    if (result.ok) {
      setVerified(code)
      return
    }
    setWaitUntil(result.waitUntil)
    setError(
      result.reason === 'wrong' && result.waitUntil === null
        ? `That recovery code isn't right. ${result.triesLeft} ${result.triesLeft === 1 ? 'try' : 'tries'} left.`
        : ''
    )
  }

  return (
    <LockLayout
      theme={theme}
      onToggleTheme={onToggleTheme}
      title="Forgot your PIN?"
      subtitle="Type the recovery code you wrote down when you set up Little Hands."
      wide
    >
      <form onSubmit={check} style={{ display: 'flex', flexDirection: 'column', gap: 16, alignSelf: 'stretch' }}>
        <label className="tf">
          <span className="lb">Recovery code</span>
          <input
            type="text"
            value={code}
            autoFocus
            autoComplete="off"
            spellCheck={false}
            placeholder="XXXX-XXXX-XXXX-XXXX"
            onChange={(e) => { setCode(e.target.value); setError('') }}
            disabled={waiting}
          />
          <span className="help">Capital or small letters both work. Dashes are optional.</span>
        </label>
        <div className="msg" role="alert">
          {waiting ? waitMessage(secondsLeft) : error}
        </div>
        <button type="submit" className="btn lg filled" disabled={!code.trim() || busy || waiting}>
          Continue
        </button>
      </form>
      <div className="lock-foot">
        <button type="button" className="btn textb" onClick={onBack}>
          Back to PIN
        </button>
      </div>
    </LockLayout>
  )
}

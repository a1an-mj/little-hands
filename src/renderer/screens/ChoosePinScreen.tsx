import { useState } from 'react'
import type { Theme } from '@shared/ipc-contract'
import { LockLayout } from '../components/LockLayout'
import { PinPad } from '../components/PinPad'

interface Props {
  theme: Theme
  onToggleTheme: () => void
  title: string
  /** Called with the confirmed PIN. */
  onChosen: (pin: string) => Promise<void>
  onCancel?: () => void
}

/** Choose a 4-digit PIN, then type it again to confirm. Used on first run and after recovery. */
export function ChoosePinScreen({ theme, onToggleTheme, title, onChosen, onCancel }: Props) {
  const [first, setFirst] = useState<string | null>(null)
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [shake, setShake] = useState(0)
  const [busy, setBusy] = useState(false)

  async function next() {
    if (pin.length !== 4 || busy) return
    if (first === null) {
      setFirst(pin)
      setPin('')
      return
    }
    if (pin !== first) {
      setFirst(null)
      setPin('')
      setShake((n) => n + 1)
      setError("The two PINs didn't match. Please choose your PIN again.")
      return
    }
    setBusy(true)
    try {
      await onChosen(pin)
    } catch {
      setBusy(false)
      setError('Something went wrong. Please try again.')
    }
  }

  const confirming = first !== null
  return (
    <LockLayout
      theme={theme}
      onToggleTheme={onToggleTheme}
      title={title}
      subtitle={confirming ? 'Enter the same PIN again' : 'Choose a 4-digit PIN'}
    >
      <PinPad value={pin} onChange={(v) => { setPin(v); setError('') }} onSubmit={next} disabled={busy} shakeKey={shake} />
      <div className={error ? 'msg' : 'msg info'} role="alert">
        {error || (confirming ? '' : 'You will type this PIN each time you open Little Hands.')}
      </div>
      <button type="button" className="btn lg filled" style={{ width: '100%' }} disabled={pin.length < 4 || busy} onClick={next}>
        {confirming ? 'Save PIN' : 'Next'}
      </button>
      {(confirming || onCancel) && (
        <div className="lock-foot">
          <button
            type="button"
            className="btn textb"
            onClick={() => {
              if (confirming) { setFirst(null); setPin(''); setError('') } else onCancel?.()
            }}
          >
            {confirming ? 'Start again' : 'Back'}
          </button>
        </div>
      )}
    </LockLayout>
  )
}

import { useState } from 'react'
import type { Theme } from '@shared/ipc-contract'
import { LockLayout, useSecondsLeft, waitMessage } from '../components/LockLayout'
import { PinPad } from '../components/PinPad'

interface Props {
  theme: Theme
  onToggleTheme: () => void
  initialWaitUntil: number | null
  onForgot: () => void
}

export function LockScreen({ theme, onToggleTheme, initialWaitUntil, onForgot }: Props) {
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [shake, setShake] = useState(0)
  const [waitUntil, setWaitUntil] = useState(initialWaitUntil)
  const secondsLeft = useSecondsLeft(waitUntil)
  const waiting = secondsLeft > 0

  async function unlock() {
    if (pin.length !== 4 || busy || waiting) return
    setBusy(true)
    const result = await window.lh.lock.unlock(pin)
    setBusy(false)
    if (result.ok) return // App switches to the main screen when the main process reports "unlocked"
    setPin('')
    setShake((n) => n + 1)
    setWaitUntil(result.waitUntil)
    if (result.reason === 'wrong' && result.waitUntil === null) {
      setError(`That PIN isn't right. ${result.triesLeft} ${result.triesLeft === 1 ? 'try' : 'tries'} left.`)
    } else {
      setError('')
    }
  }

  return (
    <LockLayout theme={theme} onToggleTheme={onToggleTheme} title="Little Hands" subtitle="Enter your PIN">
      <PinPad value={pin} onChange={(v) => { setPin(v); setError('') }} onSubmit={unlock} disabled={busy || waiting} shakeKey={shake} />
      <div className="msg" role="alert">
        {waiting ? waitMessage(secondsLeft) : error}
      </div>
      <button type="button" className="btn lg filled" style={{ width: '100%' }} disabled={pin.length < 4 || busy || waiting} onClick={unlock}>
        Unlock
      </button>
      <div className="lock-foot">
        <button type="button" className="btn textb" onClick={onForgot}>
          Forgot PIN?
        </button>
        <span className="small muted">Locks itself after 10 minutes without use</span>
      </div>
    </LockLayout>
  )
}

import { useEffect, useState } from 'react'
import type { LockStatus } from '@shared/ipc-contract'
import { useActivityPing } from './hooks/useActivityPing'
import { useTheme } from './hooks/useTheme'
import { ChoosePinScreen } from './screens/ChoosePinScreen'
import { LockScreen } from './screens/LockScreen'
import { RecoverScreen } from './screens/RecoverScreen'
import { RecoveryCodeScreen } from './screens/RecoveryCodeScreen'
import { Shell } from './shell/Shell'

export function App() {
  const [theme, toggleTheme] = useTheme()
  const [status, setStatus] = useState<LockStatus | null>(null)
  const [recovering, setRecovering] = useState(false)
  // A recovery code waiting to be shown. Kept across an auto-lock so it is never lost.
  const [pendingCode, setPendingCode] = useState<{ code: string; isNew: boolean } | null>(null)

  useEffect(() => {
    void window.lh.lock.status().then(setStatus)
    return window.lh.lock.onChange((s) => {
      setStatus(s)
      if (s.state === 'locked') setRecovering(false)
    })
  }, [])

  const unlocked = status?.state === 'unlocked'
  useActivityPing(unlocked)

  const common = { theme, onToggleTheme: toggleTheme }

  if (status === null) return null

  if (status.state === 'needs-setup') {
    return (
      <ChoosePinScreen
        {...common}
        title="Welcome to Little Hands"
        onChosen={async (pin) => {
          const { recoveryCode } = await window.lh.lock.setup(pin)
          setPendingCode({ code: recoveryCode, isNew: false })
          setStatus({ state: 'unlocked' })
        }}
      />
    )
  }

  if (status.state === 'locked') {
    return recovering ? (
      <RecoverScreen
        {...common}
        initialWaitUntil={status.waitUntil}
        onBack={() => setRecovering(false)}
        onReset={(code) => {
          setRecovering(false)
          setPendingCode({ code, isNew: true })
          setStatus({ state: 'unlocked' })
        }}
      />
    ) : (
      <LockScreen {...common} initialWaitUntil={status.waitUntil} onForgot={() => setRecovering(true)} />
    )
  }

  if (pendingCode) {
    return <RecoveryCodeScreen {...common} code={pendingCode.code} isNew={pendingCode.isNew} onDone={() => setPendingCode(null)} />
  }

  return <Shell {...common} onLock={() => void window.lh.lock.lockNow()} />
}

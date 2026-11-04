import { useEffect } from 'react'

interface Props {
  value: string
  onChange: (value: string) => void
  onSubmit?: () => void
  disabled?: boolean
  /** Bump this number to play the "wrong PIN" shake. */
  shakeKey?: number
}

const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9']

/** Four dots plus an on-screen keypad. The physical keyboard works too (digits, Backspace, Esc, Enter). */
export function PinPad({ value, onChange, onSubmit, disabled = false, shakeKey = 0 }: Props) {
  const add = (d: string) => !disabled && value.length < 4 && onChange(value + d)
  const back = () => !disabled && onChange(value.slice(0, -1))
  const clear = () => !disabled && onChange('')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return
      if (/^\d$/.test(e.key)) add(e.key)
      else if (e.key === 'Backspace') back()
      else if (e.key === 'Escape') clear()
      else if (e.key === 'Enter' && value.length === 4 && !disabled) onSubmit?.()
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <>
      <div
        key={shakeKey}
        className={shakeKey ? 'dots shake' : 'dots'}
        role="status"
        aria-label={`${value.length} of 4 digits entered`}
      >
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={i < value.length ? 'dot filled pop' : 'dot'} />
        ))}
      </div>
      <div className="keys">
        {DIGITS.map((d) => (
          <button key={d} type="button" className="key" onClick={() => add(d)} disabled={disabled} aria-label={d}>
            {d}
          </button>
        ))}
        <button type="button" className="key alt" onClick={clear} disabled={disabled}>
          Clear
        </button>
        <button type="button" className="key" onClick={() => add('0')} disabled={disabled} aria-label="0">
          0
        </button>
        <button type="button" className="key alt" onClick={back} disabled={disabled} aria-label="Delete last digit">
          ⌫
        </button>
      </div>
    </>
  )
}

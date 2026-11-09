import { useId, type ChangeEvent, type ReactNode } from 'react'

interface Props {
  label: string
  value: string
  onChange: (value: string) => void
  error?: string
  help?: ReactNode
  type?: 'text' | 'tel' | 'date' | 'time'
  /** Shows a number keypad on touch screens, e.g. 'decimal' for money. */
  inputMode?: 'decimal' | 'numeric'
  multiline?: boolean
  rows?: number
  placeholder?: string
  readOnly?: boolean
  required?: boolean
  autoFocus?: boolean
  name?: string
  max?: string
}

/** Outlined text field from the designs. Shows the error under the field when there is one. */
export function TextField(p: Props) {
  const helpId = useId()
  const onChange = (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => p.onChange(e.target.value)
  const common = {
    value: p.value,
    onChange,
    placeholder: p.placeholder,
    readOnly: p.readOnly,
    autoFocus: p.autoFocus,
    name: p.name,
    'aria-invalid': p.error ? true : undefined,
    'aria-describedby': p.error || p.help ? helpId : undefined,
    'data-field': p.name
  }
  const cls = ['tf', p.readOnly && 'ro', p.error && 'err'].filter(Boolean).join(' ')
  return (
    <label className={cls}>
      <span className="lb">
        {p.label}
        {p.required ? ' *' : ''}
      </span>
      {p.multiline ? (
        <textarea rows={p.rows ?? 2} {...common} />
      ) : (
        <input type={p.type ?? 'text'} max={p.max} inputMode={p.inputMode} autoComplete="off" spellCheck={p.type === 'text' || !p.type} {...common} />
      )}
      {(p.error || p.help) && (
        <span className="help" id={helpId} role={p.error ? 'alert' : undefined}>
          {p.error || p.help}
        </span>
      )}
    </label>
  )
}

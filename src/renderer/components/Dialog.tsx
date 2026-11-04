import { useEffect, useRef, type ReactNode } from 'react'

interface Props {
  title: string
  onClose: () => void
  children: ReactNode
}

/** A modal dialog (native <dialog>: keeps keyboard focus inside, Esc closes). Render it to open it. */
export function Dialog({ title, onClose, children }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    if (d && !d.open) d.showModal()
  }, [])
  return (
    <dialog
      ref={ref}
      className="dlg"
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
    >
      <div className="dlg-body">
        <h2 className="h-md">{title}</h2>
        {children}
      </div>
    </dialog>
  )
}

interface ConfirmProps {
  title: string
  message: ReactNode
  confirmLabel: string
  danger?: boolean
  onConfirm: () => void | Promise<void>
  onClose: () => void
}

export function ConfirmDialog({ title, message, confirmLabel, danger, onConfirm, onClose }: ConfirmProps) {
  return (
    <Dialog title={title} onClose={onClose}>
      <div className="muted">{message}</div>
      <div className="dlg-actions">
        <button type="button" className="btn textb" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className={danger ? 'btn danger-filled' : 'btn filled'} onClick={() => void onConfirm()}>
          {confirmLabel}
        </button>
      </div>
    </Dialog>
  )
}

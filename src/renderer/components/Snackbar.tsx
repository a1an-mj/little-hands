import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'

/** An optional button on the message, e.g. "Undo". */
export interface SnackAction {
  label: string
  run: () => void
}
type Show = (message: string, action?: SnackAction) => void
const SnackContext = createContext<Show>(() => {})

/** Short messages at the bottom of the screen ("Number copied"), gone after 4 seconds (6 with a button). */
export function SnackbarProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<{ text: string; action?: SnackAction; key: number } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  const show = useCallback<Show>((text, action) => {
    clearTimeout(timer.current)
    setMsg({ text, action, key: Date.now() })
    timer.current = setTimeout(() => setMsg(null), action ? 6000 : 4000)
  }, [])
  useEffect(() => () => clearTimeout(timer.current), [])

  return (
    <SnackContext.Provider value={show}>
      {children}
      {msg && (
        <div className="snack" role="status" key={msg.key}>
          <span style={{ flex: 1 }}>{msg.text}</span>
          {msg.action ? (
            <button
              type="button"
              className="btn"
              onClick={() => {
                setMsg(null)
                msg.action!.run()
              }}
            >
              {msg.action.label}
            </button>
          ) : (
            <button type="button" className="btn" onClick={() => setMsg(null)}>
              OK
            </button>
          )}
        </div>
      )}
    </SnackContext.Provider>
  )
}

export const useSnackbar = () => useContext(SnackContext)

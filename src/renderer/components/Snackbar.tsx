import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'

type Show = (message: string) => void
const SnackContext = createContext<Show>(() => {})

/** Short messages at the bottom of the screen ("Number copied"), gone after 4 seconds. */
export function SnackbarProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<{ text: string; key: number } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  const show = useCallback<Show>((text) => {
    clearTimeout(timer.current)
    setMsg({ text, key: Date.now() })
    timer.current = setTimeout(() => setMsg(null), 4000)
  }, [])
  useEffect(() => () => clearTimeout(timer.current), [])

  return (
    <SnackContext.Provider value={show}>
      {children}
      {msg && (
        <div className="snack" role="status" key={msg.key}>
          <span style={{ flex: 1 }}>{msg.text}</span>
          <button type="button" className="btn" onClick={() => setMsg(null)}>
            OK
          </button>
        </div>
      )}
    </SnackContext.Provider>
  )
}

export const useSnackbar = () => useContext(SnackContext)

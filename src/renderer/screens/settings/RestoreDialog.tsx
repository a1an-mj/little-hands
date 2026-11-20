import { useState } from 'react'
import type { BackupPreview } from '@shared/backup'
import { Dialog } from '../../components/Dialog'
import { AlertIcon } from '../../components/icons'
import { TextField } from '../../components/TextField'
import { call, messageOf } from '../../lib/api'

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })

const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path

/**
 * Restore: password → what's inside → "Replace everything on this laptop" → the app restarts.
 * Shows its own messages (it is also used on the first-run screen, where there is no snackbar).
 */
export function RestoreDialog({ path, onClose }: { path: string; onClose: () => void }) {
  const [password, setPassword] = useState('')
  const [preview, setPreview] = useState<BackupPreview | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  async function open() {
    if (!password) return setError('Enter the backup password')
    setBusy(true)
    setError('')
    try {
      setPreview(await call(window.lh.backup.inspect(path, password)))
    } catch (e) {
      setError(messageOf(e))
    } finally {
      setBusy(false)
    }
  }

  async function restore() {
    setBusy(true)
    setError('')
    try {
      await call(window.lh.backup.restore(path, password))
      setDone(true)
    } catch (e) {
      setError(messageOf(e))
      setBusy(false)
    }
  }

  if (done) {
    return (
      <Dialog title="Backup restored" onClose={() => undefined}>
        <p style={{ margin: 0 }} role="status">
          Little Hands is restarting with the restored data. Use the PIN from the laptop the backup came from.
        </p>
      </Dialog>
    )
  }

  return (
    <Dialog title="Restore from a backup" onClose={busy ? () => undefined : onClose}>
      <form
        noValidate
        style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
        onSubmit={(e) => {
          e.preventDefault()
          void (preview ? restore() : open())
        }}
      >
        <div className="who">
          <div style={{ minWidth: 0 }}>
            <div className="t-lg" style={{ overflowWrap: 'anywhere' }}>{fileName(path)}</div>
            <div className="small muted" style={{ overflowWrap: 'anywhere' }}>{path}</div>
          </div>
        </div>

        {!preview && (
          <TextField
            label="Backup password"
            type="password"
            value={password}
            onChange={(v) => {
              setPassword(v)
              setError('')
            }}
            error={error}
            autoFocus
            help="The password chosen when backups were set up"
          />
        )}

        {preview && (
          <>
            <div data-testid="backup-preview">
              <div className="t-lg">Backup from {when(preview.createdAt)}</div>
              <div className="muted">
                {preview.students} student{preview.students === 1 ? '' : 's'} · {preview.payments} payment{preview.payments === 1 ? '' : 's'}
                {preview.lastPaymentNo ? ` · last payment ${preview.lastPaymentNo}` : ''}
              </div>
            </div>
            <div className="alert" role="alert">
              <AlertIcon />
              <span>
                This replaces <strong>everything on this laptop</strong> with the data in this backup. The current data is kept aside
                first, just in case.
              </span>
            </div>
            {error && (
              <div className="field-error" role="alert">
                {error}
              </div>
            )}
          </>
        )}

        <div className="dlg-actions">
          <button type="button" className="btn textb" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          {preview ? (
            <button type="submit" className="btn danger-filled" disabled={busy}>
              {busy ? 'Restoring…' : 'Replace everything on this laptop'}
            </button>
          ) : (
            <button type="submit" className="btn filled" disabled={busy}>
              {busy ? 'Opening…' : 'Open backup'}
            </button>
          )}
        </div>
      </form>
    </Dialog>
  )
}

/** Opens the file picker, then the restore dialog for the chosen file. */
export function useRestorePicker() {
  const [path, setPath] = useState<string | null>(null)
  const [error, setError] = useState('')
  const choose = async () => {
    setError('')
    try {
      const p = await call(window.lh.backup.pickFile())
      if (p) setPath(p)
    } catch (e) {
      setError(messageOf(e))
    }
  }
  const dialog = path ? <RestoreDialog path={path} onClose={() => setPath(null)} /> : null
  return { choose, open: (p: string) => setPath(p), dialog, error }
}

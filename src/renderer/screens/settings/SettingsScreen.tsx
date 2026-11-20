import { useState } from 'react'
import { BACKUP_WARN_DAYS, MIN_PASSWORD, sizeText, type BackupStatus } from '@shared/backup'
import { formatDate } from '@shared/dates'
import type { Theme } from '@shared/ipc-contract'
import { formatTime } from '@shared/schedule'
import { Dialog } from '../../components/Dialog'
import { AlertIcon, CheckIcon } from '../../components/icons'
import { useSnackbar } from '../../components/Snackbar'
import { TextField } from '../../components/TextField'
import { ThemeSwitch } from '../../components/ThemeSwitch'
import { call, messageOf, useLoad } from '../../lib/api'
import { ImportStudents } from './ImportStudents'
import { useRestorePicker } from './RestoreDialog'

interface Props {
  theme: Theme
  onToggleTheme: () => void
}

/** "Today, 9:30 AM" / "19 Nov 2026, 5:45 PM" for a local "YYYY-MM-DDTHH:MM". */
export function backupWhen(at: string, today: string): string {
  const d = at.slice(0, 10)
  return `${d === today ? 'Today' : formatDate(d)}, ${formatTime(at.slice(11, 16))}`
}

/** The one-line backup status (dashboard and settings). */
export function backupLine(s: BackupStatus): { text: string; warn: boolean } {
  switch (s.warning) {
    case 'not-set-up':
      return { text: 'Backups are not set up yet', warn: true }
    case 'never':
      return { text: 'No backup yet', warn: true }
    case 'failed':
      return { text: `Last backup failed: ${s.lastError}`, warn: true }
    case 'old':
      return { text: `Last backup: ${backupWhen(s.lastBackupAt!, s.today)} (more than ${BACKUP_WARN_DAYS} days ago)`, warn: true }
    default:
      return { text: `Last backup: ${backupWhen(s.lastBackupAt!, s.today)}`, warn: false }
  }
}

type Open = { kind: 'setup' } | { kind: 'password' } | null

/** Settings: backup & restore, and importing students from the admission-form spreadsheet. */
export function SettingsScreen({ theme, onToggleTheme }: Props) {
  const snack = useSnackbar()
  const { data: s, reload } = useLoad(() => window.lh.backup.status(), [])
  const [open, setOpen] = useState<Open>(null)
  const [busy, setBusy] = useState(false)
  const restore = useRestorePicker()

  async function run(label: string, task: () => Promise<unknown>) {
    setBusy(true)
    try {
      await task()
      snack(label)
    } catch (e) {
      snack(messageOf(e))
    } finally {
      setBusy(false)
      await reload()
    }
  }

  async function changeFolder() {
    const folder = await call(window.lh.backup.pickFolder()).catch(() => null)
    if (folder) await run('Backup folder changed, and a backup made there', () => call(window.lh.backup.changeFolder(folder)))
  }

  const line = s ? backupLine(s) : null
  return (
    <>
      <header className="topbar in">
        <div style={{ flex: '1 1 240px', minWidth: 0 }}>
          <h1 className="h-lg">Settings</h1>
          <div className="muted">Backup, restore &amp; import</div>
        </div>
        <ThemeSwitch theme={theme} onToggle={onToggleTheme} />
      </header>

      <section className="card in" aria-labelledby="bk-h" style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 860 }} data-testid="backups">
        <h2 id="bk-h" className="h-md">Backups</h2>
        {line && (
          <div className={line.warn ? 'alert' : 'okline'} data-testid="backup-status" role={line.warn ? 'alert' : undefined}>
            {line.warn ? <AlertIcon /> : <CheckIcon />}
            <span>{line.text}</span>
          </div>
        )}

        {s && !s.configured && (
          <>
            <p className="muted" style={{ margin: 0 }}>
              Every day, and when Little Hands is closed, an encrypted copy of all the data is saved in a folder you choose: your
              OneDrive or Google Drive folder (it goes to the cloud), or a USB drive. The last 30 are kept.
            </p>
            <div>
              <button type="button" className="btn filled" onClick={() => setOpen({ kind: 'setup' })}>
                Set up backups
              </button>
            </div>
          </>
        )}

        {s?.configured && (
          <>
            <div className="setrow">
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="small muted">Folder</div>
                <div style={{ overflowWrap: 'anywhere' }} data-testid="backup-folder">{s.folder}</div>
              </div>
              <button type="button" className="btn textb" onClick={() => void call(window.lh.backup.openFolder()).catch((e) => snack(messageOf(e)))}>
                Open
              </button>
              <button type="button" className="btn textb" onClick={() => void changeFolder()} disabled={busy}>
                Change
              </button>
            </div>
            <div className="setrow">
              <div style={{ flex: 1 }}>
                <div className="small muted">Backup password</div>
                <div>Set ✓</div>
              </div>
              <button type="button" className="btn textb" onClick={() => setOpen({ kind: 'password' })} disabled={busy}>
                Change
              </button>
            </div>
            <div>
              <button type="button" className="btn filled" disabled={busy} onClick={() => void run('Backup saved', () => call(window.lh.backup.backupNow()))}>
                {busy ? 'Backing up…' : 'Back up now'}
              </button>
            </div>

            <div>
              <h3 className="h-sm">Recent backups</h3>
              {s.recent.length === 0 && <p className="muted small">None found in the folder{s.lastError ? ' (is the drive plugged in?)' : ''}.</p>}
              <ul className="plain" aria-label="Recent backups">
                {s.recent.map((b) => (
                  <li key={b.path} className="row setrow" data-testid="backup-file">
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div>{backupWhen(b.createdAt, s.today)}</div>
                      <div className="small muted">
                        {b.name} · {sizeText(b.sizeBytes)}
                      </div>
                    </div>
                    <button type="button" className="btn textb" aria-label={`Restore ${b.name}`} onClick={() => restore.open(b.path)}>
                      Restore
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
      </section>

      <section className="card in" aria-labelledby="rs-h" style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 860 }}>
        <h2 id="rs-h" className="h-md">Restore from a backup</h2>
        <p className="muted" style={{ margin: 0 }}>
          Replaces everything on this laptop with the data in a backup, for example when setting up a new laptop. You need the
          backup password.
        </p>
        <div>
          <button type="button" className="btn outlined" onClick={() => void restore.choose()}>
            Choose backup file…
          </button>
        </div>
        {restore.error && <div className="field-error">{restore.error}</div>}
      </section>

      <ImportStudents />

      {open?.kind === 'setup' && (
        <SetUpDialog
          onClose={() => setOpen(null)}
          onDone={async () => {
            setOpen(null)
            snack('Backups are on. The first backup is saved.')
            await reload()
          }}
        />
      )}
      {open?.kind === 'password' && (
        <PasswordDialog
          onClose={() => setOpen(null)}
          onDone={async () => {
            setOpen(null)
            snack('Backup password changed. New backups use the new password.')
            await reload()
          }}
        />
      )}
      {restore.dialog}
    </>
  )
}

function PasswordFields(props: { password: string; confirm: string; setPassword: (v: string) => void; setConfirm: (v: string) => void; errors: Record<string, string> }) {
  return (
    <>
      <div className="grid">
        <TextField label="Backup password" type="password" value={props.password} onChange={props.setPassword} error={props.errors.password} help={`At least ${MIN_PASSWORD} characters`} />
        <TextField label="Type it again" type="password" value={props.confirm} onChange={props.setConfirm} error={props.errors.confirm} />
      </div>
      <div className="alert">
        <AlertIcon />
        <span>
          <strong>Write this password down</strong> and keep it safe, away from the laptop. Without it, a backup can't be opened, by
          anyone, including us.
        </span>
      </div>
    </>
  )
}

function checkPasswords(password: string, confirm: string): Record<string, string> {
  if (password.length < MIN_PASSWORD) return { password: `Use at least ${MIN_PASSWORD} characters` }
  if (confirm !== password) return { confirm: "The two passwords don't match" }
  return {}
}

function SetUpDialog({ onClose, onDone }: { onClose: () => void; onDone: () => Promise<void> }) {
  const [folder, setFolder] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  async function save() {
    const e = { ...(folder ? {} : { folder: 'Choose a folder' }), ...checkPasswords(password, confirm) }
    setErrors(e)
    if (Object.keys(e).length) return
    setBusy(true)
    try {
      await call(window.lh.backup.setUp(folder!, password))
      await onDone()
    } catch (err) {
      setErrors({ form: messageOf(err) })
      setBusy(false)
    }
  }

  return (
    <Dialog title="Set up backups" onClose={busy ? () => undefined : onClose}>
      <form noValidate style={{ display: 'flex', flexDirection: 'column', gap: 16 }} onSubmit={(e) => { e.preventDefault(); void save() }}>
        <div className="setrow">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="small muted">Folder</div>
            <div style={{ overflowWrap: 'anywhere' }} data-testid="chosen-folder">{folder ?? 'Not chosen yet'}</div>
            <div className="small muted">e.g. your OneDrive or Google Drive folder, or a USB drive</div>
            {errors.folder && <div className="field-error" role="alert">{errors.folder}</div>}
          </div>
          <button
            type="button"
            className="btn outlined"
            onClick={async () => {
              const f = await call(window.lh.backup.pickFolder()).catch(() => null)
              if (f) {
                setFolder(f)
                setErrors((x) => ({ ...x, folder: '' }))
              }
            }}
          >
            Choose folder…
          </button>
        </div>
        <PasswordFields password={password} confirm={confirm} setPassword={setPassword} setConfirm={setConfirm} errors={errors} />
        {errors.form && <div className="field-error" role="alert">{errors.form}</div>}
        <div className="dlg-actions">
          <button type="button" className="btn textb" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn filled" disabled={busy}>
            {busy ? 'Saving the first backup…' : 'Turn on backups'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}

function PasswordDialog({ onClose, onDone }: { onClose: () => void; onDone: () => Promise<void> }) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  async function save() {
    const e = checkPasswords(password, confirm)
    setErrors(e)
    if (Object.keys(e).length) return
    setBusy(true)
    try {
      await call(window.lh.backup.changePassword(password))
      await onDone()
    } catch (err) {
      setErrors({ form: messageOf(err) })
      setBusy(false)
    }
  }
  return (
    <Dialog title="Change the backup password" onClose={busy ? () => undefined : onClose}>
      <form noValidate style={{ display: 'flex', flexDirection: 'column', gap: 16 }} onSubmit={(e) => { e.preventDefault(); void save() }}>
        <p className="muted" style={{ margin: 0 }}>
          New backups use the new password. Older backups still open only with the password they were made with.
        </p>
        <PasswordFields password={password} confirm={confirm} setPassword={setPassword} setConfirm={setConfirm} errors={errors} />
        {errors.form && <div className="field-error" role="alert">{errors.form}</div>}
        <div className="dlg-actions">
          <button type="button" className="btn textb" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn filled" disabled={busy}>
            Change password
          </button>
        </div>
      </form>
    </Dialog>
  )
}

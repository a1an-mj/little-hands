import { useState } from 'react'
import type { ImportPreview, ImportResult } from '@shared/import'
import { Dialog } from '../../components/Dialog'
import { call, messageOf } from '../../lib/api'

/** Settings card: add the children from the spreadsheet typed up from the paper admission forms. */
export function ImportStudents() {
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function choose() {
    setError('')
    try {
      const p = await call(window.lh.students.importPreview())
      if (p) setPreview(p)
    } catch (e) {
      setError(messageOf(e))
    }
  }

  async function run() {
    setBusy(true)
    try {
      setResult(await call(window.lh.students.importRun()))
      setPreview(null)
    } catch (e) {
      setError(messageOf(e))
      setPreview(null)
    } finally {
      setBusy(false)
    }
  }

  const ready = preview?.rows.filter((r) => !r.skip) ?? []
  const skipped = preview?.rows.filter((r) => r.skip) ?? []
  const todoCount = preview?.rows.filter((r) => r.hasTodo).length ?? 0
  return (
    <section className="card in" aria-labelledby="im-h" style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 860 }}>
      <h2 id="im-h" className="h-md">Import students</h2>
      <p className="muted" style={{ margin: 0 }}>
        Adds children from a spreadsheet of the paper admission forms (saved as CSV). Fees start at ₹0: set each child's fee on
        their profile afterwards. What the form leaves unclear is kept in the child's admission note, and each form's "Check" notes
        become a to-do. Children already in the app are left out.
      </p>
      <div>
        <button type="button" className="btn outlined" onClick={() => void choose()}>
          Choose spreadsheet…
        </button>
      </div>
      {error && <div className="field-error" role="alert">{error}</div>}

      {preview && (
        <Dialog title={`Import from ${preview.fileName}`} onClose={busy ? () => undefined : () => setPreview(null)}>
          <p style={{ margin: 0 }} data-testid="import-summary">
            {ready.length} {ready.length === 1 ? 'child' : 'children'} will be added
            {skipped.length > 0 && `, ${skipped.length} left out`}.
          </p>
          {todoCount > 0 && (
            <p className="muted" style={{ margin: 0 }} data-testid="import-todos">
              {todoCount} {todoCount === 1 ? 'to-do' : 'to-dos'} will be made from the forms' "Check" notes, one per child.
            </p>
          )}
          <ul className="plain" aria-label="Children to add" style={{ maxHeight: 360, overflowY: 'auto' }}>
            {preview.rows.map((r) => (
              <li key={r.line} className="row setrow" data-testid="import-row">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div>{r.name}</div>
                  <div className="small muted">
                    {r.skip ? <span className="field-error">{r.skip}</span> : r.programs}
                    {!r.skip && r.siblingOf && ` · same family as ${r.siblingOf}`}
                  </div>
                </div>
              </li>
            ))}
          </ul>
          <div className="dlg-actions">
            <button type="button" className="btn textb" onClick={() => setPreview(null)} disabled={busy}>
              Cancel
            </button>
            <button type="button" className="btn filled" onClick={() => void run()} disabled={busy || (ready.length === 0 && todoCount === 0)}>
              {busy ? 'Adding…' : ready.length === 0 && todoCount > 0 ? `Add ${todoCount} ${todoCount === 1 ? 'to-do' : 'to-dos'}` : `Add ${ready.length} ${ready.length === 1 ? 'child' : 'children'}`}
            </button>
          </div>
        </Dialog>
      )}

      {result && (
        <Dialog title="Students imported" onClose={() => setResult(null)}>
          <p style={{ margin: 0 }} data-testid="import-result">
            {result.added} {result.added === 1 ? 'child' : 'children'} added. Set their fees on each child's profile.
          </p>
          {result.todos > 0 && (
            <p className="muted" style={{ margin: 0 }} data-testid="import-result-todos">
              {result.todos} {result.todos === 1 ? 'to-do' : 'to-dos'} added to the To-do list.
            </p>
          )}
          {result.skipped.length > 0 && (
            <div>
              <div className="t-lg">Not added</div>
              <ul>
                {result.skipped.map((s) => (
                  <li key={s.name}>
                    {s.name}: <span className="muted">{s.reason}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="dlg-actions">
            <button type="button" className="btn filled" onClick={() => setResult(null)}>
              Done
            </button>
          </div>
        </Dialog>
      )}
    </section>
  )
}

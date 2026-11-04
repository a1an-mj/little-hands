import { useState } from 'react'
import { formatPhone } from '@shared/phone'
import { fieldErrors, guardianSchema, noteSchema, studentDetailsSchema, type GuardianInput, type NoteInput, type StudentDetailsInput } from '@shared/schemas'
import { STATUS_LABEL, STUDENT_STATUSES, type GuardianLink, type StudentNote, type StudentProfile, type StudentStatus } from '@shared/students'
import { ConfirmDialog, Dialog } from '../../components/Dialog'
import { CheckIcon } from '../../components/icons'
import { useSnackbar } from '../../components/Snackbar'
import { TextField } from '../../components/TextField'
import { call, messageOf } from '../../lib/api'
import type { z } from 'zod'

/** Validates with the shared schema, then runs `action`. Returns field errors to show, if any. */
function useSubmit() {
  const snack = useSnackbar()
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  async function submit(schema: z.ZodType, input: unknown, action: () => Promise<unknown>) {
    const parsed = schema.safeParse(input)
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error))
      return
    }
    setBusy(true)
    try {
      await action()
    } catch (e) {
      snack(messageOf(e))
      setBusy(false)
    }
  }
  return { busy, errors, setErrors, submit, snack }
}

function Check({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <label className="check" style={{ padding: 0 }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="cbox">{checked && <CheckIcon />}</span>
      {children}
    </label>
  )
}

// ---------- Edit details (and remove) ----------

export function EditDetailsDialog(props: {
  p: StudentProfile
  onClose: () => void
  onSaved: () => void
  onRemoved: () => void
  onPhotoRemoved: () => void
}) {
  const { p } = props
  const [d, setD] = useState<StudentDetailsInput>({
    fullName: p.fullName,
    joiningDate: p.joiningDate,
    status: p.status,
    homeAddress: p.homeAddress
  })
  const [confirm, setConfirm] = useState<'remove' | 'photo' | null>(null)
  const { busy, errors, submit, snack } = useSubmit()
  const set = (patch: Partial<StudentDetailsInput>) => setD({ ...d, ...patch })

  if (confirm === 'remove') {
    return (
      <ConfirmDialog
        title={`Remove ${p.fullName}?`}
        message={
          <>
            Only do this if the child was added by mistake. They will disappear from every list. To record that a child has left,
            change their status to <strong>Inactive</strong> or <strong>Graduated</strong> instead.
          </>
        }
        confirmLabel="Remove student"
        danger
        onClose={() => setConfirm(null)}
        onConfirm={async () => {
          try {
            await call(window.lh.students.remove(p.id))
            props.onRemoved()
          } catch (e) {
            snack(messageOf(e))
          }
        }}
      />
    )
  }
  if (confirm === 'photo') {
    return (
      <ConfirmDialog
        title="Remove the photo?"
        message="You can add a new photo at any time."
        confirmLabel="Remove photo"
        danger
        onClose={() => setConfirm(null)}
        onConfirm={async () => {
          try {
            await call(window.lh.students.setPhoto(p.id, null))
            props.onPhotoRemoved()
          } catch (e) {
            snack(messageOf(e))
          }
        }}
      />
    )
  }

  return (
    <Dialog title="Edit details" onClose={props.onClose}>
      <form
        noValidate
        style={{ display: 'flex', flexDirection: 'column', gap: 20 }}
        onSubmit={(e) => {
          e.preventDefault()
          void submit(studentDetailsSchema, d, async () => {
            await call(window.lh.students.updateDetails(p.id, d))
            props.onSaved()
          })
        }}
      >
        <TextField label="Full name" required autoFocus value={d.fullName} onChange={(v) => set({ fullName: v })} error={errors.fullName} />
        <div className="grid">
          <TextField label="Joining date" required type="date" value={d.joiningDate} onChange={(v) => set({ joiningDate: v })} error={errors.joiningDate} help="The student ID does not change." />
          <label className="tf">
            <span className="lb">Status</span>
            <select value={d.status} onChange={(e) => set({ status: e.target.value as StudentStatus })}>
              {STUDENT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <TextField label="Home address" multiline value={d.homeAddress} onChange={(v) => set({ homeAddress: v })} error={errors.homeAddress} />
        <div className="dlg-actions" style={{ justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <button type="button" className="btn danger" onClick={() => setConfirm('remove')}>
              Remove student
            </button>
            {p.photo && (
              <button type="button" className="btn textb" onClick={() => setConfirm('photo')}>
                Remove photo
              </button>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn textb" onClick={props.onClose}>
              Cancel
            </button>
            <button type="submit" className="btn filled" disabled={busy}>
              Save
            </button>
          </div>
        </div>
      </form>
    </Dialog>
  )
}

// ---------- Add / edit a guardian ----------

export function GuardianDialog(props: {
  studentId: string
  link: GuardianLink | null
  onClose: () => void
  onDone: (message: string) => void
}) {
  const { link } = props
  const [g, setG] = useState<GuardianInput>({
    name: link?.name ?? '',
    phone: link?.phone ? formatPhone(link.phone) : '',
    relationship: link?.relationship ?? '',
    isEmergency: link?.isEmergency ?? false
  })
  const [confirmRemove, setConfirmRemove] = useState(false)
  const { busy, errors, submit, snack } = useSubmit()
  const set = (patch: Partial<GuardianInput>) => setG({ ...g, ...patch })
  const who = link?.name ?? link?.relationship ?? ''

  async function run(action: () => Promise<unknown>, message: string) {
    try {
      await action()
      props.onDone(message)
    } catch (e) {
      snack(messageOf(e))
    }
  }

  if (confirmRemove && link) {
    return (
      <ConfirmDialog
        title={`Remove ${who}?`}
        message={
          link.sharedWith.length > 0
            ? `${who} will no longer be listed for this child. They stay listed for ${link.sharedWith.map((s) => s.fullName).join(', ')}.`
            : `${who} will no longer be listed for this child.`
        }
        confirmLabel="Remove"
        danger
        onClose={() => setConfirmRemove(false)}
        onConfirm={() => run(() => call(window.lh.students.removeGuardian(link.linkId)), `${who} removed`)}
      />
    )
  }

  return (
    <Dialog title={link ? `Edit ${who}` : 'Add a parent or guardian'} onClose={props.onClose}>
      <form
        noValidate
        style={{ display: 'flex', flexDirection: 'column', gap: 20 }}
        onSubmit={(e) => {
          e.preventDefault()
          void submit(guardianSchema, g, async () => {
            if (link) await call(window.lh.students.updateGuardian(link.linkId, g))
            else await call(window.lh.students.addGuardian(props.studentId, g))
            props.onDone(link ? 'Contact saved' : 'Contact added')
          })
        }}
      >
        {link && link.sharedWith.length > 0 && (
          <div className="small muted">
            Name and phone are shared with {link.sharedWith.map((s) => s.fullName).join(', ')}, so changing them updates both.
          </div>
        )}
        <TextField label="Name" autoFocus value={g.name} onChange={(v) => set({ name: v })} error={errors.name} />
        <div className="grid">
          <TextField label="Relationship" required placeholder="e.g. Father, Grandmother" value={g.relationship} onChange={(v) => set({ relationship: v })} error={errors.relationship} />
          <TextField label="Phone" type="tel" placeholder="+91" value={g.phone} onChange={(v) => set({ phone: v })} error={errors.phone} />
        </div>
        <Check checked={g.isEmergency} onChange={(v) => set({ isEmergency: v })}>
          Call in an emergency
        </Check>
        <div className="dlg-actions" style={{ justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {link && !link.isFeeContact && (
              <>
                <button type="button" className="btn tonal" onClick={() => run(() => call(window.lh.students.setFeeContact(link.linkId)), `${who} is now the main contact for fees`)}>
                  Make main contact for fees
                </button>
                <button type="button" className="btn danger" onClick={() => setConfirmRemove(true)}>
                  Remove
                </button>
              </>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn textb" onClick={props.onClose}>
              Cancel
            </button>
            <button type="submit" className="btn filled" disabled={busy}>
              Save
            </button>
          </div>
        </div>
      </form>
    </Dialog>
  )
}

// ---------- Add / edit a note ----------

export function NoteDialog(props: { studentId: string; note: StudentNote | null; onClose: () => void; onDone: (message: string) => void }) {
  const { note } = props
  const [n, setN] = useState<NoteInput>({ title: note?.title ?? '', details: note?.details ?? '', important: note?.important ?? false })
  const { busy, errors, submit, snack } = useSubmit()
  const set = (patch: Partial<NoteInput>) => setN({ ...n, ...patch })

  return (
    <Dialog title={note ? 'Edit note' : 'Add a note'} onClose={props.onClose}>
      <form
        noValidate
        style={{ display: 'flex', flexDirection: 'column', gap: 20 }}
        onSubmit={(e) => {
          e.preventDefault()
          void submit(noteSchema, n, async () => {
            if (note) await call(window.lh.students.updateNote(note.id, n))
            else await call(window.lh.students.addNote(props.studentId, n))
            props.onDone(note ? 'Note saved' : 'Note added')
          })
        }}
      >
        <TextField label="Title" required autoFocus placeholder="e.g. Peanut allergy" value={n.title} onChange={(v) => set({ title: v })} error={errors.title} />
        <TextField label="Details" multiline rows={3} value={n.details} onChange={(v) => set({ details: v })} error={errors.details} />
        <Check checked={n.important} onChange={(v) => set({ important: v })}>
          Important (shown in red, at the top)
        </Check>
        <div className="dlg-actions" style={{ justifyContent: 'space-between' }}>
          <div>
            {note && (
              <button
                type="button"
                className="btn danger"
                onClick={async () => {
                  try {
                    await call(window.lh.students.removeNote(note.id))
                    props.onDone('Note removed')
                  } catch (e) {
                    snack(messageOf(e))
                  }
                }}
              >
                Remove
              </button>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn textb" onClick={props.onClose}>
              Cancel
            </button>
            <button type="submit" className="btn filled" disabled={busy}>
              Save
            </button>
          </div>
        </div>
      </form>
    </Dialog>
  )
}

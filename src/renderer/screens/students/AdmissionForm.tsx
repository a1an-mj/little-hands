import { useMemo, useState } from 'react'
import type { Theme } from '@shared/ipc-contract'
import { formatPhone } from '@shared/phone'
import { admissionSchema, fieldErrors, type AdmissionInput } from '@shared/schemas'
import type { GuardianLink } from '@shared/students'
import { Avatar } from '../../components/Avatar'
import { ConfirmDialog, Dialog } from '../../components/Dialog'
import { CameraIcon, CheckIcon, CloseIcon, PlusSmallIcon, SearchIcon } from '../../components/icons'
import { useSnackbar } from '../../components/Snackbar'
import { TextField } from '../../components/TextField'
import { ThemeSwitch } from '../../components/ThemeSwitch'
import { call, messageOf, useLoad } from '../../lib/api'
import { todayIso } from '../../lib/format'
import type { Navigate } from '../../shell/routes'

interface Props {
  theme: Theme
  onToggleTheme: () => void
  navigate: Navigate
}

type Person = { name: string; phone: string }
type Extra = Person & { relationship: string }
interface Sibling {
  id: string
  fullName: string
  guardians: GuardianLink[]
}

interface FormState {
  fullName: string
  joiningDate: string
  notes: string
  homeAddress: string
  photo: string | null
  father: Person
  mother: Person
  emergency: Person & { relationship: string }
  extra: Extra[]
  feeContact: string
  sibling: Sibling | null
}

const blank = (): FormState => ({
  fullName: '',
  joiningDate: todayIso(),
  notes: '',
  homeAddress: '',
  photo: null,
  father: { name: '', phone: '' },
  mother: { name: '', phone: '' },
  emergency: { name: '', relationship: '', phone: '' },
  extra: [],
  feeContact: 'father',
  sibling: null
})

function toInput(f: FormState): AdmissionInput {
  return {
    fullName: f.fullName,
    joiningDate: f.joiningDate,
    notes: f.notes,
    homeAddress: f.homeAddress,
    photo: f.photo,
    family: f.sibling
      ? { kind: 'sibling', siblingId: f.sibling.id }
      : { kind: 'new', father: f.father, mother: f.mother, emergency: f.emergency, extra: f.extra, feeContact: f.feeContact }
  }
}

const filled = (p: Person) => Boolean(p.name.trim() || p.phone.trim())

export function AdmissionForm({ theme, onToggleTheme, navigate }: Props) {
  const snack = useSnackbar()
  const [initial] = useState(blank)
  const [f, setF] = useState<FormState>(initial)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [pickingSibling, setPickingSibling] = useState(false)
  const [confirmLeave, setConfirmLeave] = useState(false)

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setF((s) => ({ ...s, [key]: value }))
    setErrors((e) => Object.fromEntries(Object.entries(e).filter(([k]) => k !== key && !k.startsWith(`family.${String(key)}`))))
  }
  const err = (path: string) => errors[path]

  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(f.joiningDate)
  const { data: nextCode } = useLoad(
    () => (validDate ? window.lh.students.nextCode(f.joiningDate) : Promise.resolve({ ok: true as const, value: '' })),
    [f.joiningDate]
  )

  const feeOptions = useMemo(() => {
    const opts = [
      { key: 'father', label: 'Father' },
      { key: 'mother', label: 'Mother' }
    ]
    if (filled(f.emergency) && f.emergency.phone !== f.father.phone && f.emergency.phone !== f.mother.phone) {
      opts.push({ key: 'emergency', label: f.emergency.name.trim() || f.emergency.relationship.trim() || 'Emergency contact' })
    }
    f.extra.forEach((g, i) => {
      if (filled(g)) opts.push({ key: `extra-${i}`, label: g.name.trim() || g.relationship.trim() || `Guardian ${i + 3}` })
    })
    return opts
  }, [f.father, f.mother, f.emergency, f.extra])

  async function choosePhoto() {
    try {
      const photo = await call(window.lh.students.pickPhoto())
      if (photo) set('photo', photo)
    } catch (e) {
      snack(messageOf(e))
    }
  }

  async function save() {
    if (busy) return
    const parsed = admissionSchema.safeParse(toInput(f))
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error))
      requestAnimationFrame(() => {
        const el = document.querySelector<HTMLElement>('[aria-invalid="true"], [data-error="true"]')
        el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
        el?.focus({ preventScroll: true })
      })
      return
    }
    setBusy(true)
    try {
      const id = await call(window.lh.students.admit(toInput(f)))
      snack(`${f.fullName.trim()} has been admitted`)
      navigate({ name: 'student', id })
    } catch (e) {
      snack(messageOf(e))
      setBusy(false)
    }
  }

  const dirty = JSON.stringify(f) !== JSON.stringify(initial)
  const leave = () => (dirty ? setConfirmLeave(true) : navigate({ name: 'students' }))

  return (
    <>
      <header className="topbar in">
        <button type="button" className="iconb" aria-label="Close and go back to students" onClick={leave}>
          <CloseIcon />
        </button>
        <div style={{ flex: '1 1 240px', minWidth: 0 }}>
          <h1 className="h-lg">New admission</h1>
          <div className="muted">Fields marked * are needed. The photo and everything else can be added later.</div>
        </div>
        <ThemeSwitch theme={theme} onToggle={onToggleTheme} />
      </header>

      <form
        className="form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        {/* ---------- Child ---------- */}
        <section aria-labelledby="s1" className="card in" style={{ display: 'flex', flexWrap: 'wrap', gap: 32, padding: 28, animationDelay: '60ms' }}>
          <div style={{ flex: '0 0 auto', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
            <button
              type="button"
              className={f.photo ? 'photo has' : 'photo'}
              aria-label={f.photo ? 'Change photo' : 'Add photo, optional'}
              onClick={choosePhoto}
            >
              {f.photo ? <img src={f.photo} alt="" /> : (<><CameraIcon size={30} />Add photo</>)}
            </button>
            {f.photo ? (
              <button type="button" className="btn textb" onClick={() => set('photo', null)}>
                Remove photo
              </button>
            ) : (
              <span className="small muted">Optional</span>
            )}
          </div>
          <div style={{ flex: '1 1 420px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 24 }}>
            <h2 id="s1" className="h-md">Child</h2>
            <TextField label="Full name" required autoFocus name="fullName" value={f.fullName} onChange={(v) => set('fullName', v)} error={err('fullName')} />
            <div className="grid">
              <TextField label="Joining date" required type="date" name="joiningDate" value={f.joiningDate} onChange={(v) => set('joiningDate', v)} error={err('joiningDate')} />
              <TextField label="Student ID" readOnly value={nextCode ?? ''} onChange={() => {}} help="Given automatically" />
            </div>
            <TextField
              label="Notes for staff"
              multiline
              name="notes"
              value={f.notes}
              onChange={(v) => set('notes', v)}
              placeholder="Allergies, pick-up instructions, anything staff should know"
              error={err('notes')}
            />
          </div>
        </section>

        {/* ---------- Parents & guardians ---------- */}
        <section aria-labelledby="s2" className="card in" style={{ display: 'flex', flexDirection: 'column', gap: 24, padding: 28, animationDelay: '120ms' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <h2 id="s2" className="h-md">Parents &amp; guardians</h2>
            {!f.sibling && (
              <button type="button" className="btn tonal" onClick={() => setPickingSibling(true)}>
                Same family as an existing student
              </button>
            )}
          </div>

          {f.sibling ? (
            <SiblingFamily sibling={f.sibling} onClear={() => set('sibling', null)} />
          ) : (
            <NewFamily f={f} setF={setF} set={set} err={err} feeOptions={feeOptions} />
          )}

          <TextField label="Home address" multiline name="homeAddress" value={f.homeAddress} onChange={(v) => set('homeAddress', v)} error={err('homeAddress')} />
        </section>

        {/* ---------- Programs (step 3) ---------- */}
        <section aria-labelledby="s3" className="card in" style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 28, animationDelay: '180ms' }}>
          <h2 id="s3" className="h-md">Programs, timings &amp; fees</h2>
          <div className="soon-inline">
            <span className="step-chip">Coming in step 3</span>
            <p style={{ margin: '8px 0 0' }}>Choosing Playgroup, LKG, UKG or Tuition, with each one's days, timings and agreed fee.</p>
          </div>
        </section>

        <div className="bar-bottom">
          <div style={{ flex: '1 1 200px' }} className="muted">
            {f.fullName.trim() ? `Admitting ${f.fullName.trim()}` : 'New admission'}
          </div>
          <button type="button" className="btn textb" onClick={leave}>
            Cancel
          </button>
          <button type="submit" className="btn filled" disabled={busy}>
            {busy ? 'Saving…' : 'Save student'}
          </button>
        </div>
      </form>

      {pickingSibling && (
        <SiblingPicker
          onClose={() => setPickingSibling(false)}
          onPick={(s) => {
            setPickingSibling(false)
            setF((cur) => ({ ...cur, sibling: s.sibling, homeAddress: cur.homeAddress || s.address }))
            setErrors({})
          }}
        />
      )}
      {confirmLeave && (
        <ConfirmDialog
          title="Discard this admission?"
          message="What you have typed will not be saved."
          confirmLabel="Discard"
          danger
          onClose={() => setConfirmLeave(false)}
          onConfirm={() => navigate({ name: 'students' })}
        />
      )}
    </>
  )
}

// ---------- Parents typed in fresh ----------

interface NewFamilyProps {
  f: FormState
  setF: React.Dispatch<React.SetStateAction<FormState>>
  set: <K extends keyof FormState>(key: K, value: FormState[K]) => void
  err: (path: string) => string | undefined
  feeOptions: { key: string; label: string }[]
}

function NewFamily({ f, setF, set, err, feeOptions }: NewFamilyProps) {
  const setExtra = (i: number, patch: Partial<Extra>) =>
    set('extra', f.extra.map((g, j) => (j === i ? { ...g, ...patch } : g)))
  const removeExtra = (i: number) =>
    setF((s) => {
      // Keep the chosen main contact pointing at the same person after the list shifts.
      let fee = s.feeContact
      if (fee === `extra-${i}`) fee = 'father'
      else if (fee.startsWith('extra-') && Number(fee.slice(6)) > i) fee = `extra-${Number(fee.slice(6)) - 1}`
      return { ...s, extra: s.extra.filter((_, j) => j !== i), feeContact: fee }
    })

  return (
    <>
      <div className="grid2">
        <TextField label="Father's name" name="father.name" value={f.father.name} onChange={(v) => set('father', { ...f.father, name: v })} error={err('family.father.name')} />
        <TextField label="Father's phone" type="tel" name="father.phone" placeholder="+91" value={f.father.phone} onChange={(v) => set('father', { ...f.father, phone: v })} error={err('family.father.phone')} />
        <TextField label="Mother's name" name="mother.name" value={f.mother.name} onChange={(v) => set('mother', { ...f.mother, name: v })} error={err('family.mother.name')} />
        <TextField label="Mother's phone" type="tel" name="mother.phone" placeholder="+91" value={f.mother.phone} onChange={(v) => set('mother', { ...f.mother, phone: v })} error={err('family.mother.phone')} />
      </div>

      <div role="group" aria-labelledby="mc-l" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }} data-error={err('family.feeContact') ? 'true' : undefined} tabIndex={-1}>
        <span id="mc-l" className="t-lg" style={{ marginRight: 8 }}>
          Main contact for fees *
        </span>
        {feeOptions.map((o) => (
          <button key={o.key} type="button" className="chip" aria-pressed={f.feeContact === o.key} onClick={() => set('feeContact', o.key)}>
            {f.feeContact === o.key && <CheckIcon />}
            {o.label}
          </button>
        ))}
        {err('family.feeContact') && (
          <div className="field-error" role="alert" style={{ flexBasis: '100%' }}>
            {err('family.feeContact')}
          </div>
        )}
      </div>

      <div className="grid" style={{ paddingTop: 24, borderTop: '1px solid var(--olv)' }}>
        <TextField label="Emergency contact" name="emergency.name" value={f.emergency.name} onChange={(v) => set('emergency', { ...f.emergency, name: v })} error={err('family.emergency.name')} />
        <TextField label="Relationship" name="emergency.relationship" placeholder="e.g. Grandmother" value={f.emergency.relationship} onChange={(v) => set('emergency', { ...f.emergency, relationship: v })} error={err('family.emergency.relationship')} />
        <TextField
          label="Emergency phone"
          required
          type="tel"
          name="emergency.phone"
          placeholder="+91"
          value={f.emergency.phone}
          onChange={(v) => set('emergency', { ...f.emergency, phone: v })}
          error={err('family.emergency.phone')}
          help="Can be the father's or mother's number"
        />
      </div>

      {f.extra.map((g, i) => (
        <div key={i} className="subcard">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span className="t-lg">Another guardian</span>
            <button type="button" className="iconb" aria-label={`Remove guardian ${i + 1}`} onClick={() => removeExtra(i)}>
              <CloseIcon />
            </button>
          </div>
          <div className="grid">
            <TextField label="Name" name={`extra.${i}.name`} value={g.name} onChange={(v) => setExtra(i, { name: v })} error={err(`family.extra.${i}.name`)} />
            <TextField label="Relationship" required name={`extra.${i}.relationship`} placeholder="e.g. Uncle" value={g.relationship} onChange={(v) => setExtra(i, { relationship: v })} error={err(`family.extra.${i}.relationship`)} />
            <TextField label="Phone" type="tel" name={`extra.${i}.phone`} placeholder="+91" value={g.phone} onChange={(v) => setExtra(i, { phone: v })} error={err(`family.extra.${i}.phone`)} />
          </div>
        </div>
      ))}

      {f.extra.length < 6 && (
        <button type="button" className="btn outlined" style={{ alignSelf: 'flex-start' }} onClick={() => set('extra', [...f.extra, { name: '', phone: '', relationship: '' }])}>
          <PlusSmallIcon />
          Add another guardian
        </button>
      )}
    </>
  )
}

// ---------- Same family as an existing student ----------

function SiblingFamily({ sibling, onClear }: { sibling: Sibling; onClear: () => void }) {
  return (
    <div className="subcard">
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
        <span style={{ flex: 1 }}>
          Same parents and guardians as <strong>{sibling.fullName}</strong>. Changes to their names or phone numbers will show
          for both children.
        </span>
        <button type="button" className="btn textb" onClick={onClear}>
          Use different parents
        </button>
      </div>
      <ul className="plain">
        {sibling.guardians.map((g) => (
          <li key={g.linkId} className="row" style={{ padding: '10px 0', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="t-lg">{g.name ?? g.relationship}</span>
            {g.isFeeContact && <span className="tag ok">Main</span>}
            {g.isEmergency && <span className="tag due">Emergency</span>}
            <span className="small muted" style={{ marginLeft: 'auto' }}>
              {g.relationship}
              {g.phone ? ` · ${formatPhone(g.phone)}` : ''}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function SiblingPicker({ onClose, onPick }: { onClose: () => void; onPick: (s: { sibling: Sibling; address: string }) => void }) {
  const [search, setSearch] = useState('')
  const { data } = useLoad(() => window.lh.students.list({ search, status: 'active', page: 0 }), [search])
  const snack = useSnackbar()

  async function pick(id: string) {
    try {
      const p = await call(window.lh.students.profile(id))
      if (!p) return
      onPick({ sibling: { id: p.id, fullName: p.fullName, guardians: p.guardians }, address: p.homeAddress })
    } catch (e) {
      snack(messageOf(e))
    }
  }

  return (
    <Dialog title="Same family as…" onClose={onClose}>
      <label className="search" style={{ maxWidth: 'none', background: 'var(--c4)' }}>
        <SearchIcon />
        <span className="sr">Search brother or sister</span>
        <input type="search" autoFocus placeholder="Brother or sister's name, ID or parent phone" value={search} onChange={(e) => setSearch(e.target.value)} />
      </label>
      <div style={{ maxHeight: 320, overflowY: 'auto', margin: '0 -8px' }}>
        {data?.rows.map((r) => (
          <button key={r.id} type="button" className="lrow" onClick={() => void pick(r.id)}>
            <Avatar name={r.fullName} />
            <span style={{ flex: 1, minWidth: 0 }}>
              <span className="t-lg" style={{ display: 'block' }}>{r.fullName}</span>
              <span className="small muted">
                {r.code}
                {r.mainContact?.name ? ` · ${r.mainContact.name}` : ''}
              </span>
            </span>
          </button>
        ))}
        {data && data.rows.length === 0 && <div className="empty">No students match.</div>}
      </div>
      <div className="dlg-actions">
        <button type="button" className="btn textb" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Dialog>
  )
}

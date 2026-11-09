import { useState } from 'react'
import type { Theme } from '@shared/ipc-contract'
import { formatPhone } from '@shared/phone'
import { STATUS_LABEL, type GuardianLink, type StudentNote, type StudentProfile as Profile } from '@shared/students'
import { Avatar } from '../../components/Avatar'
import { BackIcon, CameraIcon, CopyIcon, EditIcon } from '../../components/icons'
import { useSnackbar } from '../../components/Snackbar'
import { ThemeSwitch } from '../../components/ThemeSwitch'
import { call, messageOf, useLoad } from '../../lib/api'
import { formatDateLong } from '../../lib/format'
import type { Navigate } from '../../shell/routes'
import { EditDetailsDialog, GuardianDialog, NoteDialog } from './ProfileDialogs'
import { AddProgramDialog, EditProgramDialog, EndProgramDialog, ProgramsCard, type ProgramDialog } from './EnrollmentDialogs'
import { ProgramTag } from './ProgramFields'
import { PROGRAM_NAME, type EnrollmentView } from '@shared/enrollments'

interface Props {
  theme: Theme
  onToggleTheme: () => void
  id: string
  navigate: Navigate
}

type Tab = 'overview' | 'fees' | 'att' | 'notes'
const TABS: [Tab, string][] = [
  ['overview', 'Overview'],
  ['fees', 'Fees & payments'],
  ['att', 'Attendance'],
  ['notes', 'Notes']
]

type Open =
  | { kind: 'details' }
  | { kind: 'guardian'; link: GuardianLink | null }
  | { kind: 'note'; note: StudentNote | null }
  | ProgramDialog
  | null

export function StudentProfile({ theme, onToggleTheme, id, navigate }: Props) {
  const snack = useSnackbar()
  const [tab, setTab] = useState<Tab>('overview')
  const [open, setOpen] = useState<Open>(null)
  const { data: p, error, reload } = useLoad(() => window.lh.students.profile(id), [id])

  const back = () => navigate({ name: 'students' })

  async function changePhoto() {
    try {
      const photo = await call(window.lh.students.pickPhoto())
      if (!photo) return
      await call(window.lh.students.setPhoto(id, photo))
      snack('Photo saved')
      await reload()
    } catch (e) {
      snack(messageOf(e))
    }
  }

  async function copy(g: GuardianLink) {
    if (!g.phone) return
    try {
      await navigator.clipboard.writeText(formatPhone(g.phone))
      snack('Number copied')
    } catch {
      snack('Could not copy the number')
    }
  }

  const header = (
    <header className="topbar in">
      <button type="button" className="iconb" aria-label="Back to all students" onClick={back}>
        <BackIcon />
      </button>
      <span className="t-lg" style={{ flex: 1 }}>Student profile</span>
      <ThemeSwitch theme={theme} onToggle={onToggleTheme} />
    </header>
  )

  if (error || p === null) {
    return (
      <>
        {header}
        <div className="card empty" role="alert">{error ?? 'This student could not be found. They may have been removed.'}</div>
      </>
    )
  }
  if (!p) return header

  async function resume(e: EnrollmentView) {
    try {
      await call(window.lh.enrollments.resume(e.id))
      snack(`${PROGRAM_NAME[e.program]} continues`)
      await reload()
    } catch (err) {
      snack(messageOf(err))
    }
  }

  const done = async (message: string) => {
    setOpen(null)
    snack(message)
    await reload()
  }

  return (
    <>
      {header}

      <section aria-label="Student summary" className="card in" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 24, animationDelay: '60ms' }}>
        <div style={{ position: 'relative', flex: 'none' }}>
          <Avatar name={p.fullName} photo={p.photo} size="xl" />
          <button
            type="button"
            className="btn filled"
            aria-label={p.photo ? 'Change photo' : 'Add photo'}
            title={p.photo ? 'Change photo' : 'Add photo'}
            onClick={changePhoto}
            style={{ position: 'absolute', right: -10, bottom: -10, width: 48, height: 48, padding: 0, borderRadius: 16, boxShadow: 'var(--sh3)' }}
          >
            <CameraIcon />
          </button>
        </div>
        <div style={{ flex: '1 1 280px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
            <h1 className="h-lg">{p.fullName}</h1>
            <span className={p.status === 'active' ? 'tag lg ok' : 'tag lg nt'}>{STATUS_LABEL[p.status]}</span>
          </div>
          <div className="muted" style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 20px' }}>
            <span>{p.code}</span>
            <span>Joined {formatDateLong(p.joiningDate)}</span>
            {!p.photo && <span>No photo yet</span>}
          </div>
          {p.enrollments.some((e) => e.state !== 'ended') && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {[...new Set(p.enrollments.filter((e) => e.state !== 'ended').map((e) => e.program))].map((c) => (
                <ProgramTag key={c} code={c} large />
              ))}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          <button type="button" className="btn outlined" onClick={() => setOpen({ kind: 'details' })}>
            <EditIcon />
            Edit
          </button>
        </div>
      </section>

      <div className="tabs in" role="tablist" aria-label="Profile sections" style={{ animationDelay: '120ms' }}>
        {TABS.map(([key, label]) => (
          <button key={key} type="button" role="tab" className="tab" aria-selected={tab === key} onClick={() => setTab(key)}>
            {label}
            {key === 'notes' && p.notes.length > 0 ? ` · ${p.notes.length}` : ''}
            {tab === key && <span className="ind" />}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="cols">
          <ProgramsCard p={p} onOpen={setOpen} onResume={(e) => void resume(e)} />
          <Guardians
            p={p}
            onAdd={() => setOpen({ kind: 'guardian', link: null })}
            onEdit={(link) => setOpen({ kind: 'guardian', link })}
            onCopy={copy}
            onEditAddress={() => setOpen({ kind: 'details' })}
          />
        </div>
      )}

      {tab === 'fees' && <Soon step={4} text="Month-by-month fees and the full payment history for this child will appear here." />}
      {tab === 'att' && <Soon step={5} text="Arrival and departure times for recent school days will appear here." />}

      {tab === 'notes' && (
        <section aria-labelledby="nt-h" className="card in" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h2 id="nt-h" className="h-md">Notes for staff</h2>
          {p.notes.length === 0 && <p className="muted" style={{ margin: 0 }}>No notes yet.</p>}
          {p.notes.map((n) => (
            <div key={n.id} className={n.important ? 'note important' : 'note'}>
              <div className="note-body">
                <div className="t-lg">{n.title}</div>
                {n.details && <div className="muted">{n.details}</div>}
              </div>
              <button type="button" className="iconb" aria-label={`Edit note: ${n.title}`} onClick={() => setOpen({ kind: 'note', note: n })}>
                <EditIcon size={20} />
              </button>
            </div>
          ))}
          <button type="button" className="btn tonal" style={{ alignSelf: 'flex-start' }} onClick={() => setOpen({ kind: 'note', note: null })}>
            Add a note
          </button>
        </section>
      )}

      {open?.kind === 'details' && (
        <EditDetailsDialog
          p={p}
          onClose={() => setOpen(null)}
          onSaved={() => done('Details saved')}
          onRemoved={() => {
            snack(`${p.fullName} has been removed`)
            navigate({ name: 'students' })
          }}
          onPhotoRemoved={() => done('Photo removed')}
        />
      )}
      {open?.kind === 'guardian' && (
        <GuardianDialog studentId={p.id} link={open.link} onClose={() => setOpen(null)} onDone={done} />
      )}
      {open?.kind === 'note' && <NoteDialog studentId={p.id} note={open.note} onClose={() => setOpen(null)} onDone={done} />}
      {open?.kind === 'add' && <AddProgramDialog p={p} onClose={() => setOpen(null)} onDone={done} />}
      {open?.kind === 'edit' && (
        <EditProgramDialog
          enrollment={open.enrollment}
          onClose={() => setOpen(null)}
          onDone={done}
          onEnd={() => setOpen({ kind: 'end', enrollment: open.enrollment })}
        />
      )}
      {open?.kind === 'end' && <EndProgramDialog enrollment={open.enrollment} onClose={() => setOpen(null)} onDone={done} />}
    </>
  )
}

function Guardians(props: {
  p: Profile
  onAdd: () => void
  onEdit: (g: GuardianLink) => void
  onCopy: (g: GuardianLink) => void
  onEditAddress: () => void
}) {
  const { p } = props
  return (
    <section aria-labelledby="gua-h" className="card in" style={{ animationDelay: '260ms' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <h2 id="gua-h" className="h-md">Parents &amp; guardians</h2>
        <button type="button" className="btn textb" onClick={props.onAdd}>
          Add
        </button>
      </div>
      {p.guardians.length === 0 && <p className="muted">No parents or guardians saved yet.</p>}
      {p.guardians.map((g) => (
        <div key={g.linkId} className="row gline" data-testid="guardian">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
              <span className="t-lg">{g.name ?? g.relationship}</span>
              {g.isFeeContact && <span className="tag ok">Main</span>}
              {g.isEmergency && <span className="tag due">Emergency</span>}
            </div>
            <div className="small muted">
              {[g.name ? g.relationship : null, formatPhone(g.phone) || 'No phone'].filter(Boolean).join(' · ')}
            </div>
            {g.sharedWith.length > 0 && (
              <div className="small muted">Also for {g.sharedWith.map((s) => s.fullName).join(', ')}</div>
            )}
          </div>
          {g.phone && (
            <button type="button" className="iconb" aria-label={`Copy ${g.name ?? g.relationship}'s number`} title="Copy number" onClick={() => props.onCopy(g)}>
              <CopyIcon />
            </button>
          )}
          <button type="button" className="iconb" aria-label={`Edit ${g.name ?? g.relationship}`} title="Edit" onClick={() => props.onEdit(g)}>
            <EditIcon size={20} />
          </button>
        </div>
      ))}
      <div className="row" style={{ paddingTop: 12, display: 'flex', alignItems: 'flex-start', gap: 4 }}>
        <div style={{ flex: 1 }}>
          <div className="small muted">Address</div>
          <div style={{ whiteSpace: 'pre-wrap' }}>{p.homeAddress || <span className="muted">Not added yet</span>}</div>
        </div>
        <button type="button" className="iconb" aria-label="Edit address" title="Edit" onClick={props.onEditAddress}>
          <EditIcon size={20} />
        </button>
      </div>
    </section>
  )
}

function Soon({ step, text }: { step: number; text: string }) {
  return (
    <section className="card soon-card in">
      <span className="step-chip">Coming in step {step}</span>
      <p className="muted" style={{ margin: 0 }}>{text}</p>
    </section>
  )
}

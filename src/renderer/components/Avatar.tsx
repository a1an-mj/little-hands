import { initials } from '../lib/format'

export function Avatar({ name, photo, size }: { name: string; photo?: string | null; size?: 'xl' }) {
  return (
    <span className={size ? `avatar ${size}` : 'avatar'} aria-hidden="true">
      {photo ? <img src={photo} alt="" /> : initials(name)}
    </span>
  )
}

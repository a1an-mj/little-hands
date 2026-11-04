// Inline SVG icons taken from the design files.

type P = { size?: number }
const line = { fill: 'none', stroke: 'currentColor', strokeLinecap: 'round', strokeLinejoin: 'round' } as const

export const LogoIcon = ({ size = 30 }: P) => (
  <svg width={size} height={size} viewBox="8 7 22 24" {...line} strokeWidth={1.8} aria-hidden="true">
    <path d="M14 22v-8a2 2 0 0 1 4 0v6M18 19v-8a2 2 0 0 1 4 0v8M22 19v-6a2 2 0 0 1 4 0v9c0 4-3 7-7 7h-1c-2.2 0-3.6-.9-5-2.6L10 24.5a2 2 0 0 1 3.2-2.4L14 23" />
  </svg>
)

export const PlusIcon = ({ size = 24 }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...line} strokeWidth={2} aria-hidden="true">
    <path d="M12 5v14M5 12h14" />
  </svg>
)

const Rail = ({ children }: { children: React.ReactNode }) => (
  <svg width={22} height={22} viewBox="0 0 24 24" {...line} strokeWidth={1.8} aria-hidden="true">
    {children}
  </svg>
)

export const HomeIcon = () => <Rail><path d="M4 10.5 12 4l8 6.5V20h-5v-6H9v6H4z" /></Rail>
export const StudentsIcon = () => (
  <Rail>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.8c1.9.7 3.1 2.4 3.5 5.2" />
  </Rail>
)
export const FeesIcon = () => (
  <Rail>
    <rect x="3" y="6" width="18" height="13" rx="2" />
    <path d="M3 10h18M7 15h4" />
  </Rail>
)
export const AttendanceIcon = () => (
  <Rail>
    <rect x="4" y="5" width="16" height="15" rx="2" />
    <path d="M8 3v4M16 3v4M4 10h16M9 15l2 2 4-4" />
  </Rail>
)
export const ReportsIcon = () => <Rail><path d="M5 20V10M12 20V4M19 20v-7" /></Rail>
export const SettingsIcon = () => (
  <Rail>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" />
  </Rail>
)
export const LockIcon = () => (
  <Rail>
    <rect x="5" y="11" width="14" height="9" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </Rail>
)

export const MoonIcon = () => (
  <svg className="pop" width={14} height={14} viewBox="0 0 24 24" {...line} strokeWidth={2.2} aria-hidden="true">
    <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
  </svg>
)
export const SunIcon = () => (
  <svg className="pop" width={14} height={14} viewBox="0 0 24 24" {...line} strokeWidth={2.2} aria-hidden="true">
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </svg>
)
export const CheckIcon = () => (
  <svg width={14} height={14} viewBox="0 0 24 24" {...line} strokeWidth={3} aria-hidden="true">
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </svg>
)

const Small = ({ size = 20, children }: { size?: number; children: React.ReactNode }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...line} strokeWidth={1.8} aria-hidden="true">
    {children}
  </svg>
)

export const BackIcon = () => <Small size={24}><path d="M19 12H5M11 6l-6 6 6 6" /></Small>
export const CloseIcon = () => <Small size={24}><path d="M6 6l12 12M18 6 6 18" /></Small>
export const CopyIcon = () => (
  <Small>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15V5a1 1 0 0 1 1-1h10" />
  </Small>
)
export const CameraIcon = ({ size = 22 }: P) => (
  <Small size={size}>
    <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
    <circle cx="12" cy="13" r="3.5" />
  </Small>
)
export const EditIcon = ({ size = 18 }: P) => <Small size={size}><path d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4" /></Small>
export const SearchIcon = () => (
  <Small size={22}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M16 16l4.5 4.5" />
  </Small>
)
export const AddPersonIcon = () => (
  <Small size={18}>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5 3.3 0 5.9 1.9 6.5 5.5M19 8v6M16 11h6" />
  </Small>
)
export const PlusSmallIcon = () => <Small size={18}><path d="M12 5v14M5 12h14" /></Small>
export const AlertIcon = () => (
  <Small>
    <path d="M12 3 2 20h20z" />
    <path d="M12 10v4M12 17v.5" />
  </Small>
)

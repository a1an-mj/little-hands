# Little Hands — Kindergarten & Tuition Manager

Offline desktop app for one Windows laptop, used by the kindergarten owner (non-technical).
Full requirements: `docs/requirements.md`. Approved screen designs: `design/*.html`.

## Decisions already made (do not re-ask)
- Runs only on the owner's Windows laptop. No server, no internet needed, no user accounts.
- Opens behind a 4-digit PIN; auto-locks after 10 minutes idle.
- Forgot PIN: a one-time recovery code (16 characters) is shown when the PIN is set; it lets the
  owner choose a new PIN and is then replaced by a new code. 5 wrong tries (PIN or code) → 30 s wait.
- English only.
- A child can be in a kindergarten class (Playgroup / LKG / UKG) AND Tuition at the same time.
  Each enrollment has its own days, arrival/departure times and fee agreement.
- Fees are mostly monthly; term-wise or custom must be possible per enrollment.
- Concessions are supported: standard fee − concession = agreed fee, with a reason.
- Attendance (actual arrival / departure / absent) is in version 1, marked from the Students
  screen ("Mark attendance" mode) and from the dashboard's "Today's arrivals" list.
- Receipts: NOT in version 1 (planned later).
- Payments are append-only. Never edit or delete a saved payment; corrections are reversal entries.
- Dashboard shows today's arrivals first, then fees to follow up.
- Cloud: version 1 has encrypted cloud BACKUPS only (see Backups). No multi-device sync yet,
  but the data model must be sync-ready (see Data model rules).

## Still to confirm with the owner
- Fee due day each month (designs assume the 10th).
- Academic year (designs assume June–May, "2026–27").
Ask about these before building the payments module (step 4), not before.

## Tech stack (agreed)
- Electron (desktop shell) + React + TypeScript, bundled with Vite.
- Styling: plain CSS using the colour tokens from `design/`. No UI component library.
- Fonts/icons bundled locally (`@fontsource/roboto`, inline SVG icons). No CDN, no Google Fonts.
- SQLite via **better-sqlite3**, plain SQL with numbered migration files and a migrations table.
  better-sqlite3 is a native module; that is fine because the Windows installer is built on a
  Windows runner (below), where it is compiled for Windows automatically.
- Input validation with zod, shared between UI and main process.
- PIN stored as a scrypt hash (Node `crypto`), never in plain text.
- Tests: Vitest for fee/balance/attendance logic (must be well covered); Playwright for
  end-to-end flows in Electron.
- Packaging: electron-builder (NSIS installer) on GitHub Actions `windows-latest`.
- Security basics: contextIsolation on, nodeIntegration off, all DB access in the main process
  behind a small typed IPC API exposed through a preload script.

## Design
- Material 3 look, light + dark theme. The theme follows Windows' light/dark setting until the
  owner uses the switch; the switch choice is remembered. Smooth transitions; respect "reduce motion".
- Reports and Settings appear in the menu but are greyed out ("Coming in a later version").
- Seed colour #9AE8EB. Colour tokens are the CSS variables at the top of each file in `design/`
  (`.lh{...}` = light, `.lh[data-theme="dark"]{...}` = dark). Reuse them exactly.
- Program colours: Playgroup coral, LKG yellow, UKG blue, Tuition violet (tokens pg/lk/uk/tu).
- The design files are prototypes made in a design tool: the markup inside `<x-dc>` plus the
  `<style>` block show layout and styling; the `<script type="text/x-dc">` block shows intended
  interactions. Rebuild them as real components; don't try to run these files as-is.

## Development setup: build on Linux, ship to Windows
- Development and day-to-day testing happen on an **Arch Linux** laptop. There is no Windows
  machine available to the developer. The finished app runs on the owner's **Windows** laptop.
- Everything must run and be testable on Linux.
- Build the Windows installer on a Windows runner in GitHub Actions (windows-latest), not by
  cross-compiling on Linux. Set this up as part of the packaging step.
- Write platform-neutral code: use path.join and the OS user-data folder (app.getPath('userData')),
  never hard-coded / or \ paths or Linux-only locations.
- Before handing over, the Windows build must be tested on real Windows (owner's laptop or a
  Windows VM): install, PIN, add student, payment, attendance, backup, restore, restart.

## Data model rules
- Store money as integer paise, never floating point.
- SQLite with foreign keys on, WAL mode, and a transaction for every write.
- Sync-ready from day one (so cloud sync can be added later without a rewrite):
  - every table's primary key is a UUID; the readable student ID (LH-<year>-<3-digit sequence>)
    is a separate unique column, generated automatically;
  - every row has `created_at`, `updated_at` and `device_id`;
  - soft delete (`deleted_at`) instead of deleting rows;
  - payments and attendance are append-only event records;
  - keep a change-history (audit) table for edits to students, guardians, enrollments and fees.

## Backups
- Never place the live database file in a cloud-synced folder.
- Make backups with SQLite's online backup API (better-sqlite3 `.backup()`), so copies are
  always consistent.
- Encrypt each backup with a backup password chosen by the owner (e.g. AES-256-GCM with a key
  derived via scrypt). Without the password a backup cannot be read.
- Automatic daily backup on first launch of the day and on close; "Back up now" button.
- Backup folder chosen in the app: typically the OneDrive or Google Drive for desktop folder
  (that tool uploads it to the cloud) or a USB drive. Keep the last 30 backups, delete older ones.
- "Restore from backup" (pick a file, enter password, confirm) to set up a new laptop.
- Show "Last backup: <date, time>" in the app; warn if older than 2 days.

## Way of working
Work in small, reviewable steps on a git branch per module. Before writing code, propose the
data model (tables, columns, relationships) and project structure and wait for approval.
Build and demo one module at a time:
1. Project setup + PIN lock + app shell (navigation rail, theme switch)
2. Students + guardians + admission form
3. Enrollments, schedules and fee agreements
4. Payments (append-only, reversals, balances per period)
5. Attendance + dashboard
6. Backups (encrypted, cloud folder, restore), then packaging as a Windows installer
   (built via GitHub Actions) and a Windows test pass
Keep it simple: no unnecessary infrastructure or features beyond the requirements.

-- Programs, enrollments, expected timings (schedules) and fee agreements.
-- Sync-ready: UUID keys, created/updated/device on every row, soft delete via deleted_at.
-- Schedules and fee agreements are versioned by effective_from: a change from a date adds a row,
-- so the timings and fee that applied on any past day can always be looked up.

-- The four programs. Fixed IDs so every laptop has the same rows when sync is added.
-- The default days and timings only pre-fill the form; nothing is charged from here.
CREATE TABLE programs (
  id               TEXT PRIMARY KEY,
  code             TEXT NOT NULL UNIQUE CHECK (code IN ('pg', 'lk', 'uk', 'tu')),
  name             TEXT NOT NULL,
  kind             TEXT NOT NULL CHECK (kind IN ('kindergarten', 'tuition')),
  sort_order       INTEGER NOT NULL,
  default_days     INTEGER NOT NULL CHECK (default_days BETWEEN 1 AND 127),
  default_arrives  TEXT NOT NULL,
  default_leaves   TEXT NOT NULL,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  device_id        TEXT NOT NULL,
  deleted_at       TEXT
) STRICT;

-- days: one bit per weekday, Monday = 1, Tuesday = 2, Wednesday = 4 … Sunday = 64 (31 = Mon–Fri).
INSERT INTO programs (id, code, name, kind, sort_order, default_days, default_arrives, default_leaves, created_at, updated_at, device_id) VALUES
  ('5a0e6b1c-3f4d-4c2a-9b7e-1d2c3a4b5c01', 'pg', 'Playgroup', 'kindergarten', 1, 31, '09:30', '12:00', '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z', 'seed'),
  ('5a0e6b1c-3f4d-4c2a-9b7e-1d2c3a4b5c02', 'lk', 'LKG',       'kindergarten', 2, 31, '08:45', '12:30', '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z', 'seed'),
  ('5a0e6b1c-3f4d-4c2a-9b7e-1d2c3a4b5c03', 'uk', 'UKG',       'kindergarten', 3, 31, '08:45', '13:00', '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z', 'seed'),
  ('5a0e6b1c-3f4d-4c2a-9b7e-1d2c3a4b5c04', 'tu', 'Tuition',   'tuition',      4, 21, '16:00', '17:30', '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z', 'seed');

CREATE TABLE enrollments (
  id          TEXT PRIMARY KEY,
  student_id  TEXT NOT NULL REFERENCES students (id),
  program_id  TEXT NOT NULL REFERENCES programs (id),
  start_date  TEXT NOT NULL CHECK (start_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  -- Last day attended (inclusive). Empty while the child continues.
  end_date    TEXT CHECK (end_date IS NULL OR (end_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND end_date >= start_date)),
  end_reason  TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  device_id   TEXT NOT NULL,
  deleted_at  TEXT
) STRICT;
CREATE INDEX enrollments_student ON enrollments (student_id) WHERE deleted_at IS NULL;
CREATE INDEX enrollments_program ON enrollments (program_id) WHERE deleted_at IS NULL;
-- A child can't be in the same program twice at once.
CREATE UNIQUE INDEX enrollments_one_open
  ON enrollments (student_id, program_id) WHERE end_date IS NULL AND deleted_at IS NULL;

CREATE TABLE schedules (
  id              TEXT PRIMARY KEY,
  enrollment_id   TEXT NOT NULL REFERENCES enrollments (id),
  effective_from  TEXT NOT NULL CHECK (effective_from GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  days            INTEGER NOT NULL CHECK (days BETWEEN 1 AND 127),
  arrives         TEXT NOT NULL CHECK (arrives GLOB '[0-2][0-9]:[0-5][0-9]'),
  leaves          TEXT NOT NULL CHECK (leaves GLOB '[0-2][0-9]:[0-5][0-9]' AND leaves > arrives),
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  device_id       TEXT NOT NULL,
  deleted_at      TEXT
) STRICT;
CREATE UNIQUE INDEX schedules_one_per_date
  ON schedules (enrollment_id, effective_from) WHERE deleted_at IS NULL;

-- Money is in paise (₹1 = 100). Agreed fee = standard fee − concession, worked out by the database.
CREATE TABLE fee_agreements (
  id                 TEXT PRIMARY KEY,
  enrollment_id      TEXT NOT NULL REFERENCES enrollments (id),
  effective_from     TEXT NOT NULL CHECK (effective_from GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  frequency          TEXT NOT NULL CHECK (frequency IN ('monthly', 'term', 'custom')),
  custom_label       TEXT NOT NULL DEFAULT '',
  standard_paise     INTEGER NOT NULL CHECK (standard_paise >= 0),
  concession_paise   INTEGER NOT NULL DEFAULT 0 CHECK (concession_paise >= 0 AND concession_paise <= standard_paise),
  agreed_paise       INTEGER GENERATED ALWAYS AS (standard_paise - concession_paise) VIRTUAL,
  concession_reason  TEXT NOT NULL DEFAULT '',
  remarks            TEXT NOT NULL DEFAULT '',
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  device_id          TEXT NOT NULL,
  deleted_at         TEXT,
  CHECK (concession_paise = 0 OR length(trim(concession_reason)) > 0),
  CHECK (frequency <> 'custom' OR length(trim(custom_label)) > 0)
) STRICT;
CREATE UNIQUE INDEX fee_agreements_one_per_date
  ON fee_agreements (enrollment_id, effective_from) WHERE deleted_at IS NULL;

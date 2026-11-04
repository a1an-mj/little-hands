-- Students, guardians, notes, photos, and the change history (audit log).
-- Sync-ready: UUID keys, created/updated/device on every row, soft delete via deleted_at.

CREATE TABLE students (
  id            TEXT PRIMARY KEY,
  student_code  TEXT NOT NULL UNIQUE,
  code_year     INTEGER NOT NULL,
  code_seq      INTEGER NOT NULL,
  full_name     TEXT NOT NULL CHECK (length(trim(full_name)) > 0),
  joining_date  TEXT NOT NULL CHECK (joining_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'graduated')),
  home_address  TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  device_id     TEXT NOT NULL,
  deleted_at    TEXT,
  UNIQUE (code_year, code_seq)
) STRICT;
CREATE INDEX students_list ON students (status, full_name COLLATE NOCASE) WHERE deleted_at IS NULL;

CREATE TABLE student_photos (
  id          TEXT PRIMARY KEY,
  student_id  TEXT NOT NULL REFERENCES students (id),
  image       BLOB NOT NULL,
  mime        TEXT NOT NULL CHECK (mime = 'image/jpeg'),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  device_id   TEXT NOT NULL,
  deleted_at  TEXT
) STRICT;
CREATE UNIQUE INDEX student_photos_one ON student_photos (student_id) WHERE deleted_at IS NULL;

CREATE TABLE guardians (
  id          TEXT PRIMARY KEY,
  name        TEXT,
  phone       TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  device_id   TEXT NOT NULL,
  deleted_at  TEXT,
  CHECK (coalesce(name, '') <> '' OR coalesce(phone, '') <> '')
) STRICT;

CREATE TABLE student_guardians (
  id              TEXT PRIMARY KEY,
  student_id      TEXT NOT NULL REFERENCES students (id),
  guardian_id     TEXT NOT NULL REFERENCES guardians (id),
  relationship    TEXT NOT NULL,
  is_fee_contact  INTEGER NOT NULL DEFAULT 0 CHECK (is_fee_contact IN (0, 1)),
  is_emergency    INTEGER NOT NULL DEFAULT 0 CHECK (is_emergency IN (0, 1)),
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  device_id       TEXT NOT NULL,
  deleted_at      TEXT
) STRICT;
CREATE INDEX student_guardians_student ON student_guardians (student_id) WHERE deleted_at IS NULL;
CREATE INDEX student_guardians_guardian ON student_guardians (guardian_id) WHERE deleted_at IS NULL;
-- At most one main contact for fees per child, and no person linked twice to the same child.
CREATE UNIQUE INDEX student_guardians_one_fee_contact
  ON student_guardians (student_id) WHERE is_fee_contact = 1 AND deleted_at IS NULL;
CREATE UNIQUE INDEX student_guardians_unique
  ON student_guardians (student_id, guardian_id) WHERE deleted_at IS NULL;

CREATE TABLE student_notes (
  id          TEXT PRIMARY KEY,
  student_id  TEXT NOT NULL REFERENCES students (id),
  title       TEXT NOT NULL CHECK (length(trim(title)) > 0),
  details     TEXT NOT NULL DEFAULT '',
  important   INTEGER NOT NULL DEFAULT 0 CHECK (important IN (0, 1)),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  device_id   TEXT NOT NULL,
  deleted_at  TEXT
) STRICT;
CREATE INDEX student_notes_student ON student_notes (student_id) WHERE deleted_at IS NULL;

-- Change history. Append-only: the triggers below refuse any edit or delete.
CREATE TABLE audit_log (
  id          TEXT PRIMARY KEY,
  table_name  TEXT NOT NULL,
  row_id      TEXT NOT NULL,
  action      TEXT NOT NULL CHECK (action IN ('insert', 'update', 'delete')),
  changes     TEXT NOT NULL,   -- JSON: { column: [old, new] }
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  device_id   TEXT NOT NULL
) STRICT;
CREATE INDEX audit_log_row ON audit_log (table_name, row_id);

CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;

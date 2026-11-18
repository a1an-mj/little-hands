-- Owner input (Nov 2026): Nursery is a kindergarten class (Playgroup → Nursery → LKG → UKG), and
-- Daycare is a separate program that isn't schooling: each child has their own days and times, and
-- it can be taken together with a class (like Tuition). Also: a "School closed today" record.

-- The programs table only allows the old four codes, so it is rebuilt with the new ones.
-- Enrollments point at programs by id: the rows are copied aside, the table is recreated under the
-- same name and the rows put back with the same ids, so the deferred foreign-key check passes at commit.
PRAGMA defer_foreign_keys = ON;

CREATE TEMP TABLE programs_copy AS SELECT * FROM programs;
DROP TABLE programs;

CREATE TABLE programs (
  id               TEXT PRIMARY KEY,
  code             TEXT NOT NULL UNIQUE CHECK (code IN ('pg', 'nu', 'lk', 'uk', 'dc', 'tu')),
  name             TEXT NOT NULL,
  kind             TEXT NOT NULL CHECK (kind IN ('kindergarten', 'daycare', 'tuition')),
  sort_order       INTEGER NOT NULL,
  default_days     INTEGER NOT NULL CHECK (default_days BETWEEN 1 AND 127),
  default_arrives  TEXT NOT NULL,
  default_leaves   TEXT NOT NULL,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  device_id        TEXT NOT NULL,
  deleted_at       TEXT
) STRICT;

INSERT INTO programs SELECT * FROM programs_copy;
DROP TABLE programs_copy;

-- Menu order: the classes by age, then the add-ons.
UPDATE programs SET sort_order = 1 WHERE code = 'pg';
UPDATE programs SET sort_order = 3 WHERE code = 'lk';
UPDATE programs SET sort_order = 4 WHERE code = 'uk';
UPDATE programs SET sort_order = 6 WHERE code = 'tu';

-- Default days and times only pre-fill the form (Mon–Fri = 31); each child's own are set at admission.
INSERT INTO programs (id, code, name, kind, sort_order, default_days, default_arrives, default_leaves, created_at, updated_at, device_id) VALUES
  ('5a0e6b1c-3f4d-4c2a-9b7e-1d2c3a4b5c05', 'nu', 'Nursery', 'kindergarten', 2, 31, '09:30', '12:30', '2026-11-18T00:00:00.000Z', '2026-11-18T00:00:00.000Z', 'seed'),
  ('5a0e6b1c-3f4d-4c2a-9b7e-1d2c3a4b5c06', 'dc', 'Daycare', 'daycare', 5, 31, '08:30', '17:30', '2026-11-18T00:00:00.000Z', '2026-11-18T00:00:00.000Z', 'seed');

-- Days the school is closed (Onam, Christmas, a strike day). Re-opening soft-deletes the row.
CREATE TABLE closed_days (
  id          TEXT PRIMARY KEY,
  date        TEXT NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  reason      TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  device_id   TEXT NOT NULL,
  deleted_at  TEXT
) STRICT;
CREATE UNIQUE INDEX closed_days_one_per_date ON closed_days (date) WHERE deleted_at IS NULL;

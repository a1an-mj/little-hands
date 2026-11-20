-- Owner's paper admission form (Nov 2026): two more programs, and the details the form asks for.

-- 1. Preparatory class (tuition during the summer vacation) and Summer camp: their own days,
--    attendance and fee (one-time or monthly per child). The code list is rebuilt again (as in 006).
PRAGMA defer_foreign_keys = ON;

CREATE TEMP TABLE programs_copy AS SELECT * FROM programs;
DROP TABLE programs;

CREATE TABLE programs (
  id               TEXT PRIMARY KEY,
  code             TEXT NOT NULL UNIQUE CHECK (code IN ('pg', 'nu', 'lk', 'uk', 'dc', 'tu', 'pc', 'sm', 'ka', 'da', 'tr')),
  name             TEXT NOT NULL,
  kind             TEXT NOT NULL CHECK (kind IN ('kindergarten', 'daycare', 'tuition', 'vacation', 'extra')),
  sort_order       INTEGER NOT NULL,
  default_days     INTEGER CHECK (default_days IS NULL OR default_days BETWEEN 1 AND 127),
  default_arrives  TEXT,
  default_leaves   TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  device_id        TEXT NOT NULL,
  deleted_at       TEXT
) STRICT;

INSERT INTO programs SELECT * FROM programs_copy;
DROP TABLE programs_copy;

-- Menu order: classes, Daycare, Tuition, the vacation programs, then the extras.
UPDATE programs SET sort_order = 9 WHERE code = 'ka';
UPDATE programs SET sort_order = 10 WHERE code = 'da';
UPDATE programs SET sort_order = 11 WHERE code = 'tr';
INSERT INTO programs (id, code, name, kind, sort_order, default_days, created_at, updated_at, device_id) VALUES
  ('5a0e6b1c-3f4d-4c2a-9b7e-1d2c3a4b5c10', 'pc', 'Preparatory class', 'vacation', 7, 31, '2026-11-20T00:00:00.000Z', '2026-11-20T00:00:00.000Z', 'seed'),
  ('5a0e6b1c-3f4d-4c2a-9b7e-1d2c3a4b5c11', 'sm', 'Summer camp',       'vacation', 8, 31, '2026-11-20T00:00:00.000Z', '2026-11-20T00:00:00.000Z', 'seed');

-- 2. The child: date of birth, and for "afterschool" children (who study at another school and
--    come here after school, in Tuition or Daycare) that school and class.
ALTER TABLE students ADD COLUMN date_of_birth TEXT CHECK (date_of_birth IS NULL OR date_of_birth GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]');
ALTER TABLE students ADD COLUMN afterschool INTEGER NOT NULL DEFAULT 0 CHECK (afterschool IN (0, 1));
ALTER TABLE students ADD COLUMN other_school TEXT NOT NULL DEFAULT '';
ALTER TABLE students ADD COLUMN other_school_class TEXT NOT NULL DEFAULT '';

-- 3. Parents' occupation (any guardian may have one).
ALTER TABLE guardians ADD COLUMN occupation TEXT NOT NULL DEFAULT '';

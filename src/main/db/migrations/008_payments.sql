-- Step 4: payments. What a parent owes is worked out from the fee agreements (src/shared/periods.ts);
-- only real events are stored here: payments and reversals, extra charges, and waived periods.

-- 1. Extras (karate, dance, transport) are programs of kind 'extra': their own fee, period and due day,
--    but no days and no attendance. The programs table only allows the listed codes, so it is rebuilt
--    (same way as migration 006: rows copied aside, ids kept, foreign keys checked at commit).
PRAGMA defer_foreign_keys = ON;

CREATE TEMP TABLE programs_copy AS SELECT * FROM programs;
DROP TABLE programs;

CREATE TABLE programs (
  id               TEXT PRIMARY KEY,
  code             TEXT NOT NULL UNIQUE CHECK (code IN ('pg', 'nu', 'lk', 'uk', 'dc', 'tu', 'ka', 'da', 'tr')),
  name             TEXT NOT NULL,
  kind             TEXT NOT NULL CHECK (kind IN ('kindergarten', 'daycare', 'tuition', 'extra')),
  sort_order       INTEGER NOT NULL,
  -- Pre-fill for the form; empty for extras (no days). The old default times are no longer used.
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

INSERT INTO programs (id, code, name, kind, sort_order, default_days, created_at, updated_at, device_id) VALUES
  ('5a0e6b1c-3f4d-4c2a-9b7e-1d2c3a4b5c07', 'ka', 'Karate',    'extra', 7, NULL, '2026-11-19T00:00:00.000Z', '2026-11-19T00:00:00.000Z', 'seed'),
  ('5a0e6b1c-3f4d-4c2a-9b7e-1d2c3a4b5c08', 'da', 'Dance',     'extra', 8, NULL, '2026-11-19T00:00:00.000Z', '2026-11-19T00:00:00.000Z', 'seed'),
  ('5a0e6b1c-3f4d-4c2a-9b7e-1d2c3a4b5c09', 'tr', 'Transport', 'extra', 9, NULL, '2026-11-19T00:00:00.000Z', '2026-11-19T00:00:00.000Z', 'seed');

-- 2. Charges besides the regular fee: the one-time admission fee, late fines, anything else.
--    Cancelling one (added by mistake) soft-deletes it; the change history keeps the record.
CREATE TABLE charges (
  id            TEXT PRIMARY KEY,
  student_id    TEXT NOT NULL REFERENCES students (id),
  kind          TEXT NOT NULL CHECK (kind IN ('admission', 'fine', 'other')),
  label         TEXT NOT NULL CHECK (length(trim(label)) > 0),
  amount_paise  INTEGER NOT NULL CHECK (amount_paise > 0),
  due_date      TEXT NOT NULL CHECK (due_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  reason        TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  device_id     TEXT NOT NULL,
  deleted_at    TEXT
) STRICT;
CREATE INDEX charges_student ON charges (student_id) WHERE deleted_at IS NULL;

-- 3. "Don't charge this period" (e.g. Daycare while the child is away). One per period.
CREATE TABLE fee_waivers (
  id             TEXT PRIMARY KEY,
  enrollment_id  TEXT NOT NULL REFERENCES enrollments (id),
  period_start   TEXT NOT NULL CHECK (period_start GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  reason         TEXT NOT NULL CHECK (length(trim(reason)) > 0),
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  device_id      TEXT NOT NULL,
  deleted_at     TEXT
) STRICT;
CREATE UNIQUE INDEX fee_waivers_one_per_period
  ON fee_waivers (enrollment_id, period_start) WHERE deleted_at IS NULL;

-- 4. Payments: append-only, never updated or deleted. A mistake is cancelled by a 'reversal' row with
--    the negative amount, pointing at the payment it reverses, with a reason.
--    Each payment is for one child and one thing: a program's period, or a charge.
CREATE TABLE payments (
  id                   TEXT PRIMARY KEY,
  -- Shown as PAY-0001, PAY-0002… (reversals get their own number too, as in the design).
  payment_seq          INTEGER NOT NULL UNIQUE CHECK (payment_seq > 0),
  student_id           TEXT NOT NULL REFERENCES students (id),
  enrollment_id        TEXT REFERENCES enrollments (id),
  period_start         TEXT CHECK (period_start IS NULL OR period_start GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  charge_id            TEXT REFERENCES charges (id),
  kind                 TEXT NOT NULL CHECK (kind IN ('payment', 'reversal')),
  amount_paise         INTEGER NOT NULL,
  method               TEXT NOT NULL CHECK (method IN ('cash', 'upi', 'bank')),
  reference            TEXT NOT NULL DEFAULT '',
  -- Local date and time the money was received, "YYYY-MM-DDTHH:MM".
  paid_at              TEXT NOT NULL CHECK (paid_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-2][0-9]:[0-5][0-9]'),
  recorded_by          TEXT NOT NULL CHECK (length(trim(recorded_by)) > 0),
  remarks              TEXT NOT NULL DEFAULT '',
  reverses_payment_id  TEXT REFERENCES payments (id),
  reason               TEXT NOT NULL DEFAULT '',
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL,
  device_id            TEXT NOT NULL,
  deleted_at           TEXT,
  -- For exactly one thing: a program's period, or a charge.
  CHECK ((enrollment_id IS NOT NULL AND period_start IS NOT NULL AND charge_id IS NULL)
      OR (enrollment_id IS NULL AND period_start IS NULL AND charge_id IS NOT NULL)),
  CHECK ((kind = 'payment' AND amount_paise > 0 AND reverses_payment_id IS NULL)
      OR (kind = 'reversal' AND amount_paise < 0 AND reverses_payment_id IS NOT NULL AND length(trim(reason)) > 0))
) STRICT;
CREATE INDEX payments_student ON payments (student_id) WHERE deleted_at IS NULL;
CREATE INDEX payments_period ON payments (enrollment_id, period_start) WHERE deleted_at IS NULL;
CREATE INDEX payments_charge ON payments (charge_id) WHERE deleted_at IS NULL;
CREATE INDEX payments_paid_at ON payments (paid_at) WHERE deleted_at IS NULL;
-- A payment can be reversed only once.
CREATE UNIQUE INDEX payments_reversed_once ON payments (reverses_payment_id) WHERE reverses_payment_id IS NOT NULL;

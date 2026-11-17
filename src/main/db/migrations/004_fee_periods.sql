-- Fees are paid per child every N months, on the child's own due day (confirmed with the owner).
-- Replaces frequency ('monthly' / 'term' / 'custom') with period_months, and adds due_day.
-- period_months: 1 = monthly, 3 = every 3 months, 12 = yearly, 0 = one-time.
-- The choices offered are listed in src/shared/enrollments.ts (FEE_PERIODS).

CREATE TABLE fee_agreements_new (
  id                 TEXT PRIMARY KEY,
  enrollment_id      TEXT NOT NULL REFERENCES enrollments (id),
  effective_from     TEXT NOT NULL CHECK (effective_from GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  period_months      INTEGER NOT NULL CHECK (period_months BETWEEN 0 AND 24),
  -- Day of the month the fee is due. In shorter months, a day like 31 means the last day.
  due_day            INTEGER NOT NULL CHECK (due_day BETWEEN 1 AND 31),
  standard_paise     INTEGER NOT NULL CHECK (standard_paise >= 0),
  concession_paise   INTEGER NOT NULL DEFAULT 0 CHECK (concession_paise >= 0 AND concession_paise <= standard_paise),
  agreed_paise       INTEGER GENERATED ALWAYS AS (standard_paise - concession_paise) VIRTUAL,
  concession_reason  TEXT NOT NULL DEFAULT '',
  remarks            TEXT NOT NULL DEFAULT '',
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  device_id          TEXT NOT NULL,
  deleted_at         TEXT,
  CHECK (concession_paise = 0 OR length(trim(concession_reason)) > 0)
) STRICT;

-- Existing agreements: monthly stays monthly; "per term" and "custom" become every 3 months
-- (to be checked by the owner), keeping any custom wording in the remarks. Due day = start day.
INSERT INTO fee_agreements_new (id, enrollment_id, effective_from, period_months, due_day, standard_paise,
                                concession_paise, concession_reason, remarks, created_at, updated_at, device_id, deleted_at)
SELECT id, enrollment_id, effective_from,
       CASE frequency WHEN 'monthly' THEN 1 ELSE 3 END,
       CAST(substr(effective_from, 9, 2) AS INTEGER),
       standard_paise, concession_paise, concession_reason,
       CASE WHEN frequency = 'custom' THEN trim(remarks || ' (Was: ' || custom_label || ')') ELSE remarks END,
       created_at, updated_at, device_id, deleted_at
FROM fee_agreements;

DROP TABLE fee_agreements;
ALTER TABLE fee_agreements_new RENAME TO fee_agreements;
CREATE UNIQUE INDEX fee_agreements_one_per_date
  ON fee_agreements (enrollment_id, effective_from) WHERE deleted_at IS NULL;

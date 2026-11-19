-- Owner (Nov 2026): children have no fixed arrival or leaving time, and nobody is "late"; the app
-- only records when a child actually came and left (attendance_events). A program's schedule now
-- holds only the days the child comes. The old time columns become optional: times saved before
-- stay in the history, new rows leave them empty, and the app no longer reads them.
-- (Nothing references schedules, so a plain rebuild is enough.)

CREATE TABLE schedules_new (
  id              TEXT PRIMARY KEY,
  enrollment_id   TEXT NOT NULL REFERENCES enrollments (id),
  effective_from  TEXT NOT NULL CHECK (effective_from GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  days            INTEGER NOT NULL CHECK (days BETWEEN 1 AND 127),
  arrives         TEXT CHECK (arrives IS NULL OR arrives GLOB '[0-2][0-9]:[0-5][0-9]'),
  leaves          TEXT CHECK (leaves IS NULL OR leaves GLOB '[0-2][0-9]:[0-5][0-9]'),
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  device_id       TEXT NOT NULL,
  deleted_at      TEXT
) STRICT;

INSERT INTO schedules_new SELECT * FROM schedules;
DROP TABLE schedules;
ALTER TABLE schedules_new RENAME TO schedules;
CREATE UNIQUE INDEX schedules_one_per_date
  ON schedules (enrollment_id, effective_from) WHERE deleted_at IS NULL;

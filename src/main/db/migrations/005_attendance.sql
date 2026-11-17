-- Attendance: what actually happened each day, per program (a child in LKG and Tuition comes twice).
-- Append-only event records: a tap on "Arrived", "Mark left" or "Absent" adds a row; nothing is
-- edited or deleted. A mistake is cancelled with a 'void' row pointing at the event it cancels
-- (the same idea as payment reversals). The day's status is worked out by replaying the events
-- (src/shared/attendance.ts). Expected days and times come from the schedules table.

CREATE TABLE attendance_events (
  id              TEXT PRIMARY KEY,
  enrollment_id   TEXT NOT NULL REFERENCES enrollments (id),
  date            TEXT NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  kind            TEXT NOT NULL CHECK (kind IN ('arrived', 'left', 'absent', 'void')),
  -- Arrival / leaving time on the laptop's clock. Empty for "present" marked without a time.
  at              TEXT CHECK (at IS NULL OR at GLOB '[0-2][0-9]:[0-5][0-9]'),
  note            TEXT NOT NULL DEFAULT '',
  voids_event_id  TEXT REFERENCES attendance_events (id),
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  device_id       TEXT NOT NULL,
  deleted_at      TEXT,
  CHECK (kind IN ('arrived', 'left') OR at IS NULL),
  CHECK (kind <> 'left' OR at IS NOT NULL),
  CHECK ((kind = 'void') = (voids_event_id IS NOT NULL))
) STRICT;

CREATE INDEX attendance_by_enrollment_date ON attendance_events (enrollment_id, date) WHERE deleted_at IS NULL;
CREATE INDEX attendance_by_date ON attendance_events (date) WHERE deleted_at IS NULL;

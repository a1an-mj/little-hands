-- Calendar events and a shared to-do list (Nov 2026).
-- Birthdays and "School closed" days are not stored again: the calendar reads them from
-- students.date_of_birth and closed_days. A holiday event also closes the school that day
-- (a closed_days row with the holiday's title), and removing the holiday opens it again.

CREATE TABLE events (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 100),
  date        TEXT NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  time        TEXT CHECK (time IS NULL OR time GLOB '[0-2][0-9]:[0-5][0-9]'),
  kind        TEXT NOT NULL CHECK (kind IN ('event', 'holiday', 'meeting')),
  notes       TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  device_id   TEXT NOT NULL,
  deleted_at  TEXT
) STRICT;
CREATE INDEX events_by_date ON events (date) WHERE deleted_at IS NULL;

-- One list for the owner and the teachers. done_at is empty until the task is ticked.
CREATE TABLE todos (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  notes       TEXT NOT NULL DEFAULT '',
  due_date    TEXT CHECK (due_date IS NULL OR due_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  student_id  TEXT REFERENCES students (id),
  done_at     TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  device_id   TEXT NOT NULL,
  deleted_at  TEXT
) STRICT;
CREATE INDEX todos_open ON todos (due_date) WHERE deleted_at IS NULL AND done_at IS NULL;
CREATE INDEX todos_by_student ON todos (student_id) WHERE deleted_at IS NULL;

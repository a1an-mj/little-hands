-- Settings that belong to this laptop only (PIN, theme, device id).
-- Never synced: each device keeps its own.
CREATE TABLE app_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  device_id  TEXT NOT NULL
) STRICT;

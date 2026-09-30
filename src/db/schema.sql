-- Core schema per design.md "Data model" section.
-- SQLite for local/personal-scale use; revisit if this becomes multi-user.

CREATE TABLE IF NOT EXISTS activities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  start_time TEXT NOT NULL,
  duration_seconds INTEGER NOT NULL,
  distance_meters REAL,
  elevation_gain_meters REAL,
  tss REAL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Links a canonical activity back to each source's native record.
-- One activity can have multiple rows here (e.g. same workout from Garmin + Strava).
CREATE TABLE IF NOT EXISTS activity_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  activity_id INTEGER NOT NULL REFERENCES activities(id),
  source TEXT NOT NULL CHECK (source IN ('strava', 'garmin', 'trainingpeaks')),
  source_activity_id TEXT NOT NULL,
  raw_payload TEXT NOT NULL,
  UNIQUE (source, source_activity_id)
);

CREATE TABLE IF NOT EXISTS metrics_daily (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL CHECK (source IN ('strava', 'garmin', 'trainingpeaks')),
  date TEXT NOT NULL,
  hrv REAL,
  resting_heart_rate REAL,
  sleep_score REAL,
  body_battery REAL,
  vo2_max REAL,
  raw_payload TEXT NOT NULL,
  UNIQUE (source, date)
);

CREATE TABLE IF NOT EXISTS training_load (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL UNIQUE,
  ctl REAL,
  atl REAL,
  tsb REAL
);

CREATE TABLE IF NOT EXISTS planned_workouts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_workout_id TEXT NOT NULL UNIQUE,
  planned_date TEXT NOT NULL,
  type TEXT NOT NULL,
  planned_tss REAL,
  description TEXT,
  raw_payload TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_state (
  source TEXT PRIMARY KEY CHECK (source IN ('strava', 'garmin', 'trainingpeaks')),
  last_synced_at TEXT,
  last_status TEXT
);

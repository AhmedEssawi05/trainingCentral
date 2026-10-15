import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Node's built-in SQLite (node:sqlite) instead of better-sqlite3 — avoids a native
// build step (node-gyp/Xcode CLT) for what's a small, local-scale personal project.
export function openDb(path = "training-central.db"): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL");
  const schema = readFileSync(join(__dirname, "schema.sql"), "utf-8");
  db.exec(schema);
  migrate(db);
  return db;
}

// schema.sql only uses CREATE TABLE IF NOT EXISTS, so columns added later need an ALTER
// for databases created before them.
function migrate(db: DatabaseSync): void {
  const cols = db.prepare("PRAGMA table_info(activity_sources)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "normalized_payload")) {
    db.exec("ALTER TABLE activity_sources ADD COLUMN normalized_payload TEXT");
  }
  // Rows written before reconciliation existed: each is the sole source of its activity,
  // so the canonical row is exactly that source's normalized data.
  db.exec(`
    UPDATE activity_sources
    SET normalized_payload = (
      SELECT json_object(
        'sourceActivityId', activity_sources.source_activity_id,
        'source', activity_sources.source,
        'type', a.type,
        'startTime', a.start_time,
        'durationSeconds', a.duration_seconds,
        'distanceMeters', a.distance_meters,
        'elevationGainMeters', a.elevation_gain_meters,
        'tss', a.tss
      ) FROM activities a WHERE a.id = activity_sources.activity_id
    )
    WHERE normalized_payload IS NULL
      AND (SELECT COUNT(*) FROM activity_sources o WHERE o.activity_id = activity_sources.activity_id) = 1
  `);
}

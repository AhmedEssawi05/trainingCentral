// Sync entry point: runs one connector end-to-end and writes results to the DB.
// Currently wires up Strava only; Garmin/TrainingPeaks connectors slot in the same way
// once reconciliation (design.md "Reconciliation / Dedup Layer") exists to merge them.

import "dotenv/config";
import { openDb } from "../db/client.js";
import { StravaConnector } from "../connectors/strava/index.js";
import type { NormalizedActivity, SyncCheckpoint } from "../connectors/types.js";

async function main() {
  const db = openDb();

  const connector = new StravaConnector({
    clientId: requireEnv("STRAVA_CLIENT_ID"),
    clientSecret: requireEnv("STRAVA_CLIENT_SECRET"),
    refreshToken: requireEnv("STRAVA_REFRESH_TOKEN"),
  });

  const checkpoint = getCheckpoint(db, connector.source);

  await connector.authenticate();
  const activities = await connector.fetchActivities(checkpoint);

  db.exec("BEGIN");
  try {
    for (const activity of activities) {
      insertActivity(db, activity);
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  updateCheckpoint(db, connector.source);

  console.log(`Synced ${activities.length} activities from ${connector.source}`);
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

function getCheckpoint(db: ReturnType<typeof openDb>, source: string): SyncCheckpoint {
  const row = db
    .prepare("SELECT last_synced_at FROM sync_state WHERE source = ?")
    .get(source) as { last_synced_at: string | null } | undefined;
  return { source: source as SyncCheckpoint["source"], lastSyncedAt: row?.last_synced_at ?? null };
}

function updateCheckpoint(db: ReturnType<typeof openDb>, source: string): void {
  db.prepare(
    `INSERT INTO sync_state (source, last_synced_at, last_status)
     VALUES (?, ?, 'ok')
     ON CONFLICT(source) DO UPDATE SET last_synced_at = excluded.last_synced_at, last_status = 'ok'`,
  ).run(source, new Date().toISOString());
}

// No reconciliation layer yet, so each source's activity is inserted as its own
// canonical activity. This will need to change once a second connector exists
// and the same workout can arrive from more than one source.
function insertActivity(db: ReturnType<typeof openDb>, activity: NormalizedActivity): void {
  const existing = db
    .prepare("SELECT activity_id FROM activity_sources WHERE source = ? AND source_activity_id = ?")
    .get(activity.source, activity.sourceActivityId);
  if (existing) return;

  const result = db
    .prepare(
      `INSERT INTO activities (type, start_time, duration_seconds, distance_meters, elevation_gain_meters, tss)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      activity.type,
      activity.startTime,
      activity.durationSeconds,
      activity.distanceMeters ?? null,
      activity.elevationGainMeters ?? null,
      activity.tss ?? null,
    );

  db.prepare(
    `INSERT INTO activity_sources (activity_id, source, source_activity_id, raw_payload)
     VALUES (?, ?, ?, ?)`,
  ).run(result.lastInsertRowid, activity.source, activity.sourceActivityId, JSON.stringify(activity.raw));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

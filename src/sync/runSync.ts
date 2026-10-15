// Sync entry point: runs one connector end-to-end and writes results to the DB.
// Currently wires up Strava only; Garmin/TrainingPeaks connectors slot in the same way.
// Activities go through the reconciliation layer so cross-source duplicates merge.

import "dotenv/config";
import { openDb } from "../db/client.js";
import { StravaConnector } from "../connectors/strava/index.js";
import { reconcileActivity } from "../reconcile/reconcile.js";
import type { SyncCheckpoint } from "../connectors/types.js";

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
      reconcileActivity(db, activity);
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

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

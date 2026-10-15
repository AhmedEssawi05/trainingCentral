import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { reconcileActivity } from "./reconcile.js";
import type { NormalizedActivity } from "../connectors/types.js";

const schema = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../db/schema.sql"), "utf-8");

function memDb() {
  const db = new DatabaseSync(":memory:");
  db.exec(schema);
  return db;
}

const act = (over: Partial<NormalizedActivity>): NormalizedActivity => ({
  sourceActivityId: "1",
  source: "strava",
  type: "Run",
  startTime: "2026-01-01T10:00:00Z",
  durationSeconds: 3600,
  raw: {},
  ...over,
});

const count = (db: DatabaseSync, table: string) =>
  (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

test("creates a canonical activity and a source link", () => {
  const db = memDb();
  const r = reconcileActivity(db, act({ distanceMeters: 10000 }));
  assert.equal(r.outcome, "created");
  assert.equal(count(db, "activities"), 1);
  assert.equal(count(db, "activity_sources"), 1);
});

test("same workout from two sources merges into one canonical activity", () => {
  const db = memDb();
  reconcileActivity(db, act({ distanceMeters: 10000, elevationGainMeters: 50 }));
  const r = reconcileActivity(
    db,
    act({ source: "garmin", sourceActivityId: "g1", startTime: "2026-01-01T10:02:00Z", durationSeconds: 3620, distanceMeters: 10100, type: "running" }),
  );
  assert.equal(r.outcome, "merged");
  assert.equal(count(db, "activities"), 1);
  assert.equal(count(db, "activity_sources"), 2);
  const row = db.prepare("SELECT * FROM activities").get() as Record<string, unknown>;
  assert.equal(row.distance_meters, 10100); // garmin wins distance
  assert.equal(row.elevation_gain_meters, 50); // falls back to strava where garmin has none
});

test("tss prefers TrainingPeaks regardless of arrival order", () => {
  const db = memDb();
  reconcileActivity(db, act({ source: "trainingpeaks", sourceActivityId: "t1", tss: 80 }));
  reconcileActivity(db, act({ source: "garmin", sourceActivityId: "g1", tss: 70 }));
  const row = db.prepare("SELECT tss FROM activities").get() as { tss: number };
  assert.equal(row.tss, 80);
});

test("different type, distant start, or very different duration do not merge", () => {
  const db = memDb();
  reconcileActivity(db, act({}));
  reconcileActivity(db, act({ source: "garmin", sourceActivityId: "a", type: "Ride" }));
  reconcileActivity(db, act({ source: "garmin", sourceActivityId: "b", startTime: "2026-01-01T10:30:00Z" }));
  reconcileActivity(db, act({ source: "garmin", sourceActivityId: "c", durationSeconds: 1800 }));
  assert.equal(count(db, "activities"), 4);
});

test("two activities from the same source never merge with each other", () => {
  const db = memDb();
  reconcileActivity(db, act({ sourceActivityId: "1" }));
  reconcileActivity(db, act({ sourceActivityId: "2", startTime: "2026-01-01T10:01:00Z" }));
  assert.equal(count(db, "activities"), 2);
});

test("re-syncing a known record updates it in place", () => {
  const db = memDb();
  reconcileActivity(db, act({ distanceMeters: 5000 }));
  assert.equal(reconcileActivity(db, act({ distanceMeters: 5000 })).outcome, "unchanged");
  assert.equal(reconcileActivity(db, act({ distanceMeters: 5200 })).outcome, "updated");
  assert.equal(count(db, "activities"), 1);
  const row = db.prepare("SELECT distance_meters FROM activities").get() as { distance_meters: number };
  assert.equal(row.distance_meters, 5200);
});

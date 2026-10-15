// Reconciliation / dedup layer (design.md component 3).
//
// Takes a NormalizedActivity from any connector and either links it to an existing
// canonical activity (same physical workout from another source) or creates a new one.
// The canonical row is always rebuilt from every linked source using per-field precedence.

import type { DatabaseSync } from "node:sqlite";
import type { NormalizedActivity, SourceName } from "../connectors/types.js";

export const MATCH_START_TOLERANCE_MS = 5 * 60 * 1000;
export const MATCH_DURATION_TOLERANCE = 0.1; // fraction of the longer duration
export const MATCH_DURATION_MIN_SLACK_SECONDS = 60;

type MergedField = "startTime" | "type" | "durationSeconds" | "distanceMeters" | "elevationGainMeters" | "tss";

// Highest-precedence source first. Per field, not a single "trust this source" rule.
export const FIELD_PRECEDENCE: Record<MergedField, SourceName[]> = {
  startTime: ["garmin", "strava", "trainingpeaks"],
  type: ["garmin", "strava", "trainingpeaks"],
  durationSeconds: ["garmin", "strava", "trainingpeaks"],
  distanceMeters: ["garmin", "strava", "trainingpeaks"],
  elevationGainMeters: ["garmin", "strava", "trainingpeaks"],
  tss: ["trainingpeaks", "garmin", "strava"],
};

// Sources label the same sport differently ("Run" vs "TrailRun" vs "running"); matching
// compares these groups, while the canonical `type` keeps the winning source's label.
const TYPE_GROUPS: Record<string, string> = {
  run: "run", trailrun: "run", virtualrun: "run", running: "run", treadmill_running: "run", trail_running: "run",
  ride: "ride", virtualride: "ride", ebikeride: "ride", gravelride: "ride", mountainbikeride: "ride",
  emountainbikeride: "ride", cycling: "ride", road_biking: "ride", gravel_cycling: "ride", mountain_biking: "ride",
  virtual_ride: "ride", indoor_cycling: "ride",
  swim: "swim", swimming: "swim", lap_swimming: "swim", open_water_swimming: "swim",
  walk: "walk", walking: "walk", hike: "walk", hiking: "walk",
};

export function typeGroup(type: string): string {
  const key = type.toLowerCase().replace(/[\s-]/g, "_");
  return TYPE_GROUPS[key] ?? key;
}

export type NormalizedFields = Omit<NormalizedActivity, "raw">;

export type ReconcileResult = {
  activityId: number;
  outcome: "created" | "merged" | "updated" | "unchanged";
};

export function reconcileActivity(db: DatabaseSync, activity: NormalizedActivity): ReconcileResult {
  const normalized = stripRaw(activity);
  const rawJson = JSON.stringify(activity.raw);

  // Re-sync of a record we already know: refresh its link and rebuild the canonical row.
  const existing = db
    .prepare("SELECT id, activity_id, raw_payload, normalized_payload FROM activity_sources WHERE source = ? AND source_activity_id = ?")
    .get(activity.source, activity.sourceActivityId) as
    | { id: number; activity_id: number; raw_payload: string; normalized_payload: string | null }
    | undefined;
  if (existing) {
    const unchanged = existing.raw_payload === rawJson && existing.normalized_payload === JSON.stringify(normalized);
    db.prepare("UPDATE activity_sources SET raw_payload = ?, normalized_payload = ? WHERE id = ?").run(
      rawJson,
      JSON.stringify(normalized),
      existing.id,
    );
    rebuildCanonical(db, existing.activity_id);
    return { activityId: existing.activity_id, outcome: unchanged ? "unchanged" : "updated" };
  }

  const matchId = findMatch(db, normalized);
  if (matchId !== null) {
    insertLink(db, matchId, normalized, rawJson);
    rebuildCanonical(db, matchId);
    return { activityId: matchId, outcome: "merged" };
  }

  const result = db
    .prepare("INSERT INTO activities (type, start_time, duration_seconds) VALUES (?, ?, ?)")
    .run(normalized.type, normalized.startTime, normalized.durationSeconds);
  const activityId = Number(result.lastInsertRowid);
  insertLink(db, activityId, normalized, rawJson);
  rebuildCanonical(db, activityId);
  return { activityId, outcome: "created" };
}

/** Closest-starting canonical activity that is plausibly the same workout, or null. */
export function findMatch(db: DatabaseSync, a: NormalizedFields): number | null {
  const start = Date.parse(a.startTime);
  const lo = new Date(start - MATCH_START_TOLERANCE_MS).toISOString();
  const hi = new Date(start + MATCH_START_TOLERANCE_MS).toISOString();

  const candidates = db
    .prepare(
      `SELECT a.id, a.type, a.start_time, a.duration_seconds
       FROM activities a
       WHERE a.start_time BETWEEN ? AND ?
         AND NOT EXISTS (SELECT 1 FROM activity_sources s WHERE s.activity_id = a.id AND s.source = ?)`,
    )
    .all(wideBound(lo, -1), wideBound(hi, 1), a.source) as {
    id: number;
    type: string;
    start_time: string;
    duration_seconds: number;
  }[];

  let best: { id: number; diff: number } | null = null;
  for (const c of candidates) {
    const diff = Math.abs(Date.parse(c.start_time) - start);
    if (diff > MATCH_START_TOLERANCE_MS) continue;
    if (typeGroup(c.type) !== typeGroup(a.type)) continue;
    const longer = Math.max(c.duration_seconds, a.durationSeconds);
    const slack = Math.max(MATCH_DURATION_MIN_SLACK_SECONDS, longer * MATCH_DURATION_TOLERANCE);
    if (Math.abs(c.duration_seconds - a.durationSeconds) > slack) continue;
    if (best === null || diff < best.diff) best = { id: c.id, diff };
  }
  return best?.id ?? null;
}

// String BETWEEN on ISO timestamps is only a prefilter (the precise check is in JS);
// widen by a day so differing timestamp formats can't exclude a real candidate.
function wideBound(iso: string, direction: 1 | -1): string {
  return new Date(Date.parse(iso) + direction * 24 * 60 * 60 * 1000).toISOString();
}

function insertLink(db: DatabaseSync, activityId: number, n: NormalizedFields, rawJson: string): void {
  db.prepare(
    `INSERT INTO activity_sources (activity_id, source, source_activity_id, raw_payload, normalized_payload)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(activityId, n.source, n.sourceActivityId, rawJson, JSON.stringify(n));
}

/** Recompute the canonical row from all linked sources using FIELD_PRECEDENCE. */
export function rebuildCanonical(db: DatabaseSync, activityId: number): void {
  const rows = db
    .prepare("SELECT normalized_payload FROM activity_sources WHERE activity_id = ?")
    .all(activityId) as { normalized_payload: string | null }[];
  const sources = rows.flatMap((r) => (r.normalized_payload ? [JSON.parse(r.normalized_payload) as NormalizedFields] : []));
  if (sources.length === 0) return; // legacy rows with no normalized payload: leave canonical as-is

  const pick = <F extends MergedField>(field: F): NormalizedFields[F] | undefined => {
    const rank = (s: SourceName) => FIELD_PRECEDENCE[field].indexOf(s);
    const ordered = [...sources].sort((x, y) => rank(x.source) - rank(y.source));
    return ordered.find((s) => s[field] !== undefined && s[field] !== null)?.[field];
  };

  db.prepare(
    `UPDATE activities
     SET type = ?, start_time = ?, duration_seconds = ?, distance_meters = ?, elevation_gain_meters = ?, tss = ?
     WHERE id = ?`,
  ).run(
    pick("type")!,
    pick("startTime")!,
    pick("durationSeconds")!,
    pick("distanceMeters") ?? null,
    pick("elevationGainMeters") ?? null,
    pick("tss") ?? null,
    activityId,
  );
}

function stripRaw(a: NormalizedActivity): NormalizedFields {
  const { raw: _raw, ...rest } = a;
  return rest;
}

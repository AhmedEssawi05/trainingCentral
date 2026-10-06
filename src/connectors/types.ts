// Shared contract every source connector (Strava, Garmin, TrainingPeaks) implements.
// See design.md "Connectors" section.
//
// A connector only talks to its source API and maps results into the normalized
// shapes below. It does not write to the DB and does not dedupe across sources.

export type SourceName = "strava" | "garmin" | "trainingpeaks";

export interface NormalizedActivity {
  sourceActivityId: string;
  source: SourceName;
  type: string;
  startTime: string; // ISO 8601
  durationSeconds: number;
  distanceMeters?: number;
  elevationGainMeters?: number;
  tss?: number;
  raw: unknown; // original API payload, stored for replay if normalization changes
}

export interface NormalizedMetric {
  source: SourceName;
  date: string; // YYYY-MM-DD
  hrv?: number;
  restingHeartRate?: number;
  sleepScore?: number;
  bodyBattery?: number;
  vo2Max?: number;
  raw: unknown;
}

export interface SyncCheckpoint {
  source: SourceName;
  lastSyncedAt: string | null; // ISO 8601, null on first sync
}

export interface Connector {
  readonly source: SourceName;
  /** Obtain/refresh credentials. Safe to call repeatedly. */
  authenticate(): Promise<void>;
  /** Fetch all activities after the checkpoint (handles pagination internally). */
  fetchActivities(since: SyncCheckpoint): Promise<NormalizedActivity[]>;
  /** Fetch health/load metrics; connectors without any return []. */
  fetchMetrics(since: SyncCheckpoint): Promise<NormalizedMetric[]>;
  /** Pure mapping from a source-specific activity payload to the shared shape. */
  normalizeActivity(rawPayload: unknown): NormalizedActivity;
}

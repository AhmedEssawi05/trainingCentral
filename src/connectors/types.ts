// Shared contract every source connector (Strava, Garmin, TrainingPeaks) implements.
// See design.md "Connectors" section.

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
  raw: unknown;
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
  authenticate(): Promise<void>;
  fetchActivities(since: SyncCheckpoint): Promise<NormalizedActivity[]>;
  fetchMetrics(since: SyncCheckpoint): Promise<NormalizedMetric[]>;
}

import type { Connector, NormalizedActivity, NormalizedMetric, SyncCheckpoint } from "../types.js";
import { refreshStravaTokens, type StravaTokens } from "./auth.js";

const ACTIVITIES_URL = "https://www.strava.com/api/v3/athlete/activities";

interface StravaConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

interface StravaActivity {
  id: number;
  type: string;
  start_date: string;
  moving_time: number;
  distance: number;
  total_elevation_gain: number;
}

export class StravaConnector implements Connector {
  readonly source = "strava" as const;
  private tokens?: StravaTokens;

  constructor(private readonly config: StravaConfig) {}

  async authenticate(): Promise<void> {
    this.tokens = await refreshStravaTokens(
      this.config.clientId,
      this.config.clientSecret,
      this.config.refreshToken,
    );
  }

  async fetchActivities(since: SyncCheckpoint): Promise<NormalizedActivity[]> {
    if (!this.tokens) throw new Error("StravaConnector.authenticate() must be called first");

    const after = since.lastSyncedAt
      ? Math.floor(new Date(since.lastSyncedAt).getTime() / 1000)
      : undefined;
    const url = new URL(ACTIVITIES_URL);
    if (after) url.searchParams.set("after", String(after));

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${this.tokens.accessToken}` },
    });
    if (!res.ok) {
      throw new Error(`Strava activities fetch failed: ${res.status} ${await res.text()}`);
    }

    const activities = (await res.json()) as StravaActivity[];
    return activities.map(normalizeActivity);
  }

  async fetchMetrics(_since: SyncCheckpoint): Promise<NormalizedMetric[]> {
    // Strava doesn't expose HRV/sleep/recovery data — that comes from the Garmin connector.
    return [];
  }
}

function normalizeActivity(activity: StravaActivity): NormalizedActivity {
  return {
    sourceActivityId: String(activity.id),
    source: "strava",
    type: activity.type,
    startTime: activity.start_date,
    durationSeconds: activity.moving_time,
    distanceMeters: activity.distance,
    elevationGainMeters: activity.total_elevation_gain,
    raw: activity,
  };
}

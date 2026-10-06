// Strava connector: OAuth refresh, paginated activity fetch, normalization.
// API docs: https://developers.strava.com/docs/reference/#api-Activities-getLoggedInAthleteActivities

import type { Connector, NormalizedActivity, NormalizedMetric, SyncCheckpoint } from "../types.js";
import { requestJson, type RequestOptions } from "../http.js";
import { isExpired, refreshStravaTokens, type StravaTokens } from "./auth.js";

const ACTIVITIES_URL = "https://www.strava.com/api/v3/athlete/activities";
const PAGE_SIZE = 200; // Strava's maximum per_page

export interface StravaConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  /** Overrides for HTTP behavior (injectable fetch/sleep for tests). */
  http?: RequestOptions;
}

export interface StravaActivity {
  id: number;
  type: string;
  sport_type?: string;
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
      this.tokens?.refreshToken ?? this.config.refreshToken, // Strava may rotate refresh tokens
      this.config.http,
    );
  }

  async fetchActivities(since: SyncCheckpoint): Promise<NormalizedActivity[]> {
    if (!this.tokens) throw new Error("StravaConnector.authenticate() must be called first");

    const after = since.lastSyncedAt
      ? Math.floor(new Date(since.lastSyncedAt).getTime() / 1000)
      : undefined;

    const results: NormalizedActivity[] = [];
    for (let page = 1; ; page++) {
      // Refresh proactively so a long multi-page backfill doesn't die on an expired token.
      if (isExpired(this.tokens)) await this.authenticate();

      const url = new URL(ACTIVITIES_URL);
      url.searchParams.set("per_page", String(PAGE_SIZE));
      url.searchParams.set("page", String(page));
      if (after) url.searchParams.set("after", String(after));

      const batch = await requestJson<StravaActivity[]>(
        url,
        { headers: { Authorization: `Bearer ${this.tokens.accessToken}` } },
        this.config.http,
      );
      results.push(...batch.map((a) => this.normalizeActivity(a)));
      if (batch.length < PAGE_SIZE) break;
    }
    return results;
  }

  async fetchMetrics(_since: SyncCheckpoint): Promise<NormalizedMetric[]> {
    // Strava doesn't expose HRV/sleep/recovery data — that comes from the Garmin connector.
    return [];
  }

  normalizeActivity(rawPayload: unknown): NormalizedActivity {
    const a = rawPayload as StravaActivity;
    return {
      sourceActivityId: String(a.id),
      source: "strava",
      // sport_type is Strava's newer, more specific field; `type` is deprecated.
      type: a.sport_type ?? a.type,
      startTime: a.start_date,
      durationSeconds: a.moving_time,
      distanceMeters: a.distance,
      elevationGainMeters: a.total_elevation_gain,
      raw: a,
    };
  }
}

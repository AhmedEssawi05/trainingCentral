import { test } from "node:test";
import assert from "node:assert/strict";
import { StravaConnector, type StravaActivity } from "./index.js";

const activity = (id: number): StravaActivity => ({
  id,
  type: "Ride",
  sport_type: "GravelRide",
  start_date: "2026-01-01T10:00:00Z",
  moving_time: 3600,
  distance: 30000,
  total_elevation_gain: 250,
});

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { status: 200, ...init });

const tokenResponse = (expiresAt = Date.now() / 1000 + 3600) =>
  json({ access_token: "a", refresh_token: "r", expires_at: expiresAt });

function connector(fetchFn: typeof fetch, sleep: (ms: number) => Promise<void> = async () => {}) {
  return new StravaConnector({
    clientId: "id",
    clientSecret: "secret",
    refreshToken: "r0",
    http: { fetchFn, sleep },
  });
}

test("normalizeActivity maps Strava fields and prefers sport_type", () => {
  const n = connector(fetch).normalizeActivity(activity(7));
  assert.equal(n.sourceActivityId, "7");
  assert.equal(n.type, "GravelRide");
  assert.equal(n.durationSeconds, 3600);
});

test("fetchActivities paginates until a short page", async () => {
  const pages: number[] = [];
  const fetchFn = (async (url: string | URL) => {
    const u = new URL(String(url));
    if (u.pathname === "/oauth/token") return tokenResponse();
    const page = Number(u.searchParams.get("page"));
    pages.push(page);
    return json(Array.from({ length: page === 1 ? 200 : 5 }, (_, i) => activity(page * 1000 + i)));
  }) as typeof fetch;

  const c = connector(fetchFn);
  await c.authenticate();
  const result = await c.fetchActivities({ source: "strava", lastSyncedAt: null });
  assert.deepEqual(pages, [1, 2]);
  assert.equal(result.length, 205);
});

test("passes `after` from the checkpoint", async () => {
  let after: string | null = null;
  const fetchFn = (async (url: string | URL) => {
    const u = new URL(String(url));
    if (u.pathname === "/oauth/token") return tokenResponse();
    after = u.searchParams.get("after");
    return json([]);
  }) as typeof fetch;

  const c = connector(fetchFn);
  await c.authenticate();
  await c.fetchActivities({ source: "strava", lastSyncedAt: "2026-01-01T00:00:00Z" });
  assert.equal(after, String(Date.parse("2026-01-01T00:00:00Z") / 1000));
});

test("retries after a 429, waiting for Retry-After", async () => {
  let calls = 0;
  const waits: number[] = [];
  const fetchFn = (async (url: string | URL) => {
    if (new URL(String(url)).pathname === "/oauth/token") return tokenResponse();
    return ++calls === 1
      ? new Response("slow down", { status: 429, headers: { "Retry-After": "5" } })
      : json([activity(1)]);
  }) as typeof fetch;

  const c = connector(fetchFn, async (ms) => void waits.push(ms));
  await c.authenticate();
  const result = await c.fetchActivities({ source: "strava", lastSyncedAt: null });
  assert.equal(result.length, 1);
  assert.deepEqual(waits, [5000]);
});

test("fails fast on non-retryable errors", async () => {
  const fetchFn = (async (url: string | URL) =>
    new URL(String(url)).pathname === "/oauth/token"
      ? tokenResponse()
      : new Response("nope", { status: 401 })) as typeof fetch;

  const c = connector(fetchFn);
  await c.authenticate();
  await assert.rejects(c.fetchActivities({ source: "strava", lastSyncedAt: null }), /401/);
});

test("refreshes an expired token before fetching", async () => {
  let tokenCalls = 0;
  const fetchFn = (async (url: string | URL) => {
    if (new URL(String(url)).pathname === "/oauth/token") {
      tokenCalls++;
      return tokenResponse(tokenCalls === 1 ? 0 : Date.now() / 1000 + 3600);
    }
    return json([]);
  }) as typeof fetch;

  const c = connector(fetchFn);
  await c.authenticate(); // already expired (expires_at = 0)
  await c.fetchActivities({ source: "strava", lastSyncedAt: null });
  assert.equal(tokenCalls, 2);
});

# Design

How Training Central is structured, from data ingestion through to the dashboard.

## High-level architecture

```
 Strava API   Garmin API   TrainingPeaks API
     |            |               |
     v            v               v
  +-----------------------------------+
  |         Connectors (per-source)    |
  |  - OAuth / auth handling           |
  |  - Rate limiting, pagination       |
  |  - Raw payload -> normalized shape |
  +-----------------------------------+
                  |
                  v
  +-----------------------------------+
  |       Sync / Ingestion Service     |
  |  - Scheduled + webhook-triggered   |
  |  - Writes raw + normalized data    |
  +-----------------------------------+
                  |
                  v
  +-----------------------------------+
  |     Reconciliation / Dedup Layer   |
  |  - Match activities across sources |
  |  - Merge into canonical records    |
  +-----------------------------------+
                  |
                  v
  +-----------------------------------+
  |              Database              |
  |  raw_events | activities | metrics |
  |  training_load | source_links      |
  +-----------------------------------+
                  |
                  v
  +-----------------------------------+
  |            API layer               |
  |  - REST/GraphQL over the DB        |
  +-----------------------------------+
                  |
                  v
  +-----------------------------------+
  |             Dashboard              |
  |  - Activity feed, trends, load     |
  +-----------------------------------+
```

## Components

### 1. Connectors

One connector per source (`strava`, `garmin`, `trainingpeaks`). Each is responsible only for talking to its API and producing normalized-but-unmerged records. Keeping this boundary narrow means a broken/changed API only touches one connector.

Each connector implements the same small interface:

- `authenticate()` — OAuth flow, token refresh.
- `fetchActivities(since)` — pull activities/workouts since a checkpoint.
- `fetchMetrics(since)` — pull health/load metrics where applicable (Garmin HRV/sleep, TrainingPeaks TSS/CTL/ATL).
- `normalize(rawPayload)` — map source-specific fields to the shared schema (see below).

Source quirks (Garmin's lack of a public consumer API for many metrics, TrainingPeaks' partner-API access requirements) live entirely inside the connector, not leaked upstream.

### 2. Sync / Ingestion Service

- Runs on a schedule (e.g. every 15–30 min) per source, plus reacts to webhooks where a source supports them (Strava has webhooks; Garmin/TrainingPeaks are more likely polling-only).
- Tracks a per-source, per-user sync checkpoint (last successful timestamp or cursor) so re-runs are incremental, not full re-pulls.
- Writes two things per fetch:
  - The **raw payload** as returned by the API (for debugging/replay if normalization logic changes later).
  - The **normalized record** in the shared schema.

### 3. Reconciliation / Dedup Layer

The same physical workout often appears from more than one source (e.g. a Garmin watch activity that also syncs to Strava and to TrainingPeaks). This layer:

- Matches candidate records across sources using start time (± a few minutes), duration, and activity type as the matching heuristic.
- Merges matches into one **canonical activity**, keeping a `source_links` table mapping the canonical activity back to each source's original record id (so nothing is lost, and re-sync can update the right row).
- Field precedence on conflicts is source-dependent — e.g. prefer Garmin for HR/physiological data, TrainingPeaks for planned-vs-actual and TSS, Strava for kudos/segments — configurable per field rather than a single "trust this source always" rule.

### 4. Data model (core tables)

- `activities` — canonical, deduplicated workouts (type, start time, duration, distance, elevation, TSS if available).
- `activity_sources` — link table: canonical activity id → (source, source's native id, raw payload ref).
- `metrics_daily` — per-day health metrics (HRV, resting HR, sleep score, body battery, VO2 max) keyed by date + source.
- `training_load` — CTL/ATL/TSB time series, either pulled directly from TrainingPeaks or computed locally from TSS if not available.
- `planned_workouts` — TrainingPeaks planned sessions, kept separate from `activities` so planned-vs-actual comparisons are possible.
- `sync_state` — per-user, per-source checkpoint/cursor and last sync status.

### 5. API layer

A thin API (REST or GraphQL) sits over the database and is the only thing the dashboard talks to — the dashboard never calls Strava/Garmin/TrainingPeaks directly. This keeps auth tokens server-side and lets the data model evolve independently of the three source APIs.

### 6. Dashboard

Consumes the API layer only. Initial views:

- **Today/this week** — planned vs. completed, recovery snapshot (HRV, sleep, resting HR).
- **Activity feed** — canonical activity list, with a way to see which source(s) contributed each one.
- **Load trends** — CTL/ATL/TSB chart over time.
- **Source health** — last sync time and status per connector, so a silently-broken Garmin token is visible instead of just producing stale data.

## Auth & credentials

- Each source uses OAuth2 where available (Strava, TrainingPeaks partner API); Garmin's official consumer access is more limited, so the Garmin connector is the one most likely to need a documented fallback (e.g. Garmin Connect's unofficial API or a manual export path) — noted as a risk, not solved by this design.
- Tokens stored encrypted at rest, refreshed proactively by the sync service, never exposed to the dashboard/frontend.

## Why this shape

- **Connector boundary** isolates the messiest part (three different, unstable third-party APIs) from everything else.
- **Raw + normalized storage** means a bug in normalization or a schema change doesn't require re-fetching from the source.
- **Separate reconciliation step** keeps dedup logic in one auditable place instead of scattered across connectors.
- **API layer between DB and dashboard** keeps the dashboard swappable (web now, maybe mobile later) without touching ingestion.

## Open questions

- Single-user (personal) vs. multi-user from day one — affects whether auth/tenancy needs to be designed now or can be deferred.
- Where this runs (local script + local DB vs. hosted service) — affects scheduling (cron vs. hosted job) and secrets storage.
- Whether training load (CTL/ATL/TSB) is trusted from TrainingPeaks directly or computed locally from TSS across all sources.

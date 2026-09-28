# Training Central

A unified training dashboard that pulls data from Strava, Garmin, and TrainingPeaks into a single place, so you don't have to jump between three apps to understand your training.

## Why

Endurance training data today is fragmented:

- **Strava** has activities, kudos, segments, and social data.
- **Garmin** has device-level metrics — HR, HRV, sleep, body battery, VO2 max, recovery.
- **TrainingPeaks** has planned workouts, TSS/CTL/ATL load metrics, and structured plans.

Each tells part of the story, but none of them gives the full picture on its own. Training Central aggregates all three into one dashboard so training load, recovery, and performance trends can be viewed together.

## Goals

- **Unify data from multiple sources** — ingest activities, workouts, and health metrics from Strava, Garmin, and TrainingPeaks into a single, consistent data model.
- **One dashboard, one view** — see planned vs. completed workouts, training load (CTL/ATL/TSB), recovery signals (HRV, sleep, resting HR), and activity history without switching apps.
- **Deduplicate overlapping data** — the same activity often lands in more than one source (e.g. a Garmin watch synced to both Strava and TrainingPeaks); reconcile these into a single canonical record.
- **Surface trends over time** — fitness, fatigue, and form trends, weekly/monthly volume, and recovery patterns, rather than just a feed of individual activities.
- **Support training decisions** — help answer questions like "am I recovering enough," "is my load trending up too fast," and "how did this week compare to plan."

## Non-goals (for now)

- Replacing any of the three source platforms — this is a read-oriented aggregation layer, not a replacement for logging or planning workouts.
- Social features (kudos, comments, following) — out of scope initially.
- Coaching/prescription logic — the dashboard surfaces data and trends; it doesn't (yet) tell you what workout to do next.

## Planned data sources

| Source | Data pulled | API |
|---|---|---|
| Strava | Activities, segments, kudos/social | Strava API (OAuth) |
| Garmin | Health metrics (HRV, sleep, body battery, VO2 max), device activities | Garmin Connect API |
| TrainingPeaks | Planned workouts, TSS, CTL/ATL/TSB | TrainingPeaks API |

## Status

Early stage — project scaffolding not yet started. This README defines the goals the implementation will be built against.

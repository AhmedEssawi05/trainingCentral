// Shared HTTP helper for connectors: retries on rate limits (429) and transient
// server errors (5xx), honoring Retry-After. Keeps rate-limit handling out of
// individual connectors. See design.md "Connectors" (rate limiting, pagination).

export type FetchLike = typeof fetch;

export interface RequestOptions {
  fetchFn?: FetchLike;
  maxRetries?: number;
  /** Fallback wait when a 429 has no Retry-After header. Strava limits reset on 15-minute windows. */
  defaultRateLimitWaitMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
    url: string,
  ) {
    super(`HTTP ${status} from ${url}: ${body}`);
  }
}

export async function requestJson<T>(
  url: string | URL,
  init: RequestInit = {},
  opts: RequestOptions = {},
): Promise<T> {
  const fetchFn = opts.fetchFn ?? fetch;
  const sleep = opts.sleep ?? defaultSleep;
  const maxRetries = opts.maxRetries ?? 3;

  for (let attempt = 0; ; attempt++) {
    const res = await fetchFn(url, init);
    if (res.ok) return (await res.json()) as T;

    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= maxRetries) {
      throw new HttpError(res.status, await res.text(), String(url));
    }

    const retryAfter = Number(res.headers.get("Retry-After"));
    const waitMs =
      res.status === 429
        ? retryAfter > 0
          ? retryAfter * 1000
          : (opts.defaultRateLimitWaitMs ?? 15 * 60 * 1000)
        : 1000 * 2 ** attempt; // exponential backoff for 5xx
    await sleep(waitMs);
  }
}

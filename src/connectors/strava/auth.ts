// Strava OAuth2 token exchange/refresh.
// Docs: https://developers.strava.com/docs/authentication/

import { requestJson, type RequestOptions } from "../http.js";

export interface StravaTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // unix seconds
}

const TOKEN_URL = "https://www.strava.com/oauth/token";

/** Treat tokens as expired this many seconds early to avoid mid-request expiry. */
const EXPIRY_SKEW_SECONDS = 60;

export function isExpired(tokens: StravaTokens, nowSeconds = Date.now() / 1000): boolean {
  return tokens.expiresAt - EXPIRY_SKEW_SECONDS <= nowSeconds;
}

export async function refreshStravaTokens(
  clientId: string,
  clientSecret: string,
  refreshToken: string,
  opts: RequestOptions = {},
): Promise<StravaTokens> {
  const body = await requestJson<{
    access_token: string;
    refresh_token: string;
    expires_at: number;
  }>(
    TOKEN_URL,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    },
    opts,
  );

  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: body.expires_at,
  };
}

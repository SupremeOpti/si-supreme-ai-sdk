# Changelog

## 1.1.0 — 2026-07-03

Auth-traffic and session-continuity release. Fully backward compatible — no
config or API surface changes required in integrating apps.

### Session continuity

- **Rate limiting can no longer look like an expired session.** A `429` (or
  `5xx` / network loss) on token refresh is now treated as transient: the SDK
  schedules a single retry (honoring `Retry-After`) instead of emitting
  `tokenExpired` / calling `onTokenExpired`. A `429` on `/validate` falls back
  to a local expiry check instead of reporting a hard validation failure.
- **Silent re-auth through the parent.** In embedded mode, when the refresh
  token itself is rejected (e.g. a tab left open past the 24 h refresh-token
  lifetime), the SDK now asks the parent page to mint fresh tokens from its
  still-alive web session before declaring the session expired. Tabs idle for
  days resume invisibly as long as the user is logged in to the parent app.

### Traffic reduction

- **Timers idle in hidden tabs.** The token-refresh (10 min) and balance
  (30 s) intervals skip ticks while `document.hidden`. A `visibilitychange`
  handler catches up the token first, then the balance, the moment the tab is
  foregrounded — the user never returns to a stale token.
- **No more server-side validate on boot.** Saved tokens are checked locally
  against their `exp` claim instead of a `GET /api/jwt/validate` round-trip on
  every client construction (SPAs construct the client per mount). The server
  remains the authority: a revoked token still 401s on first use and flows
  into the existing refresh-and-retry path.
- **Single-flight refresh.** Concurrent refresh triggers (timer tick, 401
  retry, visibility catch-up) share one request.
- **`ParentIntegrator` reuses tokens.** Token responses are served from cache
  when the last mint is under 60 s old (or, in hidden tabs, while the cached
  token has >2 min of life left), concurrent child requests collapse into one
  `getJWTToken()` call, and failed fetches back off for 5 s. Children are
  never denied a token — a stale cache still triggers a live mint.

### Notes for integrators

- Pairs with server-side per-user throttles on `/api/jwt/validate`,
  `/api/ai-agents/jwt` and the session-mint endpoints (Supreme Intelligence
  app, July 2026). Older SDK versions keep working — the throttle ceilings sit
  far above legitimate cadence — but only 1.1.0 guarantees a throttled call is
  never escalated into a logout, and only 1.1.0 stops hidden-tab traffic.

# Network Weather Map

An interactive prototype for live internet "weather". The app combines simulated regional readings with live-local HTTPS probes and renders them as a radar-style map.

## Current Prototype

- Simulated regional readings for latency, jitter, packet loss, DNS, TLS, and HTTP response time.
- Live-local probes against Cloudflare, Google, and GitHub.
- Severity scoring that maps metrics to clear, cloudy, rain, and storm states.
- Canvas-based map with animated radar overlays.
- Metric filters for severity, latency, loss, DNS, TLS, and HTTP.

## Run Locally

```sh
npm start
```

The server listens on `http://127.0.0.1:4173` by default.

If `npm` is not available but `node` is installed:

```sh
node server.js
```

## API

- `GET /api/weather` returns the current simulated and live-local weather snapshot.
- `GET /api/regions` returns the configured probe regions.

## Next Build Steps

1. Store recent snapshots in memory for short historical playback.
2. Add configurable probe targets.
3. Add mock cloud-provider worker payloads so the ingestion contract is ready for real regions.
4. Add incident detection for sharp regional or target-specific degradation.

# Network Weather Map

An interactive prototype for live internet "weather". The app combines live-local HTTPS target checks, continent-distributed map probe stations, and optional real regional probe payloads, then renders them as a radar-style map.

## Current Prototype

- Live-local probes against a broad set of public cloud, CDN, DNS, package registry, and web endpoints.
- 18 plotted map probe stations: 5 in North America, 2 in South America, 2 in Europe, 3 in Africa, 5 in Asia, and 1 in Australia.
- Real regional reading ingestion from `POST /api/readings`, `NETWORK_WEATHER_DATA_FILE`, or `NETWORK_WEATHER_DATA_URL`.
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

## Real Data

Post real regional measurements to the local server:

```sh
curl -X POST http://127.0.0.1:4173/api/readings \
  -H 'content-type: application/json' \
  -d '{
    "regions": [
      { "id": "iad-worker", "name": "IAD Worker", "lat": 39.0438, "lon": -77.4874 }
    ],
    "readings": [
      {
        "regionId": "iad-worker",
        "target": "edge composite",
        "metrics": {
          "latencyMs": 42,
          "jitterMs": 4,
          "packetLossPct": 0,
          "dnsMs": 8,
          "tlsMs": 20,
          "httpMs": 90
        }
      }
    ]
  }'
```

Readings can also provide raw `probes`; the server will derive aggregate metrics:

```json
{
  "regionId": "sfo-worker",
  "name": "SFO Worker",
  "lat": 37.7749,
  "lon": -122.4194,
  "probes": [
    { "name": "Cloudflare", "ok": true, "statusCode": 200, "totalMs": 28, "dnsMs": 4, "tlsMs": 9, "httpMs": 15 },
    { "name": "GitHub", "ok": true, "statusCode": 200, "totalMs": 73, "dnsMs": 7, "tlsMs": 22, "httpMs": 44 }
  ]
}
```

Optional environment variables:

- `NETWORK_WEATHER_INGEST_TOKEN`: require `Authorization: Bearer <token>` or `x-network-weather-token` on `POST /api/readings`.
- `NETWORK_WEATHER_DATA_FILE`: load real readings from a local JSON file.
- `NETWORK_WEATHER_DATA_URL`: poll a JSON endpoint for real readings.
- `NETWORK_WEATHER_DATA_REFRESH_MS`: poll interval for file/URL sources. Default: `15000`.
- `NETWORK_WEATHER_REAL_TTL_MS`: stale real-reading timeout. Default: `120000`.
- `NETWORK_WEATHER_TARGETS`: replace the default local probe target list with a JSON array.
- `NETWORK_WEATHER_EXTRA_TARGETS`: append more local probe targets with a JSON array.
- `NETWORK_WEATHER_CORS_ORIGIN`: add CORS headers for browser-based ingestion tools.

## API

- `GET /api/weather` returns plotted map probe readings, local target probe details, and active real regional readings.
- `GET /api/readings` returns active real regional readings.
- `POST /api/readings` ingests real regional readings.
- `GET /api/regions` returns the configured and ingested probe regions.
- `GET /api/targets` returns the active local probe targets.

## Next Build Steps

1. Store recent snapshots in memory for short historical playback.
2. Add incident detection for sharp regional or target-specific degradation.
3. Add a small deployable worker package that posts real readings from cloud regions.

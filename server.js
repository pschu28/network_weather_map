const dns = require("node:dns");
const fs = require("node:fs");
const http = require("node:http");
const https = require("node:https");
const path = require("node:path");
const { URL } = require("node:url");
const { performance } = require("node:perf_hooks");

const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || "127.0.0.1";
const PUBLIC_DIR = path.join(__dirname, "public");
const REAL_READING_TTL_MS = Number(process.env.NETWORK_WEATHER_REAL_TTL_MS || 120000);
const REAL_DATA_REFRESH_MS = Number(process.env.NETWORK_WEATHER_DATA_REFRESH_MS || 15000);
const REAL_DATA_URL = process.env.NETWORK_WEATHER_DATA_URL || "";
const REAL_DATA_FILE = process.env.NETWORK_WEATHER_DATA_FILE || "";
const INGEST_TOKEN = process.env.NETWORK_WEATHER_INGEST_TOKEN || "";
const CORS_ORIGIN = process.env.NETWORK_WEATHER_CORS_ORIGIN || "";

const metricKeys = ["latencyMs", "jitterMs", "packetLossPct", "dnsMs", "tlsMs", "httpMs"];

const mapProbeStations = [
  { id: "na-seattle", name: "North America West", lat: 47.6062, lon: -122.3321, type: "map-probe", targetIds: ["cloudflare"] },
  { id: "na-bay", name: "North America Bay Area", lat: 37.7749, lon: -122.4194, type: "map-probe", targetIds: ["github"] },
  { id: "na-dallas", name: "North America Central", lat: 32.7767, lon: -96.797, type: "map-probe", targetIds: ["google"] },
  { id: "na-chicago", name: "North America Midwest", lat: 41.8781, lon: -87.6298, type: "map-probe", targetIds: ["microsoft"] },
  { id: "na-new-york", name: "North America East", lat: 40.7128, lon: -74.006, type: "map-probe", targetIds: ["fastly"] },
  { id: "sa-sao-paulo", name: "South America East", lat: -23.5558, lon: -46.6396, type: "map-probe", targetIds: ["akamai"] },
  { id: "sa-santiago", name: "South America West", lat: -33.4489, lon: -70.6693, type: "map-probe", targetIds: ["wikipedia"] },
  { id: "eu-dublin", name: "Europe West", lat: 53.3498, lon: -6.2603, type: "map-probe", targetIds: ["npm"] },
  { id: "eu-frankfurt", name: "Europe Central", lat: 50.1109, lon: 8.6821, type: "map-probe", targetIds: ["pypi"] },
  { id: "af-lagos", name: "Africa West", lat: 6.5244, lon: 3.3792, type: "map-probe", targetIds: ["cloudflare-dns"] },
  { id: "af-nairobi", name: "Africa East", lat: -1.2921, lon: 36.8219, type: "map-probe", targetIds: ["google-dns"] },
  { id: "af-johannesburg", name: "Africa South", lat: -26.2041, lon: 28.0473, type: "map-probe", targetIds: ["iana"] },
  { id: "as-mumbai", name: "Asia South", lat: 19.076, lon: 72.8777, type: "map-probe", targetIds: ["aws-health"] },
  { id: "as-singapore", name: "Asia Southeast", lat: 1.3521, lon: 103.8198, type: "map-probe", targetIds: ["azure"] },
  { id: "as-tokyo", name: "Asia Northeast", lat: 35.6762, lon: 139.6503, type: "map-probe", targetIds: ["google-cloud"] },
  { id: "as-seoul", name: "Asia Korea", lat: 37.5665, lon: 126.978, type: "map-probe", targetIds: ["jsdelivr"] },
  { id: "as-hong-kong", name: "Asia East", lat: 22.3193, lon: 114.1694, type: "map-probe", targetIds: ["unpkg"] },
  { id: "au-sydney", name: "Australia East", lat: -33.8688, lon: 151.2093, type: "map-probe", targetIds: ["apple"] }
];

const defaultRegions = [
  { id: "local", name: "Local Probe", lat: 42.3314, lon: -83.0458, type: "local" },
  ...mapProbeStations.map(({ targetIds, ...region }) => region)
];

const defaultTargets = [
  { id: "cloudflare", name: "Cloudflare", url: "https://www.cloudflare.com/cdn-cgi/trace" },
  { id: "google", name: "Google 204", url: "https://www.google.com/generate_204" },
  { id: "github", name: "GitHub", url: "https://github.com/" },
  { id: "fastly", name: "Fastly", url: "https://www.fastly.com/" },
  { id: "akamai", name: "Akamai", url: "https://www.akamai.com/" },
  { id: "aws-health", name: "AWS Health", url: "https://health.aws.amazon.com/" },
  { id: "azure", name: "Azure", url: "https://azure.microsoft.com/" },
  { id: "microsoft", name: "Microsoft", url: "https://www.microsoft.com/" },
  { id: "npm", name: "npm Registry", url: "https://registry.npmjs.org/-/ping" },
  { id: "wikipedia", name: "Wikipedia", url: "https://www.wikipedia.org/" },
  { id: "apple", name: "Apple", url: "https://www.apple.com/library/test/success.html" },
  { id: "google-cloud", name: "Google Cloud", url: "https://cloud.google.com/" },
  { id: "cloudflare-dns", name: "Cloudflare DNS", url: "https://cloudflare-dns.com/dns-query?ct=application/dns-json&name=example.com&type=A" },
  { id: "google-dns", name: "Google DNS", url: "https://dns.google/resolve?name=example.com&type=A" },
  { id: "iana", name: "IANA", url: "https://www.iana.org/domains/reserved" },
  { id: "icann", name: "ICANN", url: "https://www.icann.org/" },
  { id: "mozilla", name: "Mozilla", url: "https://www.mozilla.org/" },
  { id: "vercel", name: "Vercel", url: "https://vercel.com/" },
  { id: "netlify", name: "Netlify", url: "https://www.netlify.com/" },
  { id: "digitalocean", name: "DigitalOcean", url: "https://www.digitalocean.com/" },
  { id: "pypi", name: "PyPI", url: "https://pypi.org/simple/" },
  { id: "docker-hub", name: "Docker Hub Registry", url: "https://registry-1.docker.io/v2/" },
  { id: "jsdelivr", name: "jsDelivr", url: "https://cdn.jsdelivr.net/npm/@picocss/pico@2/css/pico.min.css" },
  { id: "unpkg", name: "UNPKG", url: "https://unpkg.com/react@18/umd/react.production.min.js" },
  { id: "stackoverflow", name: "Stack Overflow", url: "https://stackoverflow.com/" },
  { id: "heroku", name: "Heroku", url: "https://www.heroku.com/" }
];

const latencyHistory = new Map();
const externalReadings = new Map();
const regionRegistry = new Map(defaultRegions.map((region) => [region.id, region]));
const targets = loadTargets();
let realDataSourceState = {
  checkedAt: null,
  loadedAt: null,
  ok: false,
  message: "No external real data source configured"
};

const scoreFactors = [
  ["latencyMs", 280, 22],
  ["jitterMs", 90, 16],
  ["packetLossPct", 12, 28],
  ["dnsMs", 180, 10],
  ["tlsMs", 260, 10],
  ["httpMs", 700, 14]
];

function parseJsonEnv(name) {
  const value = process.env[name];
  if (!value) return null;

  try {
    return JSON.parse(value);
  } catch (error) {
    console.warn(`Ignoring ${name}: ${error.message}`);
    return null;
  }
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function normalizeTarget(target, index) {
  if (!target || typeof target !== "object") return null;

  try {
    const url = new URL(String(target.url || "").trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;

    const name = String(target.name || url.hostname).trim();
    const id = String(target.id || slugify(name) || `target-${index + 1}`).trim();
    const requestedTimeout = finiteNumber(target.timeoutMs);
    const timeoutMs = clamp(requestedTimeout === null ? 4500 : requestedTimeout, 1000, 15000);

    return { id, name, url: url.toString(), timeoutMs };
  } catch {
    return null;
  }
}

function loadTargets() {
  const configuredTargets = parseJsonEnv("NETWORK_WEATHER_TARGETS");
  const extraTargets = parseJsonEnv("NETWORK_WEATHER_EXTRA_TARGETS");
  const baseTargets = Array.isArray(configuredTargets) && configuredTargets.length ? configuredTargets : defaultTargets;
  const candidates = [...baseTargets, ...(Array.isArray(extraTargets) ? extraTargets : [])];
  const normalized = candidates
    .map((target, index) => normalizeTarget(target, index))
    .filter(Boolean);

  const uniqueTargets = new Map();
  for (const target of normalized) {
    uniqueTargets.set(target.id, target);
  }

  return uniqueTargets.size ? [...uniqueTargets.values()] : defaultTargets.map((target, index) => normalizeTarget(target, index));
}

function normalizeRegion(region) {
  if (!region || typeof region !== "object") return null;

  const id = String(region.id || region.regionId || "").trim();
  const lat = Number(region.lat);
  const lon = Number(region.lon);
  const type = typeof region.type === "string" && region.type.trim() ? region.type.trim() : null;
  if (!id || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;

  return {
    id,
    name: String(region.name || id).trim(),
    lat: round(lat),
    lon: round(lon),
    ...(type ? { type } : {})
  };
}

function registerRegion(region) {
  const normalized = normalizeRegion(region);
  if (!normalized) return null;

  const existing = regionRegistry.get(normalized.id);
  const merged = {
    ...existing,
    ...normalized,
    type: normalized.type || existing?.type || "live-region"
  };
  regionRegistry.set(merged.id, merged);

  return merged;
}

function getRegions() {
  return [...regionRegistry.values()];
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  };

  if (CORS_ORIGIN) {
    headers["access-control-allow-origin"] = CORS_ORIGIN;
    headers["access-control-allow-methods"] = "GET,POST,OPTIONS";
    headers["access-control-allow-headers"] = "content-type,authorization,x-network-weather-token";
  }

  res.writeHead(status, headers);
  res.end(payload);
}

function sendNoContent(res) {
  const headers = {};

  if (CORS_ORIGIN) {
    headers["access-control-allow-origin"] = CORS_ORIGIN;
    headers["access-control-allow-methods"] = "GET,POST,OPTIONS";
    headers["access-control-allow-headers"] = "content-type,authorization,x-network-weather-token";
  }

  res.writeHead(204, headers);
  res.end();
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value) {
  return Math.round(value * 10) / 10;
}

function average(items, selector) {
  return items.reduce((sum, item) => sum + selector(item), 0) / items.length;
}

function scoreMetrics(metrics) {
  const score = scoreFactors.reduce((sum, [key, threshold, weight]) => {
    return sum + clamp(metrics[key] / threshold, 0, 1) * weight;
  }, 0);

  return round(score);
}

function conditionFor(score) {
  if (score >= 75) return "storm";
  if (score >= 52) return "rain";
  if (score >= 30) return "cloudy";
  return "clear";
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function calculateJitter(historyKey, latencyMs) {
  const previous = latencyHistory.get(historyKey);
  latencyHistory.set(historyKey, latencyMs);
  return previous === undefined ? 0 : Math.abs(latencyMs - previous);
}

function normalizeMetrics(metrics) {
  if (!metrics || typeof metrics !== "object") return null;

  const normalized = {};
  for (const key of metricKeys) {
    const value = finiteNumber(metrics[key]);
    if (value !== null) normalized[key] = round(Math.max(0, value));
  }

  return Object.keys(normalized).length ? normalized : null;
}

function completeMetrics(metrics, historyKey) {
  const completed = {};
  const hasJitter = finiteNumber(metrics.jitterMs) !== null;

  for (const key of metricKeys) {
    completed[key] = round(Math.max(0, finiteNumber(metrics[key]) || 0));
  }

  if (hasJitter) {
    latencyHistory.set(historyKey, completed.latencyMs);
  } else {
    completed.jitterMs = round(calculateJitter(historyKey, completed.latencyMs));
  }

  return completed;
}

function normalizeProbe(probe, index) {
  if (!probe || typeof probe !== "object") return null;

  const totalMs = finiteNumber(probe.totalMs ?? probe.latencyMs ?? probe.durationMs);
  if (totalMs === null) return null;

  const statusCode = finiteNumber(probe.statusCode);
  const hasExplicitOk = typeof probe.ok === "boolean";
  const ok = hasExplicitOk ? probe.ok : statusCode === null ? !probe.error : statusCode < 500;
  const name = String(probe.name || probe.id || `Probe ${index + 1}`).trim();

  return {
    id: String(probe.id || slugify(name) || `probe-${index + 1}`).trim(),
    name,
    ok,
    statusCode: statusCode === null ? null : statusCode,
    error: probe.error ? String(probe.error) : null,
    totalMs: round(Math.max(0, totalMs)),
    dnsMs: round(Math.max(0, finiteNumber(probe.dnsMs) || 0)),
    tlsMs: round(Math.max(0, finiteNumber(probe.tlsMs) || 0)),
    httpMs: round(Math.max(0, finiteNumber(probe.httpMs) || 0))
  };
}

function deriveMetricsFromProbes(regionId, probes) {
  if (!probes.length) return null;

  const successful = probes.filter((probe) => probe.ok);
  const usable = successful.length ? successful : probes;
  const latencyMs = average(usable, (probe) => probe.totalMs);

  return {
    latencyMs: round(latencyMs),
    jitterMs: round(calculateJitter(`real:${regionId}`, latencyMs)),
    packetLossPct: round(((probes.length - successful.length) / probes.length) * 100),
    dnsMs: round(average(usable, (probe) => probe.dnsMs)),
    tlsMs: round(average(usable, (probe) => probe.tlsMs)),
    httpMs: round(average(usable, (probe) => probe.httpMs))
  };
}

function normalizeTimestamp(value, fallback) {
  const date = value ? new Date(value) : fallback;
  return Number.isNaN(date.getTime()) ? fallback.toISOString() : date.toISOString();
}

function normalizeCondition(value, score) {
  return ["clear", "cloudy", "rain", "storm"].includes(value) ? value : conditionFor(score);
}

function normalizeReading(input, now, source) {
  if (!input || typeof input !== "object") {
    return { error: "Reading must be an object" };
  }

  const embeddedRegion = input.region && typeof input.region === "object" ? input.region : input;
  const registeredRegion = registerRegion(embeddedRegion);
  const regionId = String(input.regionId || registeredRegion?.id || input.id || "").trim();

  if (!regionId) {
    return { error: "Reading is missing regionId" };
  }

  if (!regionRegistry.has(regionId)) {
    const inferredRegion = registerRegion({
      id: regionId,
      name: input.regionName || input.name || regionId,
      lat: input.lat,
      lon: input.lon,
      type: input.type || "live-region"
    });

    if (!inferredRegion) {
      return { error: `Reading ${regionId} is missing valid region coordinates` };
    }
  }

  const probes = Array.isArray(input.probes)
    ? input.probes.map((probe, index) => normalizeProbe(probe, index)).filter(Boolean)
    : [];

  const rawMetrics = normalizeMetrics(input.metrics) || deriveMetricsFromProbes(regionId, probes);
  if (!rawMetrics) {
    return { error: `Reading ${regionId} is missing metrics or usable probes` };
  }

  const metrics = completeMetrics(rawMetrics, `real:${regionId}`);
  const rawScore = finiteNumber(input.score);
  const score = rawScore === null ? scoreMetrics(metrics) : round(clamp(rawScore, 0, 100));
  const target = input.target || (probes.length ? probes.map((probe) => probe.name).join(", ") : "regional probe");

  return {
    reading: {
      regionId,
      source: String(input.source || source || "live-region").trim(),
      updatedAt: normalizeTimestamp(input.updatedAt, now),
      target,
      score,
      condition: normalizeCondition(input.condition, score),
      metrics,
      ...(probes.length ? { probes } : {})
    }
  };
}

function ingestRealDataPayload(payload, { source = "live-region", now = new Date() } = {}) {
  const regionInputs = Array.isArray(payload?.regions) ? payload.regions : [];
  const registeredRegions = regionInputs.map(registerRegion).filter(Boolean);
  const readingInputs = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.readings)
      ? payload.readings
      : payload?.regionId || payload?.metrics || payload?.probes
        ? [payload]
        : [];

  const accepted = [];
  const rejected = [];

  for (const input of readingInputs) {
    const result = normalizeReading(input, now, source);
    if (result.reading) {
      externalReadings.set(result.reading.regionId, result.reading);
      accepted.push(result.reading.regionId);
    } else {
      rejected.push(result.error);
    }
  }

  return {
    accepted: accepted.length,
    acceptedRegionIds: accepted,
    rejected,
    registeredRegions: registeredRegions.length,
    activeReadings: externalReadings.size
  };
}

function pruneExternalReadings(now) {
  const nowMs = now.getTime();
  for (const [regionId, reading] of externalReadings) {
    const updatedMs = Date.parse(reading.updatedAt);
    if (Number.isNaN(updatedMs) || nowMs - updatedMs > REAL_READING_TTL_MS) {
      externalReadings.delete(regionId);
    }
  }
}

function getActiveExternalReadings(now) {
  pruneExternalReadings(now);
  return [...externalReadings.values()];
}

async function refreshExternalDataSource(now) {
  if (!REAL_DATA_URL && !REAL_DATA_FILE) return;

  const lastChecked = realDataSourceState.checkedAt ? Date.parse(realDataSourceState.checkedAt) : 0;
  if (Date.now() - lastChecked < REAL_DATA_REFRESH_MS) return;

  const checkedAt = now.toISOString();
  try {
    const rawPayload = REAL_DATA_URL
      ? await fetchRealDataUrl()
      : await fs.promises.readFile(REAL_DATA_FILE, "utf8");
    const payload = JSON.parse(rawPayload);
    const result = ingestRealDataPayload(payload, {
      source: REAL_DATA_URL ? "live-url" : "live-file",
      now
    });

    realDataSourceState = {
      checkedAt,
      loadedAt: checkedAt,
      ok: true,
      message: `Accepted ${result.accepted} real reading${result.accepted === 1 ? "" : "s"}`
    };
  } catch (error) {
    realDataSourceState = {
      ...realDataSourceState,
      checkedAt,
      ok: false,
      message: error.message
    };
  }
}

async function fetchRealDataUrl() {
  const response = await fetch(REAL_DATA_URL, {
    headers: INGEST_TOKEN ? { authorization: `Bearer ${INGEST_TOKEN}` } : undefined
  });
  if (!response.ok) {
    throw new Error(`Real data source returned ${response.status}`);
  }
  return response.text();
}

function firstHeader(value) {
  return Array.isArray(value) ? value[0] : value || "";
}

function isAuthorized(req) {
  if (!INGEST_TOKEN) return true;

  const authorization = firstHeader(req.headers.authorization);
  const token = firstHeader(req.headers["x-network-weather-token"]);
  return authorization === `Bearer ${INGEST_TOKEN}` || token === INGEST_TOKEN;
}

function readJsonBody(req, limitBytes = 1_000_000) {
  return new Promise((resolve, reject) => {
    let body = "";

    req.on("data", (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body) > limitBytes) {
        reject(new Error("Request body is too large"));
        req.destroy();
      }
    });

    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(new Error(`Invalid JSON: ${error.message}`));
      }
    });

    req.on("error", reject);
  });
}

function buildProbeTimings(timings, startedAt, endedAt) {
  return {
    totalMs: endedAt - startedAt,
    dnsMs: timings.lookup ? timings.lookup - startedAt : 0,
    tcpMs: timings.connect && timings.lookup ? timings.connect - timings.lookup : 0,
    tlsMs: timings.secureConnect && timings.connect ? timings.secureConnect - timings.connect : 0,
    httpMs: timings.response && timings.secureConnect ? timings.response - timings.secureConnect : endedAt - startedAt
  };
}

function buildProbeResult(base, timings, startedAt) {
  const endedAt = performance.now();
  return {
    ...base,
    ...buildProbeTimings(timings, startedAt, endedAt)
  };
}

function probeTarget(target) {
  return new Promise((resolve) => {
    const startedAt = performance.now();
    const timings = {};
    const url = new URL(target.url);
    const isHttps = url.protocol === "https:";
    const client = isHttps ? https : http;

    const request = client.request(
      {
        method: "GET",
        hostname: url.hostname,
        path: `${url.pathname}${url.search}`,
        port: url.port || (isHttps ? 443 : 80),
        protocol: url.protocol,
        timeout: target.timeoutMs,
        lookup: dns.lookup
      },
      (response) => {
        timings.response = performance.now();
        response.resume();
        response.on("end", () => {
          resolve(buildProbeResult({
            ok: response.statusCode < 500,
            statusCode: response.statusCode
          }, timings, startedAt));
        });
      }
    );

    request.on("socket", (socket) => {
      socket.on("lookup", () => {
        timings.lookup = performance.now();
      });
      socket.on("connect", () => {
        timings.connect = performance.now();
      });
      socket.on("secureConnect", () => {
        timings.secureConnect = performance.now();
      });
    });

    request.on("timeout", () => {
      request.destroy(new Error("Probe timed out"));
    });

    request.on("error", (error) => {
      resolve(buildProbeResult({
        ok: false,
        error: error.message
      }, timings, startedAt));
    });

    request.end();
  });
}

async function collectTargetResults() {
  return Promise.all(
    targets.map(async (target) => ({
      target,
      result: await probeTarget(target)
    }))
  );
}

function summarizeProbe({ target, result }) {
  return {
    id: target.id,
    name: target.name,
    ok: result.ok,
    statusCode: result.statusCode || null,
    error: result.error || null,
    totalMs: round(result.totalMs),
    dnsMs: round(result.dnsMs),
    tlsMs: round(result.tlsMs),
    httpMs: round(result.httpMs)
  };
}

function buildReadingFromProbes(region, probes, now, source) {
  const metrics = deriveMetricsFromProbes(region.id, probes);
  const score = scoreMetrics(metrics);

  return {
    regionId: region.id,
    source,
    updatedAt: now.toISOString(),
    target: probes.map((probe) => probe.name).join(", "),
    score,
    condition: conditionFor(score),
    metrics,
    probes
  };
}

function buildMapProbeReadings(now, results) {
  const resultsByTargetId = new Map(results.map((item) => [item.target.id, item]));

  return mapProbeStations
    .map((station) => {
      const probes = station.targetIds
        .map((targetId) => resultsByTargetId.get(targetId))
        .filter(Boolean)
        .map(summarizeProbe);
      return probes.length ? buildReadingFromProbes(station, probes, now, "live-map") : null;
    })
    .filter(Boolean);
}

function buildLocalReading(now, results) {
  const successful = results.filter(({ result }) => result.ok);
  const total = results.length || 1;
  const usable = successful.length ? successful : results;
  const avgResult = (selector) => average(usable, (item) => selector(item.result));
  const latencyMs = avgResult((result) => result.totalMs);

  const metrics = {
    latencyMs: round(latencyMs),
    jitterMs: round(calculateJitter("local", latencyMs)),
    packetLossPct: round(((total - successful.length) / total) * 100),
    dnsMs: round(avgResult((result) => result.dnsMs)),
    tlsMs: round(avgResult((result) => result.tlsMs)),
    httpMs: round(avgResult((result) => result.httpMs))
  };

  const score = scoreMetrics(metrics);
  return {
    regionId: "local",
    source: "live-local",
    updatedAt: now.toISOString(),
    target: targets.map((target) => target.name).join(", "),
    score,
    condition: conditionFor(score),
    metrics,
    probes: results.map(summarizeProbe)
  };
}

async function buildWeatherSnapshot() {
  const now = new Date();
  await refreshExternalDataSource(now);

  const targetResults = await collectTargetResults();
  const local = buildLocalReading(now, targetResults);
  const mapReadings = buildMapProbeReadings(now, targetResults);
  const realReadings = getActiveExternalReadings(now);
  const readings = [
    ...mapReadings,
    ...realReadings
  ];

  return {
    generatedAt: now.toISOString(),
    regions: getRegions(),
    targets,
    localProbe: local,
    metadata: {
      localTargets: targets.length,
      mapProbes: readings.length,
      stationMapProbes: mapReadings.length,
      realReadings: realReadings.length,
      realReadingTtlMs: REAL_READING_TTL_MS,
      realDataSource: realDataSourceState
    },
    readings
  };
}

function serveStatic(req, res) {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);
  const cleanPath = requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, cleanPath));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    const ext = path.extname(filePath);
    const contentTypes = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "text/javascript; charset=utf-8"
    };

    res.writeHead(200, {
      "content-type": contentTypes[ext] || "application/octet-stream",
      "cache-control": "no-store"
    });
    res.end(content);
  });
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "OPTIONS") {
    sendNoContent(res);
    return;
  }

  if (requestUrl.pathname === "/api/weather" && req.method === "GET") {
    try {
      sendJson(res, 200, await buildWeatherSnapshot());
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
    return;
  }

  if (requestUrl.pathname === "/api/readings" && req.method === "GET") {
    const now = new Date();
    await refreshExternalDataSource(now);
    sendJson(res, 200, {
      readings: getActiveExternalReadings(now),
      metadata: {
        realReadingTtlMs: REAL_READING_TTL_MS,
        realDataSource: realDataSourceState
      }
    });
    return;
  }

  if (requestUrl.pathname === "/api/readings" && req.method === "POST") {
    if (!isAuthorized(req)) {
      sendJson(res, 401, { error: "Missing or invalid ingest token" });
      return;
    }

    try {
      const payload = await readJsonBody(req);
      const result = ingestRealDataPayload(payload, {
        source: "live-ingest",
        now: new Date()
      });
      sendJson(res, result.accepted ? 202 : 400, result);
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (requestUrl.pathname === "/api/regions" && req.method === "GET") {
    sendJson(res, 200, { regions: getRegions() });
    return;
  }

  if (requestUrl.pathname === "/api/targets" && req.method === "GET") {
    sendJson(res, 200, { targets });
    return;
  }

  serveStatic(req, res);
});

server.listen(PORT, HOST, () => {
  console.log(`Network Weather Map running at http://${HOST}:${PORT}`);
});

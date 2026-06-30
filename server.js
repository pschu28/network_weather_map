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

const regions = [
  { id: "local", name: "Local Probe", lat: 42.3314, lon: -83.0458, type: "local" },
  { id: "us-east", name: "US East", lat: 39.0438, lon: -77.4874, type: "simulated" },
  { id: "us-west", name: "US West", lat: 37.7749, lon: -122.4194, type: "simulated" },
  { id: "eu-west", name: "EU West", lat: 53.3498, lon: -6.2603, type: "simulated" },
  { id: "eu-central", name: "EU Central", lat: 50.1109, lon: 8.6821, type: "simulated" },
  { id: "ap-south", name: "AP South", lat: 19.076, lon: 72.8777, type: "simulated" },
  { id: "ap-northeast", name: "AP Northeast", lat: 35.6762, lon: 139.6503, type: "simulated" },
  { id: "sa-east", name: "SA East", lat: -23.5558, lon: -46.6396, type: "simulated" },
  { id: "af-south", name: "AF South", lat: -33.9249, lon: 18.4241, type: "simulated" }
];

const targets = [
  { id: "cloudflare", name: "Cloudflare", url: "https://www.cloudflare.com/cdn-cgi/trace" },
  { id: "google", name: "Google", url: "https://www.google.com/generate_204" },
  { id: "github", name: "GitHub", url: "https://github.com/" }
];

const simulatedState = new Map();
const localHistory = new Map();
const simulatedRegions = regions.filter((region) => region.type === "simulated");
const targetNames = targets.map((target) => target.name).join(", ");

const scoreFactors = [
  ["latencyMs", 280, 22],
  ["jitterMs", 90, 16],
  ["packetLossPct", 12, 28],
  ["dnsMs", 180, 10],
  ["tlsMs", 260, 10],
  ["httpMs", 700, 14]
];

for (const region of simulatedRegions) {
  simulatedState.set(region.id, {
    phase: Math.random() * Math.PI * 2,
    severity: Math.random() * 35,
    velocity: 0.65 + Math.random() * 0.75
  });
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(payload);
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

function buildSimulatedReading(region, now) {
  const state = simulatedState.get(region.id);
  state.phase += state.velocity * 0.09;

  const wave = (Math.sin(state.phase) + 1) / 2;
  const cell = (Math.sin(state.phase * 0.41 + region.lon * 0.03) + 1) / 2;
  const front = now.getUTCMinutes() % 17 === 0 ? 18 : 0;
  const severity = clamp(state.severity * 0.72 + wave * 34 + cell * 24 + front, 4, 96);

  const metrics = {
    latencyMs: round(28 + severity * 2.4 + Math.random() * 24),
    jitterMs: round(2 + severity * 0.58 + Math.random() * 10),
    packetLossPct: round(Math.max(0, (severity - 36) * 0.12 + Math.random() * 1.6)),
    dnsMs: round(8 + severity * 0.78 + Math.random() * 15),
    tlsMs: round(20 + severity * 1.12 + Math.random() * 28),
    httpMs: round(90 + severity * 5.2 + Math.random() * 120)
  };

  const score = scoreMetrics(metrics);
  return {
    regionId: region.id,
    source: "simulated",
    updatedAt: now.toISOString(),
    target: "regional composite",
    score,
    condition: conditionFor(score),
    metrics
  };
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

function probeTarget(target, timeoutMs = 4500) {
  return new Promise((resolve) => {
    const startedAt = performance.now();
    const timings = {};
    const url = new URL(target.url);

    const request = https.request(
      {
        method: "GET",
        hostname: url.hostname,
        path: `${url.pathname}${url.search}`,
        port: url.port || 443,
        timeout: timeoutMs,
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

async function buildLocalReading(now) {
  const results = await Promise.all(
    targets.map(async (target) => ({
      target,
      result: await probeTarget(target)
    }))
  );

  const successful = results.filter(({ result }) => result.ok);
  const total = results.length || 1;
  const usable = successful.length ? successful : results;
  const avgResult = (selector) => average(usable, (item) => selector(item.result));
  const latencyMs = avgResult((result) => result.totalMs);
  const previous = localHistory.get("latencyMs") || latencyMs;
  localHistory.set("latencyMs", latencyMs);

  const metrics = {
    latencyMs: round(latencyMs),
    jitterMs: round(Math.abs(latencyMs - previous)),
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
    target: targetNames,
    score,
    condition: conditionFor(score),
    metrics,
    probes: results.map(({ target, result }) => ({
      id: target.id,
      name: target.name,
      ok: result.ok,
      statusCode: result.statusCode || null,
      error: result.error || null,
      totalMs: round(result.totalMs)
    }))
  };
}

async function buildWeatherSnapshot() {
  const now = new Date();
  const local = await buildLocalReading(now);
  return {
    generatedAt: now.toISOString(),
    regions,
    targets,
    readings: [
      local,
      ...simulatedRegions.map((region) => buildSimulatedReading(region, now))
    ]
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
  if (req.url.startsWith("/api/weather")) {
    try {
      sendJson(res, 200, await buildWeatherSnapshot());
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
    return;
  }

  if (req.url.startsWith("/api/regions")) {
    sendJson(res, 200, { regions });
    return;
  }

  serveStatic(req, res);
});

server.listen(PORT, HOST, () => {
  console.log(`Network Weather Map running at http://${HOST}:${PORT}`);
});

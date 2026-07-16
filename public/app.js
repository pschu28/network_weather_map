const canvas = document.querySelector("#weather-map");
const ctx = canvas.getContext("2d");
const tooltip = document.querySelector("#tooltip");
const subtitle = document.querySelector("#subtitle");
const liveStatus = document.querySelector("#live-status");
const updatedAt = document.querySelector("#updated-at");
const globalCondition = document.querySelector("#global-condition");
const averageScore = document.querySelector("#average-score");
const liveRegionCount = document.querySelector("#live-region-count");
const probeCount = document.querySelector("#probe-count");
const readingList = document.querySelector("#reading-list");
const localProbe = document.querySelector("#local-probe");
const metricButtons = [...document.querySelectorAll("[data-metric]")];
const zoomInButton = document.querySelector("#zoom-in");
const zoomOutButton = document.querySelector("#zoom-out");
const zoomResetButton = document.querySelector("#zoom-reset");

let snapshot = null;
let selectedMetric = "score";
let hoverRegion = null;
let regionById = new Map();
let viewport = { scale: 1, x: 0, y: 0 };
let dragState = null;

const minZoom = 1;
const maxZoom = 5;

const conditionColors = {
  clear: "#18b875",
  cloudy: "#e4b737",
  rain: "#f47c3c",
  storm: "#e84d66"
};

const metrics = {
  score: { max: 100, unit: "" },
  latencyMs: { max: 360, unit: " ms" },
  packetLossPct: { max: 12, unit: "%" },
  dnsMs: { max: 180, unit: " ms" },
  tlsMs: { max: 260, unit: " ms" },
  httpMs: { max: 800, unit: " ms" }
};

const metricKeys = Object.keys(metrics).filter((key) => key !== "score");

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function pluralize(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function sourceLabel(source) {
  const labels = {
    "live-local": "live local",
    "live-map": "live map",
    "live-region": "live region",
    "live-ingest": "live ingest",
    "live-url": "live URL",
    "live-file": "live file"
  };
  return labels[source] || source || "unknown";
}

const landShapes = [
  [
    [-168, 71], [-153, 70], [-142, 60], [-134, 58], [-125, 49], [-124, 40],
    [-117, 33], [-111, 31], [-108, 24], [-99, 19], [-90, 18], [-83, 25],
    [-80, 32], [-74, 40], [-61, 47], [-53, 52], [-58, 57], [-76, 58],
    [-92, 64], [-112, 69], [-136, 70], [-151, 73]
  ],
  [
    [-73, 84], [-24, 82], [-16, 73], [-30, 64], [-44, 60], [-56, 66],
    [-66, 76]
  ],
  [
    [-81, 12], [-74, 9], [-77, 1], [-73, -8], [-70, -18], [-65, -25],
    [-63, -36], [-57, -45], [-66, -55], [-73, -52], [-76, -41], [-72, -31],
    [-76, -21], [-80, -10], [-79, 1]
  ],
  [
    [-11, 72], [8, 71], [24, 67], [31, 59], [24, 51], [13, 45],
    [3, 42], [-6, 45], [-10, 54], [-18, 61]
  ],
  [
    [-17, 36], [-5, 36], [10, 37], [25, 32], [33, 22], [42, 11],
    [50, -2], [44, -17], [35, -29], [25, -34], [17, -34], [11, -25],
    [5, -15], [-2, -5], [-8, 6], [-14, 19]
  ],
  [
    [26, 69], [54, 70], [83, 72], [112, 68], [136, 58], [153, 49],
    [146, 37], [126, 29], [116, 23], [109, 14], [100, 8], [90, 11],
    [80, 21], [65, 24], [49, 31], [36, 43], [30, 55]
  ],
  [
    [34, 32], [48, 30], [57, 22], [54, 13], [44, 12], [37, 22]
  ],
  [
    [68, 24], [84, 22], [91, 9], [80, 6], [72, 15]
  ],
  [
    [95, 22], [109, 18], [116, 8], [107, -4], [98, 5]
  ],
  [
    [112, -11], [130, -12], [153, -24], [146, -39], [124, -43],
    [113, -31]
  ]
];

const borderLines = [
  [[-125, 49], [-95, 49], [-67, 45]],
  [[-117, 32], [-104, 31], [-97, 26]],
  [[-10, 36], [3, 43], [15, 45], [30, 46]],
  [[30, 31], [42, 36], [55, 39], [70, 42], [88, 45]],
  [[-16, 20], [4, 13], [18, 12], [34, 7]],
  [[-74, -10], [-66, -16], [-62, -30], [-58, -39]]
];

const mapLabels = [
  { label: "North America", lat: 52, lon: -104 },
  { label: "South America", lat: -18, lon: -62 },
  { label: "Europe", lat: 52, lon: 14 },
  { label: "Africa", lat: 6, lon: 20 },
  { label: "Asia", lat: 45, lon: 86 },
  { label: "Australia", lat: -27, lon: 134 },
  { label: "Atlantic Ocean", lat: 10, lon: -35, water: true },
  { label: "Pacific Ocean", lat: 5, lon: -150, water: true },
  { label: "Indian Ocean", lat: -18, lon: 78, water: true }
];

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(rect.width * dpr));
  canvas.height = Math.max(1, Math.floor(rect.height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  clampViewport();
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function clampViewport() {
  const rect = canvas.getBoundingClientRect();
  viewport.scale = clamp(viewport.scale, minZoom, maxZoom);

  const maxX = Math.max(0, rect.width * (viewport.scale - 1));
  const maxY = Math.max(0, rect.height * (viewport.scale - 1));
  viewport.x = clamp(viewport.x, -maxX, 0);
  viewport.y = clamp(viewport.y, -maxY, 0);
}

function screenPoint(basePoint) {
  return {
    x: basePoint.x * viewport.scale + viewport.x,
    y: basePoint.y * viewport.scale + viewport.y
  };
}

function projectBase(lat, lon) {
  const rect = canvas.getBoundingClientRect();
  const maxLat = 78;
  const clippedLat = Math.max(-maxLat, Math.min(maxLat, lat));
  const latRad = (clippedLat * Math.PI) / 180;
  const mercatorN = Math.log(Math.tan(Math.PI / 4 + latRad / 2));
  const topLat = (maxLat * Math.PI) / 180;
  const topMercator = Math.log(Math.tan(Math.PI / 4 + topLat / 2));
  return {
    x: ((lon + 180) / 360) * rect.width,
    y: (0.5 - mercatorN / (2 * topMercator)) * rect.height
  };
}

function project(lat, lon) {
  return screenPoint(projectBase(lat, lon));
}

function setZoom(nextScale, origin = null) {
  const rect = canvas.getBoundingClientRect();
  const focus = origin || { x: rect.width / 2, y: rect.height / 2 };
  const previousScale = viewport.scale;
  const scale = clamp(nextScale, minZoom, maxZoom);
  if (scale === previousScale) return;

  const worldX = (focus.x - viewport.x) / previousScale;
  const worldY = (focus.y - viewport.y) / previousScale;
  viewport.scale = scale;
  viewport.x = focus.x - worldX * scale;
  viewport.y = focus.y - worldY * scale;
  clampViewport();
  draw();
}

function resetViewport() {
  viewport = { scale: 1, x: 0, y: 0 };
  clearHover();
  draw();
}

function metricValue(reading) {
  if (selectedMetric === "score") return reading.score;
  return reading.metrics[selectedMetric] || 0;
}

function normalizedMetric(reading) {
  return Math.min(1, metricValue(reading) / metrics[selectedMetric].max);
}

function formatMetric(reading) {
  const value = metricValue(reading);
  return `${value}${metrics[selectedMetric].unit}`;
}

function regionFor(reading) {
  return regionById.get(reading.regionId);
}

function conditionForScore(score) {
  if (score >= 75) return "storm";
  if (score >= 52) return "rain";
  if (score >= 30) return "cloudy";
  return "clear";
}

function clusterRadius() {
  return 0;
}

function average(items, selector) {
  return items.reduce((sum, item) => sum + selector(item), 0) / items.length;
}

function buildCluster(entries, index) {
  const readings = entries.map((entry) => entry.reading);
  const score = Math.round(average(readings, (reading) => reading.score));
  const metricsAverage = {};

  for (const key of metricKeys) {
    metricsAverage[key] = Math.round(average(readings, (reading) => reading.metrics[key] || 0) * 10) / 10;
  }

  const sources = [...new Set(readings.map((reading) => reading.source))];
  const regions = entries.map((entry) => entry.region);

  return {
    id: entries.length === 1 ? readings[0].regionId : `cluster-${index}-${readings.map((reading) => reading.regionId).sort().join("-")}`,
    isCluster: entries.length > 1,
    label: entries.length === 1 ? regions[0].name : `${entries.length} region average`,
    source: sources.length === 1 ? sources[0] : "mixed",
    score,
    condition: conditionForScore(score),
    metrics: metricsAverage,
    point: {
      x: average(entries, (entry) => entry.point.x),
      y: average(entries, (entry) => entry.point.y)
    },
    readings,
    regions
  };
}

function mapClusters(readings) {
  const entries = readings
    .map((reading) => {
      const region = regionFor(reading);
      const point = readingPoint(reading);
      return region && point ? { reading, region, point } : null;
    })
    .filter(Boolean);

  const radius = clusterRadius();
  const clusters = [];
  const unused = new Set(entries);

  while (unused.size) {
    const seed = unused.values().next().value;
    const group = [seed];
    unused.delete(seed);
    let center = { ...seed.point };

    let changed = true;
    while (changed) {
      changed = false;

      for (const entry of [...unused]) {
        const closeToGroup = Math.hypot(entry.point.x - center.x, entry.point.y - center.y) <= radius;

        if (closeToGroup) {
          group.push(entry);
          unused.delete(entry);
          center = {
            x: average(group, (item) => item.point.x),
            y: average(group, (item) => item.point.y)
          };
          changed = true;
        }
      }
    }

    clusters.push(buildCluster(group, clusters.length));
  }

  return clusters;
}

function projectPoint([lon, lat]) {
  return project(lat, lon);
}

function drawPath(points, { close = false } = {}) {
  ctx.beginPath();
  points.forEach((point, index) => {
    const { x, y } = projectPoint(point);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  if (close) ctx.closePath();
}

function readingPoint(reading) {
  const region = regionFor(reading);
  return region ? project(region.lat, region.lon) : null;
}

function drawBackground(width, height) {
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#101d24";
  ctx.fillRect(0, 0, width, height);

  const waterGradient = ctx.createLinearGradient(0, 0, 0, height);
  waterGradient.addColorStop(0, "#142631");
  waterGradient.addColorStop(1, "#0f1b22");
  ctx.fillStyle = waterGradient;
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = "rgba(196, 216, 216, 0.055)";
  ctx.lineWidth = 1;
  for (let lon = -180; lon <= 180; lon += 45) {
    const a = project(-78, lon);
    const b = project(78, lon);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  for (let lat = -60; lat <= 75; lat += 30) {
    const a = project(lat, -180);
    const b = project(lat, 180);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }

  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.fillStyle = "#263530";
  ctx.strokeStyle = "rgba(233, 239, 235, 0.28)";
  for (const shape of landShapes) {
    drawPath(shape, { close: true });
    ctx.fill();
    ctx.stroke();
  }

  ctx.strokeStyle = "rgba(233, 239, 235, 0.09)";
  ctx.lineWidth = 1;
  for (const line of borderLines) {
    drawPath(line);
    ctx.stroke();
  }

  drawMapLabels();
}

function drawWeatherAreas(clusters) {
  for (const cluster of clusters) {
    const strength = normalizedMetric(cluster);
    const color = conditionColors[cluster.condition];
    const radius = (22 + strength * 52 + (cluster.readings.length - 1) * 8) * Math.sqrt(viewport.scale);
    const gradient = ctx.createRadialGradient(cluster.point.x, cluster.point.y, 0, cluster.point.x, cluster.point.y, radius);

    gradient.addColorStop(0, `${color}66`);
    gradient.addColorStop(0.58, `${color}25`);
    gradient.addColorStop(1, `${color}00`);

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(cluster.point.x, cluster.point.y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawMapLabels() {
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  for (const item of mapLabels) {
    const point = project(item.lat, item.lon);
    ctx.font = item.water ? "500 12px system-ui, sans-serif" : "700 12px system-ui, sans-serif";
    ctx.fillStyle = item.water ? "rgba(168, 191, 201, 0.28)" : "rgba(221, 230, 225, 0.32)";
    ctx.fillText(item.label, point.x, point.y);
  }

  ctx.textAlign = "start";
  ctx.textBaseline = "alphabetic";
}

function drawMarkers(clusters) {
  for (const cluster of clusters) {
    const color = conditionColors[cluster.condition];
    const isHover = hoverRegion === cluster.id;
    const markerRadius = cluster.isCluster ? 9 + Math.sqrt(cluster.readings.length) * 5 : 6;

    ctx.fillStyle = "#f8fbf8";
    ctx.strokeStyle = color;
    ctx.lineWidth = isHover ? 3 : 2;
    ctx.beginPath();
    ctx.arc(cluster.point.x, cluster.point.y, isHover ? markerRadius + 3 : markerRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "rgba(245, 249, 247, 0.92)";
    ctx.strokeStyle = "rgba(8, 16, 20, 0.9)";
    ctx.lineWidth = 3;
    ctx.font = "700 11px system-ui, sans-serif";
    const label = cluster.isCluster ? `${Math.round(metricValue(cluster))} avg` : String(Math.round(metricValue(cluster)));
    ctx.strokeText(label, cluster.point.x + markerRadius + 6, cluster.point.y + 4);
    ctx.fillText(label, cluster.point.x + markerRadius + 6, cluster.point.y + 4);
  }
}

function draw() {
  const rect = canvas.getBoundingClientRect();
  drawBackground(rect.width, rect.height);
  if (snapshot) {
    const clusters = mapClusters(snapshot.readings);
    drawWeatherAreas(clusters);
    drawMarkers(clusters);
  }
}

function renderPanels() {
  if (!snapshot) return;

  const readings = [...snapshot.readings].sort((a, b) => b.score - a.score);
  if (!readings.length) {
    averageScore.textContent = "--";
    globalCondition.textContent = "waiting";
    liveRegionCount.textContent = "0";
    probeCount.textContent = String(snapshot.targets?.length || 0);
    readingList.innerHTML = "";
    localProbe.innerHTML = "";
    return;
  }

  const avgScore = readings.reduce((sum, reading) => sum + reading.score, 0) / readings.length;
  const top = readings[0];
  const metadata = snapshot.metadata || {};
  const mapProbes = metadata.mapProbes || readings.length;
  const targetCount = metadata.localTargets || snapshot.targets?.length || 0;

  averageScore.textContent = Math.round(avgScore);
  globalCondition.textContent = top.condition;
  liveRegionCount.textContent = String(mapProbes);
  probeCount.textContent = String(targetCount);
  updatedAt.textContent = `Updated ${new Date(snapshot.generatedAt).toLocaleTimeString()}`;
  subtitle.textContent = `Live data · ${pluralize(mapProbes, "map probe")} · ${pluralize(targetCount, "target probe")}`;

  readingList.innerHTML = readings
    .map((reading) => {
      const region = regionFor(reading) || { name: reading.regionId };
      return `
        <article class="reading" data-region="${escapeHtml(reading.regionId)}">
          <span class="condition-bar" style="background:${conditionColors[reading.condition]}"></span>
          <div>
            <h3>${escapeHtml(region.name)}</h3>
            <p>${escapeHtml(sourceLabel(reading.source))} · ${escapeHtml(reading.condition)} · ${escapeHtml(formatMetric(reading))}</p>
          </div>
          <span class="score">${reading.score}</span>
        </article>
      `;
    })
    .join("");

  const local = snapshot.localProbe || snapshot.readings.find((reading) => reading.regionId === "local");
  localProbe.innerHTML = local?.probes?.length
    ? local.probes
    .map((probe) => `
      <div class="probe-row ${probe.ok ? "ok" : "failed"}">
        <span class="probe-main">
          <strong>${escapeHtml(probe.name)}</strong>
          <small>${escapeHtml(probe.ok ? (probe.statusCode ? `HTTP ${probe.statusCode}` : "OK") : probe.error || "Failed")} · DNS/TLS/HTTP ${probe.dnsMs}/${probe.tlsMs}/${probe.httpMs} ms</small>
        </span>
        <span>${escapeHtml(probe.totalMs)} ms</span>
      </div>
    `)
    .join("")
    : `<div class="empty-state">No local probe results</div>`;
}

async function loadWeather() {
  try {
    const response = await fetch("/api/weather", { cache: "no-store" });
    if (!response.ok) throw new Error(`Weather update failed with ${response.status}`);
    snapshot = await response.json();
    regionById = new Map(snapshot.regions.map((region) => [region.id, region]));
    liveStatus.classList.add("online");
    renderPanels();
    draw();
  } catch (error) {
    liveStatus.classList.remove("online");
    updatedAt.textContent = "Probe update failed";
  }
}

function updateTooltip(event) {
  if (!snapshot || dragState) return;

  const rect = canvas.getBoundingClientRect();
  const mouse = { x: event.clientX - rect.left, y: event.clientY - rect.top };
  const clusters = mapClusters(snapshot.readings);
  let nearest = null;
  let nearestDistance = Infinity;

  for (const cluster of clusters) {
    const distance = Math.hypot(mouse.x - cluster.point.x, mouse.y - cluster.point.y);
    if (distance < nearestDistance) {
      nearest = cluster;
      nearestDistance = distance;
    }
  }

  if (!nearest || nearestDistance > (nearest.isCluster ? 36 : 28)) {
    clearHover();
    return;
  }

  const changed = hoverRegion !== nearest.id;
  hoverRegion = nearest.id;
  tooltip.hidden = false;
  tooltip.style.left = `${Math.min(rect.width - 250, nearest.point.x + 16)}px`;
  tooltip.style.top = `${Math.max(80, nearest.point.y - 18)}px`;
  tooltip.innerHTML = `
    <strong>${escapeHtml(nearest.label)}</strong>
    <span>${escapeHtml(sourceLabel(nearest.source))} · ${escapeHtml(nearest.condition)} · ${pluralize(nearest.readings.length, "reading")}</span>
    <span>Latency: ${nearest.metrics.latencyMs} ms</span>
    <span>Jitter: ${nearest.metrics.jitterMs} ms</span>
    <span>Loss: ${nearest.metrics.packetLossPct}%</span>
    <span>DNS/TLS/HTTP: ${nearest.metrics.dnsMs}/${nearest.metrics.tlsMs}/${nearest.metrics.httpMs} ms</span>
    ${nearest.isCluster ? `<span>${escapeHtml(nearest.regions.map((region) => region.name).join(", "))}</span>` : ""}
  `;
  if (changed) draw();
}

function clearHover() {
  const changed = hoverRegion !== null;
  hoverRegion = null;
  tooltip.hidden = true;
  if (changed) draw();
}

function mapPointer(event) {
  const rect = canvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

metricButtons.forEach((button) => {
  button.addEventListener("click", () => {
    selectedMetric = button.dataset.metric;
    metricButtons.forEach((item) => item.classList.toggle("active", item === button));
    renderPanels();
    draw();
  });
});

zoomInButton.addEventListener("click", () => setZoom(viewport.scale * 1.35));
zoomOutButton.addEventListener("click", () => setZoom(viewport.scale / 1.35));
zoomResetButton.addEventListener("click", resetViewport);

canvas.addEventListener("wheel", (event) => {
  event.preventDefault();
  const direction = event.deltaY < 0 ? 1 : -1;
  const factor = direction > 0 ? 1.16 : 1 / 1.16;
  setZoom(viewport.scale * factor, mapPointer(event));
}, { passive: false });

canvas.addEventListener("pointerdown", (event) => {
  if (event.button !== 0 && event.pointerType === "mouse") return;
  dragState = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    viewportX: viewport.x,
    viewportY: viewport.y,
    moved: false
  };
  canvas.setPointerCapture(event.pointerId);
  canvas.classList.add("dragging");
  clearHover();
});

canvas.addEventListener("pointermove", (event) => {
  if (!dragState || dragState.pointerId !== event.pointerId) return;

  const dx = event.clientX - dragState.startX;
  const dy = event.clientY - dragState.startY;
  if (Math.abs(dx) + Math.abs(dy) > 2) dragState.moved = true;

  viewport.x = dragState.viewportX + dx;
  viewport.y = dragState.viewportY + dy;
  clampViewport();
  draw();
});

function endDrag(event) {
  if (!dragState || dragState.pointerId !== event.pointerId) return;
  canvas.releasePointerCapture(event.pointerId);
  canvas.classList.remove("dragging");
  dragState = null;
}

canvas.addEventListener("pointerup", endDrag);
canvas.addEventListener("pointercancel", endDrag);
canvas.addEventListener("mousemove", updateTooltip);
canvas.addEventListener("mouseleave", clearHover);

window.addEventListener("resize", () => {
  resizeCanvas();
  draw();
});

resizeCanvas();
loadWeather();
setInterval(loadWeather, 7000);
draw();

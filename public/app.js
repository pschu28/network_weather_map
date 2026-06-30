const canvas = document.querySelector("#weather-map");
const ctx = canvas.getContext("2d");
const tooltip = document.querySelector("#tooltip");
const liveStatus = document.querySelector("#live-status");
const updatedAt = document.querySelector("#updated-at");
const globalCondition = document.querySelector("#global-condition");
const averageScore = document.querySelector("#average-score");
const readingList = document.querySelector("#reading-list");
const localProbe = document.querySelector("#local-probe");
const metricButtons = [...document.querySelectorAll("[data-metric]")];

let snapshot = null;
let selectedMetric = "score";
let hoverRegion = null;
let regionById = new Map();

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
}

function project(lat, lon) {
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

function drawWeatherAreas(readings) {
  for (const reading of readings) {
    const point = readingPoint(reading);
    if (!point) continue;

    const strength = normalizedMetric(reading);
    const color = conditionColors[reading.condition];
    const radius = 22 + strength * 52;
    const gradient = ctx.createRadialGradient(point.x, point.y, 0, point.x, point.y, radius);

    gradient.addColorStop(0, `${color}66`);
    gradient.addColorStop(0.58, `${color}25`);
    gradient.addColorStop(1, `${color}00`);

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
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

function drawMarkers(readings) {
  for (const reading of readings) {
    const point = readingPoint(reading);
    if (!point) continue;

    const color = conditionColors[reading.condition];
    const isHover = hoverRegion === reading.regionId;

    ctx.fillStyle = "#f8fbf8";
    ctx.strokeStyle = color;
    ctx.lineWidth = isHover ? 3 : 2;
    ctx.beginPath();
    ctx.arc(point.x, point.y, isHover ? 8 : 5.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "rgba(245, 249, 247, 0.92)";
    ctx.strokeStyle = "rgba(8, 16, 20, 0.9)";
    ctx.lineWidth = 3;
    ctx.font = "700 11px system-ui, sans-serif";
    const label = String(Math.round(metricValue(reading)));
    ctx.strokeText(label, point.x + 12, point.y + 4);
    ctx.fillText(label, point.x + 12, point.y + 4);
  }
}

function draw() {
  const rect = canvas.getBoundingClientRect();
  drawBackground(rect.width, rect.height);
  if (snapshot) {
    drawWeatherAreas(snapshot.readings);
    drawMarkers(snapshot.readings);
  }
}

function renderPanels() {
  if (!snapshot) return;

  const readings = [...snapshot.readings].sort((a, b) => b.score - a.score);
  const avgScore = readings.reduce((sum, reading) => sum + reading.score, 0) / readings.length;
  const top = readings[0];

  averageScore.textContent = Math.round(avgScore);
  globalCondition.textContent = top.condition;
  updatedAt.textContent = `Updated ${new Date(snapshot.generatedAt).toLocaleTimeString()}`;

  readingList.innerHTML = readings
    .map((reading) => {
      const region = regionFor(reading);
      return `
        <article class="reading" data-region="${reading.regionId}">
          <span class="condition-bar" style="background:${conditionColors[reading.condition]}"></span>
          <div>
            <h3>${region.name}</h3>
            <p>${reading.source} · ${reading.condition} · ${formatMetric(reading)}</p>
          </div>
          <span class="score">${reading.score}</span>
        </article>
      `;
    })
    .join("");

  const local = snapshot.readings.find((reading) => reading.regionId === "local");
  localProbe.innerHTML = local.probes
    .map((probe) => `
      <div class="probe-row">
        <span><strong>${probe.name}</strong> ${probe.ok ? "OK" : "Failed"}</span>
        <span>${probe.totalMs} ms</span>
      </div>
    `)
    .join("");
}

async function loadWeather() {
  try {
    const response = await fetch("/api/weather", { cache: "no-store" });
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
  if (!snapshot) return;

  const rect = canvas.getBoundingClientRect();
  const mouse = { x: event.clientX - rect.left, y: event.clientY - rect.top };
  let nearest = null;
  let nearestDistance = Infinity;

  for (const reading of snapshot.readings) {
    const region = regionFor(reading);
    const point = readingPoint(reading);
    if (!point || !region) continue;

    const distance = Math.hypot(mouse.x - point.x, mouse.y - point.y);
    if (distance < nearestDistance) {
      nearest = { reading, region, point };
      nearestDistance = distance;
    }
  }

  if (!nearest || nearestDistance > 28) {
    clearHover();
    return;
  }

  const changed = hoverRegion !== nearest.region.id;
  hoverRegion = nearest.region.id;
  tooltip.hidden = false;
  tooltip.style.left = `${Math.min(rect.width - 250, nearest.point.x + 16)}px`;
  tooltip.style.top = `${Math.max(80, nearest.point.y - 18)}px`;
  tooltip.innerHTML = `
    <strong>${nearest.region.name}</strong>
    <span>${nearest.reading.source} · ${nearest.reading.condition}</span>
    <span>Latency: ${nearest.reading.metrics.latencyMs} ms</span>
    <span>Jitter: ${nearest.reading.metrics.jitterMs} ms</span>
    <span>Loss: ${nearest.reading.metrics.packetLossPct}%</span>
    <span>DNS/TLS/HTTP: ${nearest.reading.metrics.dnsMs}/${nearest.reading.metrics.tlsMs}/${nearest.reading.metrics.httpMs} ms</span>
  `;
  if (changed) draw();
}

function clearHover() {
  const changed = hoverRegion !== null;
  hoverRegion = null;
  tooltip.hidden = true;
  if (changed) draw();
}

metricButtons.forEach((button) => {
  button.addEventListener("click", () => {
    selectedMetric = button.dataset.metric;
    metricButtons.forEach((item) => item.classList.toggle("active", item === button));
    renderPanels();
    draw();
  });
});

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

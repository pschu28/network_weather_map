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

const conditionColors = {
  clear: "#44d07b",
  cloudy: "#f2c94c",
  rain: "#ff8a4c",
  storm: "#ff4d6d"
};

const landShapes = [
  [
    [-168, 72], [-150, 70], [-137, 60], [-125, 50], [-124, 40], [-118, 32],
    [-107, 24], [-97, 19], [-88, 21], [-82, 26], [-75, 36], [-66, 44],
    [-54, 48], [-58, 56], [-73, 61], [-92, 66], [-116, 69], [-140, 72]
  ],
  [
    [-73, 84], [-24, 82], [-16, 73], [-30, 64], [-44, 60], [-56, 66],
    [-66, 76]
  ],
  [
    [-82, 13], [-76, 8], [-78, 0], [-72, -10], [-70, -21], [-64, -31],
    [-58, -42], [-68, -55], [-77, -48], [-81, -32], [-76, -18], [-80, -5]
  ],
  [
    [-11, 72], [8, 71], [25, 67], [31, 59], [24, 50], [12, 45],
    [2, 43], [-8, 51], [-18, 61]
  ],
  [
    [-18, 36], [-5, 35], [9, 37], [25, 32], [33, 21], [42, 12],
    [48, -3], [42, -18], [35, -30], [22, -35], [13, -30], [4, -14],
    [-7, 5], [-14, 20]
  ],
  [
    [26, 69], [58, 70], [88, 72], [117, 67], [142, 57], [154, 48],
    [148, 34], [126, 26], [112, 18], [104, 5], [91, 8], [78, 21],
    [64, 25], [48, 32], [34, 43]
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

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(rect.width * dpr));
  canvas.height = Math.max(1, Math.floor(rect.height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function project(lat, lon) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((lon + 180) / 360) * rect.width,
    y: ((90 - lat) / 180) * rect.height
  };
}

function metricValue(reading) {
  if (selectedMetric === "score") return reading.score;
  return reading.metrics[selectedMetric] || 0;
}

function metricMax() {
  return {
    score: 100,
    latencyMs: 360,
    packetLossPct: 12,
    dnsMs: 180,
    tlsMs: 260,
    httpMs: 800
  }[selectedMetric];
}

function normalizedMetric(reading) {
  return Math.min(1, metricValue(reading) / metricMax());
}

function drawBackground(width, height) {
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#0b1d27";
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = "rgba(236, 246, 243, 0.045)";
  ctx.lineWidth = 1;
  for (let lon = -180; lon <= 180; lon += 30) {
    const a = project(-85, lon);
    const b = project(85, lon);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  for (let lat = -60; lat <= 75; lat += 15) {
    const a = project(lat, -180);
    const b = project(lat, 180);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }

  ctx.fillStyle = "#183235";
  ctx.strokeStyle = "rgba(236, 246, 243, 0.18)";
  for (const shape of landShapes) {
    ctx.beginPath();
    shape.forEach(([lon, lat], index) => {
      const point = project(lat, lon);
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
}

function drawWeatherAreas(readings) {
  for (const reading of readings) {
    const region = snapshot.regions.find((item) => item.id === reading.regionId);
    if (!region) continue;

    const point = project(region.lat, region.lon);
    const strength = normalizedMetric(reading);
    const color = conditionColors[reading.condition];
    const radius = 26 + strength * 62;
    const gradient = ctx.createRadialGradient(point.x, point.y, 0, point.x, point.y, radius);

    gradient.addColorStop(0, `${color}70`);
    gradient.addColorStop(0.55, `${color}2f`);
    gradient.addColorStop(1, `${color}00`);

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawMarkers(readings) {
  for (const reading of readings) {
    const region = snapshot.regions.find((item) => item.id === reading.regionId);
    if (!region) continue;

    const point = project(region.lat, region.lon);
    const color = conditionColors[reading.condition];
    const isHover = hoverRegion === region.id;

    ctx.fillStyle = "#071015";
    ctx.strokeStyle = color;
    ctx.lineWidth = isHover ? 3 : 2;
    ctx.beginPath();
    ctx.arc(point.x, point.y, isHover ? 8 : 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#ecf6f3";
    ctx.font = "700 12px system-ui, sans-serif";
    ctx.fillText(String(Math.round(metricValue(reading))), point.x + 12, point.y + 4);
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

function formatMetric(reading) {
  if (selectedMetric === "score") return `${reading.score}`;
  const value = metricValue(reading);
  return selectedMetric === "packetLossPct" ? `${value}%` : `${value} ms`;
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
      const region = snapshot.regions.find((item) => item.id === reading.regionId);
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
    const region = snapshot.regions.find((item) => item.id === reading.regionId);
    const point = project(region.lat, region.lon);
    const distance = Math.hypot(mouse.x - point.x, mouse.y - point.y);
    if (distance < nearestDistance) {
      nearest = { reading, region, point };
      nearestDistance = distance;
    }
  }

  if (!nearest || nearestDistance > 28) {
    const changed = hoverRegion !== null;
    hoverRegion = null;
    tooltip.hidden = true;
    if (changed) draw();
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

metricButtons.forEach((button) => {
  button.addEventListener("click", () => {
    selectedMetric = button.dataset.metric;
    metricButtons.forEach((item) => item.classList.toggle("active", item === button));
    renderPanels();
    draw();
  });
});

canvas.addEventListener("mousemove", updateTooltip);
canvas.addEventListener("mouseleave", () => {
  hoverRegion = null;
  tooltip.hidden = true;
  draw();
});

window.addEventListener("resize", () => {
  resizeCanvas();
  draw();
});

resizeCanvas();
loadWeather();
setInterval(loadWeather, 7000);
draw();

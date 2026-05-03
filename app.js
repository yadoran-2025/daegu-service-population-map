const data = window.DAEGU_SERVICE_POPULATION;
const canvas = document.getElementById("mapCanvas");
const ctx = canvas.getContext("2d");
const tooltip = document.getElementById("tooltip");
const hourRange = document.getElementById("hourRange");
const hourLabel = document.getElementById("hourLabel");
const hourHint = document.getElementById("hourHint");
const playButton = document.getElementById("playButton");
const districtFilter = document.getElementById("districtFilter");
const searchInput = document.getElementById("searchInput");
const rankList = document.getElementById("rankList");
const rankMeta = document.getElementById("rankMeta");
const sourceInfo = document.getElementById("sourceInfo");
const totalPopulation = document.getElementById("totalPopulation");
const topArea = document.getElementById("topArea");
const areaCount = document.getElementById("areaCount");
const averagePopulation = document.getElementById("averagePopulation");

const numberFormat = new Intl.NumberFormat("ko-KR");
const hours = data.hours.length ? data.hours : ["--"];
const state = {
  hourIndex: 0,
  district: "전체",
  query: "",
  hoverCode: null,
  selectedCode: null,
  transform: { scale: 1, offsetX: 0, offsetY: 0 },
  paths: new Map(),
  timer: null,
};

const colors = ["#dce9df", "#b8d9bf", "#7ab59c", "#3b927f", "#e0a13d", "#b94a62"];

function populationOf(feature) {
  return feature.populations[hours[state.hourIndex]] ?? null;
}

function visibleFeatures() {
  const query = state.query.trim().toLowerCase();
  return data.features.filter((feature) => {
    const districtMatch = state.district === "전체" || feature.district === state.district;
    const queryMatch = !query || feature.name.toLowerCase().includes(query);
    return districtMatch && queryMatch;
  });
}

function colorFor(value, min, max) {
  if (value === null || Number.isNaN(value)) return "#d8d6cf";
  if (max <= min) return colors[3];
  const t = (value - min) / (max - min);
  const index = Math.min(colors.length - 1, Math.floor(t * colors.length));
  return colors[index];
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(rect.width * dpr));
  canvas.height = Math.max(1, Math.round(rect.height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  computeTransform(rect.width, rect.height);
  draw();
}

function computeTransform(width, height) {
  const [minX, minY, maxX, maxY] = data.bounds;
  const padding = Math.min(width, height) < 560 ? 24 : 42;
  const scale = Math.min((width - padding * 2) / (maxX - minX), (height - padding * 2) / (maxY - minY));
  state.transform = {
    scale,
    offsetX: (width - (maxX - minX) * scale) / 2 - minX * scale,
    offsetY: (height + (maxY - minY) * scale) / 2 + minY * scale,
  };
}

function project(point) {
  const { scale, offsetX, offsetY } = state.transform;
  return [point[0] * scale + offsetX, -point[1] * scale + offsetY];
}

function buildPath(feature) {
  const path = new Path2D();
  for (const polygon of feature.polygons) {
    for (const ring of polygon) {
      ring.forEach((point, index) => {
        const [x, y] = project(point);
        if (index === 0) path.moveTo(x, y);
        else path.lineTo(x, y);
      });
      path.closePath();
    }
  }
  return path;
}

function drawLabels(features) {
  ctx.save();
  ctx.font = "700 11px Pretendard, Segoe UI, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 3;
  const activeCode = state.hoverCode || state.selectedCode;
  const feature = features.find((item) => item.code === activeCode);
  if (feature) {
    const [x, y] = project(feature.centroid);
    ctx.strokeStyle = "rgba(255,253,248,0.92)";
    ctx.fillStyle = "#17211f";
    ctx.strokeText(feature.name, x, y);
    ctx.fillText(feature.name, x, y);
  }
  ctx.restore();
}

function draw() {
  const rect = canvas.getBoundingClientRect();
  ctx.clearRect(0, 0, rect.width, rect.height);
  state.paths.clear();

  const features = visibleFeatures();
  const values = features.map(populationOf).filter((value) => value !== null);
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 0;

  for (const feature of data.features) {
    const path = buildPath(feature);
    state.paths.set(feature.code, path);
    const visible = features.includes(feature);
    const value = visible ? populationOf(feature) : null;
    ctx.fillStyle = visible ? colorFor(value, min, max) : "rgba(216,214,207,0.25)";
    ctx.strokeStyle = visible ? "rgba(255,253,248,0.88)" : "rgba(255,253,248,0.35)";
    ctx.lineWidth = visible ? 0.9 : 0.5;
    ctx.fill(path, "evenodd");
    ctx.stroke(path);
  }

  const activeCode = state.hoverCode || state.selectedCode;
  if (activeCode && state.paths.has(activeCode)) {
    ctx.save();
    ctx.strokeStyle = "#17211f";
    ctx.lineWidth = 2.8;
    ctx.stroke(state.paths.get(activeCode));
    ctx.restore();
  }

  drawLabels(features);
}

function updateStats() {
  const features = visibleFeatures();
  const withValues = features
    .map((feature) => ({ feature, value: populationOf(feature) }))
    .filter((item) => item.value !== null)
    .sort((a, b) => b.value - a.value);
  const total = withValues.reduce((sum, item) => sum + item.value, 0);

  totalPopulation.textContent = numberFormat.format(total);
  topArea.textContent = withValues[0] ? withValues[0].feature.name : "-";
  areaCount.textContent = `${numberFormat.format(withValues.length)} / ${numberFormat.format(features.length)}`;
  averagePopulation.textContent = withValues.length ? numberFormat.format(Math.round(total / withValues.length)) : "-";
  rankMeta.textContent = `${hours[state.hourIndex]}시`;

  rankList.innerHTML = "";
  for (const [index, item] of withValues.entries()) {
    const li = document.createElement("li");
    li.dataset.code = item.feature.code;
    li.innerHTML = `
      <span class="rank-number">${index + 1}</span>
      <span class="rank-name"><strong>${item.feature.name}</strong><span>${item.feature.district}</span></span>
      <span class="rank-value">${numberFormat.format(item.value)}</span>
    `;
    li.addEventListener("mouseenter", () => {
      state.hoverCode = item.feature.code;
      draw();
    });
    li.addEventListener("mouseleave", () => {
      state.hoverCode = null;
      draw();
    });
    li.addEventListener("click", () => {
      state.selectedCode = item.feature.code;
      draw();
    });
    rankList.appendChild(li);
  }
}

function syncControls() {
  const hour = hours[state.hourIndex];
  hourLabel.textContent = `${hour}시`;
  hourRange.value = String(state.hourIndex);
  hourHint.textContent =
    hours.length > 1
      ? `${hours[0]}시부터 ${hours[hours.length - 1]}시까지 ${hours.length}개 시간대`
      : `현재 파일에는 ${hour}시 데이터만 있습니다`;
  playButton.disabled = hours.length < 2;
  sourceInfo.textContent = `${data.summary.source} · 기준일 ${formatDate(data.summary.baseDate)} · ${data.summary.populatedFeatureCount}개 동`;
}

function formatDate(value) {
  if (!value || value.length !== 8) return value || "-";
  return `${value.slice(0, 4)}.${value.slice(4, 6)}.${value.slice(6, 8)}`;
}

function updateView() {
  syncControls();
  updateStats();
  draw();
}

function initializeControls() {
  hourRange.min = "0";
  hourRange.max = String(Math.max(0, hours.length - 1));
  hourRange.disabled = hours.length < 2;

  const districts = ["전체", ...new Set(data.features.map((feature) => feature.district))].sort((a, b) =>
    a === "전체" ? -1 : b === "전체" ? 1 : a.localeCompare(b, "ko-KR")
  );
  districtFilter.innerHTML = districts.map((district) => `<option value="${district}">${district}</option>`).join("");

  hourRange.addEventListener("input", (event) => {
    state.hourIndex = Number(event.target.value);
    updateView();
  });

  districtFilter.addEventListener("change", (event) => {
    state.district = event.target.value;
    state.selectedCode = null;
    updateView();
  });

  searchInput.addEventListener("input", (event) => {
    state.query = event.target.value;
    state.selectedCode = null;
    updateView();
  });

  playButton.addEventListener("click", () => {
    if (state.timer) {
      clearInterval(state.timer);
      state.timer = null;
      playButton.textContent = "▶";
      return;
    }
    playButton.textContent = "Ⅱ";
    state.timer = setInterval(() => {
      state.hourIndex = (state.hourIndex + 1) % hours.length;
      updateView();
    }, 900);
  });
}

function featureAt(x, y) {
  for (let i = data.features.length - 1; i >= 0; i -= 1) {
    const feature = data.features[i];
    const path = state.paths.get(feature.code);
    if (path && ctx.isPointInPath(path, x, y, "evenodd")) return feature;
  }
  return null;
}

canvas.addEventListener("mousemove", (event) => {
  const rect = canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const feature = featureAt(x, y);
  state.hoverCode = feature?.code || null;
  draw();

  if (!feature) {
    tooltip.classList.remove("visible");
    return;
  }

  const value = populationOf(feature);
  tooltip.innerHTML = `
    <strong>${feature.name}</strong>
    <span>${feature.district} · ${hours[state.hourIndex]}시</span>
    <span>${value === null ? "데이터 없음" : `${numberFormat.format(value)}명`}</span>
  `;
  tooltip.style.transform = `translate(${Math.min(x + 16, rect.width - 190)}px, ${Math.min(y + 16, rect.height - 92)}px)`;
  tooltip.classList.add("visible");
});

canvas.addEventListener("mouseleave", () => {
  state.hoverCode = null;
  tooltip.classList.remove("visible");
  draw();
});

canvas.addEventListener("click", (event) => {
  const rect = canvas.getBoundingClientRect();
  const feature = featureAt(event.clientX - rect.left, event.clientY - rect.top);
  state.selectedCode = feature?.code || null;
  draw();
});

window.addEventListener("resize", resizeCanvas);

initializeControls();
syncControls();
updateStats();
resizeCanvas();

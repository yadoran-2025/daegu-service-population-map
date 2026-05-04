const adminData = window.DAEGU_ADMIN_BOUNDARIES;
const gridData = window.DAEGU_GRID_FLOW;
const densityData = window.DAEGU_DENSITY;
const subwayData = window.DAEGU_SUBWAY;

const canvas = document.getElementById("mapCanvas");
const ctx = canvas.getContext("2d");
const tooltip = document.getElementById("tooltip");
const hourRange = document.getElementById("hourRange");
const hourLabel = document.getElementById("hourLabel");
const selectedDong = document.getElementById("selectedDong");
const panelDong = document.getElementById("panelDong");
const maxMetricLabel = document.getElementById("maxMetricLabel");
const maxGrid = document.getElementById("maxGrid");
const legendTitle = document.getElementById("legendTitle");
const legendItems = document.getElementById("legendItems");
const subwayLegend = document.getElementById("subwayLegend");
const subwayLegendItems = document.getElementById("subwayLegendItems");
const timebar = document.querySelector(".timebar");
const notesTitle = document.getElementById("notesTitle");
const notesText = document.getElementById("notesText");
const mapModeButtons = document.querySelectorAll("[data-map-mode]");
const mapHelpOpen = document.getElementById("mapHelpOpen");
const mapHelpDialog = document.getElementById("mapHelpDialog");
const mapHelpClose = document.getElementById("mapHelpClose");
const subwayToggle = document.getElementById("subwayToggle");

const numberFormat = new Intl.NumberFormat("ko-KR");
const state = {
  mapMode: "flow",
  hourIndex: 0,
  selectedAdminCode: null,
  hoverAdminCode: null,
  hoverGridId: null,
  hoverStationId: null,
  selectedStationId: null,
  showSubway: true,
  mouse: { x: 0, y: 0 },
  baseTransform: { scale: 1, offsetX: 0, offsetY: 0 },
  transform: { scale: 1, offsetX: 0, offsetY: 0 },
  zoom: 1,
  dpr: 1,
  panX: 0,
  panY: 0,
  isDragging: false,
  dragMoved: false,
  dragStart: { x: 0, y: 0 },
  dragPanStart: { x: 0, y: 0 },
  pathsReady: false,
  adminPaths: new Map(),
  gridPaths: new Map(),
};

function currentHour() {
  return gridData.hours[state.hourIndex];
}

function currentValue(grid) {
  return grid.values[currentHour()] ?? 0;
}

function isDensityMode() {
  return state.mapMode === "density";
}

function colorFor(value) {
  const breaks = gridData.breaks;
  const colors = gridData.colors;
  for (let i = breaks.length - 1; i >= 0; i -= 1) {
    if (value >= breaks[i]) return colors[i];
  }
  return colors[0];
}

function densityColorFor(value) {
  const breaks = densityData.breaks;
  const colors = densityData.colors;
  for (let i = breaks.length - 1; i >= 0; i -= 1) {
    if (value >= breaks[i]) return colors[i];
  }
  return colors[0];
}

function labelForBreak(index, breaks) {
  if (index === breaks.length - 1) return `${numberFormat.format(breaks[index])}+`;
  return `${numberFormat.format(breaks[index])}~${numberFormat.format(breaks[index + 1])}`;
}

function buildLegend() {
  const source = isDensityMode() ? densityData : gridData;
  const unit = isDensityMode() ? "명/km²" : "명";
  legendTitle.textContent = isDensityMode() ? "행정동 인구밀도" : "그리드 유동인구";
  legendItems.innerHTML = source.colors
    .map(
      (color, index) => `
        <div class="legend-item">
          <span class="swatch" style="background:${color}"></span>
          <span>${labelForBreak(index, source.breaks)}${unit}</span>
        </div>
      `
    )
    .join("");
}

function buildSubwayLegend() {
  if (!subwayData) {
    subwayLegend.classList.add("is-hidden");
    return;
  }
  subwayLegendItems.innerHTML = subwayData.lines
    .map(
      (line) => `
        <div class="subway-legend-item">
          <span class="subway-line-swatch" style="background:${line.color}"></span>
          <span>${line.name}</span>
        </div>
      `
    )
    .join("");
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  state.dpr = dpr;
  canvas.width = Math.max(1, Math.round(rect.width * dpr));
  canvas.height = Math.max(1, Math.round(rect.height * dpr));
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(dpr, dpr);
  computeTransform(rect.width, rect.height);
  rebuildPaths();
  draw();
}

function computeTransform(width, height) {
  const [minX, minY, maxX, maxY] = adminData.bounds;
  const padding = Math.min(width, height) < 560 ? 18 : 36;
  const scale = Math.min((width - padding * 2) / (maxX - minX), (height - padding * 2) / (maxY - minY));
  state.baseTransform = {
    scale,
    offsetX: (width - (maxX - minX) * scale) / 2 - minX * scale,
    offsetY: (height + (maxY - minY) * scale) / 2 + minY * scale,
  };
  applyZoomTransform();
}

function applyZoomTransform(anchorX, anchorY, previousZoom = state.zoom) {
  const base = state.baseTransform;
  const previousScale = base.scale * previousZoom;
  const nextScale = base.scale * state.zoom;

  if (anchorX !== undefined && anchorY !== undefined) {
    const mapX = (anchorX - (base.offsetX + state.panX)) / previousScale;
    const mapY = (anchorY - (base.offsetY + state.panY)) / previousScale;
    state.panX = anchorX - base.offsetX - mapX * nextScale;
    state.panY = anchorY - base.offsetY - mapY * nextScale;
  }

  state.transform = {
    scale: nextScale,
    offsetX: base.offsetX + state.panX,
    offsetY: base.offsetY + state.panY,
  };
}

function project(point) {
  const { scale, offsetX, offsetY } = state.transform;
  return [point[0] * scale + offsetX, -point[1] * scale + offsetY];
}

function pathFromPolygons(polygons) {
  const path = new Path2D();
  for (const polygon of polygons) {
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

function rebuildPaths() {
  state.adminPaths.clear();
  state.gridPaths.clear();
  for (const admin of adminData.features) state.adminPaths.set(admin.code, pathFromPolygons(admin.polygons));
  for (const grid of gridData.features) state.gridPaths.set(grid.id, pathFromPolygons(grid.polygons));
  state.pathsReady = true;
}

function drawAdminBase() {
  if (!state.pathsReady) return;
  ctx.save();
  for (const admin of adminData.features) {
    const path = state.adminPaths.get(admin.code);
    if (!path) continue;
    ctx.fillStyle = admin.code === state.selectedAdminCode ? "rgba(245, 246, 241, 0.95)" : "rgba(251, 250, 245, 0.86)";
    ctx.strokeStyle = "rgba(33, 44, 42, 0.38)";
    ctx.lineWidth = admin.code === state.selectedAdminCode ? 1.7 : 0.85;
    ctx.fill(path, "evenodd");
    ctx.stroke(path);
  }
  ctx.restore();
}

function drawGridLayer() {
  if (!state.pathsReady) return;
  ctx.save();
  ctx.globalAlpha = 0.82;
  for (const grid of gridData.features) {
    const path = state.gridPaths.get(grid.id);
    if (!path) continue;
    ctx.fillStyle = colorFor(currentValue(grid));
    ctx.strokeStyle = "rgba(255, 255, 255, 0.34)";
    ctx.lineWidth = 0.35;
    ctx.fill(path, "evenodd");
    ctx.stroke(path);
  }
  ctx.restore();
}

function drawDensityLayer() {
  if (!state.pathsReady) return;
  ctx.save();
  ctx.globalAlpha = 0.88;
  for (const admin of adminData.features) {
    const density = densityFeatureForAdmin(admin);
    if (!density) continue;
    const path = state.adminPaths.get(admin.code);
    if (!path) continue;
    ctx.fillStyle = densityColorFor(density.density);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.42)";
    ctx.lineWidth = 0.7;
    ctx.fill(path, "evenodd");
    ctx.stroke(path);
  }
  ctx.restore();
}

function drawAdminOutlines() {
  if (!state.pathsReady) return;
  ctx.save();
  for (const admin of adminData.features) {
    const selected = admin.code === state.selectedAdminCode;
    const path = state.adminPaths.get(admin.code);
    ctx.strokeStyle = selected ? "#102a43" : "rgba(23, 33, 31, 0.62)";
    ctx.lineWidth = selected ? 3 : 1.15;
    ctx.stroke(path);
  }
  ctx.restore();
}

function drawSelectedLabel() {
  const admin = adminData.features.find((item) => item.code === state.selectedAdminCode);
  if (!admin) return;
  const [x, y] = project(admin.centroid);
  ctx.save();
  ctx.font = "800 15px Pretendard, Segoe UI, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const width = Math.max(78, ctx.measureText(admin.name).width + 28);
  const height = 32;
  ctx.fillStyle = "rgba(255, 253, 248, 0.96)";
  ctx.strokeStyle = "rgba(16, 42, 67, 0.22)";
  ctx.lineWidth = 1;
  roundRect(ctx, x - width / 2, y - height / 2, width, height, 8);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#102a43";
  ctx.fillText(admin.name, x, y + 1);
  ctx.restore();
}

function drawHoverGrid() {
  if (isDensityMode()) {
    if (!state.hoverAdminCode) return;
    const path = state.adminPaths.get(state.hoverAdminCode);
    if (!path) return;
    ctx.save();
    ctx.strokeStyle = "#0b2f4a";
    ctx.lineWidth = 2;
    ctx.stroke(path);
    ctx.restore();
    return;
  }

  if (!state.hoverGridId) return;
  const path = state.gridPaths.get(state.hoverGridId);
  if (!path) return;
  ctx.save();
  ctx.strokeStyle = "#0b2f4a";
  ctx.lineWidth = 2;
  ctx.stroke(path);
  ctx.restore();
}

function stationRadius(station) {
  if (station.transfer) return state.zoom >= 2 ? 5.5 : 4.6;
  return state.zoom >= 2 ? 4.6 : 3.4;
}

function drawStationLabel(station, x, y) {
  const stationName = station.name || station.englishName || "역 정보 없음";
  const lineText = station.transfer ? `${station.lineName} · 환승역` : station.lineName;
  const label = `${stationName} ${lineText}`;
  ctx.save();
  ctx.font = "800 12px Pretendard, Segoe UI, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const width = Math.max(88, ctx.measureText(label).width + 18);
  const height = 26;
  const labelX = x + 10;
  const labelY = y - 14;
  ctx.fillStyle = "rgba(255, 253, 248, 0.97)";
  ctx.strokeStyle = "rgba(11, 47, 74, 0.22)";
  ctx.lineWidth = 1;
  roundRect(ctx, labelX, labelY - height / 2, width, height, 7);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#0b2f4a";
  ctx.fillText(label, labelX + 9, labelY + 1);
  ctx.restore();
}

function drawSubwayLayer() {
  if (!state.showSubway || !subwayData) return;

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const line of subwayData.lines) {
    if (!line.points.length) continue;
    const [startX, startY] = project(line.points[0]);
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    for (const point of line.points.slice(1)) {
      const [x, y] = project(point);
      ctx.lineTo(x, y);
    }
    ctx.strokeStyle = "rgba(255, 253, 248, 0.88)";
    ctx.lineWidth = Math.max(5.5, 7.5 / Math.sqrt(state.zoom));
    ctx.stroke();
    ctx.strokeStyle = line.color;
    ctx.lineWidth = Math.max(2.8, 4.6 / Math.sqrt(state.zoom));
    ctx.stroke();
  }

  const selectedStation = subwayData.stations.find((station) => station.id === state.selectedStationId);
  for (const station of subwayData.stations) {
    const [x, y] = project(station.point);
    const hovered = station.id === state.hoverStationId;
    const selected = station.id === state.selectedStationId;
    const radius = stationRadius(station) + (hovered ? 2 : 0);
    ctx.beginPath();
    ctx.arc(x, y, radius + 1.8, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255, 253, 248, 0.95)";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = station.transfer ? "#0b2f4a" : station.color;
    ctx.fill();
    ctx.strokeStyle = "rgba(11, 47, 74, 0.38)";
    ctx.lineWidth = hovered || selected ? 1.8 : 0.8;
    ctx.stroke();
  }

  if (selectedStation) {
    const [x, y] = project(selectedStation.point);
    drawStationLabel(selectedStation, x, y);
  }
  ctx.restore();
}

function draw() {
  if (!state.pathsReady) return;
  const rect = canvas.getBoundingClientRect();
  ctx.clearRect(0, 0, rect.width, rect.height);
  drawAdminBase();
  if (isDensityMode()) drawDensityLayer();
  else drawGridLayer();
  drawAdminOutlines();
  drawHoverGrid();
  drawSelectedDensityValue();
  drawSubwayLayer();
}

function roundRect(context, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}

function drawHoverGridValue(grid) {
  const [x, y] = project(grid.centroid);
  const text = `${numberFormat.format(currentValue(grid))}명`;

  ctx.save();
  ctx.font = "800 14px Pretendard, Segoe UI, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const width = Math.max(68, ctx.measureText(text).width + 22);
  const height = 28;
  const labelX = x + 12 + width / 2;
  const labelY = y - 12;
  ctx.fillStyle = "rgba(255, 253, 248, 0.97)";
  ctx.strokeStyle = "rgba(11, 47, 74, 0.28)";
  ctx.lineWidth = 1;
  roundRect(ctx, labelX - width / 2, labelY - height / 2, width, height, 8);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#0b2f4a";
  ctx.fillText(text, labelX, labelY + 1);
  ctx.restore();
}

function densityFeatureForAdmin(admin) {
  if (!admin) return null;
  return densityData.features.find((feature) => feature.code === admin.code || feature.name === admin.name) || null;
}

function densityLabel(feature) {
  return `${feature.name} · ${numberFormat.format(Math.round(feature.density))}명/km²`;
}

function drawDensityValue(feature, admin) {
  const [x, y] = project(admin?.centroid || feature.centroid);
  const text = densityLabel(feature);

  ctx.save();
  ctx.font = "800 13px Pretendard, Segoe UI, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const width = Math.max(116, ctx.measureText(text).width + 24);
  const height = 30;
  ctx.fillStyle = "rgba(255, 253, 248, 0.97)";
  ctx.strokeStyle = "rgba(11, 47, 74, 0.28)";
  ctx.lineWidth = 1;
  roundRect(ctx, x - width / 2, y - height / 2, width, height, 8);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#0b2f4a";
  ctx.fillText(text, x, y + 1);
  ctx.restore();
}

function drawSelectedDensityValue() {
  if (!isDensityMode() || !state.selectedAdminCode) return;
  const admin = adminData.features.find((item) => item.code === state.selectedAdminCode);
  const density = densityFeatureForAdmin(admin);
  if (density) drawDensityValue(density, admin);
}

function updateStats() {
  if (isDensityMode()) {
    let max = -1;
    let maxFeature = null;
    for (const feature of densityData.features) {
      if (feature.density > max) {
        max = feature.density;
        maxFeature = feature;
      }
    }
    hourLabel.textContent = "밀도";
    maxMetricLabel.textContent = "최대 밀도 행정동";
    maxGrid.textContent = `${maxFeature.name} · ${numberFormat.format(Math.round(max))}명/km²`;
    return;
  }

  const hour = currentHour();
  const grids = gridData.features;
  let max = -1;
  let maxId = null;
  for (const grid of grids) {
    const value = currentValue(grid);
    if (value > max) {
      max = value;
      maxId = grid.id;
    }
  }
  hourLabel.textContent = `${hour}시`;
  maxMetricLabel.textContent = "최대 그리드";
  maxGrid.textContent = `#${numberFormat.format(maxId)} · ${numberFormat.format(max)}명`;
}

function updateSelectedAdmin(admin) {
  state.selectedAdminCode = admin?.code || null;
  const name = admin?.name || "지도를 클릭하세요";
  selectedDong.textContent = name;
  const density = densityFeatureForAdmin(admin);
  panelDong.textContent =
    admin && isDensityMode() && density
      ? `${name} · ${numberFormat.format(Math.round(density.density))}명/km²`
      : admin
        ? name
        : "-";
  draw();
}

function updateModeUi() {
  const densityMode = isDensityMode();
  mapModeButtons.forEach((button) => {
    const active = button.dataset.mapMode === state.mapMode;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });

  hourRange.disabled = densityMode;
  timebar.classList.toggle("is-density-mode", densityMode);
  notesTitle.textContent = densityMode ? "인구밀도 기준" : "색상 기준";
  notesText.textContent = densityMode
    ? "행정동별 거주자 인구수를 면적으로 나눈 값입니다. 색이 진할수록 1km²당 거주 인구가 많은 지역입니다."
    : "모든 시간대에 같은 절대 범위를 적용합니다. 슬라이더를 움직여도 같은 인구 구간은 같은 색으로 표시됩니다.";

  state.hoverGridId = null;
  state.hoverAdminCode = null;
  buildLegend();
  updateStats();
  const selectedAdmin = state.selectedAdminCode ? adminData.features.find((admin) => admin.code === state.selectedAdminCode) : null;
  if (state.pathsReady) updateSelectedAdmin(selectedAdmin);
  else {
    const name = selectedAdmin?.name || "지도를 클릭하세요";
    selectedDong.textContent = name;
    const density = densityFeatureForAdmin(selectedAdmin);
    panelDong.textContent =
      selectedAdmin && densityMode && density
        ? `${name} · ${numberFormat.format(Math.round(density.density))}명/km²`
        : selectedAdmin
          ? name
          : "-";
  }
}

function adminAt(x, y) {
  const hitX = x * state.dpr;
  const hitY = y * state.dpr;
  for (let i = adminData.features.length - 1; i >= 0; i -= 1) {
    const admin = adminData.features[i];
    const path = state.adminPaths.get(admin.code);
    if (path && ctx.isPointInPath(path, hitX, hitY, "evenodd")) return admin;
  }
  return null;
}

function gridAt(x, y) {
  const hitX = x * state.dpr;
  const hitY = y * state.dpr;
  for (let i = gridData.features.length - 1; i >= 0; i -= 1) {
    const grid = gridData.features[i];
    const path = state.gridPaths.get(grid.id);
    if (path && ctx.isPointInPath(path, hitX, hitY, "evenodd")) return grid;
  }
  return null;
}

function stationAt(x, y) {
  if (!state.showSubway || !subwayData) return null;
  let closest = null;
  let closestDistance = Infinity;

  for (const station of subwayData.stations) {
    const [stationX, stationY] = project(station.point);
    const radius = stationRadius(station) + 6;
    const dx = x - stationX;
    const dy = y - stationY;
    const distance = dx * dx + dy * dy;
    if (distance <= radius * radius && distance < closestDistance) {
      closest = station;
      closestDistance = distance;
    }
  }

  return closest;
}

canvas.addEventListener("mousemove", (event) => {
  if (state.isDragging) {
    const rect = canvas.getBoundingClientRect();
    state.panX = state.dragPanStart.x + event.clientX - state.dragStart.x;
    state.panY = state.dragPanStart.y + event.clientY - state.dragStart.y;
    applyZoomTransform();
    rebuildPaths();
    tooltip.classList.remove("visible");
    draw();
    return;
  }

  const rect = canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const admin = adminAt(x, y);
  const density = densityFeatureForAdmin(admin);
  const grid = isDensityMode() ? null : gridAt(x, y);
  const station = stationAt(x, y);
  state.hoverGridId = grid?.id || null;
  state.hoverAdminCode = isDensityMode() ? admin?.code || null : null;
  state.hoverStationId = station?.id || null;
  tooltip.classList.remove("visible");
  draw();
  if (grid && !station) drawHoverGridValue(grid);
  if (isDensityMode() && density && !station) drawDensityValue(density, admin);
});

canvas.addEventListener("mouseleave", () => {
  state.isDragging = false;
  state.hoverGridId = null;
  state.hoverAdminCode = null;
  state.hoverStationId = null;
  tooltip.classList.remove("visible");
  canvas.classList.remove("is-dragging");
  draw();
});

canvas.addEventListener("click", (event) => {
  if (state.dragMoved) {
    state.dragMoved = false;
    return;
  }
  const rect = canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const station = stationAt(x, y);
  tooltip.classList.remove("visible");
  if (station) {
    state.selectedStationId = state.selectedStationId === station.id ? null : station.id;
    draw();
    return;
  }
  state.selectedStationId = null;
  const admin = adminAt(x, y);
  updateSelectedAdmin(admin);
});

canvas.addEventListener("mousedown", (event) => {
  if (event.button !== 0 || state.zoom <= 1) return;
  event.preventDefault();
  state.isDragging = true;
  state.dragMoved = false;
  state.dragStart = { x: event.clientX, y: event.clientY };
  state.dragPanStart = { x: state.panX, y: state.panY };
  canvas.classList.add("is-dragging");
});

window.addEventListener("mouseup", () => {
  if (!state.isDragging) return;
  state.isDragging = false;
  canvas.classList.remove("is-dragging");
});

window.addEventListener("mousemove", (event) => {
  if (!state.isDragging) return;
  const movedX = Math.abs(event.clientX - state.dragStart.x);
  const movedY = Math.abs(event.clientY - state.dragStart.y);
  state.dragMoved = movedX > 4 || movedY > 4;
});

canvas.addEventListener(
  "wheel",
  (event) => {
    event.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const previousZoom = state.zoom;
    const zoomFactor = Math.exp(-event.deltaY * 0.0014);
    state.zoom = Math.min(8, Math.max(1, state.zoom * zoomFactor));

    if (state.zoom === 1) {
      state.panX = 0;
      state.panY = 0;
      state.dragMoved = false;
      applyZoomTransform();
    } else {
      applyZoomTransform(event.clientX - rect.left, event.clientY - rect.top, previousZoom);
    }

    rebuildPaths();
    draw();
  },
  { passive: false }
);

hourRange.addEventListener("input", (event) => {
  state.hourIndex = Number(event.target.value);
  if (isDensityMode()) return;
  updateStats();
  draw();
});

mapModeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    state.mapMode = button.dataset.mapMode;
    updateModeUi();
  });
});

mapHelpOpen.addEventListener("click", () => {
  mapHelpDialog.showModal();
});

mapHelpClose.addEventListener("click", () => {
  mapHelpDialog.close();
});

mapHelpDialog.addEventListener("click", (event) => {
  if (event.target === mapHelpDialog) mapHelpDialog.close();
});

subwayToggle.addEventListener("click", () => {
  state.showSubway = !state.showSubway;
  state.hoverStationId = null;
  state.selectedStationId = null;
  subwayToggle.classList.toggle("is-active", state.showSubway);
  subwayToggle.setAttribute("aria-pressed", String(state.showSubway));
  subwayLegend.classList.toggle("is-hidden", !state.showSubway);
  draw();
});

window.addEventListener("resize", resizeCanvas);

buildSubwayLegend();
updateModeUi();
resizeCanvas();

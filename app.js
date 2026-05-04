const adminData = window.DAEGU_ADMIN_BOUNDARIES;
const gridData = window.DAEGU_GRID_FLOW;

const canvas = document.getElementById("mapCanvas");
const ctx = canvas.getContext("2d");
const tooltip = document.getElementById("tooltip");
const hourRange = document.getElementById("hourRange");
const hourLabel = document.getElementById("hourLabel");
const selectedDong = document.getElementById("selectedDong");
const panelDong = document.getElementById("panelDong");
const maxGrid = document.getElementById("maxGrid");
const legendItems = document.getElementById("legendItems");

const numberFormat = new Intl.NumberFormat("ko-KR");
const state = {
  hourIndex: 0,
  selectedAdminCode: null,
  hoverGridId: null,
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
  adminPaths: new Map(),
  gridPaths: new Map(),
};

function currentHour() {
  return gridData.hours[state.hourIndex];
}

function currentValue(grid) {
  return grid.values[currentHour()] ?? 0;
}

function colorFor(value) {
  const breaks = gridData.breaks;
  const colors = gridData.colors;
  for (let i = breaks.length - 1; i >= 0; i -= 1) {
    if (value >= breaks[i]) return colors[i];
  }
  return colors[0];
}

function labelForBreak(index) {
  const breaks = gridData.breaks;
  if (index === breaks.length - 1) return `${numberFormat.format(breaks[index])}+`;
  return `${numberFormat.format(breaks[index])}~${numberFormat.format(breaks[index + 1])}`;
}

function buildLegend() {
  legendItems.innerHTML = gridData.colors
    .map(
      (color, index) => `
        <div class="legend-item">
          <span class="swatch" style="background:${color}"></span>
          <span>${labelForBreak(index)}명</span>
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
}

function drawAdminBase() {
  ctx.save();
  for (const admin of adminData.features) {
    const path = state.adminPaths.get(admin.code);
    ctx.fillStyle = admin.code === state.selectedAdminCode ? "rgba(245, 246, 241, 0.95)" : "rgba(251, 250, 245, 0.86)";
    ctx.strokeStyle = "rgba(33, 44, 42, 0.38)";
    ctx.lineWidth = admin.code === state.selectedAdminCode ? 1.7 : 0.85;
    ctx.fill(path, "evenodd");
    ctx.stroke(path);
  }
  ctx.restore();
}

function drawGridLayer() {
  ctx.save();
  ctx.globalAlpha = 0.82;
  for (const grid of gridData.features) {
    const path = state.gridPaths.get(grid.id);
    ctx.fillStyle = colorFor(currentValue(grid));
    ctx.strokeStyle = "rgba(255, 255, 255, 0.34)";
    ctx.lineWidth = 0.35;
    ctx.fill(path, "evenodd");
    ctx.stroke(path);
  }
  ctx.restore();
}

function drawAdminOutlines() {
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
  if (!state.hoverGridId) return;
  const path = state.gridPaths.get(state.hoverGridId);
  if (!path) return;
  ctx.save();
  ctx.strokeStyle = "#0b2f4a";
  ctx.lineWidth = 2;
  ctx.stroke(path);
  ctx.restore();
}

function draw() {
  const rect = canvas.getBoundingClientRect();
  ctx.clearRect(0, 0, rect.width, rect.height);
  drawAdminBase();
  drawGridLayer();
  drawAdminOutlines();
  drawHoverGrid();
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

function updateStats() {
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
  maxGrid.textContent = `#${numberFormat.format(maxId)} · ${numberFormat.format(max)}명`;
}

function updateSelectedAdmin(admin) {
  state.selectedAdminCode = admin?.code || null;
  const name = admin?.name || "지도를 클릭하세요";
  selectedDong.textContent = name;
  panelDong.textContent = admin ? name : "-";
  draw();
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
  const grid = gridAt(x, y);
  state.hoverGridId = grid?.id || null;
  tooltip.classList.remove("visible");
  draw();
  if (grid) drawHoverGridValue(grid);
});

canvas.addEventListener("mouseleave", () => {
  state.isDragging = false;
  state.hoverGridId = null;
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
  tooltip.classList.remove("visible");
  updateSelectedAdmin(adminAt(x, y));
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
  updateStats();
  draw();
});

window.addEventListener("resize", resizeCanvas);

buildLegend();
updateStats();
resizeCanvas();

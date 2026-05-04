const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const adminSource = path.join(root, "대구 행정동 지도.geojson");
const gridSource = path.join(root, "그리드별 시간대별 유동인구.geojson");
const adminOutput = path.join(root, "data", "daegu-admin-boundaries.js");
const gridOutput = path.join(root, "data", "daegu-grid-flow.js");

const GRID_BREAKS = [0, 500, 1000, 2000, 4000, 8000, 12000];

function readJson(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`Missing source file: ${filePath}`);
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function roundPoint(point) {
  return [Math.round(point[0] * 100) / 100, Math.round(point[1] * 100) / 100];
}

function normalizeGeometry(geometry) {
  return geometry.coordinates.map((polygon) => polygon.map((ring) => ring.map(roundPoint)));
}

function updateBounds(bounds, point) {
  bounds[0] = Math.min(bounds[0], point[0]);
  bounds[1] = Math.min(bounds[1], point[1]);
  bounds[2] = Math.max(bounds[2], point[0]);
  bounds[3] = Math.max(bounds[3], point[1]);
}

function scanBounds(features) {
  const bounds = [Infinity, Infinity, -Infinity, -Infinity];
  const walk = (value) => {
    if (Array.isArray(value) && typeof value[0] === "number") {
      updateBounds(bounds, value);
      return;
    }
    if (Array.isArray(value)) value.forEach(walk);
  };
  for (const feature of features) walk(feature.geometry.coordinates);
  return bounds.map((value) => Math.round(value * 100) / 100);
}

function ringArea(ring) {
  let area = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    area += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return Math.abs(area / 2);
}

function centroidFromGeometry(polygons) {
  let selected = polygons[0][0];
  let selectedArea = -1;

  for (const polygon of polygons) {
    const area = ringArea(polygon[0]);
    if (area > selectedArea) {
      selected = polygon[0];
      selectedArea = area;
    }
  }

  let twiceArea = 0;
  let x = 0;
  let y = 0;

  for (let i = 0; i < selected.length - 1; i += 1) {
    const cross = selected[i][0] * selected[i + 1][1] - selected[i + 1][0] * selected[i][1];
    twiceArea += cross;
    x += (selected[i][0] + selected[i + 1][0]) * cross;
    y += (selected[i][1] + selected[i + 1][1]) * cross;
  }

  if (!twiceArea) return selected[0];
  return roundPoint([x / (3 * twiceArea), y / (3 * twiceArea)]);
}

function buildAdminData() {
  const geojson = readJson(adminSource);
  const features = geojson.features.map((feature) => {
    const polygons = normalizeGeometry(feature.geometry);
    return {
      code: feature.properties.ADM_CD,
      name: feature.properties.ADM_NM,
      centroid: centroidFromGeometry(polygons),
      polygons,
    };
  });

  return {
    source: path.basename(adminSource),
    crs: geojson.crs?.properties?.name || "",
    bounds: scanBounds(geojson.features),
    featureCount: features.length,
    features,
  };
}

function buildGridData() {
  const geojson = readJson(gridSource);
  const keys = Object.keys(geojson.features[0].properties);
  const hourlyColumns = keys
    .map((key) => {
      const match = key.match(/_(\d{2})시$/);
      return match ? { key, hour: match[1] } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.hour.localeCompare(b.hour));

  if (hourlyColumns.length !== 24) {
    throw new Error(`Expected 24 hourly columns, found ${hourlyColumns.length}.`);
  }

  const globalStats = {
    min: Infinity,
    max: -Infinity,
    totalByHour: Object.fromEntries(hourlyColumns.map(({ hour }) => [hour, 0])),
    maxByHour: Object.fromEntries(hourlyColumns.map(({ hour }) => [hour, 0])),
  };

  const features = geojson.features.map((feature, index) => {
    const values = {};
    for (const { key, hour } of hourlyColumns) {
      const value = Number(feature.properties[key] || 0);
      values[hour] = value;
      globalStats.min = Math.min(globalStats.min, value);
      globalStats.max = Math.max(globalStats.max, value);
      globalStats.totalByHour[hour] += value;
      globalStats.maxByHour[hour] = Math.max(globalStats.maxByHour[hour], value);
    }

    const polygons = normalizeGeometry(feature.geometry);
    return {
      id: index + 1,
      centroid: centroidFromGeometry(polygons),
      polygons,
      values,
    };
  });

  return {
    source: path.basename(gridSource),
    crs: geojson.crs?.properties?.name || "",
    bounds: scanBounds(geojson.features),
    hours: hourlyColumns.map(({ hour }) => hour),
    breaks: GRID_BREAKS,
    colors: ["#fffdf7", "#d9f0e8", "#a8d8c8", "#68b6a0", "#2f8a7d", "#176071", "#0b2f4a"],
    featureCount: features.length,
    stats: globalStats,
    features,
  };
}

const adminData = buildAdminData();
const gridData = buildGridData();

fs.mkdirSync(path.join(root, "data"), { recursive: true });
fs.writeFileSync(adminOutput, `window.DAEGU_ADMIN_BOUNDARIES = ${JSON.stringify(adminData)};\n`, "utf8");
fs.writeFileSync(gridOutput, `window.DAEGU_GRID_FLOW = ${JSON.stringify(gridData)};\n`, "utf8");

console.log(`Wrote ${adminOutput}`);
console.log(`Wrote ${gridOutput}`);
console.log(`Admin features: ${adminData.featureCount}`);
console.log(`Grid features: ${gridData.featureCount}`);
console.log(`Hours: ${gridData.hours.join(", ")}`);
console.log(`Global range: ${gridData.stats.min} - ${gridData.stats.max}`);

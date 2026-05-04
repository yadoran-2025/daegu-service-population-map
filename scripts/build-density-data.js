const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const densitySource = path.join(root, "대구 행정동별 인구밀도.geojson");
const densityOutput = path.join(root, "data", "daegu-density.js");

const DENSITY_BREAKS = [0, 1000, 3000, 6000, 10000, 15000, 20000];
const DENSITY_COLORS = ["#fffdf7", "#e8f3d2", "#b9dda2", "#73ba89", "#2b8a8a", "#2864a6", "#25306f"];

function readJson(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`Missing source file: ${filePath}`);
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function roundPoint(point) {
  return [Math.round(point[0] * 100) / 100, Math.round(point[1] * 100) / 100];
}

function roundNumber(value, digits = 3) {
  const factor = 10 ** digits;
  return Math.round(Number(value || 0) * factor) / factor;
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

const geojson = readJson(densitySource);
const residentPopulationKey = Object.keys(geojson.features[0].properties).find((key) => key.endsWith("_거주자 인구수"));

if (!residentPopulationKey) {
  throw new Error("Cannot find resident population field in density GeoJSON.");
}

const features = geojson.features
  .map((feature) => {
    const properties = feature.properties;
    const polygons = normalizeGeometry(feature.geometry);
    return {
      code: properties.ADM_CD,
      name: properties.ADM_NM,
      centroid: centroidFromGeometry(polygons),
      polygons,
      areaKm2: roundNumber(properties["area-km2"], 3),
      areaM2: Math.round(Number(properties.area_m2 || 0)),
      residentPopulation: Math.round(Number(properties[residentPopulationKey] || 0)),
      density: roundNumber(properties["행정동별 인구밀도"], 3),
    };
  })
  .sort((a, b) => a.code.localeCompare(b.code));

const densityValues = features.map((feature) => feature.density).filter((value) => Number.isFinite(value));
const summary = {
  source: path.basename(densitySource),
  baseDate: geojson.features[0]?.properties.BASE_DATE || "",
  residentPopulationField: residentPopulationKey,
  densityField: "행정동별 인구밀도",
  featureCount: features.length,
  minDensity: Math.min(...densityValues),
  maxDensity: Math.max(...densityValues),
};

const output = {
  source: path.basename(densitySource),
  crs: geojson.crs?.properties?.name || "",
  bounds: scanBounds(geojson.features),
  breaks: DENSITY_BREAKS,
  colors: DENSITY_COLORS,
  summary,
  features,
};

fs.mkdirSync(path.join(root, "data"), { recursive: true });
fs.writeFileSync(densityOutput, `window.DAEGU_DENSITY = ${JSON.stringify(output)};\n`, "utf8");
console.log(`Wrote ${densityOutput}`);
console.log(`Density features: ${features.length}`);
console.log(`Density range: ${summary.minDensity} - ${summary.maxDensity}`);

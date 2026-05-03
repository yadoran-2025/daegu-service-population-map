const fs = require("fs");
const path = require("path");

const preferredSources = ["대구 서비스인구.geojson", "population_08.geojson"];
const sourcePath = preferredSources
  .map((name) => path.join(__dirname, "..", name))
  .find((filePath) => fs.existsSync(filePath));
const outputPath = path.join(__dirname, "..", "data", "daegu-service-population.js");

const DISTRICTS = {
  "22010": "중구",
  "22020": "동구",
  "22030": "서구",
  "22040": "남구",
  "22050": "북구",
  "22060": "수성구",
  "22070": "달서구",
  "22310": "달성군",
  "22510": "군위군",
};

if (!sourcePath) {
  throw new Error(`Cannot find a source GeoJSON. Tried: ${preferredSources.join(", ")}`);
}

const tolerance = Number(process.argv[2] || 35);
const geojson = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
const sampleKeys = Object.keys(geojson.features[0].properties);
const hourlyColumns = sampleKeys
  .map((key) => {
    const match = key.match(/시간대별_(\d{2})시$/);
    return match ? { key, hour: match[1] } : null;
  })
  .filter(Boolean)
  .sort((a, b) => a.hour.localeCompare(b.hour));
const hourKey = sampleKeys.find((key) => key.endsWith("_hour"));
const populationKey = sampleKeys.find((key) => key.endsWith("_service_population"));

if (!hourlyColumns.length && (!hourKey || !populationKey)) {
  throw new Error("Cannot find service population fields in the GeoJSON properties.");
}

function sqSegmentDistance(point, start, end) {
  let x = start[0];
  let y = start[1];
  let dx = end[0] - x;
  let dy = end[1] - y;

  if (dx || dy) {
    const t = ((point[0] - x) * dx + (point[1] - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) {
      x = end[0];
      y = end[1];
    } else if (t > 0) {
      x += dx * t;
      y += dy * t;
    }
  }

  dx = point[0] - x;
  dy = point[1] - y;
  return dx * dx + dy * dy;
}

function simplifyDouglasPeucker(points, sqTolerance) {
  const last = points.length - 1;
  const markers = new Uint8Array(points.length);
  const stack = [[0, last]];
  markers[0] = 1;
  markers[last] = 1;

  while (stack.length) {
    const [first, end] = stack.pop();
    let maxSqDistance = sqTolerance;
    let index = 0;

    for (let i = first + 1; i < end; i += 1) {
      const sqDistance = sqSegmentDistance(points[i], points[first], points[end]);
      if (sqDistance > maxSqDistance) {
        index = i;
        maxSqDistance = sqDistance;
      }
    }

    if (index) {
      if (index - first > 1) stack.push([first, index]);
      markers[index] = 1;
      if (end - index > 1) stack.push([index, end]);
    }
  }

  return points.filter((_, index) => markers[index]);
}

function simplifyRing(ring) {
  if (ring.length <= 5) return ring.map(roundPoint);
  const openRing = ring.slice(0, -1);
  const simplified = simplifyDouglasPeucker(openRing, tolerance * tolerance).map(roundPoint);
  if (simplified.length < 3) return ring.map(roundPoint);
  simplified.push(simplified[0]);
  return simplified;
}

function roundPoint(point) {
  return [Math.round(point[0]), Math.round(point[1])];
}

function updateBounds(bounds, point) {
  bounds[0] = Math.min(bounds[0], point[0]);
  bounds[1] = Math.min(bounds[1], point[1]);
  bounds[2] = Math.max(bounds[2], point[0]);
  bounds[3] = Math.max(bounds[3], point[1]);
}

function polygonArea(ring) {
  let area = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    area += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return Math.abs(area / 2);
}

function centroidFromGeometry(polygons) {
  let selected = polygons[0][0];
  let selectedArea = 0;

  for (const polygon of polygons) {
    const area = polygonArea(polygon[0]);
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

const featuresByCode = new Map();
const hours = new Set();
const bounds = [Infinity, Infinity, -Infinity, -Infinity];

for (const feature of geojson.features) {
  const properties = feature.properties;
  if (!properties.ADM_CD.startsWith("22")) continue;

  const polygons = feature.geometry.coordinates.map((polygon) =>
    polygon
      .map(simplifyRing)
      .filter((ring) => ring.length >= 4)
  );

  for (const polygon of polygons) {
    for (const ring of polygon) {
      for (const point of ring) updateBounds(bounds, point);
    }
  }

  const code = properties.ADM_CD;
  const existing = featuresByCode.get(code);
  const entry =
    existing ||
    {
      code,
      name: properties.ADM_NM,
      district: DISTRICTS[code.slice(0, 5)] || "대구",
      centroid: centroidFromGeometry(polygons),
      polygons,
      populations: {},
    };

  if (hourlyColumns.length) {
    for (const column of hourlyColumns) {
      const population = properties[column.key];
      if (population !== null && population !== undefined) {
        entry.populations[column.hour] = Number(population);
        hours.add(column.hour);
      }
    }
  } else {
    const hour = properties[hourKey];
    const population = properties[populationKey];
    if (hour !== null && population !== null) {
      const hourString = String(hour).padStart(2, "0");
      entry.populations[hourString] = Number(population);
      hours.add(hourString);
    }
  }

  featuresByCode.set(code, entry);
}

const features = [...featuresByCode.values()].sort((a, b) => a.code.localeCompare(b.code));
const availableHours = [...hours].sort();
const populatedValues = features.flatMap((feature) => Object.values(feature.populations));
const summary = {
  source: path.basename(sourcePath),
  baseDate: geojson.features.find((feature) => feature.properties.ADM_CD.startsWith("22"))?.properties.BASE_DATE || "",
  hourFields: hourlyColumns.length ? hourlyColumns.map((column) => column.key) : [hourKey],
  populationField: populationKey || "시간대별_00시~23시",
  featureCount: features.length,
  populatedFeatureCount: features.filter((feature) => Object.keys(feature.populations).length).length,
  minPopulation: Math.min(...populatedValues),
  maxPopulation: Math.max(...populatedValues),
  totalPopulation: populatedValues.reduce((sum, value) => sum + value, 0),
  toleranceMeters: tolerance,
};

const output = `window.DAEGU_SERVICE_POPULATION = ${JSON.stringify(
  { bounds, hours: availableHours, summary, features },
  null,
  2
)};\n`;

fs.writeFileSync(outputPath, output, "utf8");
console.log(`Wrote ${outputPath}`);
console.log(`${features.length} Daegu features, ${availableHours.length} hour(s): ${availableHours.join(", ")}`);

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const lineSource = path.join(root, "대구 지하철 노선.geojson");
const stationSource = path.join(root, "대구 지하철정거장.geojson");
const outputPath = path.join(root, "data", "daegu-subway.js");

const LINE_COLORS = {
  S2701: "#D93F2F",
  S2702: "#1F9D55",
  S2703: "#F2A51A",
};

const LINE_NAMES = {
  S2701: "1호선",
  S2702: "2호선",
  S2703: "3호선",
};

const WGS84_A = 6378137;
const WGS84_F = 1 / 298.257222101;
const K0 = 1;
const LAT0 = degreesToRadians(38);
const LON0 = degreesToRadians(127);
const FALSE_EASTING = 200000;
const FALSE_NORTHING = 600000;

function degreesToRadians(value) {
  return (value * Math.PI) / 180;
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function projectToEpsg5186([lon, lat]) {
  const e2 = 2 * WGS84_F - WGS84_F * WGS84_F;
  const ep2 = e2 / (1 - e2);
  const n = WGS84_A / Math.sqrt(1 - e2 * Math.sin(degreesToRadians(lat)) ** 2);
  const t = Math.tan(degreesToRadians(lat)) ** 2;
  const c = ep2 * Math.cos(degreesToRadians(lat)) ** 2;
  const a = Math.cos(degreesToRadians(lat)) * (degreesToRadians(lon) - LON0);

  const m = meridionalArc(degreesToRadians(lat), e2);
  const m0 = meridionalArc(LAT0, e2);

  const easting =
    FALSE_EASTING +
    K0 *
      n *
      (a +
        ((1 - t + c) * a ** 3) / 6 +
        ((5 - 18 * t + t ** 2 + 72 * c - 58 * ep2) * a ** 5) / 120);
  const northing =
    FALSE_NORTHING +
    K0 *
      (m -
        m0 +
        n *
          Math.tan(degreesToRadians(lat)) *
          ((a ** 2) / 2 +
            ((5 - t + 9 * c + 4 * c ** 2) * a ** 4) / 24 +
            ((61 - 58 * t + t ** 2 + 600 * c - 330 * ep2) * a ** 6) / 720));

  return [round(easting), round(northing)];
}

function meridionalArc(lat, e2) {
  return (
    WGS84_A *
    ((1 - e2 / 4 - (3 * e2 ** 2) / 64 - (5 * e2 ** 3) / 256) * lat -
      ((3 * e2) / 8 + (3 * e2 ** 2) / 32 + (45 * e2 ** 3) / 1024) * Math.sin(2 * lat) +
      ((15 * e2 ** 2) / 256 + (45 * e2 ** 3) / 1024) * Math.sin(4 * lat) -
      ((35 * e2 ** 3) / 3072) * Math.sin(6 * lat))
  );
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function lineIdFromName(value) {
  const name = clean(value);
  if (name.includes("1호선")) return "S2701";
  if (name.includes("2호선")) return "S2702";
  if (name.includes("3호선")) return "S2703";
  return "";
}

function updateBounds(bounds, point) {
  bounds[0] = Math.min(bounds[0], point[0]);
  bounds[1] = Math.min(bounds[1], point[1]);
  bounds[2] = Math.max(bounds[2], point[0]);
  bounds[3] = Math.max(bounds[3], point[1]);
}

const lineGeojson = JSON.parse(fs.readFileSync(lineSource, "utf8"));
const stationGeojson = JSON.parse(fs.readFileSync(stationSource, "utf8"));
const bounds = [Infinity, Infinity, -Infinity, -Infinity];

const lines = lineGeojson.features.map((feature) => {
  const lineId = feature.properties.LINE_ID || lineIdFromName(feature.properties.LINE_NM) || `S27${feature.properties.begin}`;
  const name = LINE_NAMES[lineId] || clean(feature.properties.LINE_NM).replace("대구 도시철도 ", "");
  const points = feature.geometry.coordinates.map(projectToEpsg5186);
  points.forEach((point) => updateBounds(bounds, point));
  return {
    id: lineId,
    name,
    color: LINE_COLORS[lineId] || "#176071",
    points,
  };
});

const stations = stationGeojson.features.map((feature) => {
  const point = projectToEpsg5186(feature.geometry.coordinates);
  updateBounds(bounds, point);
  const lineId = feature.properties.LINE_ID;
  return {
    id: feature.properties.STN_ID,
    name: clean(feature.properties.STN_KOR),
    englishName: clean(feature.properties.STN_EN),
    lineId,
    lineName: LINE_NAMES[lineId] || clean(feature.properties.LINE_NM).replace("대구 도시철도 ", ""),
    color: LINE_COLORS[lineId] || "#176071",
    transfer: clean(feature.properties.TRSF_TYPE) === "환승역",
    point,
  };
});

const output = {
  source: {
    lines: path.basename(lineSource),
    stations: path.basename(stationSource),
  },
  crs: "EPSG:5186",
  bounds: bounds.map(round),
  lineCount: lines.length,
  stationCount: stations.length,
  lines,
  stations,
};

fs.writeFileSync(outputPath, `window.DAEGU_SUBWAY = ${JSON.stringify(output)};\n`, "utf8");
console.log(`Wrote ${outputPath}`);
console.log(`Subway lines: ${lines.length}, stations: ${stations.length}`);

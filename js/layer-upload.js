// js/layer-upload.js
// ES module that parses uploads (SHP .zip, KML/KMZ, GeoJSON), normalizes to GeoJSON,
// renders on Leaflet, dispatches "mnet:dataset", and ingests to Supabase if logged in.

import { ensureDataset, ensureLayer, ingestFeatureCollection } from "./db-ingest.js";

// ====== Utilities ======

const ACCEPTED = /\.(zip|kml|kmz|geojson|json)$/i;

function readAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = reject;
    fr.readAsArrayBuffer(file);
  });
}

function readAsText(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = reject;
    fr.readAsText(file);
  });
}

function filenameStem(name) {
  return (name || "dataset").replace(/\.(zip|kml|kmz|geojson|json)$/i, "");
}

/** Ensure we return a proper GeoJSON FeatureCollection */
function toFeatureCollection(geojson) {
  if (!geojson) return null;
  if (geojson.type === "FeatureCollection") return geojson;

  if (geojson.type === "Feature") {
    return { type: "FeatureCollection", features: [geojson] };
  }
  // Geometry only -> wrap into a single feature
  if (geojson.type && geojson.coordinates) {
    return { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: geojson }] };
  }

  // Some libs return arrays of features
  if (Array.isArray(geojson)) {
    if (geojson.length && geojson[0]?.type === "Feature") {
      return { type: "FeatureCollection", features: geojson };
    }
  }
  return null;
}

/** Optionally flatten GeometryCollections (keep simple) */
function normalizeFeatureCollection(fc) {
  if (!fc || fc.type !== "FeatureCollection") return fc;
  const out = [];
  for (const f of fc.features || []) {
    if (!f || !f.geometry) continue;
    if (f.geometry.type === "GeometryCollection" && Array.isArray(f.geometry.geometries)) {
      for (const g of f.geometry.geometries) {
        out.push({ type: "Feature", properties: { ...(f.properties || {}) }, geometry: g });
      }
    } else {
      out.push(f);
    }
  }
  return { type: "FeatureCollection", features: out };
}

/** Dynamic loader for JSZip (only when KMZ is uploaded) */
async function ensureJSZip() {
  if (window.JSZip) return window.JSZip;
  await new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js";
    s.onload = res;
    s.onerror = () => rej(new Error("Failed to load JSZip for KMZ parsing."));
    document.head.appendChild(s);
  });
  return window.JSZip;
}

// ====== Parsers for each file type ======

async function parseZipShapefile(file) {
  // relies on global shpjs loaded by your HTML
  const ab = await readAsArrayBuffer(file);
  // shp.parseZip returns a FeatureCollection or array; we'll normalize
  // @ts-ignore
  const gj = await shp.parseZip(ab);
  return toFeatureCollection(gj);
}

async function parseKML(file) {
  const text = await readAsText(file);
  const xml = new DOMParser().parseFromString(text, "application/xml");
  // togeojson global from your HTML
  // @ts-ignore
  const gj = toGeoJSON.kml(xml);
  return toFeatureCollection(gj);
}

async function parseKMZ(file) {
  const JSZip = await ensureJSZip();
  const ab = await readAsArrayBuffer(file);
  const zip = await JSZip.loadAsync(ab);
  // find the first .kml in the kmz
  let kmlFile = null;
  zip.forEach((path, entry) => {
    if (!kmlFile && /\.kml$/i.test(path)) kmlFile = entry;
  });
  if (!kmlFile) throw new Error("No KML file found inside KMZ.");
  const kmlText = await kmlFile.async("text");
  const xml = new DOMParser().parseFromString(kmlText, "application/xml");
  // @ts-ignore
  const gj = toGeoJSON.kml(xml);
  return toFeatureCollection(gj);
}

async function parseGeoJSON(file) {
  const text = await readAsText(file);
  const gj = JSON.parse(text);
  return toFeatureCollection(gj);
}

// ====== Renderer ======

function renderGeoJSONOnMap(fc) {
  if (!window.map || !window.L) throw new Error("Leaflet map not ready.");

  // Remove previous "last uploaded" layer if present (avoid stacking temp layers)
  if (window._lastUploadedLayer) {
    try { window.map.removeLayer(window._lastUploadedLayer); } catch {}
    window._lastUploadedLayer = null;
  }

  const layer = L.geoJSON(fc, {
    style: { color: "#1f3763", weight: 2, opacity: 0.85, fillOpacity: 0.15 }
  }).addTo(window.map);

  // 👇 keep a handle so auto-open-all can clear/replace it later
  window._lastUploadedLayer = layer;

  try {
    const b = layer.getBounds();
    if (b.isValid && b.isValid()) window.map.fitBounds(b, { padding: [20, 20] });
  } catch {}
  return layer;
}

// ====== Main handler ======

async function handleFile(file) {
  if (!file) return;
  if (!ACCEPTED.test(file.name)) {
    alert("Unsupported file type. Please upload .zip (SHP), .kml/.kmz, or .geojson/.json");
    return;
  }

  let fc = null;
  const stem = filenameStem(file.name);

  try {
    if (/\.zip$/i.test(file.name)) {
      fc = await parseZipShapefile(file);
    } else if (/\.kml$/i.test(file.name)) {
      fc = await parseKML(file);
    } else if (/\.kmz$/i.test(file.name)) {
      fc = await parseKMZ(file);
    } else {
      fc = await parseGeoJSON(file);
    }
  } catch (e) {
    console.error("[upload] parse failed:", e);
    alert("Failed to parse the uploaded file.\n" + (e?.message || e));
    return;
  }

  if (!fc || !fc.features || !fc.features.length) {
    alert("No features found in the uploaded file.");
    return;
  }

  // Normalize (flatten GeometryCollections)
  const normalised = normalizeFeatureCollection(fc);

  // 1) Draw on Leaflet
  renderGeoJSONOnMap(normalised);

  // 2) Let the rest of the app know (keeps anonymous local save behavior in data-bridge.js)
  try {
    window.dispatchEvent(new CustomEvent("mnet:dataset", {
      detail: { name: stem, geojson: normalised, sourceFilename: file.name }
    }));
  } catch (e) {
    console.warn("mnet:dataset dispatch failed:", e);
  }

  // 3) Persist to DB if logged in (dataset → layer → RPC ingest)
  try {
    const ds = await ensureDataset(stem, file.name);
    if (ds) {
      const ly = await ensureLayer(ds.id, "uploaded");
      const inserted = await ingestFeatureCollection(ds.id, ly?.id ?? null, normalised, { chunkSize: 1000 });
      console.log(`[DB] Inserted ${inserted} features into dataset "${ds.name}"`);
    }
  } catch (e) {
    // Do not block UX; map already shows data and local save happened
    console.error("DB ingest failed:", e);
  }
}

// ====== Wire up file input ======

function bindFileInput() {
  const input = document.getElementById("layerFileInput");
  if (!input) {
    console.warn("#layerFileInput not found in DOM.");
    return;
  }
  input.addEventListener("change", async (ev) => {
    const file = ev.target?.files?.[0];
    if (!file) return;
    await handleFile(file);
    // reset so selecting the same file again will trigger change
    ev.target.value = "";
  });
}

document.addEventListener("DOMContentLoaded", bindFileInput);

// Optional: expose for drag&drop or programmatic calls
export async function handleGeoJSONUploadObject(geojson, name = "dataset") {
  const fc = toFeatureCollection(geojson);
  if (!fc) throw new Error("Invalid GeoJSON");
  const normalised = normalizeFeatureCollection(fc);
  renderGeoJSONOnMap(normalised);
  try {
    window.dispatchEvent(new CustomEvent("mnet:dataset", {
      detail: { name, geojson: normalised, sourceFilename: name + ".geojson" }
    }));
  } catch {}
  try {
    const ds = await ensureDataset(name, name + ".geojson");
    if (ds) {
      const ly = await ensureLayer(ds.id, "uploaded");
      const inserted = await ingestFeatureCollection(ds.id, ly?.id ?? null, normalised, { chunkSize: 1000 });
      console.log(`[DB] Inserted ${inserted} features into dataset "${ds.name}"`);
    }
  } catch (e) {
    console.error("DB ingest failed:", e);
  }
}

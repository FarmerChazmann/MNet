// js/layer-upload.js
// ES module that parses uploads (SHP .zip, KML/KMZ, GeoJSON), normalizes to GeoJSON,
// renders on Leaflet, dispatches "mnet:dataset", and ingests to Supabase if logged in.

import { supabase } from "./auth.js";
import { ensureDataset, ensureLayer, ingestFeatureCollection } from "./db-ingest.js";

// ====== Utilities ======

const ACCEPTED = /\.(zip|kml|kmz|geojson|json)$/i;

const MATCH_PROPERTY_GROUPS = [
  ["grower", "Grower", "grower_name", "Grower Name", "growerName", "GrowerName"],
  ["farm", "Farm", "farm_name", "Farm Name", "farmName", "FarmName", "property", "Property"],
  ["field", "Field", "field_name", "Field Name", "fieldName", "FieldName", "block", "Block", "paddock", "Paddock"],
];
const FALLBACK_PROPERTIES = ["name", "Name", "title", "Title", "id", "ID", "identifier", "Identifier"];
const MIN_SIGNATURE_PARTS = 2;
const MIN_MATCH_OVERLAP = 3;
const MIN_MATCH_SCORE = 0.58;

let datasetFingerprintCache = null;

const normaliseName = (value) =>
  typeof value === "string" ? value.replace(/[^a-z0-9]/gi, "").toLowerCase() : "";

const normalisePropValue = (value) => {
  if (value === null || value === undefined) return "";
  const str = String(value).trim();
  return str ? str.toLowerCase() : "";
};

function extractFirstMatch(props, candidates) {
  for (const key of candidates) {
    if (Object.prototype.hasOwnProperty.call(props, key)) {
      const normalised = normalisePropValue(props[key]);
      if (normalised) return normalised;
    }
  }
  return "";
}

function buildFeatureKey(feature) {
  if (!feature || typeof feature !== "object") return null;
  const props = feature.properties || {};
  const parts = [];
  MATCH_PROPERTY_GROUPS.forEach((group, index) => {
    const value = extractFirstMatch(props, group);
    if (value) parts.push(`${index}:${value}`);
  });

  if (parts.length >= MIN_SIGNATURE_PARTS) {
    return parts.join("|");
  }

  if (parts.length && FALLBACK_PROPERTIES.length) {
    const fallback = extractFirstMatch(props, FALLBACK_PROPERTIES);
    if (fallback) {
      return `${parts.join("|")}|fb:${fallback}`;
    }
  } else {
    const fallbackOnly = extractFirstMatch(props, FALLBACK_PROPERTIES);
    if (fallbackOnly) {
      return `fb:${fallbackOnly}`;
    }
  }

  return null;
}

function buildSignature(featureCollection) {
  const signature = new Set();
  if (!featureCollection || featureCollection.type !== "FeatureCollection") return signature;
  const features = Array.isArray(featureCollection.features) ? featureCollection.features : [];
  for (const feature of features) {
    const key = buildFeatureKey(feature);
    if (key) signature.add(key);
  }
  return signature;
}

function parseFeatureCollection(value) {
  if (!value) return null;
  if (value.type === "FeatureCollection") return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed?.type === "FeatureCollection" ? parsed : null;
    } catch (err) {
      console.warn("[upload] Failed to parse stored geojson for matching:", err);
      return null;
    }
  }
  return null;
}

async function loadDatasetFingerprintCache() {
  if (datasetFingerprintCache) return datasetFingerprintCache;

  const { data: userData } = await supabase.auth.getUser();
  if (!userData?.user) {
    datasetFingerprintCache = [];
    return datasetFingerprintCache;
  }

  try {
    const { data, error } = await supabase
      .from("datasets")
      .select("id,name,geojson,source_filename,updated_at")
      .order("updated_at", { ascending: false })
      .limit(200);
    if (error) throw error;
    datasetFingerprintCache = (data || []).map((row) => {
      const fc = parseFeatureCollection(row.geojson);
      return {
        id: row.id,
        name: row.name || row.source_filename || "",
        signature: buildSignature(fc),
        featureCount: fc?.features?.length ?? 0,
      };
    });
  } catch (err) {
    console.warn("[upload] Failed to load dataset fingerprints:", err);
    datasetFingerprintCache = [];
  }

  return datasetFingerprintCache;
}

function invalidateDatasetFingerprintCache() {
  datasetFingerprintCache = null;
}

const countIntersection = (aSet, bSet) => {
  if (!aSet || !bSet || !aSet.size || !bSet.size) return 0;
  let count = 0;
  for (const value of aSet) {
    if (bSet.has(value)) count++;
  }
  return count;
};

async function findMatchingDataset(featureCollection, fallbackName) {
  const signature = buildSignature(featureCollection);
  if (!signature.size) return null;

  const datasets = await loadDatasetFingerprintCache();
  if (!datasets.length) return null;

  const fallbackNormalised = normaliseName(fallbackName);
  if (fallbackNormalised) {
    const byName = datasets.find((d) => normaliseName(d.name) === fallbackNormalised);
    if (byName) {
      return { ...byName, matchReason: "name" };
    }
  }

  let best = null;
  let bestScore = 0;

  for (const dataset of datasets) {
    const datasetSignature = dataset.signature;
    if (!datasetSignature || !datasetSignature.size) continue;
    const overlap = countIntersection(signature, datasetSignature);
    if (!overlap) continue;
    const precision = overlap / signature.size;
    const recall = overlap / datasetSignature.size;
    const score = (precision + recall) / 2;
    if (score > bestScore && (overlap >= MIN_MATCH_OVERLAP || score >= MIN_MATCH_SCORE)) {
      best = {
        ...dataset,
        matchReason: "attributes",
        precision,
        recall,
        overlap,
        score,
      };
      bestScore = score;
    }
  }

  return best;
}

const progressRefs = {
  container: null,
  label: null,
  count: null,
  fill: null,
};

let progressHideTimer = null;

function ensureProgressRefs() {
  if (!progressRefs.container) {
    progressRefs.container = document.getElementById("upload-progress");
    progressRefs.label = document.getElementById("upload-progress-label");
    progressRefs.count = document.getElementById("upload-progress-count");
    progressRefs.fill = document.getElementById("upload-progress-fill");
  }
  return progressRefs.container ? progressRefs : null;
}

function showUploadProgress(total) {
  const refs = ensureProgressRefs();
  if (!refs || !total) return;
  if (progressHideTimer) {
    clearTimeout(progressHideTimer);
    progressHideTimer = null;
  }
  refs.container.classList.add("visible");
  refs.fill.style.width = "0%";
  const label = total === 1 ? "Uploading 1 file..." : `Uploading ${total} files...`;
  refs.label.textContent = label;
  refs.count.textContent = `Cloud stored: 0/${total}`;
}

function updateUploadProgress(completed, total, cloudStored) {
  const refs = ensureProgressRefs();
  if (!refs || !total) return;
  const percent = Math.min(100, Math.round((completed / total) * 100));
  refs.fill.style.width = `${percent}%`;
  const labelWord = total === 1 ? "file" : "files";
  refs.label.textContent = `Processed ${completed} of ${total} ${labelWord}`;
  refs.count.textContent = `Cloud stored: ${cloudStored}/${total}`;
}

function hideUploadProgress(delayMs = 600) {
  const refs = ensureProgressRefs();
  if (!refs) return;
  if (progressHideTimer) {
    clearTimeout(progressHideTimer);
  }
  progressHideTimer = setTimeout(() => {
    refs.container.classList.remove("visible");
    refs.fill.style.width = "0%";
    progressHideTimer = null;
  }, delayMs);
}

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

  // keep a handle so auto-open-all can clear/replace it later
  window._lastUploadedLayer = layer;

  try {
    const b = layer.getBounds();
    if (b.isValid && b.isValid()) window.map.fitBounds(b, { padding: [20, 20] });
  } catch {}
  return layer;
}

// ====== Main handler ======

async function handleFile(file) {
  if (!file) {
    return { success: false, cloudStored: false, features: 0, name: null };
  }
  if (!ACCEPTED.test(file.name)) {
    alert("Unsupported file type. Please upload .zip (SHP), .kml/.kmz, or .geojson/.json");
    return { success: false, cloudStored: false, features: 0, name: file.name };
  }

  let fc = null;
  const stem = filenameStem(file.name);
  const result = {
    success: false,
    cloudStored: false,
    features: 0,
    datasetName: stem,
    updatedExisting: false,
    matchReason: null,
    datasetId: null,
  };

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
    return result;
  }

  if (!fc || !fc.features || !fc.features.length) {
    alert("No features found in the uploaded file.");
    return result;
  }

  // Normalize (flatten GeometryCollections)
  const normalised = normalizeFeatureCollection(fc);
  result.features = normalised?.features?.length || 0;

  let matchedDataset = null;
  try {
    matchedDataset = await findMatchingDataset(normalised, stem);
    if (matchedDataset?.name) {
      result.datasetName = matchedDataset.name;
      result.updatedExisting = true;
      result.matchReason = matchedDataset.matchReason || "attributes";
      result.datasetId = matchedDataset.id ?? null;
      console.info(
        `[upload] Matched dataset "${matchedDataset.name}" using ${matchedDataset.matchReason || "attributes"}`
      );
    }
  } catch (matchErr) {
    console.warn("[upload] dataset matching skipped:", matchErr);
  }

  const datasetNameForSave = result.datasetName || stem;

  // 1) Draw on Leaflet
  try {
    renderGeoJSONOnMap(normalised);
  } catch (err) {
    console.error("Failed to draw GeoJSON on the map:", err);
    alert("We parsed the file but could not draw it on the map. Check the console for details.");
    return result;
  }

  // 2) Let the rest of the app know (keeps anonymous local save behavior in data-bridge.js)
  try {
    window.dispatchEvent(new CustomEvent("mnet:dataset", {
      detail: {
        name: datasetNameForSave,
        geojson: normalised,
        sourceFilename: file.name,
        matchedDatasetId: matchedDataset?.id ?? null,
        matchReason: matchedDataset?.matchReason ?? null,
      }
    }));
  } catch (e) {
    console.warn("mnet:dataset dispatch failed:", e);
  }

  // 3) Persist to DB if logged in (dataset -> layer -> RPC ingest)
  try {
    const ds = await ensureDataset(datasetNameForSave, file.name);
    if (ds) {
      result.datasetId = ds.id ?? result.datasetId;
      if (!result.datasetName) {
        result.datasetName = ds.name || datasetNameForSave;
      }
      if (!matchedDataset || (matchedDataset.id && matchedDataset.id === ds.id)) {
        result.updatedExisting = Boolean(matchedDataset);
      } else {
        result.updatedExisting = false;
      }

      const ly = await ensureLayer(ds.id, "uploaded");
      const inserted = await ingestFeatureCollection(ds.id, ly?.id ?? null, normalised);
      console.log(`[DB] Inserted ${inserted} features into dataset "${ds.name}"`);
      result.cloudStored = true;
      invalidateDatasetFingerprintCache();
    }
  } catch (e) {
    // Do not block UX; map already shows data and local save happened
    console.error("DB ingest failed:", e);
  }

  result.success = true;
  return result;
}

async function processFiles(files) {
  const total = files.length;
  if (!total) return;

  showUploadProgress(total);
  let processed = 0;
  let stored = 0;
  let successful = 0;
  const updatedNames = new Set();
  const createdNames = new Set();

  for (const file of files) {
    updateUploadProgress(processed, total, stored);
    let res;
    try {
      res = await handleFile(file);
    } catch (err) {
      console.error("Unexpected error handling upload:", err);
      res = { success: false, cloudStored: false };
    }
    processed += 1;
    if (res?.cloudStored) stored += 1;
    if (res?.success) {
      successful += 1;
      const datasetName = res?.datasetName || filenameStem(file.name);
      if (res?.updatedExisting) {
        if (datasetName) updatedNames.add(datasetName);
      } else if (datasetName) {
        createdNames.add(datasetName);
      }
    }
    updateUploadProgress(processed, total, stored);
  }

  hideUploadProgress();

  if (typeof window.showDataToast === "function") {
    const parts = [];
    const processedLabel = total === 1 ? "file" : "files";
    parts.push(`Processed ${successful}/${total} ${processedLabel}`);
    parts.push(`Cloud stored ${stored}/${total}`);
    if (updatedNames.size) {
      parts.push(`Updated ${updatedNames.size} dataset${updatedNames.size === 1 ? "" : "s"}`);
    }
    if (createdNames.size) {
      parts.push(`Created ${createdNames.size} new dataset${createdNames.size === 1 ? "" : "s"}`);
    }
    window.showDataToast(parts.join(" | "), 2200);
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
    const files = Array.from(ev.target?.files ?? []).filter(Boolean);
    if (!files.length) return;
    await processFiles(files);
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
  let datasetName = name;
  try {
    const matched = await findMatchingDataset(normalised, name);
    if (matched?.name) {
      datasetName = matched.name;
    }
  } catch (err) {
    console.warn("[upload] dataset matching skipped for programmatic ingest:", err);
  }
  renderGeoJSONOnMap(normalised);
  try {
    window.dispatchEvent(new CustomEvent("mnet:dataset", {
      detail: { name: datasetName, geojson: normalised, sourceFilename: name + ".geojson" }
    }));
  } catch {}
  try {
    const ds = await ensureDataset(datasetName, name + ".geojson");
    if (ds) {
      const ly = await ensureLayer(ds.id, "uploaded");
      const inserted = await ingestFeatureCollection(ds.id, ly?.id ?? null, normalised);
      console.log(`[DB] Inserted ${inserted} features into dataset "${ds.name}"`);
      invalidateDatasetFingerprintCache();
    }
  } catch (e) {
    console.error("DB ingest failed:", e);
  }
}

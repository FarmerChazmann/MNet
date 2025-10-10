// js/layer-upload.js
// ES module that parses uploads (SHP .zip, KML/KMZ, GeoJSON), normalizes to GeoJSON,
// renders on Leaflet, dispatches "mnet:dataset", and ingests to Supabase if logged in.

import { supabase } from "./auth.js";
import { ingestGrowerHierarchy } from "./db-ingest.js";

// ====== Utilities ======

const ACCEPTED = /\.(zip|kml|kmz|geojson|json)$/i;

const progressRefs = {
  container: null,
  label: null,
  count: null,
  fill: null,
};

let progressHideTimer = null;
const ATTRIBUTE_STORAGE_KEY = "mnet:attribute-mapping:v1";
let sessionAttributeMapping = null;

const mapperRefs = {
  container: null,
  form: null,
  remember: null,
  cancel: null,
  apply: null,
  selects: {
    grower: null,
    farm: null,
    field: null,
    crop: null,
  },
  samples: {
    grower: null,
    farm: null,
    field: null,
    crop: null,
  },
};

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

function ensureMapperRefs() {
  if (!mapperRefs.container) {
    mapperRefs.container = document.getElementById("attribute-mapper");
    mapperRefs.form = document.getElementById("attribute-mapper-form");
    mapperRefs.remember = document.getElementById("mapper-remember");
    mapperRefs.cancel = document.getElementById("mapper-cancel");
    mapperRefs.apply = document.getElementById("mapper-apply");
    mapperRefs.selects.grower = document.getElementById("mapper-grower");
    mapperRefs.selects.farm = document.getElementById("mapper-farm");
    mapperRefs.selects.field = document.getElementById("mapper-field");
    mapperRefs.selects.crop = document.getElementById("mapper-crop");
    mapperRefs.samples.grower = document.getElementById("mapper-grower-sample");
    mapperRefs.samples.farm = document.getElementById("mapper-farm-sample");
    mapperRefs.samples.field = document.getElementById("mapper-field-sample");
    mapperRefs.samples.crop = document.getElementById("mapper-crop-sample");
  }
  return mapperRefs.container ? mapperRefs : null;
}

function loadStoredAttributeMapping() {
  try {
    const raw = localStorage.getItem(ATTRIBUTE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && parsed.mapping) {
      return parsed;
    }
  } catch (err) {
    console.warn("[mapper] Failed to load stored mapping:", err);
  }
  return null;
}

function storeAttributeMapping(mapping, remember) {
  try {
    if (mapping && remember) {
      localStorage.setItem(
        ATTRIBUTE_STORAGE_KEY,
        JSON.stringify({ remember: true, mapping })
      );
    } else {
      localStorage.removeItem(ATTRIBUTE_STORAGE_KEY);
    }
  } catch (err) {
    console.warn("[mapper] Failed to store mapping:", err);
  }
}

function mappingIsValid(mapping, stats) {
  if (!mapping) return false;
  const required = ["grower", "farm", "field"];
  return required.every((key) => {
    const source = mapping[key];
    return typeof source === "string" && source && stats.samples[source];
  });
}

function collectPropertyStats(featureCollection, sampleLimit = 200) {
  const samples = {};
  if (!featureCollection || featureCollection.type !== "FeatureCollection") {
    return { keys: [], samples };
  }
  const features = Array.isArray(featureCollection.features) ? featureCollection.features : [];
  for (let i = 0; i < features.length && i < sampleLimit; i++) {
    const props = features[i]?.properties || {};
    Object.entries(props).forEach(([key, value]) => {
      if (value === null || value === undefined) return;
      if (!samples[key]) samples[key] = new Set();
      const current = samples[key];
      if (current.size < 5) current.add(value);
    });
  }
  const keys = Object.keys(samples).sort((a, b) => a.localeCompare(b));
  const flattened = keys.reduce((acc, key) => {
    acc[key] = Array.from(samples[key]);
    return acc;
  }, {});
  return { keys, samples: flattened };
}

function describeSamples(sampleList = []) {
  if (!sampleList.length) return "No sample values";
  const parts = sampleList.slice(0, 3).map((value) => `"${String(value)}"`);
  const more = sampleList.length > parts.length ? "…" : "";
  return `e.g. ${parts.join(", ")}${more}`;
}

function populateSelectWithKeys(select, keys, selectedValue) {
  if (!select) return;
  select.innerHTML = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Select property";
  select.appendChild(placeholder);
  keys.forEach((key) => {
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = key;
    select.appendChild(opt);
  });
  if (selectedValue && keys.includes(selectedValue)) {
    select.value = selectedValue;
  }
}

function updateMapperSamples(refs, stats) {
  const { selects, samples } = refs;
  Object.entries(selects).forEach(([name, select]) => {
    const sampleEl = samples[name];
    if (!sampleEl) return;
    const key = select.value;
    sampleEl.textContent = key ? describeSamples(stats.samples[key]) : "Select a property";
  });
}

function updateMapperApplyState(refs) {
  const { selects, apply } = refs;
  if (!apply) return;
  const requiredSelected =
    selects.grower?.value &&
    selects.farm?.value &&
    selects.field?.value;
  apply.disabled = !requiredSelected;
}

function showAttributeMapperDialog(stats, defaults = {}) {
  const refs = ensureMapperRefs();
  if (!refs) return Promise.resolve(null);
  const { keys } = stats;
  if (!keys.length) {
    alert("This file does not contain any properties to map.");
    return Promise.resolve(null);
  }

  populateSelectWithKeys(refs.selects.grower, keys, defaults.mapping?.grower || "");
  populateSelectWithKeys(refs.selects.farm, keys, defaults.mapping?.farm || "");
  populateSelectWithKeys(refs.selects.field, keys, defaults.mapping?.field || "");
  populateSelectWithKeys(refs.selects.crop, keys, defaults.mapping?.crop || "");

  if (refs.remember) {
    refs.remember.checked = Boolean(defaults.remember);
  }

  const changeHandler = () => {
    updateMapperSamples(refs, stats);
    updateMapperApplyState(refs);
  };

  Object.values(refs.selects).forEach((select) => {
    if (select) select.addEventListener("change", changeHandler);
  });

  updateMapperSamples(refs, stats);
  updateMapperApplyState(refs);

  refs.container.classList.add("visible");

  return new Promise((resolve) => {
    const cleanup = () => {
      refs.container.classList.remove("visible");
      Object.values(refs.selects).forEach((select) => {
        if (select) select.removeEventListener("change", changeHandler);
      });
      refs.form?.removeEventListener("submit", submitHandler);
      refs.cancel?.removeEventListener("click", cancelHandler);
    };

    const cancelHandler = () => {
      cleanup();
      resolve(null);
    };

    const submitHandler = (event) => {
      event.preventDefault();
      const mapping = {
        grower: refs.selects.grower?.value || "",
        farm: refs.selects.farm?.value || "",
        field: refs.selects.field?.value || "",
        crop: refs.selects.crop?.value || "",
      };
      cleanup();
      resolve({
        mapping,
        remember: Boolean(refs.remember?.checked),
      });
    };

    refs.cancel?.addEventListener("click", cancelHandler);
    refs.form?.addEventListener("submit", submitHandler);
  });
}

async function requestAttributeMapping(featureCollection) {
  const stats = collectPropertyStats(featureCollection);
  const stored = loadStoredAttributeMapping();

  if (stored?.remember && mappingIsValid(stored.mapping, stats)) {
    sessionAttributeMapping = stored.mapping;
    return stored.mapping;
  }

  if (mappingIsValid(sessionAttributeMapping, stats)) {
    // Reuse in-session mapping if valid and user already confirmed earlier
    return sessionAttributeMapping;
  }

  const defaultMapping =
    (mappingIsValid(sessionAttributeMapping, stats) && sessionAttributeMapping) ||
    (stored && mappingIsValid(stored.mapping, stats) ? stored.mapping : null);

  const result = await showAttributeMapperDialog(stats, {
    mapping: defaultMapping,
    remember: stored?.remember ?? false,
  });

  if (!result || !mappingIsValid(result.mapping, stats)) {
    return null;
  }

  sessionAttributeMapping = result.mapping;
  storeAttributeMapping(result.mapping, result.remember);
  return result.mapping;
}

function applyMappingToFeatureCollection(featureCollection, mapping) {
  if (!featureCollection || featureCollection.type !== "FeatureCollection") {
    return { collection: featureCollection, dropped: 0 };
  }
  const features = Array.isArray(featureCollection.features) ? featureCollection.features : [];
  const mappedFeatures = [];
  let dropped = 0;

  const assignValue = (props, targetKey, sourceKey) => {
    if (!sourceKey) {
      delete props[targetKey];
      return;
    }
    const raw = props[sourceKey];
    if (raw === null || raw === undefined) {
      delete props[targetKey];
      return;
    }
    const str = String(raw).trim();
    if (!str) {
      delete props[targetKey];
      return;
    }
    props[targetKey] = str;
  };

  for (const feature of features) {
    const props = { ...(feature?.properties || {}) };
    assignValue(props, "grower_name", mapping.grower);
    assignValue(props, "farm_name", mapping.farm);
    assignValue(props, "field_name", mapping.field);
    if (mapping.crop) {
      assignValue(props, "crop_type", mapping.crop);
    }
    const hasAll =
      typeof props.grower_name === "string" && props.grower_name &&
      typeof props.farm_name === "string" && props.farm_name &&
      typeof props.field_name === "string" && props.field_name;
    if (hasAll) {
      mappedFeatures.push({
        ...feature,
        properties: props,
      });
    } else {
      dropped += 1;
    }
  }

  return {
    collection: {
      type: "FeatureCollection",
      features: mappedFeatures,
    },
    dropped,
  };
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

function inferDatasetName(fc, fallback) {
  const defaultName = typeof fallback === "string" && fallback.trim() ? fallback : "dataset";
  if (!fc || fc.type !== "FeatureCollection" || !Array.isArray(fc.features) || !fc.features.length) {
    return defaultName;
  }
  const props = fc.features[0]?.properties || {};
  const candidates = [
    props.grower_name,
    props.Grower,
    props.grower,
    props.client,
    props.farm_name,
    props.Farm,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return defaultName;
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
    ingestSummary: null,
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
  let normalised = normalizeFeatureCollection(fc);

  const mapping = await requestAttributeMapping(normalised);
  if (!mapping) {
    result.cancelled = true;
    return result;
  }

  const { collection: mappedCollection, dropped } = applyMappingToFeatureCollection(normalised, mapping);
  normalised = mappedCollection;

  if (!normalised.features.length) {
    alert("No features contained the selected grower, farm, and field values. Please adjust your mapping and try again.");
    return result;
  }

  if (dropped > 0 && typeof window.showDataToast === "function") {
    window.showDataToast(`Skipped ${dropped} feature${dropped === 1 ? "" : "s"} missing required fields.`, 2400);
  }

  result.features = normalised.features.length;

  const { data: authData } = await supabase.auth.getUser();
  const currentUser = authData?.user ?? null;

  result.datasetName = inferDatasetName(normalised, result.datasetName);

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
      }
    }));
  } catch (e) {
    console.warn("mnet:dataset dispatch failed:", e);
  }

  // 3) Persist to DB if logged in (ingest hierarchy RPC)
  if (currentUser) {
    try {
      const summary = await ingestGrowerHierarchy(normalised, { replaceMissing: true });
      result.cloudStored = true;
      result.ingestSummary = summary;
      console.log(
        "[DB] Ingest summary:",
        {
          growers_inserted: summary?.growers_inserted ?? 0,
          growers_updated: summary?.growers_updated ?? 0,
          farms_inserted: summary?.farms_inserted ?? 0,
          farms_updated: summary?.farms_updated ?? 0,
          fields_inserted: summary?.fields_inserted ?? 0,
          fields_updated: summary?.fields_updated ?? 0,
          fields_removed: summary?.fields_removed ?? 0,
        }
      );
      const updatedCount = Number(summary?.fields_updated ?? 0);
      result.updatedExisting = updatedCount > 0;
    } catch (e) {
      // Do not block UX; map already shows data and local save happened
      console.error("Cloud ingest failed:", e);
    }
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
    if (res?.cancelled) {
      if (typeof window.showDataToast === "function") {
        window.showDataToast("Upload cancelled.", 1500);
      }
      hideUploadProgress(0);
      return;
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
  const datasetName = inferDatasetName(normalised, name);
  renderGeoJSONOnMap(normalised);
  try {
    window.dispatchEvent(new CustomEvent("mnet:dataset", {
      detail: { name: datasetName, geojson: normalised, sourceFilename: `${datasetName}.geojson` }
    }));
  } catch {}
  const { data: authData } = await supabase.auth.getUser();
  if (!authData?.user) return;
  try {
    const summary = await ingestGrowerHierarchy(normalised, { replaceMissing: true });
    console.log("[DB] Ingest summary:", summary);
  } catch (e) {
    console.error("Cloud ingest failed:", e);
    throw e;
  }
}

// js/auto-open-all.js
import { supabase } from "./auth.js";
import { streamGrowerDatasets } from "./data.js";

const toastEl = document.getElementById("data-toast");
let toastTimer = null;
const MNET_DEFAULT_COLOR = "#1aa560";
const MNET_ACTIVE_COLOR = "#2b60f1";

if (typeof window !== "undefined" && typeof window._mnetFilterEnabled === "undefined") {
  window._mnetFilterEnabled = true;
}

function showDataToast(message, duration = 2000) {
  if (!toastEl) return;
  toastEl.textContent = String(message ?? "");
  toastEl.classList.add("show");
  if (toastTimer) clearTimeout(toastTimer);
  const timeout = Math.max(1000, duration);
  toastTimer = setTimeout(() => {
    toastEl.classList.remove("show");
    toastTimer = null;
  }, timeout);
}

window.showDataToast = showDataToast;

/** Add a FeatureCollection to Leaflet and return the created group layer */
function featureIsMNet(feature) {
  const value = feature?.properties?.mnet;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const norm = value.trim().toLowerCase();
    return norm === "yes" || norm === "true" || norm === "1" || norm === "y";
  }
  return false;
}

function styleForFeature(feature) {
  const highlight = Boolean(window._mnetFilterEnabled);
  const isMNet = featureIsMNet(feature);
  if (highlight) {
    return {
      color: isMNet ? MNET_ACTIVE_COLOR : MNET_DEFAULT_COLOR,
      weight: isMNet ? 2.8 : 1.9,
      opacity: isMNet ? 0.96 : 0.85,
      fillOpacity: isMNet ? 0.3 : 0.16,
    };
  }
  return {
    color: MNET_DEFAULT_COLOR,
    weight: 1.9,
    opacity: 0.85,
    fillOpacity: 0.18,
  };
}

window._mnetStyleForFeature = styleForFeature;

function addFC(fc, name) {
  if (!fc || !window.map || !window.L) return null;

  const styleFn = (feature) => styleForFeature(feature);
  const group = L.geoJSON(fc, {
    style: styleFn,
  });
  group._mnetStyleFn = styleFn;

  // light label so you know which dataset is which
  try {
    group.eachLayer(l => l.bindTooltip(name || "dataset", { sticky: true }));
  } catch {}

  group.addTo(window.map);
  return group;
}

/** Remove any prior auto-opened groups to avoid duplicates */
function clearAutoOpened() {
  if (Array.isArray(window._openedDatasetLayers)) {
    try { window._openedDatasetLayers.forEach(g => window.map.removeLayer(g)); } catch {}
  }
  window._openedDatasetLayers = [];
}

function restyleAllLayers() {
  if (!Array.isArray(window._openedDatasetLayers)) return;
  window._openedDatasetLayers.forEach((layer) => {
    try {
      if (layer && typeof layer.setStyle === "function") {
        const styleFn = layer._mnetStyleFn || ((feature) => styleForFeature(feature));
        layer.setStyle(styleFn);
      }
    } catch (err) {
      console.warn("[MNet] failed to restyle layer", err);
    }
  });
}

window.restyleMNetLayers = restyleAllLayers;

const mnetToggleButton = document.getElementById("mnet-toggle");

function updateMNetToggleUI() {
  if (!mnetToggleButton) return;
  const enabled = Boolean(window._mnetFilterEnabled);
  mnetToggleButton.classList.toggle("active", enabled);
  const indicator = mnetToggleButton.querySelector(".pill-indicator");
  if (indicator) indicator.textContent = enabled ? "YES" : "ALL";
}

if (mnetToggleButton) {
  mnetToggleButton.addEventListener("click", () => {
    window._mnetFilterEnabled = !window._mnetFilterEnabled;
    updateMNetToggleUI();
    restyleAllLayers();
    if (typeof showDataToast === "function") {
      if (window._mnetFilterEnabled) {
        showDataToast("MNet highlighting enabled (Yes = blue, No = green)", 2000);
      } else {
        showDataToast("MNet highlighting disabled (all green)", 1600);
      }
    }
  });
  updateMNetToggleUI();
}

window.setMNetFilterEnabled = (value) => {
  window._mnetFilterEnabled = Boolean(value);
  updateMNetToggleUI();
  restyleAllLayers();
};

function normalizeRows(list) {
  return (list || []).map((row) => {
    if (!row) return row;
    if (typeof row.geojson === "string") {
      try {
        row.geojson = JSON.parse(row.geojson);
      } catch (err) {
        console.warn("[openAllDatasets] Failed to parse geojson string for dataset", row.id, err);
        row.geojson = null;
      }
    }
    if (row?.geojson?.type === "FeatureCollection" && Array.isArray(row.geojson.features)) {
      row.featureCount = row.geojson.features.length;
    }
    return row;
  });
}

/** Fetch all datasets (with geojson) for the current user and draw them */
export async function openAllDatasets(options = {}) {
  const {
    fitToBounds = true,
  } = options;

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    if (mnetToggleButton) mnetToggleButton.style.display = "none";
    console.info("[openAllDatasets] no user session; skipping.");
    return { groups: [], source: "anonymous" };
  }

  if (mnetToggleButton) {
    mnetToggleButton.style.display = "inline-flex";
    updateMNetToggleUI();
  }

  // If the uploader drew a temporary layer, clear it (optional)
  if (window._lastUploadedLayer) {
    try { window.map.removeLayer(window._lastUploadedLayer); } catch {}
    window._lastUploadedLayer = null;
  }

  clearAutoOpened();

  let fetchError = null;
  const groups = [];
  let growersLoaded = 0;
  let fieldsLoaded = 0;
  let totalGrowers = 0;

  try {
    const growers = await streamGrowerDatasets(user.id, async ({ grower, datasets, fieldCount, index, total }) => {
      const rows = normalizeRows(datasets);
      const validRows = rows.filter(
        (row) =>
          row &&
          row.geojson &&
          typeof row.geojson === "object" &&
          row.geojson.type === "FeatureCollection" &&
          Array.isArray(row.geojson.features) &&
          row.geojson.features.length
      );

      if (validRows.length) {
        for (const row of validRows) {
          const g = addFC(row.geojson, row.name);
          if (g) groups.push(g);
        }
        window._openedDatasetLayers = groups;
        fieldsLoaded += fieldCount;
      }

      growersLoaded += 1;
      totalGrowers = total;

      if (typeof showDataToast === "function") {
        const mnetLabel = grower?.mnet ? "Yes" : "No";
        const fieldAmount = validRows.length ? fieldCount : 0;
        const prefix = `Loaded ${fieldAmount} field${fieldAmount === 1 ? "" : "s"} for ${grower.grower_name} (MNet: ${mnetLabel})`;
        const suffix = total > 0 ? ` (${growersLoaded}/${total} growers)` : "";
        showDataToast(prefix + suffix, 1800);
      }
    });

    if (!growers || !growers.length) {
      if (fitToBounds && typeof window.resetMapView === "function") {
        window.resetMapView();
      }
      if (typeof showDataToast === "function") {
        showDataToast("No growers found to draw.", 1500);
      }
      return { groups: [], source: "cloud" };
    }

    if (fitToBounds && groups.length && window.map) {
      try {
        const fg = L.featureGroup(groups);
        const bounds = fg.getBounds();
        if (bounds && bounds.isValid && bounds.isValid()) {
          window.map.fitBounds(bounds, { padding: [24, 24] });
        }
      } catch (boundsErr) {
        console.warn("[openAllDatasets] fitBounds failed:", boundsErr);
      }
    }

    if (window.map) {
      setTimeout(() => {
        try { window.map.invalidateSize(); } catch {}
      }, 0);
    }

    if (typeof showDataToast === "function") {
      const growerWord = growersLoaded === 1 ? "grower" : "growers";
      const fieldWord = fieldsLoaded === 1 ? "field" : "fields";
      const totalPart = totalGrowers && totalGrowers !== growersLoaded
        ? ` (${growersLoaded}/${totalGrowers} growers)`
        : "";
      showDataToast(`Loaded ${fieldsLoaded} ${fieldWord} across ${growersLoaded} ${growerWord}${totalPart}`, 2200);
    }

    return { groups, source: "cloud", error: null };
  } catch (err) {
    fetchError = err;
    console.error("[openAllDatasets] select error:", err);
    if (typeof showDataToast === "function") {
      showDataToast("Could not load datasets from the cloud.", 2000);
    }
    return { groups: [], source: "error", error: fetchError };
  }
}

// Auto-run after load (covers refresh with persisted session)
document.addEventListener("DOMContentLoaded", () => {
  setTimeout(() => openAllDatasets({ forceRefresh: true }).catch(console.error), 600);
});

// Expose for debugging
window.openAllDatasets = openAllDatasets;

// js/auto-open-all.js
import { supabase } from "./auth.js";
import { cacheCloudDatasets, loadCachedCloudDatasets } from "./data.js";

/** Add a FeatureCollection to Leaflet and return the created group layer */
function addFC(fc, name) {
  if (!fc || !window.map || !window.L) return null;

  const group = L.geoJSON(fc, {
    style: { color: "#1f3763", weight: 2, opacity: 0.85, fillOpacity: 0.15 }
  });

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
    return row;
  });
}

/** Fetch all datasets (with geojson) for the current user and draw them */
export async function openAllDatasets(options = {}) {
  const {
    forceRefresh = false,
    fitToBounds = true,
    useCacheFallback = true,
  } = options;

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    console.info("[openAllDatasets] no user session; skipping.");
    return { groups: [], source: "anonymous" };
  }

  // If the uploader drew a temporary layer, clear it (optional)
  if (window._lastUploadedLayer) {
    try { window.map.removeLayer(window._lastUploadedLayer); } catch {}
    window._lastUploadedLayer = null;
  }

  clearAutoOpened();

  let rows = [];
  let source = "cloud";

  // Optionally seed from cache first to avoid blank flashes
  if (!forceRefresh && useCacheFallback) {
    rows = normalizeRows(await loadCachedCloudDatasets(user.id));
    if (rows.length) source = "cache";
  }

  let fetchError = null;
  try {
    const { data, error } = await supabase
      .from("datasets")
      .select("id,name,geojson,updated_at")
      .not("geojson", "is", null)
      .order("updated_at", { ascending: false })
      .limit(200);

    if (error) {
      fetchError = error;
      throw error;
    }

    if (Array.isArray(data) && data.length) {
      rows = normalizeRows(data);
      source = "cloud";
      if (useCacheFallback) {
        try {
          await cacheCloudDatasets(user.id, data);
        } catch (cacheErr) {
          console.warn("[openAllDatasets] failed to cache datasets locally:", cacheErr);
        }
      }
    } else if (!rows.length && useCacheFallback) {
      rows = normalizeRows(await loadCachedCloudDatasets(user.id));
      source = rows.length ? "cache" : "empty";
      if (!rows.length) {
        console.info("[openAllDatasets] no datasets found for user.");
      }
    }
  } catch (err) {
    fetchError = err;
    console.error("[openAllDatasets] select error:", err);
    if (!rows.length && useCacheFallback) {
      rows = normalizeRows(await loadCachedCloudDatasets(user.id));
      source = rows.length ? "cache" : "error";
    }
  }

  const validRows = rows.filter(
    (row) =>
      row &&
      row.geojson &&
      typeof row.geojson === "object" &&
      row.geojson.type === "FeatureCollection" &&
      Array.isArray(row.geojson.features) &&
      row.geojson.features.length
  );

  if (!validRows.length) {
    if (fitToBounds && typeof window.resetMapView === "function") {
      window.resetMapView();
    }
    if (rows.length && !fetchError) {
      console.info("[openAllDatasets] datasets retrieved but contained no features.");
    }
    return { groups: [], source, error: fetchError };
  }

  const groups = [];
  for (const row of validRows) {
    const g = addFC(row.geojson, row.name);
    if (g) groups.push(g);
  }
  window._openedDatasetLayers = groups;

  // Fit map to everything
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

  return { groups, source, error: fetchError };
}

// Auto-run after load (covers refresh with persisted session)
document.addEventListener("DOMContentLoaded", () => {
  setTimeout(() => openAllDatasets({ forceRefresh: true }).catch(console.error), 600);
});

// Expose for debugging
window.openAllDatasets = openAllDatasets;

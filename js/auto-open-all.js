// js/auto-open-all.js
import { supabase } from "./auth.js";

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

/** Fetch all datasets (with geojson) for the current user and draw them */
export async function openAllDatasets() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    console.info("[openAllDatasets] no user session; skipping.");
    return;
  }

  // If the uploader drew a temporary layer, clear it (optional)
  if (window._lastUploadedLayer) {
    try { window.map.removeLayer(window._lastUploadedLayer); } catch {}
    window._lastUploadedLayer = null;
  }

  clearAutoOpened();

  const { data, error } = await supabase
    .from("datasets")
    .select("id,name,geojson,updated_at")
    .not("geojson", "is", null)
    .order("updated_at", { ascending: false })
    .limit(200);

  if (error) { console.error("[openAllDatasets] select error:", error); return; }
  if (!data?.length) {
    console.info("[openAllDatasets] no datasets found for user.");
    return;
  }

  const groups = [];
  for (const row of data) {
    const g = addFC(row.geojson, row.name);
    if (g) groups.push(g);
  }
  window._openedDatasetLayers = groups;

  // Fit map to everything
  try {
    const fg = L.featureGroup(groups);
    window.map.fitBounds(fg.getBounds(), { padding: [24, 24] });
  } catch {}
}

// Auto-run after load (covers refresh with persisted session)
document.addEventListener("DOMContentLoaded", () => {
  setTimeout(() => openAllDatasets().catch(console.error), 600);
});

// Expose for debugging
window.openAllDatasets = openAllDatasets;

import { ensureDataset, ensureLayer, ingestFeatureCollection } from "./db-ingest.js";

(function () {
  if (!window.map) {
    console.error('[layer-upload] Leaflet map not found on window.map');
    return;
  }

  const fileInput = document.getElementById('layerFileInput');
  if (!fileInput) {
    console.warn('[layer-upload] Upload input not found; upload feature disabled.');
    return;
  }

  const UPLOAD_PANE = 'upload-pane';
  if (typeof window.ensurePane === 'function') {
    window.ensurePane(UPLOAD_PANE, 440);
  } else if (!map.getPane(UPLOAD_PANE)) {
    map.createPane(UPLOAD_PANE);
    map.getPane(UPLOAD_PANE).style.zIndex = '440';
  }

  const uploadedOverlayLayer = L.layerGroup().addTo(map);

  const defaultVectorStyle = {
    color: '#ff6600',
    weight: 2,
    fillOpacity: 0.25,
    pane: UPLOAD_PANE
  };

  fileInput.addEventListener('change', event => {
    const file = event.target.files && event.target.files[0];
    if (!file) return;

    const name = file.name.toLowerCase();
    const reader = new FileReader();

    const resetInput = () => { fileInput.value = ''; };

    const handleGeoJSON = async (geojson) => {
      const normalised = normaliseGeoJSON(geojson);
      if (!normalised || !normalised.features || !normalised.features.length) {
        alert('No features were found in the uploaded file.');
        return;
      }

      renderGeoJSON(normalised);

      const datasetName = (file.name || 'uploaded').replace(/\.(zip|kml|kmz|geojson|json|shp)$/i, '');

      window.dispatchEvent(new CustomEvent('mnet:dataset', {
        detail: { name: datasetName, geojson: normalised, sourceFilename: file.name }
      }));

      try {
        const dataset = await ensureDataset(datasetName, file.name);
        if (dataset) {
          const layer = await ensureLayer(dataset.id, 'uploaded');
          const inserted = await ingestFeatureCollection(dataset.id, layer?.id ?? null, normalised, { chunkSize: 1000 });
          console.log(`[DB] Inserted ${inserted} features into dataset ${dataset.name}`);
        }
      } catch (error) {
        console.error('DB ingest failed:', error);
      }
    };

    if (name.endsWith('.zip')) {
      reader.onload = e => {
        shp(e.target.result)
          .then(handleGeoJSON)
          .catch(err => {
            console.error('[layer-upload] Error parsing shapefile:', err);
            alert('Unable to read the shapefile. Ensure you uploaded a zipped shapefile containing .shp, .dbf, and .shx.');
          });
      };
      reader.readAsArrayBuffer(file);
    } else if (name.endsWith('.kml')) {
      reader.onload = e => {
        try {
          const dom = new DOMParser().parseFromString(e.target.result, 'text/xml');
          const geojson = toGeoJSON.kml(dom);
          handleGeoJSON(geojson);
        } catch (err) {
          console.error('[layer-upload] Error parsing KML:', err);
          alert('Unable to read the KML file. Please verify the file is valid.');
        }
      };
      reader.readAsText(file);
    } else if (name.endsWith('.geojson') || name.endsWith('.json')) {
      reader.onload = e => {
        try {
          const geojson = JSON.parse(e.target.result);
          handleGeoJSON(geojson);
        } catch (err) {
          console.error('[layer-upload] Error parsing GeoJSON:', err);
          alert('Unable to read the GeoJSON file. Please verify the file contents.');
        }
      };
      reader.readAsText(file);
    } else {
      alert('Unsupported file type. Upload a zipped Shapefile (.zip), KML (.kml), or GeoJSON (.geojson/.json).');
    }

    resetInput();
  });

  function normaliseGeoJSON(data) {
    if (!data) return null;
    if (data.type === 'FeatureCollection') return data;
    if (data.type && data.geometry) {
      return { type: 'FeatureCollection', features: [data] };
    }
    if (Array.isArray(data)) {
      const features = data
        .map(item => normaliseGeoJSON(item))
        .filter(Boolean)
        .flatMap(item => item.features || []);
      return features.length ? { type: 'FeatureCollection', features } : null;
    }
    if (typeof data === 'object') {
      const features = [];
      Object.values(data).forEach(value => {
        const normalised = normaliseGeoJSON(value);
        if (normalised && Array.isArray(normalised.features)) {
          features.push(...normalised.features);
        }
      });
      return features.length ? { type: 'FeatureCollection', features } : null;
    }
    return null;
  }

  function renderGeoJSON(geojson) {
    uploadedOverlayLayer.clearLayers();

    const layer = L.geoJSON(geojson, {
      pane: UPLOAD_PANE,
      style: () => ({
        color: defaultVectorStyle.color,
        weight: defaultVectorStyle.weight,
        fillOpacity: defaultVectorStyle.fillOpacity,
        pane: UPLOAD_PANE
      }),
      pointToLayer: (feature, latlng) => L.circleMarker(latlng, {
        radius: 6,
        color: defaultVectorStyle.color,
        weight: 2,
        fillOpacity: 0.6,
        pane: UPLOAD_PANE
      })
    });

    layer.addTo(uploadedOverlayLayer);

    try {
      const bounds = layer.getBounds();
      if (bounds && bounds.isValid()) {
        map.fitBounds(bounds, { maxZoom: 14, padding: [20, 20] });
      }
    } catch (err) {
      console.warn('[layer-upload] Could not fit bounds for uploaded data:', err);
    }
  }
})();

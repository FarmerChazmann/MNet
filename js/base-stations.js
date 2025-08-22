// === Base Station Simulator Control ===
const baseStationLayer = L.layerGroup().addTo(map);
const ringLayerGroup = L.layerGroup().addTo(map);

const antennaIcon = L.icon({
  iconUrl: 'antena.png',
  iconSize: [32, 32],
  iconAnchor: [16, 32],
  popupAnchor: [0, -32]
});

const dotOptions = {
  radius: 6,
  color: "#007bff",
  fillColor: "#fff",
  fillOpacity: 1,
  weight: 2
};

const stations = [];

// === Coverage Button State Logic ===
// 0 = empty, 1=5km, 2=10km, 3=15km, 4=20km, 5=25km, 6=30km, 7=40km, 8=simulation, -> 0
let coverageState = 7; // default to 40km on load
const coverageSteps = [0, 5, 10, 15, 20, 25, 30, 40]; // km
const RING_COLOR = "#3366cc";
const RING_FILL = "#3366cc";
const RING_FILL_OPACITY = 0.30;

// ======= SIMULATION CONFIG (visible + not painfully slow) =======
const ZOOM_BASE  = 15;   // base zoom (city-ish)
const ZOOM_CLOSE = 11;   // clearly closer than base
const RING_STEP_MS     = 500; // ring radius update speed
const FLY_DUR_BASE     = 20;  // seconds
const FLY_DUR_CLOSE    = 25;  // seconds
const PAUSE_CLOSE_MS   = 800;  // pause when zoomed-in
const PAUSE_BETWEEN_MS = 600;  // pause between stations

// ======= SIM STATE =======
let ringInterval = null;
let simRunning = false;

// ======= ORDER (north -> south) =======
let stationOrder = []; // array of indices into `stations`

function rebuildStationOrder() {
  stationOrder = stations
    .map((s, i) => ({ i, lat: s.lat }))
    .sort((a, b) => b.lat - a.lat)   // descending latitude
    .map(o => o.i);
}

// ======= Helpers =======
function clearCoverage() {
  ringLayerGroup.clearLayers();
}

function drawSingleRing(km) {
  clearCoverage();
  if (!stations.length) return;

  stations.forEach(site => {
    L.circle([site.lat, site.lon], {
      radius: km * 1000,
      color: RING_COLOR,
      fillColor: RING_FILL,
      fillOpacity: RING_FILL_OPACITY,
      weight: 2
    }).addTo(ringLayerGroup);
  });
}

function sleep(ms) {
  return new Promise(res => setTimeout(res, ms));
}

function flyToAsync(latlng, zoom, durationSec) {
  return new Promise(resolve => {
    const onEnd = () => { map.off('moveend', onEnd); resolve(); };
    map.on('moveend', onEnd);
    map.flyTo(latlng, zoom, { animate: true, duration: durationSec });
  });
}

// ======= Station zoom loop (north -> south) =======
async function zoomStationsLoop() {
  if (!stationOrder.length) rebuildStationOrder(); // ensure order
  let idx = 0; // start at the most northern (index 0 in order)

  while (simRunning) {
    if (!stations.length || !stationOrder.length) { await sleep(1000); continue; }

    const sIndex = stationOrder[idx % stationOrder.length]; // use sorted order
    const s = stations[sIndex];
    const target = [s.lat, s.lon];

    await flyToAsync(target, ZOOM_BASE,  FLY_DUR_BASE);
    if (!simRunning) break;

    await flyToAsync(target, ZOOM_CLOSE, FLY_DUR_CLOSE);
    if (!simRunning) break;

    await sleep(PAUSE_CLOSE_MS);
    if (!simRunning) break;

    await flyToAsync(target, ZOOM_BASE,  FLY_DUR_BASE);
    if (!simRunning) break;

    await sleep(PAUSE_BETWEEN_MS);
    idx++; // next most-northern
  }
}

function startRingCycle() {
  clearCoverage();
  if (ringInterval) clearInterval(ringInterval);
  let idx = 1; // 5 km
  ringInterval = setInterval(() => {
    drawSingleRing(coverageSteps[idx]); // 5,10,15,20,25,30,40
    idx++;
    if (idx >= coverageSteps.length) idx = 1;
  }, RING_STEP_MS);
}

function stopRingCycle() {
  if (ringInterval) clearInterval(ringInterval);
  ringInterval = null;
}

// ======= Simulation control =======
function startSimulation() {
  if (simRunning) return;
  simRunning = true;
  startRingCycle();
  zoomStationsLoop(); // async loop
}

function stopSimulation() {
  simRunning = false;
  stopRingCycle();
}

// ======= Button wiring =======
const coverageBtn = document.getElementById("coverageBtn");
coverageBtn.addEventListener("click", () => {
  coverageState++;
  if (coverageState > 8) coverageState = 0;

  // Button visuals
  coverageBtn.className = `coverage-btn cov-state-${coverageState}`;
  coverageBtn.querySelector("span").textContent =
    (coverageState >= 1 && coverageState <= 7) ? coverageSteps[coverageState] : "";

  // Map behaviour
  stopSimulation();
  if (coverageState === 0) {
    clearCoverage();
  } else if (coverageState >= 1 && coverageState <= 7) {
    drawSingleRing(coverageSteps[coverageState]);
  } else if (coverageState === 8) {
    startSimulation();
  }
});

// ======= Load stations =======
function loadStations() {
  fetch("sites.csv")
    .then(response => response.text())
    .then(csvText => {
      Papa.parse(csvText, {
        header: true,
        dynamicTyping: true,
        complete: function(results) {
          const data = results.data;

          data.forEach(site => {
            const lat = site["GDA94 Latitude(DD)"];
            const lon = site["GDA94 Longitude(DD)"];
            if (typeof lat !== "number" || typeof lon !== "number") return;

            stations.push({ lat, lon });

            const marker = L.marker([lat, lon], { icon: antennaIcon });
            const dot = L.circleMarker([lat, lon], dotOptions);

            marker.bindTooltip(
              `<strong>${site["Four Character ID"] || ""}</strong><br>${site["Site Name"] || ""}<br>${site.Organisation || ""}`,
              { direction: 'top', permanent: false, className: 'hover-label' }
            );

            marker.on("click", () => {
              const html = `
                <div style="font-family:sans-serif; font-size: 13px;">
                  <strong style="font-size:14px;">${site["Site Name"] || ""}</strong><br/>
                  <b>Four Character ID:</b> ${site["Four Character ID"] || ""}<br/>
                  <b>Organisation:</b> ${site.Organisation || ""}<br/>
                  <b>Marker Number:</b> ${site["Marker Number"] || ""}<br/>
                  <b>Status:</b> ${site.Status || ""}<br/>
                  <b>Last Updated:</b> ${site["Last Updated"] || ""}<br/>
                  <b>State:</b> ${site.State || ""}<br/>
                  <b>Country:</b> ${site.Country || ""}
                </div>
              `;
              L.popup().setLatLng([lat, lon]).setContent(html).openOn(map);
            });

            baseStationLayer.addLayer(marker);
            baseStationLayer.addLayer(dot);
          });

          // Build north→south order once stations are loaded
          rebuildStationOrder();

          // Default display: 40km after stations load
          coverageBtn.className = `coverage-btn cov-state-7`;
          coverageBtn.querySelector("span").textContent = coverageSteps[7];
          drawSingleRing(coverageSteps[7]);
        }
      });
    })
    .catch(err => console.error("Error loading base stations:", err));
}

loadStations();

// === Measurement Tool ===
let measuring = false;
let measurePoints = [];
let measureLine = null;
let measureMarkers = [];

const measureBtn = document.getElementById("measureBtn");
measureBtn.addEventListener("click", () => {
  measuring = !measuring;
  measureBtn.classList.toggle("active", measuring);
  measureBtn.style.background = measuring ? "#1f3763" : "#fff";
  measureBtn.style.color = measuring ? "#fff" : "#1f3763";

  if (!measuring) {
    measurePoints = [];
    if (measureLine) { map.removeLayer(measureLine); measureLine = null; }
    measureMarkers.forEach(m => map.removeLayer(m));
    measureMarkers = [];
    map.closePopup();
    map.getContainer().style.cursor = '';
  } else {
    map.getContainer().style.cursor = 'crosshair';
  }
});

map.on("click", e => {
  if (!measuring) return;

  measurePoints.push(e.latlng);

  const marker = L.circleMarker(e.latlng, {
    radius: 4, color: "#ff0000", fillColor: "#ff0000", fillOpacity: 1
  }).addTo(map);
  measureMarkers.push(marker);

  if (measurePoints.length > 1) {
    if (measureLine) map.removeLayer(measureLine);
    measureLine = L.polyline(measurePoints, { color: "#ff0000" }).addTo(map);

    let total = 0;
    for (let i = 1; i < measurePoints.length; i++) {
      total += map.distance(measurePoints[i - 1], measurePoints[i]);
    }
    total = total / 1000;

    L.popup()
      .setLatLng(measurePoints[measurePoints.length - 1])
      .setContent(`<b>${total.toFixed(2)} km</b>`)
      .openOn(map);
  }
});

document.addEventListener("keydown", e => {
  if (e.key === "Escape" && measuring) {
    measureBtn.click();
  }
});

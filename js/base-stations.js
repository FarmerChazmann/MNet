(function () {
  if (!window.map) {
    console.error('[base-stations] Leaflet map not found on window.map');
    return;
  }

  const COVERAGE_PANE = 'coverage-pane';
  const STATION_DOT_PANE = 'station-dot-pane';
  const STATION_MARKER_PANE = 'station-marker-pane';
  const SEARCH_PANE = 'search-pane';

  function ensurePane(name, zIndex) {
    if (!map.getPane(name)) {
      map.createPane(name);
      map.getPane(name).style.zIndex = String(zIndex);
    }
    return map.getPane(name);
  }

  window.ensurePane = ensurePane;

  ensurePane(COVERAGE_PANE, 450);
  ensurePane(STATION_DOT_PANE, 460);
  ensurePane(STATION_MARKER_PANE, 470);
  ensurePane(SEARCH_PANE, 480);

  const ringLayerGroup = L.layerGroup().addTo(map);
  const baseStationLayer = L.layerGroup().addTo(map);

  const antennaIcon = L.icon({
    iconUrl: 'Assets/antena.svg',
    iconSize: [40, 40],
    iconAnchor: [20, 34],
    popupAnchor: [0, -28]
  });

  const dotOptions = {
    radius: 6,
    color: '#007bff',
    fillColor: '#fff',
    fillOpacity: 1,
    weight: 2,
    pane: STATION_DOT_PANE
  };

  const stations = [];
  let stationOrder = [];
  let dataLoadErrorShown = false;

  let coverageState = 7; // default to 40km
  const coverageSteps = [0, 5, 10, 15, 20, 25, 30, 40];
  const RING_COLOR = '#3366cc';
  const RING_FILL = '#3366cc';
  const RING_FILL_OPACITY = 0.30;

  const ZOOM_BASE = 15;
  const ZOOM_CLOSE = 11;
  const RING_STEP_MS = 500;
  const FLY_DUR_BASE = 20;
  const FLY_DUR_CLOSE = 25;
  const PAUSE_CLOSE_MS = 800;
  const PAUSE_BETWEEN_MS = 600;

  let ringInterval = null;
  let simRunning = false;
  let simulationToggle = null;
  let coverageButton = null;

  function rebuildStationOrder() {
    stationOrder = stations
      .map((station, index) => ({ index, lat: station.lat }))
      .sort((a, b) => b.lat - a.lat)
      .map(item => item.index);
  }

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
        weight: 2,
        pane: COVERAGE_PANE
      }).addTo(ringLayerGroup);
    });
  }

  function updateCoverageButton() {
    if (!coverageButton) return;
    coverageButton.className = `coverage-btn cov-state-${coverageState}`;
    const label = (coverageState >= 1 && coverageState < coverageSteps.length)
      ? coverageSteps[coverageState]
      : '';
    coverageButton.querySelector('span').textContent = label;
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function flyToAsync(latlng, zoom, durationSec) {
    return new Promise(resolve => {
      const onEnd = () => {
        map.off('moveend', onEnd);
        resolve();
      };
      map.on('moveend', onEnd);
      map.flyTo(latlng, zoom, { animate: true, duration: durationSec });
    });
  }

  async function zoomStationsLoop() {
    if (!stationOrder.length) rebuildStationOrder();
    let idx = 0;

    while (simRunning) {
      if (!stations.length || !stationOrder.length) {
        await sleep(1000);
        continue;
      }

      const stationIndex = stationOrder[idx % stationOrder.length];
      const station = stations[stationIndex];
      const target = [station.lat, station.lon];

      await flyToAsync(target, ZOOM_BASE, FLY_DUR_BASE);
      if (!simRunning) break;

      await flyToAsync(target, ZOOM_CLOSE, FLY_DUR_CLOSE);
      if (!simRunning) break;

      await sleep(PAUSE_CLOSE_MS);
      if (!simRunning) break;

      await flyToAsync(target, ZOOM_BASE, FLY_DUR_BASE);
      if (!simRunning) break;

      await sleep(PAUSE_BETWEEN_MS);
      idx++;
    }
  }

  function startRingCycle() {
    clearCoverage();
    if (ringInterval) clearInterval(ringInterval);
    let idx = 1;
    ringInterval = setInterval(() => {
      drawSingleRing(coverageSteps[idx]);
      idx++;
      if (idx >= coverageSteps.length) idx = 1;
    }, RING_STEP_MS);
  }

  function stopRingCycle() {
    if (ringInterval) {
      clearInterval(ringInterval);
      ringInterval = null;
    }
  }

  function startSimulation() {
    if (simRunning) return;
    if (!stations.length) {
      alert('No stations loaded yet. Please wait for the data to finish loading.');
      return;
    }
    simRunning = true;
    if (simulationToggle) {
      simulationToggle.classList.add('active');
      simulationToggle.setAttribute('aria-pressed', 'true');
    }
    startRingCycle();
    zoomStationsLoop();
  }

  function stopSimulation() {
    if (!simRunning) return;
    simRunning = false;
    if (simulationToggle) {
      simulationToggle.classList.remove('active');
      simulationToggle.setAttribute('aria-pressed', 'false');
    }
    stopRingCycle();
    if (coverageState >= 1 && coverageState <= 7) {
      drawSingleRing(coverageSteps[coverageState]);
    } else if (coverageState === 0) {
      clearCoverage();
    }
    updateCoverageButton();
  }

  const coverageBtn = document.getElementById('coverageBtn');
  if (coverageBtn) {
    coverageButton = coverageBtn;
    updateCoverageButton();
    coverageBtn.addEventListener('click', () => {
      coverageState++;
      if (coverageState >= coverageSteps.length) coverageState = 0;

      stopSimulation();
      if (coverageState === 0) {
        clearCoverage();
      } else {
        drawSingleRing(coverageSteps[coverageState]);
      }
      updateCoverageButton();
    });
  } else {
    console.warn('[base-stations] coverage button not found; coverage controls disabled.');
  }

  const simulationBtn = document.getElementById('simulationBtn');
  if (simulationBtn) {
    simulationToggle = simulationBtn;
    simulationBtn.setAttribute('aria-pressed', 'false');
    simulationBtn.addEventListener('click', () => {
      if (simRunning) {
        stopSimulation();
      } else {
        startSimulation();
      }
    });
  } else {
    console.warn('[base-stations] simulation button not found; simulation controls disabled.');
  }

  function loadStations() {
    fetch('Assets/sites.csv')
      .then(response => {
        if (!response.ok) {
          throw new Error('Failed to load sites.csv (' + response.status + ')');
        }
        return response.text();
      })
      .then(csvText => {
        Papa.parse(csvText, {
          header: true,
          dynamicTyping: true,
          complete: results => {
            const data = results.data;

            data.forEach(site => {
              const lat = site['GDA94 Latitude(DD)'];
              const lon = site['GDA94 Longitude(DD)'];
              if (typeof lat !== 'number' || typeof lon !== 'number') return;

              stations.push({ lat, lon, site });

              const marker = L.marker([lat, lon], { icon: antennaIcon, pane: STATION_MARKER_PANE });
              const dot = L.circleMarker([lat, lon], dotOptions);

              marker.bindTooltip(
                `<strong>${site['Four Character ID'] || ''}</strong><br>${site['Site Name'] || ''}<br>${site['Organisation'] || ''}`,
                { direction: 'top', permanent: false, className: 'hover-label' }
              );

              marker.on('click', () => {
                const html = `
                  <div style="font-family:sans-serif; font-size: 13px;">
                    <strong style="font-size:14px;">${site['Site Name'] || ''}</strong><br/>
                    <b>Four Character ID:</b> ${site['Four Character ID'] || ''}<br/>
                    <b>Organisation:</b> ${site['Organisation'] || ''}<br/>
                    <b>Marker Number:</b> ${site['Marker Number'] || ''}<br/>
                    <b>Status:</b> ${site['Status'] || ''}<br/>
                    <b>Last Updated:</b> ${site['Last Updated'] || ''}<br/>
                    <b>State:</b> ${site['State'] || ''}<br/>
                    <b>Country:</b> ${site['Country'] || ''}
                  </div>
                `;
                L.popup().setLatLng([lat, lon]).setContent(html).openOn(map);
              });

              dot.addTo(baseStationLayer);
              marker.addTo(baseStationLayer);
            });

            rebuildStationOrder();

            coverageState = 7;
            updateCoverageButton();
            drawSingleRing(coverageSteps[coverageState]);
          }
        });
      })
      .catch(err => {
        console.error('Error loading base stations:', err);
        if (!dataLoadErrorShown) {
          dataLoadErrorShown = true;
          const message = window.location.protocol === 'file:'
            ? 'Unable to load Assets/sites.csv. Please run this page from a local web server so the browser can fetch the data file.'
            : 'Unable to load Assets/sites.csv. Check the network connection and try again.';
          alert(message);
        }
      });
  }

  loadStations();

  let measuring = false;
  let measurePoints = [];
  let measureLine = null;
  let measureMarkers = [];

  const measureBtn = document.getElementById('measureBtn');
  if (measureBtn) {
    measureBtn.addEventListener('click', () => {
      measuring = !measuring;
      measureBtn.classList.toggle('active', measuring);
      measureBtn.style.background = measuring ? '#1f3763' : '#fff';
      measureBtn.style.color = measuring ? '#fff' : '#1f3763';

      if (!measuring) {
        resetMeasurements();
        map.getContainer().style.cursor = '';
      } else {
        map.getContainer().style.cursor = 'crosshair';
      }
    });
  } else {
    console.warn('[base-stations] measure button not found; measurement controls disabled.');
  }

  map.on('click', e => {
    if (!measuring) return;

    measurePoints.push(e.latlng);

    const marker = L.circleMarker(e.latlng, {
      radius: 4,
      color: '#ff0000',
      fillColor: '#ff0000',
      fillOpacity: 1
    }).addTo(map);
    measureMarkers.push(marker);

    if (measurePoints.length > 1) {
      if (measureLine) map.removeLayer(measureLine);
      measureLine = L.polyline(measurePoints, { color: '#ff0000' }).addTo(map);

      let total = 0;
      for (let i = 1; i < measurePoints.length; i++) {
        total += map.distance(measurePoints[i - 1], measurePoints[i]);
      }
      const totalKm = total / 1000;

      L.popup()
        .setLatLng(measurePoints[measurePoints.length - 1])
        .setContent(`<b>${totalKm.toFixed(2)} km</b>`)
        .openOn(map);
    }
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && measuring && measureBtn) {
      measureBtn.click();
    }
  });

  function resetMeasurements() {
    measurePoints = [];
    if (measureLine) {
      map.removeLayer(measureLine);
      measureLine = null;
    }
    measureMarkers.forEach(marker => map.removeLayer(marker));
    measureMarkers = [];
    map.closePopup();
  }
})();

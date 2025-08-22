/* js/address-search.js
 * Adds an address search box to the .top-bar and zooms the Leaflet map to level 10.
 * Requires: window.map (Leaflet map instance) and a .top-bar element in the DOM.
 */
(function () {
  const ZOOM_LEVEL = 10;             // default zoom when centering on result
  const PLACEHOLDER = "Search address or place…";
  const TOPBAR_SELECTOR = ".top-bar";

  function ensureMap() {
    if (!window.map || typeof window.map.setView !== "function") {
      console.warn("[address-search] window.map not ready. Retrying in 300ms…");
      setTimeout(init, 300);
      return false;
    }
    return true;
  }

  function injectStyles() {
    if (document.getElementById("address-search-styles")) return;
    const css = `
      .search-wrap {
        display: flex; align-items: center; gap: 6px;
        background: #fff; padding: 6px 8px; border-radius: 8px;
        box-shadow: 0 1px 4px rgba(0,0,0,0.25);
      }
      .search-input {
        width: 280px; border: none; outline: none; font-size: 14px;
      }
      .search-btn {
        height: 30px; padding: 0 10px; border: none; border-radius: 6px;
        background: #1f3763; color: #fff; cursor: pointer; font-size: 13px;
      }
      .search-btn[disabled] { opacity: .7; cursor: progress; }
    `;
    const style = document.createElement("style");
    style.id = "address-search-styles";
    style.textContent = css;
    document.head.appendChild(style);
  }

  function createUI() {
    const topbar = document.querySelector(TOPBAR_SELECTOR);
    if (!topbar) {
      console.warn(`[address-search] Could not find ${TOPBAR_SELECTOR}.`);
      return null;
    }

    // Prevent double-insert
    if (document.getElementById("searchForm")) return document.getElementById("searchForm");

    const form = document.createElement("form");
    form.id = "searchForm";
    form.className = "search-wrap";
    form.autocomplete = "off";

    const input = document.createElement("input");
    input.id = "searchInput";
    input.className = "search-input";
    input.type = "text";
    input.placeholder = PLACEHOLDER;

    const btn = document.createElement("button");
    btn.className = "search-btn";
    btn.type = "submit";
    btn.textContent = "Search";

    form.appendChild(input);
    form.appendChild(btn);

    // Insert near the right side but before any trailing buttons if you want:
    topbar.appendChild(form);
    return form;
  }

  async function geocodeAddress(q) {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=1`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("Geocoding request failed");
    const data = await res.json();
    return Array.isArray(data) && data.length ? data[0] : null;
  }

  function init() {
    if (!ensureMap()) return;
    injectStyles();

    const form = createUI();
    if (!form) return;

    const input = form.querySelector("#searchInput");
    const btn = form.querySelector(".search-btn");

    // Layer to hold the search result marker(s)
    const searchLayer = L.layerGroup().addTo(map);

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const query = (input.value || "").trim();
      if (!query) return;

      btn.disabled = true;
      const oldLabel = btn.textContent;
      btn.textContent = "Searching…";

      try {
        searchLayer.clearLayers();
        const result = await geocodeAddress(query);
        if (!result) {
          alert("No results found. Try a more specific address.");
          return;
        }

        const lat = parseFloat(result.lat);
        const lon = parseFloat(result.lon);

        const marker = L.marker([lat, lon]).addTo(searchLayer)
          .bindPopup(result.display_name || "Search result");

        map.setView([lat, lon], ZOOM_LEVEL);
        marker.openPopup();
      } catch (err) {
        console.error(err);
        alert("Sorry, address lookup failed. Please try again.");
      } finally {
        btn.disabled = false;
        btn.textContent = oldLabel;
      }
    });
  }

  // Kick off when DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

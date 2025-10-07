/* js/address-search.js
 * Adds an address search toggle to the top bar and zooms the Leaflet map to level 10.
 * Requires: window.map (Leaflet map instance) and a .top-bar element in the DOM.
 */
(function () {
  const ZOOM_LEVEL = 10;
  const PLACEHOLDER = "Search address or place...";
  const TOP_CENTER_ID = "topCenter";
  const SHELL_ID = "searchShell";
  const STYLE_ID = "address-search-styles";

  function ensureMap() {
    if (!window.map || typeof window.map.setView !== "function") {
      console.warn("[address-search] window.map not ready. Retrying in 300ms...");
      setTimeout(init, 300);
      return false;
    }
    return true;
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const css = `
      .search-shell {
        position: relative;
        display: flex;
        align-items: center;
      }
      .search-toggle {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 6px 16px;
        border-radius: 999px;
        border: 1px solid rgba(255, 255, 255, 0.35);
        background: rgba(255, 255, 255, 0.08);
        color: #f5f7ff;
        font-size: 13px;
        letter-spacing: 0.02em;
        cursor: pointer;
        transition: background 0.18s ease, border-color 0.18s ease, color 0.18s ease;
      }
      .search-toggle svg {
        width: 14px;
        height: 14px;
        stroke: currentColor;
      }
      .search-toggle:hover {
        background: rgba(255, 255, 255, 0.16);
      }
      .search-shell.open .search-toggle {
        background: #1f3763;
        border-color: #1f3763;
        color: #fff;
      }
      .search-panel {
        position: absolute;
        top: calc(100% + 10px);
        right: 0;
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 12px 14px;
        background: #ffffff;
        border-radius: 12px;
        box-shadow: 0 12px 28px rgba(0, 0, 0, 0.28);
        opacity: 0;
        pointer-events: none;
        transform: translateY(-10px) scale(0.97);
        transform-origin: top right;
        transition: opacity 0.2s ease, transform 0.2s ease;
        min-width: 280px;
        z-index: 2100;
      }
      .search-shell.open .search-panel {
        opacity: 1;
        pointer-events: auto;
        transform: translateY(0) scale(1);
      }
      .search-input {
        flex: 1;
        border: none;
        outline: none;
        font-size: 14px;
        padding: 6px 0;
        border-bottom: 1px solid #d0d4dd;
      }
      .search-input:focus {
        border-bottom-color: #1f3763;
      }
      .search-btn {
        height: 34px;
        padding: 0 14px;
        border: none;
        border-radius: 8px;
        background: #1f3763;
        color: #fff;
        font-size: 13px;
        cursor: pointer;
        transition: background 0.18s ease;
      }
      .search-btn:hover {
        background: #274a86;
      }
      .search-btn[disabled] {
        opacity: 0.7;
        cursor: progress;
      }
      @media (max-width: 720px) {
        .search-panel {
          left: 50%;
          right: auto;
          transform-origin: top center;
          min-width: min(320px, 80vw);
        }
        .search-panel {
          transform: translate(-50%, -10px) scale(0.97);
        }
        .search-shell.open .search-panel {
          transform: translate(-50%, 0) scale(1);
        }
      }
    `;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = css;
    document.head.appendChild(style);
  }

  function createUI() {
    const host = document.getElementById(TOP_CENTER_ID) || document.querySelector(".top-bar");
    if (!host) {
      console.warn(`[address-search] Could not find ${TOP_CENTER_ID} or .top-bar to mount the search UI.`);
      return null;
    }

    const existingShell = document.getElementById(SHELL_ID);
    if (existingShell) {
      return {
        shell: existingShell,
        form: existingShell.querySelector("#searchForm"),
        input: existingShell.querySelector("#searchInput"),
        button: existingShell.querySelector(".search-btn"),
        toggle: existingShell.querySelector("#searchToggle"),
        closePanel: () => existingShell.classList.remove("open")
      };
    }

    const shell = document.createElement("div");
    shell.id = SHELL_ID;
    shell.className = "search-shell";

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.id = "searchToggle";
    toggle.className = "search-toggle";
    toggle.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="11" cy="11" r="7" stroke-width="2"/>
        <line x1="16.5" y1="16.5" x2="21" y2="21" stroke-width="2" stroke-linecap="round"/>
      </svg>
      <span>Search</span>
    `;

    const form = document.createElement("form");
    form.id = "searchForm";
    form.className = "search-panel";
    form.autocomplete = "off";

    const input = document.createElement("input");
    input.id = "searchInput";
    input.className = "search-input";
    input.type = "text";
    input.placeholder = PLACEHOLDER;

    const button = document.createElement("button");
    button.className = "search-btn";
    button.type = "submit";
    button.textContent = "Go";

    form.appendChild(input);
    form.appendChild(button);
    shell.appendChild(toggle);
    shell.appendChild(form);
    host.appendChild(shell);

    const closePanel = () => shell.classList.remove("open");

    toggle.addEventListener("click", () => {
      const opening = !shell.classList.contains("open");
      shell.classList.toggle("open", opening);
      if (opening) {
        requestAnimationFrame(() => input.focus({ preventScroll: true }));
      }
    });

    document.addEventListener("click", evt => {
      if (!shell.contains(evt.target)) {
        closePanel();
      }
    });

    document.addEventListener("keydown", evt => {
      if (evt.key === "Escape") {
        if (shell.classList.contains("open")) {
          closePanel();
          toggle.focus();
        }
      }
    });

    return { shell, form, input, button, toggle, closePanel };
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

    const ui = createUI();
    if (!ui) return;

    const { form, input, button, closePanel } = ui;
    if (form.dataset.bound === "1") {
      return;
    }
    form.dataset.bound = "1";

    const searchLayer = L.layerGroup([], { pane: 'search-pane' }).addTo(map);

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const query = (input.value || "").trim();
      if (!query) {
        input.focus();
        return;
      }

      button.disabled = true;
      const oldLabel = button.textContent;
      button.textContent = "Searching...";

      try {
        searchLayer.clearLayers();
        const result = await geocodeAddress(query);
        if (!result) {
          alert("No results found. Try a more specific address.");
          return;
        }

        const lat = parseFloat(result.lat);
        const lon = parseFloat(result.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
          alert("Sorry, address lookup returned invalid coordinates.");
          return;
        }

        const marker = L.marker([lat, lon]).addTo(searchLayer)
          .bindPopup(result.display_name || "Search result");

        map.setView([lat, lon], ZOOM_LEVEL);
        marker.openPopup();
        closePanel();
      } catch (err) {
        console.error(err);
        alert("Sorry, address lookup failed. Please try again.");
      } finally {
        button.disabled = false;
        button.textContent = oldLabel;
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

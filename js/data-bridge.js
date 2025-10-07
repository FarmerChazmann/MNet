import { saveDataset } from "./data.js";

window.addEventListener("mnet:dataset", async (event) => {
  const detail = event.detail || {};
  const name = detail.name;
  const geojson = detail.geojson;
  if (!name || !geojson) return;
  try {
    await saveDataset(name, geojson);
  } catch (error) {
    console.error(error);
    alert("Saved locally only (cloud save failed).");
  }
});

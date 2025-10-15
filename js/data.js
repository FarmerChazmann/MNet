import { supabase, getUser } from "./auth.js";
import { ingestGrowerHierarchy } from "./db-ingest.js";
import { set, get, del, keys } from "https://esm.sh/idb-keyval@6";

const LOCAL_PREFIX = "mnet:anon:";
const LEGACY_LOCAL_PREFIX = "mnet:";
const CLOUD_PREFIX = "mnet:cloud:";

const localKey = (name) => `${LOCAL_PREFIX}${name}`;
const cloudKey = (userId, datasetId) => `${CLOUD_PREFIX}${userId}:${datasetId}`;

const isCloudKey = (key) => key.startsWith(CLOUD_PREFIX);
const isLocalKey = (key) =>
  key.startsWith(LOCAL_PREFIX) || (key.startsWith(LEGACY_LOCAL_PREFIX) && !isCloudKey(key));

const localNameFromKey = (key) =>
  key.startsWith(LOCAL_PREFIX)
    ? key.slice(LOCAL_PREFIX.length)
    : key.slice(LEGACY_LOCAL_PREFIX.length);

const toPlainObject = (value) => (value && typeof value === "object" ? value : {});

const parseJsonMaybe = (value) => {
  if (!value) return null;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const latestTimestamp = (current, candidate) => {
  if (!candidate) return current || null;
  if (!current) return candidate;
  const currentMs = new Date(current).getTime();
  const candidateMs = new Date(candidate).getTime();
  return Number.isFinite(candidateMs) && candidateMs > currentMs ? candidate : current;
};

const normaliseGrowerDatasetName = (grower, fallback) =>
  grower?.grower_name?.trim?.() ||
  fallback ||
  "Dataset";

function normaliseRelationship(value) {
  if (!value) return null;
  if (Array.isArray(value)) {
    return value.length ? value[0] : null;
  }
  return value;
}

export function rowsToDatasetCollections(rows = []) {
  const grouped = new Map();
  for (const row of rows) {
    const farm = normaliseRelationship(row.farms ?? row.farm);
    const grower = normaliseRelationship(farm?.growers ?? farm?.grower);

    const datasetId = grower?.grower_id || farm?.farm_id || row.field_id;
    const datasetName = normaliseGrowerDatasetName(grower, farm?.farm_name || row.field_name);
    const geometry = parseJsonMaybe(row.field_boundary);
    if (!geometry) continue;

    const dataset = grouped.get(datasetId) ?? {
      id: datasetId,
      name: datasetName,
      geojson: { type: "FeatureCollection", features: [] },
      updated_at: row.updated_at ?? null,
      grower_id: grower?.grower_id ?? null,
      grower_name: grower?.grower_name ?? datasetName,
      grower_mnet: Boolean(grower?.mnet ?? false),
    };

    const baseProps = {
      field_id: row.field_id,
      field_name: row.field_name,
      field_group: row.field_group ?? null,
      farm_id: farm?.farm_id ?? null,
      farm_name: farm?.farm_name ?? null,
      grower_id: grower?.grower_id ?? null,
      grower_name: grower?.grower_name ?? null,
      area_ha: row.area_ha ?? null,
      perimeter_m: row.perimeter_m ?? null,
    };

    const properties = { ...toPlainObject(row.properties), ...baseProps };
    properties.mnet = dataset.grower_mnet;

    dataset.geojson.features.push({
      type: "Feature",
      geometry,
      properties,
    });
    dataset.updated_at = latestTimestamp(dataset.updated_at, row.updated_at ?? null);
    grouped.set(datasetId, dataset);
  }
  return Array.from(grouped.values()).map((ds) => ({
    ...ds,
    featureCount: ds.geojson?.features?.length ?? 0,
  }));
}

export async function saveDataset(name, geojson) {
  const user = await getUser();
  if (!user) {
    return set(localKey(name), geojson);
  }
  // Cloud persists are handled by the upload pipeline to avoid duplicate ingests.
  return null;
}

export async function listDatasets() {
  const user = await getUser();
  if (!user) {
    const allKeys = await keys();
    return allKeys
      .map(String)
      .filter(isLocalKey)
      .map((key) => ({ id: key, name: localNameFromKey(key), source: "local" }));
  }
  const datasets = await fetchCloudDatasets(user.id);
  return datasets.map((ds) => ({
    id: ds.id,
    name: ds.name,
    featureCount: ds.featureCount,
    updated_at: ds.updated_at,
    source: "cloud",
  }));
}

export async function loadDataset(idOrName) {
  const user = await getUser();
  if (!user) {
    if (typeof idOrName === "string") {
      const current = await get(localKey(idOrName));
      if (current !== undefined) return current;
      return get(LEGACY_LOCAL_PREFIX + idOrName);
    }
    return get(idOrName);
  }
  const datasets = await fetchCloudDatasets(user.id);
  const match = datasets.find((ds) => ds.id === idOrName || ds.name === idOrName);
  if (!match) {
    throw new Error(`Dataset "${idOrName}" not found in cloud storage.`);
  }
  return match.geojson;
}

export async function migrateLocalToCloud() {
  const user = await getUser();
  if (!user) return 0;
  const allKeys = await keys();
  let moved = 0;
  for (const rawKey of allKeys) {
    const key = String(rawKey);
    if (!isLocalKey(key)) continue;
    const name = localNameFromKey(key);
    const stored = await get(rawKey);
    try {
      const fc =
        stored?.type === "FeatureCollection"
          ? stored
          : typeof stored === "string"
            ? JSON.parse(stored)
            : null;
      if (!fc || fc.type !== "FeatureCollection") {
        throw new Error("Local dataset is not a valid FeatureCollection");
      }
      await ingestGrowerHierarchy(fc, { replaceMissing: true });
      await del(rawKey);
      moved++;
    } catch (err) {
      console.error("[migrateLocalToCloud] failed for", name, err);
    }
  }
  return moved;
}

export async function cacheCloudDatasets(userId, datasets = []) {
  if (!userId) return;
  const prefix = `${CLOUD_PREFIX}${userId}:`;
  const allKeys = await keys();
  const removals = allKeys
    .map((raw) => ({ raw, key: String(raw) }))
    .filter(({ key }) => key.startsWith(prefix))
    .map(({ raw }) => del(raw));
  await Promise.all(removals);

  if (!Array.isArray(datasets) || !datasets.length) return;
  const writes = datasets
    .filter((ds) => ds && ds.id && ds.geojson)
    .map((ds) =>
      set(cloudKey(userId, ds.id), {
        id: ds.id,
        name: ds.name || "",
        geojson: ds.geojson,
        updated_at: ds.updated_at || null,
        featureCount: ds.featureCount ?? (ds.geojson?.features?.length ?? 0),
        grower_id: ds.grower_id ?? null,
        grower_name: ds.grower_name ?? (ds.name || ""),
      })
    );
  await Promise.all(writes);
}

export async function loadCachedCloudDatasets(userId) {
  if (!userId) return [];
  const prefix = `${CLOUD_PREFIX}${userId}:`;
  const allKeys = await keys();
  const results = [];
  for (const raw of allKeys) {
    const key = String(raw);
    if (!key.startsWith(prefix)) continue;
    const value = await get(raw);
    if (value && value.geojson) results.push(value);
  }
  return results.sort(
    (a, b) =>
      new Date(b.updated_at || 0).getTime() -
      new Date(a.updated_at || 0).getTime()
  );
}

export async function clearCloudCache(userId) {
  const prefix = userId ? `${CLOUD_PREFIX}${userId}:` : CLOUD_PREFIX;
  const allKeys = await keys();
  const removals = allKeys
    .map((raw) => ({ raw, key: String(raw) }))
    .filter(({ key }) => key.startsWith(prefix))
    .map(({ raw }) => del(raw));
  await Promise.all(removals);
}

async function fetchFieldRows(options = {}) {
  const { growerId } = options;

  const selectColumns = `
      field_id,
      field_name,
      field_group,
      area_ha,
      perimeter_m,
      field_boundary:field_boundary_geojson,
      properties,
      updated_at,
      farms:farms!inner (
        farm_id,
        farm_name,
        growers (
          grower_id,
          grower_name,
          mnet
        )
      )
    `;

  const rows = [];
  const batchSize = 250;
  let from = 0;

  while (true) {
    let query = supabase
      .from("fields")
      .select(selectColumns)
      .order("updated_at", { ascending: false })
      .range(from, from + batchSize - 1);

    if (growerId) {
      query = query.eq("farms.grower_id", growerId);
    }

    const { data, error } = await query;

    if (error) throw error;
    if (!Array.isArray(data) || !data.length) break;

    rows.push(...data);
    if (data.length < batchSize) break;
    from += batchSize;
  }

  return rows;
}

export async function fetchCloudDatasets(userId) {
  const rows = await fetchFieldRows();
  return rowsToDatasetCollections(rows);
}

export async function streamGrowerDatasets(userId, onGrower) {
  const { data: growers, error } = await supabase
    .from("growers")
    .select("grower_id,grower_name,mnet")
    .order("grower_name", { ascending: true });

  if (error) throw error;
  const list = Array.isArray(growers) ? growers : [];
  const total = list.length;

  for (let index = 0; index < total; index++) {
    const grower = list[index];
    const rows = await fetchFieldRows({ growerId: grower.grower_id });
    const datasets = rowsToDatasetCollections(rows);
    if (typeof onGrower === "function") {
      await onGrower({
        grower,
        datasets,
        fieldCount: rows.length,
        index,
        total,
      });
    }
  }

  return list;
}

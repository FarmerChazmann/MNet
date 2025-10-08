import { supabase, getUser } from "./auth.js";
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

export async function saveDataset(name, geojson) {
  const user = await getUser();
  if (!user) {
    return set(localKey(name), geojson);
  }
  const { data, error } = await supabase
    .from("datasets")
    .upsert({ user_id: user.id, name, geojson })
    .select()
    .single();
  if (error) throw error;
  return data;
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
  const { data, error } = await supabase
    .from("datasets")
    .select("id,name,inserted_at,updated_at")
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return data.map((d) => ({ ...d, source: "cloud" }));
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
  const { data, error } = await supabase
    .from("datasets")
    .select("geojson")
    .eq("id", idOrName)
    .single();
  if (error) throw error;
  return data.geojson;
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
    const geojson = await get(rawKey);
    try {
      await saveDataset(name, geojson);
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

import { supabase, getUser } from "./auth.js";
import { set, get, del, keys } from "https://esm.sh/idb-keyval@6";

const LOCAL_PREFIX = "mnet:";

export async function saveDataset(name, geojson) {
  const user = await getUser();
  if (!user) {
    return set(LOCAL_PREFIX + name, geojson);
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
    const ks = await keys();
    return ks
      .map(String)
      .filter((k) => k.startsWith(LOCAL_PREFIX))
      .map((k) => ({ id: k, name: k.slice(LOCAL_PREFIX.length), source: "local" }));
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
    return get(typeof idOrName === "string" ? LOCAL_PREFIX + idOrName : idOrName);
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
  const ks = await keys();
  let moved = 0;
  for (const k of ks) {
    const key = String(k);
    if (!key.startsWith(LOCAL_PREFIX)) continue;
    const name = key.slice(LOCAL_PREFIX.length);
    const geojson = await get(k);
    await saveDataset(name, geojson);
    await del(k);
    moved++;
  }
  return moved;
}

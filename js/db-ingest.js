import { supabase } from "./auth.js";

export async function ensureDataset(name, sourceFilename) {
  const { data: { user } = {} } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from("datasets")
    .upsert({ user_id: user.id, name, source_filename: sourceFilename ?? name })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function ensureLayer(dataset_id, name = "uploaded") {
  const { data, error } = await supabase
    .from("layers")
    .upsert({ dataset_id, name })
    .select()
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function ingestFeatureCollection(dataset_id, layer_id, featureCollection, { chunkSize = 1000 } = {}) {
  const features = featureCollection?.features ?? [];
  if (!features.length) return 0;
  if (features.length > chunkSize) {
    let total = 0;
    for (let i = 0; i < features.length; i += chunkSize) {
      const slice = { type: "FeatureCollection", features: features.slice(i, i + chunkSize) };
      total += await callRpc(dataset_id, layer_id, slice);
    }
    return total;
  }
  return callRpc(dataset_id, layer_id, featureCollection);
}

async function callRpc(dataset_id, layer_id, fc) {
  const { data, error } = await supabase.rpc("ingest_featurecollection", {
    p_dataset_id: dataset_id,
    p_layer_id: layer_id,
    p_fc: fc,
  });
  if (error) throw error;
  return data;
}

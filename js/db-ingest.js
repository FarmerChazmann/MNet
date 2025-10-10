import { supabase } from "./auth.js";

const DEFAULT_CHUNK_SIZE = 250;
const MIN_CHUNK_SIZE = 50;

function isStatementTimeout(error) {
  if (!error) return false;
  const code = String(error.code || "");
  if (code === "57014" || code === "57000") return true;
  const message = String(error.message || "");
  return /statement timeout/i.test(message);
}

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

export async function ingestFeatureCollection(dataset_id, layer_id, featureCollection, { chunkSize = DEFAULT_CHUNK_SIZE } = {}) {
  const features = featureCollection?.features ?? [];
  if (!features.length) return 0;

  const effectiveChunk = Math.max(MIN_CHUNK_SIZE, chunkSize);

  if (features.length > effectiveChunk) {
    let total = 0;
    for (let i = 0; i < features.length; i += effectiveChunk) {
      const slice = {
        type: "FeatureCollection",
        features: features.slice(i, i + effectiveChunk),
      };
      total += await ingestFeatureCollection(dataset_id, layer_id, slice, { chunkSize: effectiveChunk });
    }
    return total;
  }

  try {
    return await callRpc(dataset_id, layer_id, featureCollection);
  } catch (error) {
    if (!isStatementTimeout(error) || effectiveChunk <= MIN_CHUNK_SIZE || features.length < 2) {
      throw error;
    }
    const nextChunk = Math.max(MIN_CHUNK_SIZE, Math.floor(effectiveChunk / 2));
    const midpoint = Math.ceil(features.length / 2);
    const left = {
      type: "FeatureCollection",
      features: features.slice(0, midpoint),
    };
    const right = {
      type: "FeatureCollection",
      features: features.slice(midpoint),
    };
    const leftCount = await ingestFeatureCollection(dataset_id, layer_id, left, { chunkSize: nextChunk });
    const rightCount = await ingestFeatureCollection(dataset_id, layer_id, right, { chunkSize: nextChunk });
    return leftCount + rightCount;
  }
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

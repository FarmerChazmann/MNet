import { supabase } from "./auth.js";

function validateFeatureCollection(fc) {
  if (!fc || typeof fc !== "object") {
    throw new Error("FeatureCollection payload is required.");
  }
  if (fc.type !== "FeatureCollection") {
    throw new Error("Payload must be a GeoJSON FeatureCollection.");
  }
  if (!Array.isArray(fc.features) || !fc.features.length) {
    throw new Error("FeatureCollection must contain at least one feature.");
  }
}

export async function ingestGrowerHierarchy(featureCollection, { replaceMissing = true } = {}) {
  validateFeatureCollection(featureCollection);

  const { data: authData } = await supabase.auth.getUser();
  const userId = authData?.user?.id ?? null;

  const { data, error } = await supabase.rpc("ingest_grower_hierarchy", {
    p_payload: featureCollection,
    p_user_id: userId,
    p_replace_missing: replaceMissing,
  });
  if (error) throw error;
  return data;
}

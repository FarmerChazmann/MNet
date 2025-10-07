const SUPABASE_URL = "https://YOUR-PROJECT.supabase.co"; // TODO: replace with your Supabase project URL
const SUPABASE_ANON_KEY = "YOUR-ANON-PUBLIC-KEY"; // TODO: replace with your Supabase anon public key

export const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export async function getUser() {
  const { data } = await supabase.auth.getUser();
  return data?.user ?? null;
}

export async function signInWithPassword(email, password) {
  return supabase.auth.signInWithPassword({ email, password });
}

export async function signOut() {
  await supabase.auth.signOut();
}

export function onAuthStateChanged(cb) {
  return supabase.auth.onAuthStateChange((_evt, session) => cb(session?.user ?? null));
}

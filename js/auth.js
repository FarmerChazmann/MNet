import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://havmfjxuvdzwfwdelwji.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhhdm1manh1dmR6d2Z3ZGVsd2ppIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk4MTU3NDAsImV4cCI6MjA3NTM5MTc0MH0.hyJDWepURW1YfEhQKpEgfRNzuWQa-8-pocYM_FqnQ6w";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});

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

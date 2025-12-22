export const env = {
  apiBase: import.meta.env.VITE_API_BASE || "http://localhost:5001",
  appBase: import.meta.env.VITE_APP_BASE || "/",
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL || "",
  supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY || "",
};

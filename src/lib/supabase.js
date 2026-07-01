import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !key) {
  // eslint-disable-next-line no-console
  console.warn(
    "Supabase env vars are missing. Copy .env.example to .env and fill in your project URL and anon key."
  );
}

export const supabase = createClient(url || "", key || "");

// Recognised admin account. Shane logs in with this email and gets admin
// controls (delete sites). Everyone else who logs in is treated as a
// technician (full read/write on devices & diagrams, no delete).
export const ADMIN_EMAIL = (import.meta.env.VITE_ADMIN_EMAIL || "").toLowerCase();

export function isAdminUser(user) {
  return !!user && user.email && user.email.toLowerCase() === ADMIN_EMAIL;
}

// Reutiliza el cliente Supabase (service role) ya usado por el panel /admin y por
// scripts/publish-due-social-posts.mts — mismo proyecto, mismas credenciales, sin
// duplicar la creación del cliente en un tercer sitio.
export { supabaseAdmin } from "../lib/social/supabaseAdmin.ts";

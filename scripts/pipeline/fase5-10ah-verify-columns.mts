// FASE 5.10-AH — verificacion READ-ONLY directa (no de memoria, no de
// subagente) de que episode_id/channel_status/recovery_count SI existen
// como columnas reales y consultables en Supabase, antes de corregir
// supabase/schema.sql. Selecciona explicitamente cada columna (si no
// existiera, Postgres devolveria un error claro, nunca un valor inventado).
import "./env.mts";
import { supabaseAdmin } from "../../agent/supabaseClient.mts";

async function check(label: string, run: () => Promise<{ error: { message: string } | null }>) {
  const { error } = await run();
  console.log(`${label}: ${error ? `NO EXISTE / ERROR -> ${error.message}` : "EXISTE (columna consultable)"}`);
}

async function main() {
  await check("content_files.episode_id", () => supabaseAdmin.from("content_files").select("episode_id").limit(1));
  await check("content_accounts.channel_status", () => supabaseAdmin.from("content_accounts").select("channel_status").limit(1));
  await check("social_posts.recovery_count", () => supabaseAdmin.from("social_posts").select("recovery_count").limit(1));
  await check("social_posts.claimed_at", () => supabaseAdmin.from("social_posts").select("claimed_at").limit(1));
  await check("social_posts.publisher_operation_ref", () => supabaseAdmin.from("social_posts").select("publisher_operation_ref").limit(1));
  await check("social_posts.publication_authorized_at/_by", () => supabaseAdmin.from("social_posts").select("publication_authorized_at, publication_authorized_by").limit(1));
}

main().catch((err) => {
  console.error("Error:", err instanceof Error ? err.message : err);
  process.exit(1);
});

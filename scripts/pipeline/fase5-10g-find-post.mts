// FASE 5.10-G, PASO 3 — busca (READ-ONLY) un social_post existente de
// SIN EXPLICACIÓN, plataforma youtube, status='pending'. NO crea nada si no
// existe.
import "./env.mts";
import { supabaseAdmin } from "../../agent/supabaseClient.mts";

const SIN_EXPLICACION_YOUTUBE_ACCOUNT_ID = "20c85b1b-350e-43d5-b126-ce8f393ba919";

async function main() {
  console.log("=== social_posts de SIN EXPLICACIÓN/youtube, TODOS los status (contexto) ===");
  const { data: all, error: allError } = await supabaseAdmin
    .from("social_posts")
    .select("id, account_id, content_file_id, status, scheduled_at, external_post_id, retry_count, recovery_count, title")
    .eq("account_id", SIN_EXPLICACION_YOUTUBE_ACCOUNT_ID)
    .order("scheduled_at");
  if (allError) throw new Error(allError.message);
  for (const p of all ?? []) console.log(JSON.stringify(p));

  console.log("\n=== Filtrado a status='pending' ===");
  const pending = (all ?? []).filter((p) => p.status === "pending");
  console.log(`Encontrados: ${pending.length}`);
  for (const p of pending) console.log(JSON.stringify(p));
}

main().catch((err) => {
  console.error("Error:", err instanceof Error ? err.message : err);
  process.exit(1);
});

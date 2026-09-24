// FASE 5.10-H, PASO 2 — inventario READ-ONLY de content_files candidatos para
// una prueba YouTube de SIN EXPLICACIÓN. NO accede a D:\MATERIAL VIDEOS (solo
// Supabase). NO lee credenciales.
import "./env.mts";
import { supabaseAdmin } from "../../agent/supabaseClient.mts";

const SIN_EXPLICACION_ID = "d875e649-d554-4a36-897b-bb3161244b6d";
// content_file_id de los 2 posts YouTube YA publicados de SIN EXPLICACIÓN
// (fase5-10g-find-post.mts) — candidatos naturales por prioridad 2 del pedido.
const CANDIDATE_FILE_IDS = ["b98f6ecd-a3f5-43ad-bffe-437d32480afa", "e9724e07-4243-401f-bb45-9f18a99efbdf"];

async function main() {
  console.log("=== content_files candidatos (ya publicados antes en YouTube) ===");
  const { data: files, error } = await supabaseAdmin
    .from("content_files")
    .select("id, content_account_id, folder_type, file_path, file_hash, file_size, status, episode_id, detected_at")
    .in("id", CANDIDATE_FILE_IDS);
  if (error) throw new Error(error.message);
  for (const f of files ?? []) {
    console.log(
      JSON.stringify({
        ...f,
        file_hash_present: !!f.file_hash,
        pertenece_a_sin_explicacion: f.content_account_id === SIN_EXPLICACION_ID,
      })
    );
  }

  console.log("\n=== content_metadata asociado (para ver si existe platform_metadata.youtube reusable) ===");
  const { data: metas, error: metaError } = await supabaseAdmin
    .from("content_metadata")
    .select("id, content_file_id, status, platform_metadata")
    .in("content_file_id", CANDIDATE_FILE_IDS);
  if (metaError) throw new Error(metaError.message);
  for (const m of metas ?? []) {
    const platformKeys = Object.keys((m.platform_metadata as Record<string, unknown>) ?? {});
    console.log(JSON.stringify({ id: m.id, content_file_id: m.content_file_id, status: m.status, platform_metadata_keys: platformKeys }));
  }

  console.log("\n=== social_posts existentes para estos content_file_id (cualquier plataforma) ===");
  const { data: posts, error: postsError } = await supabaseAdmin
    .from("social_posts")
    .select("id, account_id, content_file_id, status, scheduled_at")
    .in("content_file_id", CANDIDATE_FILE_IDS);
  if (postsError) throw new Error(postsError.message);
  for (const p of posts ?? []) console.log(JSON.stringify(p));

  console.log("\n=== posting_schedule_rules activas para youtube (para saber si findNextAvailableWindow encontraria hueco) ===");
  const { data: rules, error: rulesError } = await supabaseAdmin
    .from("posting_schedule_rules")
    .select("id, content_account_id, platform, day_of_week, window_start, window_end, max_posts_per_day, is_active")
    .eq("platform", "youtube")
    .eq("is_active", true)
    .or(`content_account_id.eq.${SIN_EXPLICACION_ID},content_account_id.is.null`);
  if (rulesError) throw new Error(rulesError.message);
  for (const r of rules ?? []) console.log(JSON.stringify(r));
}

main().catch((err) => {
  console.error("Error:", err instanceof Error ? err.message : err);
  process.exit(1);
});

// FASE 5.10-S — inventario READ-ONLY de content_files folder_type='clip' de
// SIN EXPLICACIÓN, para elegir un candidato Instagram/Facebook. Cero
// escritura, cero reclamo, cero selector global.
import "./env.mts";
import { supabaseAdmin } from "../../agent/supabaseClient.mts";

const SIN_EXPLICACION_ID = "d875e649-d554-4a36-897b-bb3161244b6d";
const IG_ACCOUNT_ID = "06ba45aa-59ae-4d8e-aae5-14c36a94fa8d";
const FB_ACCOUNT_ID = "fac4bb1c-dec2-4232-940c-b8c0aa5e1608";
const YT_ACCOUNT_ID = "20c85b1b-350e-43d5-b126-ce8f393ba919";

async function main() {
  const { data: clips, error } = await supabaseAdmin
    .from("content_files")
    .select("id, file_path, status, file_size, episode_id, detected_at")
    .eq("content_account_id", SIN_EXPLICACION_ID)
    .eq("folder_type", "clip")
    .order("detected_at", { ascending: false });
  if (error) throw new Error(error.message);

  console.log(`Total content_files folder_type='clip' de SIN EXPLICACIÓN: ${clips?.length ?? 0}`);

  const fileIds = (clips ?? []).map((c) => c.id as string);
  const { data: metas, error: metaError } = await supabaseAdmin
    .from("content_metadata")
    .select("id, content_file_id, status, retry_count, platform_metadata")
    .in("content_file_id", fileIds);
  if (metaError) throw new Error(metaError.message);
  const metaByFile = new Map((metas ?? []).map((m) => [m.content_file_id as string, m]));

  const { data: posts, error: postsError } = await supabaseAdmin
    .from("social_posts")
    .select("id, account_id, content_file_id, status")
    .in("content_file_id", fileIds);
  if (postsError) throw new Error(postsError.message);
  const postsByFile = new Map<string, typeof posts>();
  for (const p of posts ?? []) {
    const list = postsByFile.get(p.content_file_id as string) ?? [];
    list.push(p);
    postsByFile.set(p.content_file_id as string, list);
  }

  console.log("\n=== Detalle por archivo (mas reciente primero) ===");
  for (const f of clips ?? []) {
    const meta = metaByFile.get(f.id as string);
    const filePosts = postsByFile.get(f.id as string) ?? [];
    const hasIg = filePosts.some((p) => p.account_id === IG_ACCOUNT_ID);
    const hasFb = filePosts.some((p) => p.account_id === FB_ACCOUNT_ID);
    const hasYt = filePosts.some((p) => p.account_id === YT_ACCOUNT_ID);

    console.log(
      JSON.stringify({
        content_file_id: f.id,
        file_path: f.file_path,
        content_file_status: f.status,
        file_size: f.file_size,
        episode_id: f.episode_id,
        detected_at: f.detected_at,
        content_metadata_id: meta?.id ?? null,
        content_metadata_status: meta?.status ?? "(sin metadata)",
        content_metadata_retry_count: meta?.retry_count ?? null,
        platform_metadata_keys: meta?.platform_metadata ? Object.keys(meta.platform_metadata as object) : null,
        social_post_instagram: hasIg,
        social_post_facebook: hasFb,
        social_post_youtube_shorts: hasYt,
        elegible_ig_fb: !hasIg && !hasFb,
      })
    );
  }
}

main().catch((err) => {
  console.error("Error:", err instanceof Error ? err.message : err);
  process.exit(1);
});

// FASE 5.10-Y — verificacion READ-ONLY exclusiva del post de Instagram,
// preparando (sin ejecutar) el primer Publish DRY_RUN dirigido. El post_id
// se consulta fresco por content_file_id + platform, nunca hardcodeado.
import "./env.mts";
import { supabaseAdmin } from "../../agent/supabaseClient.mts";
import { DRY_RUN } from "../../agent/publish/config.mts";
import { PUBLISHERS } from "../../lib/social/publishers.ts";
import { evaluateChannelAuthorization } from "../../agent/publish/channelAuthorization.mts";

const CANDIDATE_FILE_ID = "9a69c9d5-22c7-4c28-80d9-b5aa6ec331cf";
const SIN_EXPLICACION_ID = "d875e649-d554-4a36-897b-bb3161244b6d";

async function main() {
  const now = new Date();

  const { data: socialAccounts } = await supabaseAdmin
    .from("social_accounts")
    .select("id, channel_id, platform, is_active")
    .eq("platform", "instagram");
  const { data: contentAccount } = await supabaseAdmin
    .from("content_accounts")
    .select("id, channel_id, channel_status")
    .eq("id", SIN_EXPLICACION_ID)
    .maybeSingle();
  const igAccount = (socialAccounts ?? []).find((s) => s.channel_id === contentAccount?.channel_id);

  const { data: post, error } = await supabaseAdmin
    .from("social_posts")
    .select(
      "id, account_id, content_file_id, status, scheduled_at, retry_count, recovery_count, external_post_id, publication_authorized_at, publication_authorized_by"
    )
    .eq("content_file_id", CANDIDATE_FILE_ID)
    .eq("account_id", igAccount?.id)
    .maybeSingle();
  if (error) throw new Error(error.message);

  const authOutcome = evaluateChannelAuthorization(contentAccount?.channel_status ?? null);
  const scheduledMs = post?.scheduled_at ? new Date(post.scheduled_at as string).getTime() : NaN;
  const isDue = Number.isFinite(scheduledMs) && scheduledMs <= now.getTime();

  console.log("=== POST_ID completo (fresco de Supabase) ===");
  console.log(post?.id);

  console.log("\n=== Detalle completo ===");
  console.log(
    JSON.stringify({
      id: post?.id,
      status: post?.status,
      account_id: post?.account_id,
      account_id_coincide_con_ig: post?.account_id === igAccount?.id,
      content_file_id: post?.content_file_id,
      content_file_id_coincide: post?.content_file_id === CANDIDATE_FILE_ID,
      retry_count: post?.retry_count,
      recovery_count: post?.recovery_count,
      external_post_id: post?.external_post_id,
      publication_authorized_at: post?.publication_authorized_at,
      publication_authorized_by: post?.publication_authorized_by,
      scheduled_at: post?.scheduled_at,
      ahora_utc: now.toISOString(),
      due_ahora: isDue,
      segundos_restantes: isDue ? 0 : Math.round((scheduledMs - now.getTime()) / 1000),
    })
  );

  console.log("\n=== Identidad / autorizacion / publisher ===");
  console.log(
    JSON.stringify({
      social_account_platform: igAccount?.platform,
      social_account_is_active: igAccount?.is_active,
      canal_coincide: igAccount?.channel_id === contentAccount?.channel_id,
      channel_status: contentAccount?.channel_status,
      channelAuthorization: authOutcome,
      publisher_instagram_disponible: Boolean(PUBLISHERS.instagram),
    })
  );

  console.log(`\nDRY_RUN actual: ${DRY_RUN}`);
}

main().catch((err) => {
  console.error("Error:", err instanceof Error ? err.message : err);
  process.exit(1);
});

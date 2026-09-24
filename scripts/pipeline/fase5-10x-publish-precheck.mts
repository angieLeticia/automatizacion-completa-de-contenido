// FASE 5.10-X — precheck 100% READ-ONLY de Publish DRY_RUN para los 3 posts
// recien creados. Cero escritura. Los ids se consultan frescos de Supabase,
// nunca hardcodeados desde memoria.
import "./env.mts";
import { supabaseAdmin } from "../../agent/supabaseClient.mts";
import { DRY_RUN } from "../../agent/publish/config.mts";
import { PUBLISHERS } from "../../lib/social/publishers.ts";
import { evaluateChannelAuthorization } from "../../agent/publish/channelAuthorization.mts";

const CANDIDATE_FILE_ID = "9a69c9d5-22c7-4c28-80d9-b5aa6ec331cf";
const SIN_EXPLICACION_ID = "d875e649-d554-4a36-897b-bb3161244b6d";

async function main() {
  console.log(`DRY_RUN actual (agent/publish/config.mts): ${DRY_RUN}`);
  const now = new Date();
  console.log(`Hora de referencia (UTC): ${now.toISOString()}`);

  const { data: posts, error } = await supabaseAdmin
    .from("social_posts")
    .select(
      "id, account_id, content_file_id, status, scheduled_at, retry_count, recovery_count, external_post_id, publication_authorized_at, publication_authorized_by"
    )
    .eq("content_file_id", CANDIDATE_FILE_ID)
    .order("scheduled_at");
  if (error) throw new Error(error.message);
  console.log(`\nTotal posts encontrados para este content_file_id: ${posts?.length ?? 0}`);

  const { data: contentAccount, error: caError } = await supabaseAdmin
    .from("content_accounts")
    .select("id, channel_id, channel_status")
    .eq("id", SIN_EXPLICACION_ID)
    .maybeSingle();
  if (caError) throw new Error(caError.message);

  for (const p of posts ?? []) {
    const { data: socialAccount, error: saError } = await supabaseAdmin
      .from("social_accounts")
      .select("id, channel_id, platform, is_active")
      .eq("id", p.account_id)
      .maybeSingle();
    if (saError) throw new Error(saError.message);

    const channelMatch = socialAccount?.channel_id === contentAccount?.channel_id;
    const authOutcome = evaluateChannelAuthorization(contentAccount?.channel_status ?? null);
    const publisherAvailable = Boolean(socialAccount && PUBLISHERS[socialAccount.platform as keyof typeof PUBLISHERS]);
    const scheduledMs = new Date(p.scheduled_at as string).getTime();
    const isDue = scheduledMs <= now.getTime();

    console.log(`\n=== POST ${p.id} (${socialAccount?.platform ?? "?"}) ===`);
    console.log(
      JSON.stringify({
        id: p.id,
        platform: socialAccount?.platform,
        status: p.status,
        scheduled_at: p.scheduled_at,
        due_ahora: isDue,
        segundos_hasta_due: isDue ? 0 : Math.round((scheduledMs - now.getTime()) / 1000),
        account_id: p.account_id,
        content_file_id: p.content_file_id,
        content_file_id_coincide: p.content_file_id === CANDIDATE_FILE_ID,
        retry_count: p.retry_count,
        recovery_count: p.recovery_count,
        external_post_id: p.external_post_id,
        publication_authorized_at: p.publication_authorized_at,
        publication_authorized_by: p.publication_authorized_by,
        social_account_active: socialAccount?.is_active,
        canal_coincide: channelMatch,
        channel_status: contentAccount?.channel_status,
        channelAuthorization: authOutcome,
        publisher_disponible: publisherAvailable,
      })
    );
  }
}

main().catch((err) => {
  console.error("Error:", err instanceof Error ? err.message : err);
  process.exit(1);
});

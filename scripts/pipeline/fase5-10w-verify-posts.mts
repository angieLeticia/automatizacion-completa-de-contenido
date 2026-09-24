import "./env.mts";
import { supabaseAdmin } from "../../agent/supabaseClient.mts";

const CANDIDATE_FILE_ID = "9a69c9d5-22c7-4c28-80d9-b5aa6ec331cf";

async function main() {
  const { data: posts, error } = await supabaseAdmin
    .from("social_posts")
    .select("id, account_id, content_file_id, status, scheduled_at, schedule_rule_id, title, retry_count, recovery_count, external_post_id")
    .eq("content_file_id", CANDIDATE_FILE_ID)
    .order("scheduled_at");
  if (error) throw new Error(error.message);

  const { data: socialAccounts } = await supabaseAdmin.from("social_accounts").select("id, platform").in("id", (posts ?? []).map((p) => p.account_id));
  const platformById = new Map((socialAccounts ?? []).map((s) => [s.id as string, s.platform as string]));

  console.log(`Total social_posts para este content_file_id: ${posts?.length ?? 0}`);
  for (const p of posts ?? []) {
    console.log(
      JSON.stringify({
        id: p.id,
        platform: platformById.get(p.account_id as string),
        account_id: p.account_id,
        status: p.status,
        scheduled_at: p.scheduled_at,
        schedule_rule_id: p.schedule_rule_id,
        title: p.title,
        retry_count: p.retry_count,
        recovery_count: p.recovery_count,
        external_post_id: p.external_post_id,
      })
    );
  }

  console.log("\n=== Cualquier social_post que pudiera estar relacionado con TikTok (no deberia haber ninguno) ===");
  const { data: allAccounts } = await supabaseAdmin.from("social_accounts").select("id, platform").eq("platform", "tiktok");
  console.log(`social_accounts platform=tiktok existentes en todo el sistema: ${allAccounts?.length ?? 0}`);
}

main().catch((err) => {
  console.error("Error:", err instanceof Error ? err.message : err);
  process.exit(1);
});

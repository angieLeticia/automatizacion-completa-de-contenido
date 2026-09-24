// FASE 5.10-AG — inspeccion READ-ONLY del unico social_post en status='error'
// hoy, para el informe de auditoria general (manejo de errores real).
import "./env.mts";
import { supabaseAdmin } from "../../agent/supabaseClient.mts";

async function main() {
  const { data, error } = await supabaseAdmin
    .from("social_posts")
    .select("id, account_id, content_file_id, status, error_message, retry_count, recovery_count, scheduled_at, published_at, external_post_id")
    .eq("status", "error");
  if (error) throw new Error(error.message);

  console.log(`Total en status='error': ${data?.length ?? 0}`);
  for (const p of data ?? []) {
    const { data: acct } = await supabaseAdmin.from("social_accounts").select("platform, channel_id").eq("id", p.account_id).maybeSingle();
    console.log(
      JSON.stringify({
        id: p.id,
        platform: acct?.platform,
        error_message: p.error_message,
        retry_count: p.retry_count,
        recovery_count: p.recovery_count,
        scheduled_at: p.scheduled_at,
      })
    );
  }
}

main().catch((err) => {
  console.error("Error:", err instanceof Error ? err.message : err);
  process.exit(1);
});

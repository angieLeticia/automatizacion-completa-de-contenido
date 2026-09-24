// FASE 5.10-E, PASO 6 — inventario READ-ONLY de lo que agent/schedule/run.mts
// CREARIA si se ejecutara ahora (content_metadata.status='ready' -> content_file
// -> content_account -> social_accounts -> candidato de social_post). Cero
// INSERT. Replica la MISMA cadena que scheduleReadyContent()/resolveTargetsForContentAccount()
// usan, sin llamarlas, para poder listar los candidatos sin ningun efecto.
import "./env.mts";
import { supabaseAdmin } from "../../agent/supabaseClient.mts";

const PRODUCTION_FOLDER_NAMES = ["SIN EXPLICACIÓN", "ENCIENDE EL CAOS", "LUNA VERDE", "OBJETOS MALDITOS"];

async function main() {
  const { data: accounts } = await supabaseAdmin
    .from("content_accounts")
    .select("id, folder_name, channel_id")
    .in("folder_name", PRODUCTION_FOLDER_NAMES);
  const accountById = new Map((accounts ?? []).map((a) => [a.id as string, a]));
  const contentAccountIds = (accounts ?? []).map((a) => a.id as string);
  const channelIds = (accounts ?? []).map((a) => a.channel_id as string);

  const { data: socialAccounts } = await supabaseAdmin.from("social_accounts").select("id, channel_id, platform").in("channel_id", channelIds);
  const socialByChannel = new Map<string, { id: string; platform: string }[]>();
  for (const sa of socialAccounts ?? []) {
    const list = socialByChannel.get(sa.channel_id as string) ?? [];
    list.push({ id: sa.id as string, platform: sa.platform as string });
    socialByChannel.set(sa.channel_id as string, list);
  }

  console.log("=== content_metadata.status='ready' dentro de las 4 cuentas de produccion ===");
  const { data: files } = await supabaseAdmin.from("content_files").select("id, content_account_id, file_path").in("content_account_id", contentAccountIds);
  const fileIds = (files ?? []).map((f) => f.id as string);
  const fileById = new Map((files ?? []).map((f) => [f.id as string, f]));

  const { data: readyMeta, error } = await supabaseAdmin
    .from("content_metadata")
    .select("id, content_file_id, platform_metadata, status")
    .eq("status", "ready")
    .in("content_file_id", fileIds);
  if (error) throw new Error(error.message);

  console.log(`Total content_metadata en status='ready': ${readyMeta?.length ?? 0}`);

  for (const meta of readyMeta ?? []) {
    const file = fileById.get(meta.content_file_id as string);
    const account = file ? accountById.get(file.content_account_id as string) : undefined;
    const platformKeys = Object.keys((meta.platform_metadata as Record<string, unknown>) ?? {});
    console.log(`\n- content_metadata=${meta.id} content_file=${meta.content_file_id} cuenta=${account?.folder_name ?? "?"} file=${file?.file_path ?? "?"}`);
    console.log(`  platform_metadata keys: ${platformKeys.join(", ") || "(ninguna)"}`);

    if (!account) continue;
    const targets = socialByChannel.get(account.channel_id) ?? [];
    for (const t of targets) {
      const { data: existing } = await supabaseAdmin
        .from("social_posts")
        .select("id, status, scheduled_at")
        .eq("content_file_id", meta.content_file_id)
        .eq("account_id", t.id)
        .maybeSingle();
      if (existing) {
        console.log(`  [YA EXISTE] ${t.platform} -> social_post ${existing.id} (status=${existing.status}, scheduled_at=${existing.scheduled_at})`);
      } else {
        console.log(`  [SE CREARIA] ${t.platform} -> nuevo social_post (account_id=${t.id})`);
      }
    }
  }
}

main().catch((err) => {
  console.error("Error:", err instanceof Error ? err.message : err);
  process.exit(1);
});

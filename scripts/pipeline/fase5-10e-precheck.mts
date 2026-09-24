// FASE 5.10-E, PASO 1 — precheck READ-ONLY antes de arrancar los procesos
// autonomos con RUN_SCOPE=PRODUCTION. Cero INSERT/UPDATE/DELETE. Nunca
// selecciona columnas de credenciales (social_accounts.credentials nunca se
// pide en el .select()).
import "./env.mts";
import { supabaseAdmin } from "../../agent/supabaseClient.mts";

const PRODUCTION_FOLDER_NAMES = ["SIN EXPLICACIÓN", "ENCIENDE EL CAOS", "LUNA VERDE", "OBJETOS MALDITOS"];

async function main() {
  console.log("=== 1. CONTENT_ACCOUNTS (4 cuentas de produccion) ===");
  const { data: accounts, error: accountsError } = await supabaseAdmin
    .from("content_accounts")
    .select("id, folder_name, channel_id, channel_status")
    .in("folder_name", PRODUCTION_FOLDER_NAMES);
  if (accountsError) throw new Error(`content_accounts: ${accountsError.message}`);
  for (const a of accounts ?? []) console.log(JSON.stringify(a));

  const channelIds = (accounts ?? []).map((a) => a.channel_id as string);
  const accountByChannelId = new Map((accounts ?? []).map((a) => [a.channel_id as string, a.folder_name as string]));

  console.log("\n=== 2. SOCIAL_ACCOUNTS (solo id, channel_id, platform) ===");
  const { data: socialAccounts, error: saError } = await supabaseAdmin
    .from("social_accounts")
    .select("id, channel_id, platform")
    .in("channel_id", channelIds);
  if (saError) throw new Error(`social_accounts: ${saError.message}`);
  for (const s of socialAccounts ?? []) console.log(JSON.stringify({ ...s, channel: accountByChannelId.get(s.channel_id as string) }));

  const socialAccountIds = (socialAccounts ?? []).map((s) => s.id as string);
  const socialAccountMeta = new Map(
    (socialAccounts ?? []).map((s) => [s.id as string, { channel: accountByChannelId.get(s.channel_id as string) ?? "?", platform: s.platform as string }])
  );

  console.log("\n=== 3. SOCIAL_POSTS (inventario, columnas no sensibles) ===");
  const { data: posts, error: postsError } = await supabaseAdmin
    .from("social_posts")
    .select("id, account_id, content_file_id, status, scheduled_at, external_post_id, retry_count, recovery_count, created_at")
    .in("account_id", socialAccountIds)
    .order("scheduled_at", { ascending: true });
  if (postsError) throw new Error(`social_posts: ${postsError.message}`);

  const now = new Date();
  console.log(`Total de posts encontrados (dentro de los 4 canales reales): ${posts?.length ?? 0}`);
  console.log(`Hora de referencia (UTC): ${now.toISOString()}`);

  console.log("\n--- Detalle ---");
  for (const p of posts ?? []) {
    const meta = socialAccountMeta.get(p.account_id as string) ?? { channel: "?", platform: "?" };
    const overdue = p.status === "pending" && p.scheduled_at && new Date(p.scheduled_at as string) <= now;
    console.log(
      JSON.stringify({
        id: p.id,
        channel: meta.channel,
        platform: meta.platform,
        status: p.status,
        scheduled_at: p.scheduled_at,
        overdue,
        external_post_id: p.external_post_id,
        retry_count: p.retry_count,
        recovery_count: p.recovery_count,
        created_at: p.created_at,
      })
    );
  }

  console.log("\n=== 4. AGRUPACION por channel / platform / status ===");
  const groups = new Map<string, number>();
  for (const p of posts ?? []) {
    const meta = socialAccountMeta.get(p.account_id as string) ?? { channel: "?", platform: "?" };
    const key = `${meta.channel} | ${meta.platform} | ${p.status}`;
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  for (const [key, count] of [...groups.entries()].sort()) {
    console.log(`${key}: ${count}`);
  }

  console.log("\n=== 5. FOCO — pending / publishing / verification_required / error ===");
  for (const targetStatus of ["pending", "publishing", "verification_required", "error"]) {
    const rows = (posts ?? []).filter((p) => p.status === targetStatus);
    console.log(`status='${targetStatus}': ${rows.length} fila(s)`);
    for (const p of rows) {
      const meta = socialAccountMeta.get(p.account_id as string) ?? { channel: "?", platform: "?" };
      const overdue = targetStatus === "pending" && p.scheduled_at && new Date(p.scheduled_at as string) <= now;
      console.log(`  - id=${p.id} channel=${meta.channel} platform=${meta.platform} scheduled_at=${p.scheduled_at} overdue=${overdue}`);
    }
  }

  console.log("\n=== 6. RIESGO PARA PUBLISH — pending VENCIDOS en canales con channel_status distinto de ACTIVE ===");
  const channelStatusByChannel = new Map((accounts ?? []).map((a) => [a.folder_name as string, a.channel_status as string]));
  const pendingOverdueRisky = (posts ?? []).filter((p) => {
    if (p.status !== "pending" || !p.scheduled_at || new Date(p.scheduled_at as string) > now) return false;
    const meta = socialAccountMeta.get(p.account_id as string);
    if (!meta) return false;
    const status = channelStatusByChannel.get(meta.channel);
    return status !== "ACTIVE";
  });
  console.log(`Posts pending vencidos en canales NO-ACTIVE (candidatos a ser corrompidos por Publish real, ver Fase 5.7): ${pendingOverdueRisky.length}`);
  for (const p of pendingOverdueRisky) {
    const meta = socialAccountMeta.get(p.account_id as string)!;
    console.log(`  - id=${p.id} channel=${meta.channel} (channel_status=${channelStatusByChannel.get(meta.channel)}) platform=${meta.platform} scheduled_at=${p.scheduled_at}`);
  }
}

main().catch((err) => {
  console.error("Error:", err instanceof Error ? err.message : err);
  process.exit(1);
});

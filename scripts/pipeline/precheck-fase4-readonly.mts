// Fase 4 — PRECHECK READ-ONLY. SOLO SELECT, nunca INSERT/UPDATE/DELETE/ALTER.
// Nunca selecciona columnas de credenciales (credentials/access_token/
// refresh_token/client_secret/password/cookies) — solo metadata estructural
// no sensible, exactamente como pidió el usuario. Este script se conserva en
// el repo como evidencia de la auditoría (no se ejecuta en ningún ciclo
// automático, no lo importa ningún otro módulo).
import "./env.mts"; // SIEMPRE primero — carga .env.local antes de que supabaseClient.mts lea process.env
import { supabaseAdmin } from "../../agent/supabaseClient.mts";

const TEST_MARKERS = /FASE4|TEST|SANDBOX/i;

async function main() {
  console.log("=== 1. social_channels ===");
  const { data: channels, error: channelsErr } = await supabaseAdmin.from("social_channels").select("id, name, is_active, created_at");
  if (channelsErr) console.log("ERROR:", channelsErr.message);
  else {
    for (const c of channels ?? []) console.log(`- id=${c.id} name="${c.name}" is_active=${c.is_active}`);
    const testish = (channels ?? []).filter((c) => TEST_MARKERS.test(c.name));
    console.log(`Total: ${channels?.length ?? 0} | coinciden con FASE4/TEST/SANDBOX: ${testish.length}`);
  }

  console.log("\n=== 2. content_accounts ===");
  const { data: accounts, error: accountsErr } = await supabaseAdmin
    .from("content_accounts")
    .select("id, folder_name, channel_id, channel_status, is_active, created_at");
  if (accountsErr) console.log("ERROR:", accountsErr.message);
  else {
    for (const a of accounts ?? []) console.log(`- id=${a.id} folder_name="${a.folder_name}" channel_id=${a.channel_id} channel_status=${a.channel_status} is_active=${a.is_active}`);
    const testish = (accounts ?? []).filter((a) => TEST_MARKERS.test(a.folder_name));
    console.log(`Total: ${accounts?.length ?? 0} | coinciden con FASE4/TEST/SANDBOX: ${testish.length}`);
  }

  console.log("\n=== 3. social_accounts (SIN credentials) ===");
  const { data: socialAccounts, error: socialAccountsErr } = await supabaseAdmin
    .from("social_accounts")
    .select("id, channel_id, platform, label, is_active, created_at");
  if (socialAccountsErr) console.log("ERROR:", socialAccountsErr.message);
  else {
    for (const s of socialAccounts ?? []) console.log(`- id=${s.id} channel_id=${s.channel_id} platform=${s.platform} label="${s.label}" is_active=${s.is_active}`);
    const testish = (socialAccounts ?? []).filter((s) => TEST_MARKERS.test(s.label ?? ""));
    console.log(`Total: ${socialAccounts?.length ?? 0} | coinciden con FASE4/TEST/SANDBOX (por label): ${testish.length}`);
  }

  console.log("\n=== 4. content_files (buscando marcadores de prueba) ===");
  const { data: files, error: filesErr } = await supabaseAdmin
    .from("content_files")
    .select("id, content_account_id, episode_id, folder_type, status, file_size, detected_at")
    .order("detected_at", { ascending: false })
    .limit(500);
  if (filesErr) console.log("ERROR:", filesErr.message);
  else {
    const testish = (files ?? []).filter((f) => TEST_MARKERS.test(f.episode_id ?? ""));
    console.log(`Total (últimos 500 por detected_at): ${files?.length ?? 0} | episode_id coincide con FASE4/TEST/SANDBOX: ${testish.length}`);
    for (const f of testish) console.log(`  - id=${f.id} content_account_id=${f.content_account_id} episode_id="${f.episode_id}" folder_type=${f.folder_type} status=${f.status} size=${f.file_size} detected_at=${f.detected_at}`);
  }

  console.log("\n=== 5. content_metadata (asociada a content_files de prueba, si las hubo arriba) ===");
  const testFileIds = ((await supabaseAdmin.from("content_files").select("id, episode_id").limit(2000)).data ?? [])
    .filter((f) => TEST_MARKERS.test(f.episode_id ?? ""))
    .map((f) => f.id);
  if (testFileIds.length === 0) {
    console.log("No hay content_files de prueba detectados arriba — nada que buscar aquí.");
  } else {
    const { data: metas, error: metasErr } = await supabaseAdmin
      .from("content_metadata")
      .select("id, content_file_id, status, has_speech, duration_seconds, retry_count, created_at")
      .in("content_file_id", testFileIds);
    if (metasErr) console.log("ERROR:", metasErr.message);
    else for (const m of metas ?? []) console.log(`- id=${m.id} content_file_id=${m.content_file_id} status=${m.status} has_speech=${m.has_speech} duration=${m.duration_seconds} retry_count=${m.retry_count}`);
  }

  console.log("\n=== 6. social_posts (buscando marcadores de prueba vía title/caption, SIN credentials) ===");
  const { data: posts, error: postsErr } = await supabaseAdmin
    .from("social_posts")
    .select("id, content_file_id, account_id, title, status, scheduled_at, publication_authorized_at, publication_authorized_by, external_post_id, retry_count, recovery_count, created_at")
    .order("created_at", { ascending: false })
    .limit(500);
  if (postsErr) console.log("ERROR:", postsErr.message);
  else {
    const testish = (posts ?? []).filter((p) => TEST_MARKERS.test(p.title ?? ""));
    console.log(`Total (últimos 500 por created_at): ${posts?.length ?? 0} | title coincide con FASE4/TEST/SANDBOX: ${testish.length}`);
    for (const p of testish) console.log(`  - id=${p.id} status=${p.status} scheduled_at=${p.scheduled_at} authorized_at=${p.publication_authorized_at} authorized_by=${p.publication_authorized_by} external_post_id=${p.external_post_id} retry_count=${p.retry_count} recovery_count=${p.recovery_count}`);
  }

  console.log("\n=== 7. posting_schedule_rules ===");
  const { data: rules, error: rulesErr } = await supabaseAdmin
    .from("posting_schedule_rules")
    .select("id, content_account_id, platform, day_of_week, window_start, window_end, max_posts_per_day, is_active");
  if (rulesErr) console.log("ERROR:", rulesErr.message);
  else {
    console.log(`Total reglas: ${rules?.length ?? 0}`);
    for (const r of rules ?? []) console.log(`- content_account_id=${r.content_account_id ?? "GLOBAL"} platform=${r.platform} day_of_week=${r.day_of_week ?? "cualquiera"} window=${r.window_start}-${r.window_end} max_posts_per_day=${r.max_posts_per_day} is_active=${r.is_active}`);
  }

  console.log("\n=== 8. SERIES en Supabase ===");
  const { error: episodesTableErr } = await supabaseAdmin.from("episodes").select("id").limit(1);
  const { error: seriesTableErr } = await supabaseAdmin.from("series").select("id").limit(1);
  console.log(`tabla 'episodes' existe: ${episodesTableErr ? "NO (" + episodesTableErr.message + ")" : "SÍ — INESPERADO, ver docs/database-contract.md:206"}`);
  console.log(`tabla 'series' existe: ${seriesTableErr ? "NO (" + seriesTableErr.message + ")" : "SÍ — INESPERADO, ver docs/database-contract.md:206"}`);

  console.log("\n=== FIN PRECHECK — 100% SELECT, cero escrituras ===");
}

main().catch((err) => {
  console.error("Error ejecutando el precheck:", err instanceof Error ? err.message : err);
  process.exit(1);
});

import "./env.mts";
import { supabaseAdmin } from "../../agent/supabaseClient.mts";

async function main() {
  // 1. content_accounts (canales reales)
  const { data: accounts, error: accErr } = await supabaseAdmin
    .from("content_accounts")
    .select("id, folder_name, is_active");
  if (accErr) throw new Error("content_accounts: " + accErr.message);
  console.log(`\n=== content_accounts (${accounts?.length ?? 0}) ===`);
  for (const a of accounts ?? []) console.log(`  ${a.id}  ${a.folder_name}  is_active=${a.is_active}`);
  const accountFolderById = new Map((accounts ?? []).map((a) => [a.id as string, a.folder_name as string]));
  const validAccountIds = new Set((accounts ?? []).map((a) => a.id as string));

  // 2. content_files por content_account_id + hash nulls + metadata match
  const { data: files, error: filesErr } = await supabaseAdmin
    .from("content_files")
    .select("id, content_account_id, file_hash, status");
  if (filesErr) throw new Error("content_files: " + filesErr.message);
  console.log(`\n=== content_files: total=${files?.length ?? 0} ===`);

  const countByAccount = new Map<string, number>();
  const nullHash: string[] = [];
  const orphanAccount: { id: string; content_account_id: string | null }[] = [];
  for (const f of files ?? []) {
    const acc = f.content_account_id as string | null;
    countByAccount.set(acc ?? "NULL", (countByAccount.get(acc ?? "NULL") ?? 0) + 1);
    if (!f.file_hash) nullHash.push(f.id as string);
    if (!acc || !validAccountIds.has(acc)) orphanAccount.push({ id: f.id as string, content_account_id: acc });
  }
  console.log("content_files por cuenta:");
  for (const [accId, n] of countByAccount) {
    const label = accId === "NULL" ? "NULL" : accountFolderById.get(accId) ?? `DESCONOCIDA(${accId})`;
    console.log(`  ${label}: ${n}`);
  }
  console.log(`content_files con file_hash NULL/vacio: ${nullHash.length}`);
  console.log(`content_files con content_account_id huerfano/invalido: ${orphanAccount.length}`);
  if (orphanAccount.length) console.log(JSON.stringify(orphanAccount.slice(0, 20)));

  // content_metadata coverage
  const fileIds = (files ?? []).map((f) => f.id as string);
  let metaCount = 0;
  const CHUNK = 500;
  for (let i = 0; i < fileIds.length; i += CHUNK) {
    const chunk = fileIds.slice(i, i + CHUNK);
    const { data: metas, error: metaErr } = await supabaseAdmin
      .from("content_metadata")
      .select("content_file_id")
      .in("content_file_id", chunk);
    if (metaErr) throw new Error("content_metadata: " + metaErr.message);
    metaCount += metas?.length ?? 0;
  }
  console.log(`\ncontent_files CON content_metadata asociado: ${metaCount}`);
  console.log(`content_files SIN content_metadata asociado: ${(files?.length ?? 0) - metaCount}`);

  // 3. social_posts por status
  const { data: posts, error: postsErr } = await supabaseAdmin
    .from("social_posts")
    .select("id, status, claimed_at, publisher_operation_ref, publication_authorized_at, publication_authorized_by, retry_count, recovery_count, scheduled_at, account_id");
  if (postsErr) throw new Error("social_posts: " + postsErr.message);
  console.log(`\n=== social_posts: total=${posts?.length ?? 0} ===`);
  const byStatus = new Map<string, number>();
  for (const p of posts ?? []) byStatus.set(p.status as string, (byStatus.get(p.status as string) ?? 0) + 1);
  for (const [status, n] of byStatus) console.log(`  status=${status}: ${n}`);

  // claimed_at column presence/population check
  const withClaimedAt = (posts ?? []).filter((p) => p.claimed_at).length;
  const withOpRef = (posts ?? []).filter((p) => p.publisher_operation_ref).length;
  const withAuthAt = (posts ?? []).filter((p) => p.publication_authorized_at).length;
  console.log(`\nclaimed_at poblado (no NULL): ${withClaimedAt} / ${posts?.length ?? 0}`);
  console.log(`publisher_operation_ref poblado (no NULL): ${withOpRef} / ${posts?.length ?? 0}`);
  console.log(`publication_authorized_at poblado (no NULL): ${withAuthAt} / ${posts?.length ?? 0}`);

  // orphaned claims: status='publishing' AND claimed_at older than 2h
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
  const orphanClaims = (posts ?? []).filter(
    (p) => p.status === "publishing" && p.claimed_at && new Date(p.claimed_at as string) < twoHoursAgo
  );
  console.log(`\n=== Claims potencialmente huerfanos (status=publishing, claimed_at > 2h) ===`);
  console.log(`Encontrados: ${orphanClaims.length}`);
  for (const p of orphanClaims) {
    console.log(
      JSON.stringify({
        id: p.id,
        claimed_at: p.claimed_at,
        publisher_operation_ref: p.publisher_operation_ref,
        retry_count: p.retry_count,
        recovery_count: p.recovery_count,
        scheduled_at: p.scheduled_at,
      })
    );
  }

  // any 'publishing' status at all (regardless of age) for context
  const anyPublishing = (posts ?? []).filter((p) => p.status === "publishing");
  console.log(`\nTotal status='publishing' (cualquier antiguedad): ${anyPublishing.length}`);
  for (const p of anyPublishing) {
    console.log(JSON.stringify({ id: p.id, claimed_at: p.claimed_at, publisher_operation_ref: p.publisher_operation_ref }));
  }

  // 4. try episode_log existence (schema.sql marks it as NOT applied in prod)
  console.log(`\n=== Verificando existencia real de episode_log ===`);
  const { error: episodeLogErr } = await supabaseAdmin.from("episode_log").select("id").limit(1);
  if (episodeLogErr) {
    console.log(`episode_log: NO existe o no accesible -> ${episodeLogErr.message}`);
  } else {
    console.log(`episode_log: SI existe (query exitosa)`);
  }

  // check episode_id column on content_files (also marked as not-applied)
  console.log(`\n=== Verificando columna episode_id en content_files ===`);
  const { error: episodeIdErr } = await supabaseAdmin.from("content_files").select("episode_id").limit(1);
  if (episodeIdErr) {
    console.log(`content_files.episode_id: NO existe -> ${episodeIdErr.message}`);
  } else {
    console.log(`content_files.episode_id: SI existe`);
  }

  // check channel_status column on content_accounts (also marked as not-applied)
  console.log(`\n=== Verificando columna channel_status en content_accounts ===`);
  const { error: chStatusErr } = await supabaseAdmin.from("content_accounts").select("channel_status").limit(1);
  if (chStatusErr) {
    console.log(`content_accounts.channel_status: NO existe -> ${chStatusErr.message}`);
  } else {
    console.log(`content_accounts.channel_status: SI existe`);
  }

  // check recovery_count column (marked not-applied in schema.sql but referenced in verify-posts script select)
  console.log(`\n=== Verificando columna recovery_count en social_posts ===`);
  const { error: recCountErr } = await supabaseAdmin.from("social_posts").select("recovery_count").limit(1);
  if (recCountErr) {
    console.log(`social_posts.recovery_count: NO existe -> ${recCountErr.message}`);
  } else {
    console.log(`social_posts.recovery_count: SI existe`);
  }

  console.log(`\nCLAIMED_AT_MIGRATION_APPLIED (env, en el proceso actual): ${process.env.CLAIMED_AT_MIGRATION_APPLIED}`);
}

main().catch((err) => {
  console.error("Error:", err instanceof Error ? err.message : err);
  process.exit(1);
});

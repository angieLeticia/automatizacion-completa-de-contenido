// Orquestador de la Fase 4B.1: capa de publicacion endurecida.
//
//   PENDING + scheduled_at<=NOW() -> CLAIM ATOMICO -> resolver content_file
//     -> verificar archivo local -> subir a Storage (si hace falta) -> resolver
//     identidad + validar credenciales -> DRY_RUN (reporta y revierte a pending)
//     o PUBLISH real (llama al publisher YA EXISTENTE, sin reescribirlo)
//     -> exito: published ; fallo: retryPolicy decide pending/error
//
// NUNCA reescribe lib/social/publishers.ts - solo lo invoca. NO se conecta a
// agent/schedule ni al script legacy scripts/publish-due-social-posts.mts.
import "./config.mts";
import { supabaseAdmin } from "../supabaseClient.mts";
import { log } from "../logger.mts";
import { DRY_RUN, CLAIMED_AT_MIGRATION_APPLIED } from "./config.mts";
import { claimPost, revertToPending } from "./claimPost.mts";
import { resolveAndVerifyContentFile } from "./resolveContentFile.mts";
import { ensureUploadedToStorage } from "./storageBridge.mts";
import { resolveAndValidateIdentity } from "./resolveIdentity.mts";
import { classifyError, decideRetry } from "./retryPolicy.mts";
import { PUBLISHERS } from "../../lib/social/publishers.ts";
import type { SocialPostRow } from "./types.mts";

interface DueRow {
  id: string;
}

async function processPost(postId: string): Promise<void> {
  const claimed = await claimPost(postId);
  if (!claimed) {
    log.info("[PUBLISH] Claim perdido - otro proceso ya lo tomo o ya no estaba pending", { postId });
    return;
  }
  const post = claimed as SocialPostRow;
  log.info("[PUBLISH] Claim ganado", { postId: post.id, dryRun: DRY_RUN });

  const fileOutcome = await resolveAndVerifyContentFile(post.content_file_id);
  if (!fileOutcome.ok) {
    await finishWithFailure(post, fileOutcome.reason, fileOutcome.retryable);
    return;
  }

  const identityOutcome = await resolveAndValidateIdentity(post.account_id, fileOutcome.contentFile.content_account_id);
  if (!identityOutcome.ok) {
    await finishWithFailure(post, identityOutcome.reason, false);
    return;
  }

  const platform = identityOutcome.account.platform;

  // Entrega del archivo al publisher: YouTube NO exige URL publica (su protocolo
  // resumable acepta un stream directo, ver auditoria Fase 4B.5) - se entrega
  // DIRECTO desde disco, sin pasar por Supabase Storage (evita el limite de
  // 50MiB del plan gratuito). Instagram/Facebook mantienen el flujo via Storage
  // sin ningun cambio.
  let postForPublisher: Record<string, unknown>;
  let deliveryLog: Record<string, unknown>;

  if (platform === "youtube") {
    postForPublisher = { ...post, local_file_path: fileOutcome.contentFile.file_path };
    deliveryLog = { delivery: "local-direct", localFilePath: fileOutcome.contentFile.file_path };
    log.info("[PUBLISH] YouTube: entrega directa desde disco local (sin Supabase Storage)", {
      postId: post.id,
      localFilePath: fileOutcome.contentFile.file_path,
    });
  } else {
    try {
      const uploadResult = await ensureUploadedToStorage(fileOutcome.contentFile);
      postForPublisher = { ...post, video_url: uploadResult.videoUrl, video_path: uploadResult.videoPath };
      deliveryLog = { delivery: "storage", videoUrl: uploadResult.videoUrl, videoPath: uploadResult.videoPath };
      log.info(uploadResult.alreadyExisted ? "[PUBLISH] Video ya existia en Storage - reutilizado" : "[PUBLISH] Video subido a Storage", {
        postId: post.id,
        videoPath: uploadResult.videoPath,
      });
    } catch (err) {
      await finishWithFailure(post, err instanceof Error ? err.message : String(err), true);
      return;
    }
  }

  if (DRY_RUN) {
    log.info("[PUBLISH][DRY_RUN] Se habria publicado - deteniendose ANTES de llamar a la API externa", {
      postId: post.id,
      platform,
      socialAccountLabel: identityOutcome.account.label,
      ...deliveryLog,
      title: post.title,
      hashtagCount: post.hashtags.length,
    });
    await revertToPending(post.id);
    log.info("[PUBLISH][DRY_RUN] Revertido a pending (no se persiste ningun resultado de dry-run)", { postId: post.id });
    return;
  }

  // A partir de aqui seria publicacion REAL - no se ejecuta durante esta fase.
  const publish = PUBLISHERS[platform as Exclude<typeof platform, "tiktok">];
  if (!publish) {
    await finishWithFailure(post, `Sin publisher para '${platform}'.`, false);
    return;
  }

  try {
    const { externalPostId } = await publish(postForPublisher as unknown as Parameters<typeof publish>[0], identityOutcome.account.credentials);
    const publishedPayload: Record<string, unknown> = { status: "published", external_post_id: externalPostId, published_at: new Date().toISOString(), error_message: null };
    if (CLAIMED_AT_MIGRATION_APPLIED) {
      publishedPayload.claimed_at = null;
    }
    await supabaseAdmin.from("social_posts").update(publishedPayload).eq("id", post.id);
    log.info("[PUBLISH] Publicado con exito", { postId: post.id, externalPostId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await finishWithFailure(post, message, classifyError(message) === "retryable");
  }
}

async function finishWithFailure(post: SocialPostRow, reason: string, retryable: boolean): Promise<void> {
  const decision = decideRetry(retryable ? "retryable" : "permanent", post.retry_count);
  log.warn("[PUBLISH] Fallo - NO PUBLICAR", { postId: post.id, reason, retryable, nextStatus: decision.nextStatus, nextRetryCount: decision.nextRetryCount });
  // claimed_at se limpia siempre que se sale de 'publishing' (exito, pending o
  // error) - igual que revertToPending() - para que ninguna fila fuera de
  // 'publishing' quede con un timestamp de claim obsoleto. Gateado igual que en
  // claimPost.mts: solo se escribe si la migracion ya esta aplicada.
  const updatePayload: Record<string, unknown> = { status: decision.nextStatus, retry_count: decision.nextRetryCount, error_message: reason };
  if (CLAIMED_AT_MIGRATION_APPLIED) {
    updatePayload.claimed_at = null;
  }
  await supabaseAdmin.from("social_posts").update(updatePayload).eq("id", post.id);
}

async function main() {
  log.info(`[PUBLISH] Iniciando capa de publicacion endurecida (Fase 4B.1). DRY_RUN=${DRY_RUN}`);

  const { data: dueRows, error } = await supabaseAdmin
    .from("social_posts")
    .select("id")
    .eq("status", "pending")
    .lte("scheduled_at", new Date().toISOString());

  if (error) {
    log.error("[PUBLISH] Error consultando social_posts pendientes vencidos", { error: error.message });
    process.exitCode = 1;
    return;
  }

  log.info(`[PUBLISH] ${dueRows?.length ?? 0} publicacion(es) vencida(s) encontradas.`);

  for (const row of (dueRows ?? []) as DueRow[]) {
    await processPost(row.id);
  }

  log.info("[PUBLISH] Ciclo finalizado.");
}

main();

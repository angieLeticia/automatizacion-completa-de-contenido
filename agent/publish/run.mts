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
import { claimPost, revertToPending, recoverStaleClaims, markPublishAttemptStarted, persistOperationRef, finishWithUncertainOutcome } from "./claimPost.mts";
import { buildPersistenceFailureError } from "./uncertainOutcome.mts";
import { resolveAndVerifyContentFile } from "./resolveContentFile.mts";
import { ensureUploadedToStorage, cleanupVideoIfDone } from "./storageBridge.mts";
import { resolveAndValidateIdentity } from "./resolveIdentity.mts";
import { isPublicationAuthorized, describeAuthorizationGap } from "./humanReviewGate.mts";
import { verifyYoutubeChannelIdentity } from "./youtubeChannelIdentity.mts";
import { classifyError, decideRetry } from "./retryPolicy.mts";
import { PUBLISHERS } from "../../lib/social/publishers.ts";
import { PublicationOutcomeUncertainError } from "../../lib/social/types.ts";
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

  // Fase 5.2.1: channel_status es un control ADICIONAL a DRY_RUN, nunca un
  // sustituto — un canal sin authorizedForRealPublication (channel_status
  // distinto de ACTIVE) se trata igual que DRY_RUN=true, sin importar el
  // valor global de DRY_RUN (evita que activar DRY_RUN=false para un canal
  // ACTIVE arrastre consigo canales TEST/READY).
  //
  // Fase 5.14: publication_authorized_at/publication_authorized_by son una
  // TERCERA condición independiente, con la misma filosofía - ninguna de las
  // tres reemplaza a las otras dos. `post` viene de claimPost()'s `SELECT *`
  // (types.mts), así que si la migración de estas 2 columnas todavía no está
  // aplicada en Supabase, ambas llegan como `undefined` (no como un error) -
  // isPublicationAuthorized() trata eso exactamente igual que "ausentes":
  // NUNCA autorizado por defecto, con o sin la migración aplicada. Se
  // evalúa DESPUÉS del claim (no antes, no en la consulta de main()) a
  // propósito: filtrar por estas columnas en la consulta de posts vencidos
  // lanzaría hoy ("column does not exist") porque ahí sí sería una
  // referencia explícita a la columna, a diferencia de `SELECT *` - y
  // claimar+revertir un post sin autorización es exactamente el mismo costo,
  // ya aceptado, que claimar+revertir uno en DRY_RUN o channel_status=TEST.
  const humanAuthorized = isPublicationAuthorized(post);
  if (DRY_RUN || !identityOutcome.authorizedForRealPublication || !humanAuthorized) {
    log.info("[PUBLISH][DRY_RUN] Se habria publicado - deteniendose ANTES de llamar a la API externa", {
      postId: post.id,
      platform,
      socialAccountLabel: identityOutcome.account.label,
      reason: DRY_RUN
        ? "DRY_RUN"
        : !identityOutcome.authorizedForRealPublication
          ? `channel_status='${identityOutcome.channelStatus}' no autoriza publicación real`
          : describeAuthorizationGap(post),
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

  // Fase 5.18 — identidad ESTRUCTURAL de YouTube: DRY_RUN/channel_status/
  // Human Review ya garantizan "un humano autorizó publicar en este canal",
  // pero ninguno confirma que la cuenta configurada sea REALMENTE el canal
  // de YouTube que se cree que es (Fase 5.17 encontró que la única
  // "verificación" existente era leer el label a ojo). Se llama a Google
  // AQUÍ a propósito (no antes, no en resolveIdentity.mts) - es el único
  // punto donde ya se confirmó DRY_RUN=false + channel_status=ACTIVE +
  // autorización humana, así que es la única vez que de verdad se está a
  // punto de publicar - evita gastar cuota de la API / depender de Google
  // en cada ciclo de DRY_RUN rutinario. FAIL-CLOSED: cualquier resultado
  // que no sea VERIFIED bloquea, exactamente igual que un fallo de
  // DRY_RUN/channel_status/Human Review - nunca sustituye a esas barreras,
  // se suma a ellas. Alcance de esta fase: solo YouTube (única plataforma
  // con OAuth real verificado, Fase 5.17); Instagram/Facebook no tienen
  // credentials.channel_id y no se tocan aquí.
  if (platform === "youtube") {
    const identityCheck = await verifyYoutubeChannelIdentity(identityOutcome.account.credentials as { client_id: string; client_secret: string; refresh_token: string; channel_id?: string });
    if (identityCheck.status !== "VERIFIED") {
      log.warn("[PUBLISH] Identidad estructural de YouTube NO verificada - el publisher NO se invoca", {
        postId: post.id,
        platform,
        identityStatus: identityCheck.status,
        reason: identityCheck.reason,
      });
      await finishWithFailure(post, identityCheck.reason, identityCheck.retryable);
      return;
    }
    log.info("[PUBLISH] Identidad estructural de YouTube verificada contra la API real", { postId: post.id });
  }

  // Fase 5.4 - checkpoint ANTES de llamar al publisher real, para CUALQUIER
  // plataforma (incluida Facebook, que nunca obtiene una referencia real) -
  // es lo que le permite a recoverStaleClaims() distinguir con certeza "nunca
  // llegamos a intentar publicar" (CASO A, seguro reintentar) de "pudimos
  // haber llamado a la plataforma real" (CASO B/C, nunca reintento
  // automatico). Ver docs/phase-5.4-claim-recovery.md.
  //
  // Fase 5.4.3 (GAP 3 de la auditoria Fase 5.4.2) - este await vivia FUERA de
  // cualquier try/catch: si el UPDATE del checkpoint lanzaba (fallo real de
  // Supabase), la excepcion escapaba de processPost() sin capturar, llegaba
  // a main() (que se invoca sin .catch()) y tumbaba el CICLO COMPLETO -
  // dejando sin procesar cualquier otro post vencido de esa corrida, aunque
  // no tuviera nada que ver con este fallo. Se aisla aqui exactamente con el
  // mismo patron ya usado arriba para ensureUploadedToStorage(): el publisher
  // real NUNCA se llega a invocar (el catch retorna antes de eso, es la
  // garantia que pedia la auditoria), y se trata como un fallo reintentable
  // mas via finishWithFailure() - NUNCA verification_required, porque en
  // este punto la accion irreversible/publica TODAVIA no pudo haber ocurrido
  // (el checkpoint es deliberadamente anterior a publish()).
  try {
    await markPublishAttemptStarted(post.id, platform);
  } catch (err) {
    log.error("[PUBLISH] Fallo el checkpoint markPublishAttemptStarted - el publisher NO se invoca", {
      postId: post.id,
      platform,
      error: err instanceof Error ? err.message : String(err),
    });
    await finishWithFailure(post, err instanceof Error ? err.message : String(err), true);
    return;
  }

  try {
    const { externalPostId } = await publish(
      postForPublisher as unknown as Parameters<typeof publish>[0],
      identityOutcome.account.credentials,
      CLAIMED_AT_MIGRATION_APPLIED ? (ref) => persistOperationRef(post.id, ref) : undefined
    );
    const publishedPayload: Record<string, unknown> = { status: "published", external_post_id: externalPostId, published_at: new Date().toISOString(), error_message: null };
    if (CLAIMED_AT_MIGRATION_APPLIED) {
      publishedPayload.claimed_at = null;
      publishedPayload.publisher_operation_ref = null;
    }
    // Fase 5.4.1 (segundo audit) - hallazgo simétrico al gap original: aquí
    // ya tenemos externalPostId REAL (la plataforma confirmó éxito) - si esta
    // escritura a Supabase falla, es un caso INCLUSO más cierto que el de
    // parseo (conocemos el ID, solo falló persistirlo), pero el mismo
    // objetivo aplica: cualquier fallo DESPUÉS de una respuesta HTTP exitosa
    // nunca debe caer en el camino de retry genérico. Se envuelve el AWAIT
    // completo (no solo el campo `.error` devuelto) porque un fallo de red
    // real hacia Supabase puede hacer que la llamada LANCE en vez de
    // resolver con un objeto de error - ambos casos deben terminar igual.
    // El externalPostId ya conocido queda en el mensaje para que la
    // reconciliación humana sea directa (no hay que adivinar nada).
    try {
      const { error: publishedUpdateError } = await supabaseAdmin.from("social_posts").update(publishedPayload).eq("id", post.id);
      if (publishedUpdateError) {
        throw buildPersistenceFailureError(platform, externalPostId, publishedUpdateError);
      }
    } catch (persistErr) {
      if (persistErr instanceof PublicationOutcomeUncertainError) throw persistErr;
      const message = persistErr instanceof Error ? persistErr.message : String(persistErr);
      throw buildPersistenceFailureError(platform, externalPostId, { message });
    }
    log.info("[PUBLISH] Publicado con exito", { postId: post.id, externalPostId });

    // Fase 5.0 — pieza traída de Flow A (ver storageBridge.mts::cleanupVideoIfDone).
    // Solo aplica a lo que de verdad se subió a Storage (Instagram/Facebook) -
    // YouTube se entregó directo desde disco, nunca ocupó Storage.
    if (platform !== "youtube" && "video_path" in postForPublisher) {
      try {
        await cleanupVideoIfDone(postForPublisher.video_path as string);
      } catch (cleanupErr) {
        log.warn("[PUBLISH] No se pudo limpiar el video de Storage (no bloquea la publicación ya exitosa)", {
          postId: post.id,
          error: cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr),
        });
      }
    }
  } catch (err) {
    // Fase 5.4.1 — PublicationOutcomeUncertainError SIEMPRE se maneja aparte,
    // ANTES de cualquier clasificación por string: significa que la
    // plataforma ya respondió éxito HTTP (pudo haber aceptado/publicado de
    // verdad) y NUNCA debe tratarse como un fallo reintentable normal, sin
    // importar el contenido de su mensaje.
    if (err instanceof PublicationOutcomeUncertainError) {
      log.warn("[PUBLISH] Resultado incierto - la plataforma pudo haber aceptado la publicación, no se puede afirmar que no ocurrió", {
        postId: post.id,
        platform: err.platform,
        operationRef: err.operationRef,
        httpStatus: err.httpStatus,
        reason: err.message,
      });
      await finishWithUncertainOutcome(post.id, err);
      return;
    }
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
    updatePayload.publisher_operation_ref = null;
  }
  await supabaseAdmin.from("social_posts").update(updatePayload).eq("id", post.id);
}

async function main() {
  log.info(`[PUBLISH] Iniciando capa de publicacion endurecida (Fase 4B.1). DRY_RUN=${DRY_RUN}`);

  // Fase 5.4 - mismo patron ya probado en agent/analyze/run.mts:28 (Agent 2):
  // recuperar claims huerfanos ANTES de buscar trabajo nuevo. Inerte por
  // completo mientras CLAIMED_AT_MIGRATION_APPLIED=false (default), ver
  // claimPost.mts::recoverStaleClaims().
  const recovery = await recoverStaleClaims();
  if (recovery.recoveredToPending || recovery.movedToVerification || recovery.movedToError) {
    log.info("[PUBLISH] Claims huerfanos recuperados", recovery);
  }

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

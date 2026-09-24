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
import { fileURLToPath } from "node:url";
import { supabaseAdmin } from "../supabaseClient.mts";
import { log } from "../logger.mts";
import { DRY_RUN, CLAIMED_AT_MIGRATION_APPLIED } from "./config.mts";
import { claimPost, revertToPending, recoverStaleClaims, markPublishAttemptStarted, persistOperationRef, finishWithUncertainOutcome } from "./claimPost.mts";
import { buildPersistenceFailureError } from "./uncertainOutcome.mts";
import { resolveAndVerifyContentFile } from "./resolveContentFile.mts";
import { ensureUploadedToStorage, cleanupVideoIfDone, getPresignedUrlFor } from "./storageBridge.mts";
import { isFreshB2Url } from "./validateB2Url.mts";
import { resolveAndValidateIdentity } from "./resolveIdentity.mts";
import { isPublicationAuthorized, describeAuthorizationGap } from "./humanReviewGate.mts";
import { verifyYoutubeChannelIdentity } from "./youtubeChannelIdentity.mts";
import { verifyFacebookPageIdentity } from "./facebookPageIdentity.mts";
import { verifyInstagramAccountIdentity } from "./instagramAccountIdentity.mts";
import { classifyError, decideRetry } from "./retryPolicy.mts";
import { resolveTargetMode, evaluateTargetPostEligibility } from "./targetPostSelection.mts";
import { resolveRunScope } from "../runScope.mts";
import { acquireRunLock, releaseRunLock, touchRunLock, checkGeneralQueueLockGate, RUN_LOCK_HEARTBEAT_MS } from "./runLock.mts";
import { isRealOperationRef } from "./staleClaimClassification.mts";
import { fetchFreshOperationRef, buildEvidenceCapturedError } from "./operationEvidenceGate.mts";
import { PUBLISHERS } from "../../lib/social/publishers.ts";
import { PublicationOutcomeUncertainError } from "../../lib/social/types.ts";
import type { SocialPostRow } from "./types.mts";

interface DueRow {
  id: string;
}

// Fase 5.10-B — allowedAccountIds es OBLIGATORIO (Decision K.6, viaja desde
// el scope resuelto una sola vez en main()). Se pasa directo a claimPost()
// para que el filtro viva DENTRO del mismo CAS, nunca como un chequeo
// separado antes/despues del claim.
async function processPost(postId: string, allowedAccountIds: string[]): Promise<void> {
  const claimed = await claimPost(postId, allowedAccountIds);
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

  // Fase 5.10-AB — la barrera DRY_RUN se evalua AQUI, ANTES de cualquier
  // operacion externa de almacenamiento (ensureUploadedToStorage/
  // getPresignedUrlFor mas abajo, exclusivas de Instagram/Facebook). La
  // Fase 5.10-Z encontro que con el orden anterior (barrera DESPUES de la
  // entrega), DRY_RUN=true todavia ejecutaba una subida real a Backblaze B2
  // y generaba una URL firmada real para Instagram/Facebook antes de
  // detenerse - un DRY_RUN que no era completamente "seco". Con la barrera
  // aqui, ningun modo DRY_RUN=true puede alcanzar ya ese bloque.
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
      title: post.title,
      hashtagCount: post.hashtags.length,
    });
    await revertToPending(post.id);
    log.info("[PUBLISH][DRY_RUN] Revertido a pending (no se persiste ningun resultado de dry-run)", { postId: post.id });
    return;
  }

  // A partir de aqui es publicacion REAL: DRY_RUN=false + channel_status
  // autoriza + autorizacion humana presente. Solo a partir de aqui es
  // seguro ejecutar operaciones externas de almacenamiento (mas abajo).
  const publish = PUBLISHERS[platform as Exclude<typeof platform, "tiktok">];
  if (!publish) {
    await finishWithFailure(post, `Sin publisher para '${platform}'.`, false);
    return;
  }

  // Entrega del archivo al publisher: YouTube NO exige URL publica (su protocolo
  // resumable acepta un stream directo, ver auditoria Fase 4B.5) - se entrega
  // DIRECTO desde disco, sin pasar por ningun Storage. Instagram/Facebook
  // (Fase 13) suben a Backblaze B2 y reciben una URL firmada TEMPORAL,
  // generada en memoria en este mismo ciclo - nunca la placeholder
  // persistida por scheduleContent.mts (ver validacion mas abajo).
  let postForPublisher: Record<string, unknown>;

  if (platform === "youtube") {
    postForPublisher = { ...post, local_file_path: fileOutcome.contentFile.file_path };
    log.info("[PUBLISH] YouTube: entrega directa desde disco local (sin ningun Storage)", {
      postId: post.id,
      localFilePath: fileOutcome.contentFile.file_path,
    });
  } else {
    let uploadResult: Awaited<ReturnType<typeof ensureUploadedToStorage>>;
    try {
      uploadResult = await ensureUploadedToStorage(fileOutcome.contentFile);
    } catch (err) {
      await finishWithFailure(post, err instanceof Error ? err.message : String(err), true);
      return;
    }
    log.info(uploadResult.alreadyExisted ? "[PUBLISH] Video ya existia en B2 - reutilizado" : "[PUBLISH] Video subido a B2", {
      postId: post.id,
      videoPath: uploadResult.videoPath,
    });

    // Fase 13 (Regla 6) — URL firmada generada AQUI, EN MEMORIA, justo antes
    // de que el publisher la use. NUNCA se persiste (ni en
    // social_posts.video_url, ni en logs - solo se loguea el object key). Se
    // genera de nuevo en CADA intento (primero o reintento), asi que ninguna
    // URL vencida puede reutilizarse por accidente.
    let presignedUrl: string;
    try {
      presignedUrl = await getPresignedUrlFor(uploadResult.videoPath);
    } catch (err) {
      await finishWithFailure(post, err instanceof Error ? err.message : String(err), true);
      return;
    }

    postForPublisher = { ...post, video_url: presignedUrl, video_path: uploadResult.videoPath };

    // Fase 13 (Regla 6/13), corregida en Fase 15 — VALIDACION EXPLICITA:
    // postForPublisher.video_url jamas debe llegar al publisher siendo el
    // placeholder que scheduleContent.mts persistio en el INSERT
    // (social_posts.video_url es NOT NULL y ese placeholder NUNCA fue
    // pensado como una URL operativa - ver scheduleContent.mts). Si por
    // cualquier motivo la URL firmada no se generase como se espera, esto
    // bloquea ANTES de invocar al publisher en vez de dejar que Meta reciba
    // una URL inservible.
    //
    // Fase 15 — BUG REAL encontrado en el preflight de Fase 14: la
    // comparacion original (`url.startsWith(B2_ENDPOINT)`) nunca podia ser
    // verdadera contra una URL real (formato virtual-hosted del SDK,
    // bucket como subdominio) - bloqueaba SIEMPRE, incluso con una URL
    // perfectamente valida. Corregido delegando en isFreshB2Url()
    // (validateB2Url.mts), que compara el hostname real contra el esperado
    // a partir de la configuracion (B2_BUCKET_NAME/B2_REGION), no un
    // prefijo literal - ver ese modulo para el detalle y las pruebas.
    const urlCheck = isFreshB2Url(postForPublisher.video_url, post.video_url);
    if (!urlCheck.ok) {
      await finishWithFailure(post, `postForPublisher.video_url no es una URL B2 fresca y valida: ${urlCheck.reason}`, true);
      return;
    }
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

  // Fase 5.21 — mismo principio y mismo punto exacto del flujo que la
  // identidad estructural de YouTube (Fase 5.18, ver bloque de arriba): se
  // llama a Meta AQUÍ porque es la única vez que ya se confirmó DRY_RUN=false
  // + channel_status=ACTIVE + autorización humana - la única vez que de
  // verdad se está a punto de publicar. FAIL-CLOSED: cualquier resultado que
  // no sea VERIFIED bloquea, se suma a los demás gates sin sustituir a
  // ninguno. Alcance: solo Facebook (Instagram queda fuera de esta fase,
  // sin cambios - ver mensaje de alcance de esta fase).
  if (platform === "facebook") {
    const identityCheck = await verifyFacebookPageIdentity(identityOutcome.account.credentials as { page_id: string; access_token: string });
    if (identityCheck.status !== "VERIFIED") {
      log.warn("[PUBLISH] Identidad estructural de Facebook NO verificada - el publisher NO se invoca", {
        postId: post.id,
        platform,
        identityStatus: identityCheck.status,
        reason: identityCheck.reason,
      });
      await finishWithFailure(post, identityCheck.reason, identityCheck.retryable);
      return;
    }
    log.info("[PUBLISH] Identidad estructural de Facebook verificada contra la API real", { postId: post.id });
  }

  // Fase 17 — mismo principio y mismo punto exacto del flujo que la
  // identidad estructural de YouTube (Fase 5.18) y Facebook (Fase 5.21): se
  // llama a Meta AQUÍ porque es la única vez que ya se confirmó DRY_RUN=false
  // + channel_status=ACTIVE + autorización humana - la única vez que de
  // verdad se está a punto de publicar. FAIL-CLOSED: cualquier resultado que
  // no sea VERIFIED bloquea, se suma a los demás gates sin sustituir a
  // ninguno. Cierra el hueco encontrado en el preflight de Instagram: antes
  // de esta fase no existía ninguna verificación estructural para esta
  // plataforma.
  if (platform === "instagram") {
    const identityCheck = await verifyInstagramAccountIdentity(identityOutcome.account.credentials as { ig_user_id: string; access_token: string });
    if (identityCheck.status !== "VERIFIED") {
      log.warn("[PUBLISH] Identidad estructural de Instagram NO verificada - el publisher NO se invoca", {
        postId: post.id,
        platform,
        identityStatus: identityCheck.status,
        reason: identityCheck.reason,
      });
      await finishWithFailure(post, identityCheck.reason, identityCheck.retryable);
      return;
    }
    log.info("[PUBLISH] Identidad estructural de Instagram verificada contra la API real", { postId: post.id });
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

  // H4-B (correccion del hallazgo #11 de la auditoria final de seguridad) —
  // `capturedOperationRef` conserva, EN MEMORIA, la referencia real en
  // cuanto el publisher la obtiene - INCONDICIONALMENTE, antes de siquiera
  // intentar persistirla. Es la UNICA fuente de evidencia que sobrevive si
  // persistOperationRef() no logra escribirla en Supabase (UPDATE con 0
  // filas afectadas, o un error real de conexion): el catch final de esta
  // funcion (mas abajo) la usa como respaldo de la lectura fresca, para que
  // un fallo del checkpoint intermedio nunca deje a la referencia real
  // atrapada solo en la pila de llamadas del publisher, a punto de perderse
  // en cuanto esta funcion termine.
  //
  // Deliberadamente NUNCA se lanza aqui si falla la persistencia: un fallo
  // de este checkpoint intermedio no significa que el intento de
  // publicacion vaya a fallar (el publisher puede seguir su curso normal y
  // terminar en exito real) - abortar prematuramente solo por esto seria
  // menos seguro, no mas.
  let capturedOperationRef: string | null = null;
  const onOperationRef = CLAIMED_AT_MIGRATION_APPLIED
    ? async (ref: string): Promise<void> => {
        capturedOperationRef = ref;
        const result = await persistOperationRef(post.id, ref);
        if (!result.ok) {
          log.error("[PUBLISH] No se pudo persistir publisher_operation_ref (checkpoint intermedio) - la referencia real se conserva en memoria para el manejo de fallos posterior; el intento de publicacion continua su curso normal", {
            postId: post.id,
            platform,
            reason: result.reason,
            detail: result.detail,
          });
        }
      }
    : undefined;

  try {
    const { externalPostId } = await publish(postForPublisher as unknown as Parameters<typeof publish>[0], identityOutcome.account.credentials, onOperationRef);
    const publishedPayload: Record<string, unknown> = { status: "published", external_post_id: externalPostId, published_at: new Date().toISOString(), error_message: null };
    // Fase 13 — cierra el bug de cleanup ya documentado (STORAGE_META_AUDIT):
    // persiste el object key REAL de B2 de vuelta a la fila (video_path),
    // para que cleanupVideoIfDone() pueda encontrar coincidencias reales con
    // posts hermanos. NUNCA se persiste video_url (la URL firmada es
    // temporal por diseño, ver Regla 6) - solo el object key, que es estable
    // y determinista por hash.
    if (platform !== "youtube" && "video_path" in postForPublisher) {
      publishedPayload.video_path = postForPublisher.video_path;
    }
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
    // H4-A.3 — CAS del camino de exito (auditoria H4-A.2 encontro que este
    // UPDATE era el UNICO en todo claimPost.mts/run.mts sin condicion de
    // status: `.eq("id", post.id)` a secas). Se añade `.eq("status","publishing")`
    // (mismo patron CAS ya universal en claimPost.mts) + `.select("id").maybeSingle()`
    // para poder DISTINGUIR "la fila seguia en publishing" (data presente) de
    // "0 filas afectadas" (data ausente) - antes, sin `.select()`, Supabase
    // devuelve exito con data=null incluso si el WHERE no matcheo ninguna
    // fila, haciendo indetectable una perdida de claim en este punto exacto.
    try {
      const { data: publishedUpdateData, error: publishedUpdateError } = await supabaseAdmin
        .from("social_posts")
        .update(publishedPayload)
        .eq("id", post.id)
        .eq("status", "publishing")
        .select("id")
        .maybeSingle();
      if (publishedUpdateError) {
        throw buildPersistenceFailureError(platform, externalPostId, publishedUpdateError);
      }
      if (!publishedUpdateData) {
        // La plataforma YA confirmo la publicacion (externalPostId real
        // conocido) pero la fila ya no estaba en 'publishing' en el instante
        // de este UPDATE - algun otro camino, protegido por el MISMO CAS
        // (claimPost.mts), la movio primero. Un proceso que ya perdio la
        // autoridad sobre 'publishing' NUNCA puede convertir la fila en
        // 'published' unilateralmente. NUNCA se asume exito silencioso,
        // NUNCA se reescribe la fila con un segundo UPDATE (ni aqui ni mas
        // abajo): se reutiliza el MISMO mecanismo ya existente desde Fase
        // 5.4.1 para "exito de plataforma + fallo de persistencia"
        // (buildPersistenceFailureError -> PublicationOutcomeUncertainError),
        // sin inventar un cuarto estado. El manejador de este error (mas
        // abajo, primera rama del catch) reutiliza finishWithUncertainOutcome()
        // (claimPost.mts, SIN MODIFICAR) - cuyo propio UPDATE tambien esta
        // condicionado a status='publishing': si la fila sigue sin estar
        // ahi, esa funcion se limita a loguear el fallo
        // (buildUncertainOutcomePersistFailureLog) y NO escribe nada, dejando
        // la fila EXACTAMENTE como el otro proceso la dejo (published,
        // verification_required, pending o error - lo que sea que ese otro
        // proceso haya decidido legitimamente).
        throw buildPersistenceFailureError(platform, externalPostId, {
          message: "la fila ya no esta en 'publishing' (perdio el claim, o ya fue movida por otro camino) - el UPDATE condicional (CAS) no afecto ninguna fila",
        });
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
      // H4-A.2 (verificacion de seguridad) — NUNCA se imprime err.operationRef
      // crudo aqui (puede ser una uploadUrl de YouTube con un identificador
      // de sesion sensible, equivalente a un bearer token para esa subida) -
      // mismo criterio ya establecido para el log "Evidencia REAL..." de mas
      // abajo (operationRefSource/operationRefLength, nunca el valor).
      log.warn("[PUBLISH] Resultado incierto - la plataforma pudo haber aceptado la publicación, no se puede afirmar que no ocurrió", {
        postId: post.id,
        platform: err.platform,
        operationRefPresent: isRealOperationRef(err.operationRef ?? null),
        operationRefLength: typeof err.operationRef === "string" ? err.operationRef.length : 0,
        httpStatus: err.httpStatus,
        reason: err.message,
      });
      await finishWithUncertainOutcome(post.id, err);
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    const retryable = classifyError(message) === "retryable";

    // H4-A (auditoria final de seguridad) — ANTES de aplicar el camino
    // normal (finishWithFailure, que SIEMPRE limpia publisher_operation_ref),
    // se hace una lectura FRESCA de Supabase (NUNCA el objeto `post` en
    // memoria - ver operationEvidenceGate.mts para el razonamiento completo:
    // ese objeto es una foto de ANTES del claim, nunca refleja lo que
    // markPublishAttemptStarted()/persistOperationRef() ya escribieron
    // durante este mismo intento) para comprobar si el publisher llegó a
    // persistir una referencia REAL de operación externa (creationId de
    // Instagram, uploadUrl de YouTube) antes de fallar. Si es así, la
    // clasificación de classifyError() (permanent/retryable) NUNCA se aplica
    // - se reutiliza finishWithUncertainOutcome() (claimPost.mts, SIN
    // MODIFICAR) exactamente igual que para un PublicationOutcomeUncertainError
    // real, para no destruir la única evidencia disponible. Alcance
    // exclusivo de este único punto de captura: los demás `finishWithFailure`
    // de esta función ocurren SIEMPRE antes de markPublishAttemptStarted()/
    // persistOperationRef() (resolución de archivo, identidad, B2, checkpoint),
    // así que nunca podrían tener una referencia real que preservar.
    //
    // Fail-safe si la propia lectura fresca falla (ej. Supabase caído en ese
    // instante): se registra y se seguir el camino normal ya existente - no
    // se inventa un tercer estado nuevo para esta falla compuesta, que ya
    // sería un caso peor que el que este cambio corrige.
    let freshOperationRef: string | null = null;
    try {
      freshOperationRef = await fetchFreshOperationRef(post.id);
    } catch (freshReadErr) {
      log.error("[PUBLISH] No se pudo leer publisher_operation_ref fresco antes de clasificar el fallo - se continúa con el camino normal (finishWithFailure)", {
        postId: post.id,
        error: freshReadErr instanceof Error ? freshReadErr.message : String(freshReadErr),
      });
    }

    // H4-B (correccion del hallazgo #11) — la evidencia real puede venir de
    // DOS fuentes, no solo de la lectura fresca: (1) la lectura fresca de
    // Supabase (caso normal, persistOperationRef() SI logro escribirla), o
    // (2) `capturedOperationRef` (declarada mas arriba, en el ambito de esta
    // funcion) - el valor que el publisher entrego via onOperationRef, en
    // memoria, INDEPENDIENTEMENTE de si persistOperationRef() logro
    // escribirlo. Se prioriza la lectura fresca (fuente de verdad real, ya
    // persistida) pero NUNCA se descarta la capturada si la fresca no la
    // muestra - es exactamente el caso que el hallazgo #11 identifico: la
    // fila solo tiene el placeholder porque la escritura fallo, no porque el
    // publisher nunca haya obtenido una referencia real.
    const evidenceRef = isRealOperationRef(freshOperationRef) ? freshOperationRef : isRealOperationRef(capturedOperationRef) ? capturedOperationRef : null;

    if (evidenceRef) {
      // NUNCA se imprime el valor real de la referencia en este log (puede
      // ser una uploadUrl de YouTube con un identificador de sesion
      // sensible) - solo metadata segura (origen, longitud).
      log.warn("[PUBLISH] Evidencia REAL de operación externa detectada tras un fallo clasificado como error/retryable - se enruta a verification_required en vez de destruir la evidencia", {
        postId: post.id,
        platform,
        operationRefSource: isRealOperationRef(freshOperationRef) ? "fresh_read" : "captured_in_memory",
        operationRefLength: evidenceRef.length,
      });
      const evidenceErr = buildEvidenceCapturedError(platform, message, evidenceRef);
      await finishWithUncertainOutcome(post.id, evidenceErr, evidenceRef);
      return;
    }

    await finishWithFailure(post, message, retryable);
  }
}

// H1 (auditoria post-publicacion) — exportada para ser testeable directamente
// (test-finish-with-failure.mts) sin ejecutar main() contra Supabase real -
// ver el guard de ejecucion directa al final de este archivo.
export async function finishWithFailure(post: SocialPostRow, reason: string, retryable: boolean): Promise<void> {
  const decision = decideRetry(retryable ? "retryable" : "permanent", post.retry_count);
  log.warn("[PUBLISH] Fallo - NO PUBLICAR", { postId: post.id, reason, retryable, nextStatus: decision.nextStatus, nextRetryCount: decision.nextRetryCount });
  // claimed_at se limpia siempre que se sale de 'publishing' (exito, pending o
  // error) - igual que revertToPending() - para que ninguna fila fuera de
  // 'publishing' quede con un timestamp de claim obsoleto. Gateado igual que en
  // claimPost.mts: solo se escribe si la migracion ya esta aplicada.
  //
  // H1 — una autorizacion humana (publication_authorized_at/_by) es valida
  // para UN SOLO intento real de publicacion (posterior al claim). Si ese
  // intento termina aqui -sea que vuelva a 'pending' para reintentar, o que
  // se agote en 'error' permanente- la autorizacion se limpia SIEMPRE, para
  // que el siguiente intento (automatico o manual) exija una nueva revision
  // humana explicita. Se escribe de forma incondicional (a diferencia de
  // claimed_at/publisher_operation_ref) porque estas 2 columnas son de una
  // migracion distinta (Fase 5.14) ya aplicada y sin bandera de activacion -
  // mismo criterio que ya usa authorizePublication() (publicationAuthorization.mts),
  // que las escribe sin ningun gate.
  //
  // Deliberadamente DISTINTO de revertToPending() (claimPost.mts, camino de
  // DRY_RUN): ese camino NUNCA llega a intentar publicar de verdad (se
  // detiene ANTES de tocar el publisher real) - limpiar la autorizacion ahi
  // rompería el flujo normal de "autorizar mientras DRY_RUN=true corre en
  // cola, publicar despues en una corrida aparte con DRY_RUN=false", que es
  // exactamente el flujo ya usado con exito en la publicacion real de esta
  // sesion. Tampoco se toca en finishWithUncertainOutcome() (verification_required)
  // - ese estado exige reconciliacion/revision manual explicita antes de
  // decidir nada (ver resolveVerificationRequired(), que ya limpia la
  // autorizacion en su propia rama "retry").
  const updatePayload: Record<string, unknown> = {
    status: decision.nextStatus,
    retry_count: decision.nextRetryCount,
    error_message: reason,
    publication_authorized_at: null,
    publication_authorized_by: null,
  };
  if (CLAIMED_AT_MIGRATION_APPLIED) {
    updatePayload.claimed_at = null;
    updatePayload.publisher_operation_ref = null;
  }
  await supabaseAdmin.from("social_posts").update(updatePayload).eq("id", post.id);
}

async function main() {
  log.info(`[PUBLISH] Iniciando capa de publicacion endurecida (Fase 4B.1). DRY_RUN=${DRY_RUN}`);

  // Fase 5.10-B — RUN_SCOPE obligatorio para TODO modo (Decision K.6),
  // resuelto UNA SOLA VEZ por pasada, antes de cualquier query (Decision
  // K.4). DRY_RUN sigue siendo un control completamente independiente (ver
  // config.mts) - RUN_SCOPE nunca lo sustituye ni lo modifica.
  const scope = await resolveRunScope();
  log.info(`[PUBLISH] [RUN_SCOPE] ${scope.runScope} — ${scope.allowedSocialAccountIds.length} social_account(s) permitida(s).`);

  // Fase 5.20 (RIESGO 1 del preflight de prueba controlada) — si POST_ID esta
  // definido, esta corrida se dedica EXCLUSIVAMENTE a ese post: nunca se
  // consulta la lista de "vencidos" (los otros posts pendientes del mismo
  // canal/content_account NUNCA se resuelven, ni se evaluan, ni se tocan de
  // ninguna forma), y NUNCA hay fallback de vuelta a "procesar todos". La
  // eligibilidad (existe, esta pending, coincide con EXPECTED_PLATFORM/
  // EXPECTED_CONTENT_FILE_ID si se dieron) se decide en una funcion pura
  // (targetPostSelection.mts) para que la regla sea 100% testeable sin
  // Supabase real. recoverStaleClaims() se omite deliberadamente en este
  // modo - es una limpieza de claims huerfanos de CUALQUIER post, y esta
  // corrida no debe tocar ninguna fila fuera de la que se pidio.
  const target = resolveTargetMode(process.env);
  if (target.mode === "single") {
    // H5 (auditoria post-publicacion, corregido tras la auditoria especifica de
    // H5) — lock de archivo LOCAL (ver runLock.mts) con adquisicion EXCLUSIVA
    // (falla si otra ejecucion dirigida ya tiene el lock, nunca lo sobrescribe)
    // y heartbeat mientras el proceso sigue vivo (nunca se acerca al umbral de
    // huerfano por error). Adquirido ANTES de cualquier consulta, para que una
    // ejecucion CONCURRENTE de la cola general (modo "all", sin POST_ID) se
    // detenga sola en vez de recoger otros posts vencidos del mismo canal.
    const lockResult = acquireRunLock(target.postId);
    if (!lockResult.ok) {
      log.error("[PUBLISH] Modo dirigido BLOQUEADO - ya existe otra ejecucion dirigida en curso, no se procesa nada", {
        postId: target.postId,
        lockedPostId: lockResult.existingPostId,
        reason: lockResult.reason,
      });
      process.exitCode = 1;
      return;
    }
    // Heartbeat: mientras este proceso siga vivo, refresca el lock cada
    // RUN_LOCK_HEARTBEAT_MS (muy por debajo de RUN_LOCK_STALE_MINUTES) para
    // que la cola general nunca lo confunda con un proceso muerto. `.unref()`
    // evita que este timer, por si solo, mantenga vivo el proceso Node si por
    // algun motivo el `finally` no llegara a ejecutarse.
    const heartbeatTimer = setInterval(() => touchRunLock(lockResult.token), RUN_LOCK_HEARTBEAT_MS);
    heartbeatTimer.unref();
    try {
      const { data: row, error: rowError } = await supabaseAdmin
        .from("social_posts")
        .select("id, status, content_file_id, account_id, scheduled_at")
        .eq("id", target.postId)
        .maybeSingle();
      if (rowError) {
        log.error("[PUBLISH] Error consultando el POST_ID solicitado", { postId: target.postId, error: rowError.message });
        process.exitCode = 1;
        return;
      }

      // Fase 5.10-B (Decision K.6) — POST_ID por si solo NO es una frontera
      // suficiente: identifica una fila exacta, pero esa fila puede
      // pertenecer a CUALQUIER cuenta social. Se bloquea aqui, ANTES de la
      // demas elegibilidad, si el account_id de esa fila cae fuera del
      // RUN_SCOPE de este proceso - claimPost() mas abajo tambien lo
      // rechazaria (defensa en profundidad), pero bloquear aqui da un motivo
      // explicito en vez de un generico "perdio el claim".
      if (row && !scope.allowedSocialAccountIds.includes(row.account_id as string)) {
        log.error("[PUBLISH] Modo dirigido BLOQUEADO - el post pertenece a una social_account fuera del RUN_SCOPE actual", {
          postId: target.postId,
          runScope: scope.runScope,
        });
        process.exitCode = 1;
        return;
      }

      let actualPlatform: string | null = null;
      if (row) {
        const { data: acct } = await supabaseAdmin.from("social_accounts").select("platform").eq("id", row.account_id).maybeSingle();
        actualPlatform = acct?.platform ?? null;
      }

      const eligibility = evaluateTargetPostEligibility(row, actualPlatform, target);
      if (!eligibility.ok) {
        log.error("[PUBLISH] Modo dirigido BLOQUEADO - no se procesa ningun post", { postId: target.postId, reason: eligibility.reason });
        process.exitCode = 1;
        return;
      }

      log.info("[PUBLISH] Modo dirigido: procesando UNICAMENTE este POST_ID - ningun otro post pendiente es consultado ni tocado", { postId: target.postId });
      await processPost(target.postId, scope.allowedSocialAccountIds);
      log.info("[PUBLISH] Ciclo dirigido finalizado.");
      return;
    } finally {
      clearInterval(heartbeatTimer);
      releaseRunLock(lockResult.token);
    }
  }

  // H5 — modo "all" (cola general): respeta un lock de ejecucion dirigida en
  // curso. Si esta activo (fresco), NO procesa nada - fail-closed completo,
  // no solo para el canal en prueba. Si el lock es huerfano, se ignora con un
  // warning claro y el ciclo continua con su comportamiento normal.
  //
  // H5-3 (auditoria final H1+H2+H5) — este chequeo original solo se hacia UNA
  // vez, aqui, antes del bucle. La auditoria encontro que una ejecucion
  // dirigida que arrancara DESPUES de este chequeo pero MIENTRAS la cola
  // general seguia iterando sobre varios posts vencidos (cada uno puede
  // tardar minutos por B2/polling) quedaba completamente invisible para el
  // resto de ese ciclo. Correccion MINIMA: checkGeneralQueueLockGate()
  // (runLock.mts, exportada para ser testeable directamente) se reutiliza
  // tanto aqui (chequeo inicial, sin cambios de comportamiento) como DENTRO
  // del bucle, ANTES de cada `processPost()` individual (ver mas abajo) -
  // nunca interrumpe un `processPost()` ya en curso, solo decide si se debe
  // INICIAR el siguiente.
  if (!checkGeneralQueueLockGate()) return;

  // Fase 5.4 - mismo patron ya probado en agent/analyze/run.mts:28 (Agent 2):
  // recuperar claims huerfanos ANTES de buscar trabajo nuevo. Inerte por
  // completo mientras CLAIMED_AT_MIGRATION_APPLIED=false (default), ver
  // claimPost.mts::recoverStaleClaims().
  const recovery = await recoverStaleClaims(scope.allowedSocialAccountIds);
  if (recovery.recoveredToPending || recovery.movedToVerification || recovery.movedToError) {
    log.info("[PUBLISH] Claims huerfanos recuperados", recovery);
  }

  // Fase 5.10-B — scope obligatorio en la query de vencidos (Decision K.2/K.5):
  // lista vacia = 0 candidatos, sin ejecutar `.in("account_id", [])`.
  if (scope.allowedSocialAccountIds.length === 0) {
    log.info("[PUBLISH] Scope sin social_accounts permitidas - 0 publicacion(es) vencida(s) a procesar.");
    log.info("[PUBLISH] Ciclo finalizado.");
    return;
  }

  const { data: dueRows, error } = await supabaseAdmin
    .from("social_posts")
    .select("id")
    .eq("status", "pending")
    .lte("scheduled_at", new Date().toISOString())
    .in("account_id", scope.allowedSocialAccountIds);

  if (error) {
    log.error("[PUBLISH] Error consultando social_posts pendientes vencidos", { error: error.message });
    process.exitCode = 1;
    return;
  }

  log.info(`[PUBLISH] ${dueRows?.length ?? 0} publicacion(es) vencida(s) encontradas dentro del scope.`);

  for (const row of (dueRows ?? []) as DueRow[]) {
    // H5-3 — se re-consulta el lock ANTES de cada post, no solo una vez al
    // principio del ciclo. Si un lock dirigido aparecio MIENTRAS el post
    // ANTERIOR seguia procesandose (que ya termino, sin interrupcion), este
    // chequeo detiene el ciclo ANTES de iniciar el siguiente - nunca a mitad
    // de un processPost() en curso.
    if (!checkGeneralQueueLockGate()) {
      log.warn("[PUBLISH] Ciclo general detenido a mitad de la cola - se detecto una ejecucion dirigida activa antes de iniciar el siguiente post", { postIdOmitido: row.id });
      break;
    }
    await processPost(row.id, scope.allowedSocialAccountIds);
  }

  log.info("[PUBLISH] Ciclo finalizado.");
}

// Guard de ejecucion directa (H1, infraestructura de testeo) — permite
// importar este archivo desde test-finish-with-failure.mts (para probar
// finishWithFailure() real, exportada arriba) sin disparar main() contra
// Supabase real. Mismo patron ya usado en authorize-publication.mts/
// resolve-verification.mts. Cuando se ejecuta directamente via
// `npx tsx agent/publish/run.mts`, process.argv[1] es este archivo, asi que
// isDirectRun=true y main() se comporta exactamente igual que antes.
const isDirectRun = typeof process.argv[1] === "string" && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirectRun) {
  main();
}

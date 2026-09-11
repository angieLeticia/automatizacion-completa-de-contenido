// Claim atomico SIN necesidad de migracion ni funcion RPC: un UPDATE condicional
// (WHERE id=? AND status='pending') ya es atomico en Postgres bajo READ COMMITTED -
// el motor toma el lock de fila y vuelve a evaluar el WHERE despues de obtenerlo,
// asi que dos procesos concurrentes NUNCA pueden ganar el mismo claim. Ver informe
// de Fase 4B.1 para la justificacion completa.
import { supabaseAdmin } from "../supabaseClient.mts";
import { CLAIMED_AT_MIGRATION_APPLIED, STALE_CLAIM_MINUTES, MAX_RETRIES } from "./config.mts";
import { decideRetry } from "./retryPolicy.mts";
import { classifyStaleClaim, publishAttemptPlaceholder } from "./staleClaimClassification.mts";
import { buildUncertainOutcomeUpdatePayload, buildUncertainOutcomePersistFailureLog } from "./uncertainOutcome.mts";
import { log } from "../logger.mts";
import type { PublicationOutcomeUncertainError } from "../../lib/social/types.ts";
import type { SocialPostRow } from "./types.mts";

// Devuelve la fila si este proceso gano el claim, o null si perdio (otro proceso
// ya la reclamo, o la fila ya no estaba en 'pending').
//
// claimed_at: SOLO se incluye en el UPDATE si CLAIMED_AT_MIGRATION_APPLIED=true
// (ver config.mts) - la columna no existe todavia en la base de datos real, asi
// que incluirla incondicionalmente rompería este claim (que SI funciona hoy sin
// ella) con un error de Postgres "column does not exist". Una vez aprobada y
// ejecutada la migracion propuesta, basta con activar la bandera de entorno.
export async function claimPost(postId: string): Promise<SocialPostRow | null> {
  const updatePayload: Record<string, unknown> = { status: "publishing" };
  if (CLAIMED_AT_MIGRATION_APPLIED) {
    updatePayload.claimed_at = new Date().toISOString();
  }

  const { data, error } = await supabaseAdmin
    .from("social_posts")
    .update(updatePayload)
    .eq("id", postId)
    .eq("status", "pending")
    .select("*")
    .maybeSingle();

  if (error) throw new Error(`Error al reclamar social_post ${postId}: ${error.message}`);
  return data as SocialPostRow | null;
}

// Revierte un post reclamado por ESTE proceso de vuelta a 'pending' - usado por
// DRY_RUN (nunca debe dejar nada en 'publishing') y por errores reintentables.
// Solo puede tener efecto si el post sigue en 'publishing' (lo cual solo es
// cierto mientras el que gano el claim no lo haya cambiado todavia) - no hay
// condicion de carrera porque el dueno del claim es exclusivo hasta que el mismo
// lo libera.
export async function revertToPending(postId: string): Promise<void> {
  const updatePayload: Record<string, unknown> = { status: "pending" };
  if (CLAIMED_AT_MIGRATION_APPLIED) {
    updatePayload.claimed_at = null;
    updatePayload.publisher_operation_ref = null;
  }
  const { error } = await supabaseAdmin.from("social_posts").update(updatePayload).eq("id", postId).eq("status", "publishing");
  if (error) throw new Error(`Error al revertir social_post ${postId} a pending: ${error.message}`);
}

// Fase 5.4 — se llama INMEDIATAMENTE antes de invocar al publisher real
// (run.mts), para CUALQUIER plataforma, incluidas las que no tienen una
// referencia intermedia real (Facebook). Escribe un placeholder
// "pending:<platform>" — no una referencia real todavía, pero suficiente para
// que classifyStaleClaim() nunca confunda "estamos a punto de publicar" con
// "nunca llegamos a intentarlo". Si el publisher SÍ obtiene una referencia
// real después (YouTube/Instagram), persistOperationRef() la sobreescribe.
export async function markPublishAttemptStarted(postId: string, platform: string): Promise<void> {
  if (!CLAIMED_AT_MIGRATION_APPLIED) return; // sin la columna aplicada, no hay nada seguro que escribir
  // Fase 5.4.1 — gap secundario corregido: se verifica que el UPDATE haya
  // afectado realmente una fila (mismo patrón que claimPost()/recoverStaleClaims()),
  // en vez de confiar solo en la ausencia de error. Bajo operación normal
  // (Atomic Claim garantiza dueño exclusivo) esto no debería fallar nunca -
  // pero si falla, es una señal real de que algo rompió esa garantía, y
  // llamar a publish() de todos modos sin el checkpoint sería inseguro.
  const { data, error } = await supabaseAdmin
    .from("social_posts")
    .update({ publisher_operation_ref: publishAttemptPlaceholder(platform) })
    .eq("id", postId)
    .eq("status", "publishing")
    .select("id")
    .maybeSingle();
  if (error) throw new Error(`Error marcando intento de publicación para ${postId}: ${error.message}`);
  if (!data) throw new Error(`No se pudo marcar el intento de publicación para ${postId}: la fila ya no está en 'publishing' (¿perdió el claim?) - no es seguro continuar sin el checkpoint.`);
}

// Fase 5.4 — llamado por el publisher (vía el callback onOperationRef) en
// cuanto obtiene una referencia real de la plataforma (uploadUrl de YouTube,
// creationId de Instagram), sobreescribiendo el placeholder de arriba.
export async function persistOperationRef(postId: string, ref: string): Promise<void> {
  if (!CLAIMED_AT_MIGRATION_APPLIED) return;
  const { data, error } = await supabaseAdmin
    .from("social_posts")
    .update({ publisher_operation_ref: ref })
    .eq("id", postId)
    .eq("status", "publishing")
    .select("id")
    .maybeSingle();
  if (error) throw new Error(`Error persistiendo publisher_operation_ref para ${postId}: ${error.message}`);
  if (!data) throw new Error(`No se pudo persistir publisher_operation_ref para ${postId}: la fila ya no está en 'publishing'.`);
}

// Fase 5.4.1 — reemplaza, para este caso específico, al camino de
// finishWithFailure(): NUNCA ejecuta decideRetry(), NUNCA vuelve a 'pending',
// NUNCA limpia claimed_at/publisher_operation_ref. Vive en este archivo (no
// en run.mts) para ser importable en tests sin disparar main().
//
// Nota de correctud: escribir status='verification_required' requiere que
// el CHECK constraint de la migración de Fase 5.4 ya esté aplicado en la
// base real (ver supabase/schema.sql) - si se alcanzara este código ANTES
// de esa migración, el UPDATE fallaría por violación de constraint. Eso es
// seguro (no escribe un estado inválido, no reintenta, no duplica) y hoy es
// además inalcanzable en la práctica: DRY_RUN=true intercepta antes de que
// el proceso pueda llegar a llamar a un publisher real (ver run.mts).
// Fase 5.4.3 (GAP 2 de la auditoría Fase 5.4.2) — antes, esta funcion
// descartaba {error}/fila-afectada del UPDATE (mismo patron de riesgo que ya
// se habia corregido en markPublishAttemptStarted()/persistOperationRef()
// en Fase 5.4.1, pero que se paso por alto aqui). Deliberadamente NO se
// relanza el error hacia processPost() en run.mts: para cuando se llega aqui
// la accion irreversible YA pudo haber ocurrido (es la razon de ser de
// PublicationOutcomeUncertainError) - relanzar haria que un fallo de
// persistencia de ESTE post tumbe el ciclo completo de main() (el mismo
// riesgo de disponibilidad que GAP 3), sin ganar ninguna seguridad adicional
// (esta funcion nunca escribe pending ni llama a publish()). La unica
// obligacion real es dejar el fallo OBSERVABLE - por eso se loguea con
// log.error (persistido en agent/logs/, no solo consola) en vez de
// silenciarlo.
export async function finishWithUncertainOutcome(postId: string, err: PublicationOutcomeUncertainError): Promise<void> {
  const updatePayload = buildUncertainOutcomeUpdatePayload(err);
  try {
    const { data, error } = await supabaseAdmin
      .from("social_posts")
      .update(updatePayload)
      .eq("id", postId)
      .eq("status", "publishing")
      .select("id")
      .maybeSingle();
    if (error) {
      const { message, meta } = buildUncertainOutcomePersistFailureLog(postId, err, error.message);
      log.error(message, meta);
      return;
    }
    if (!data) {
      const { message, meta } = buildUncertainOutcomePersistFailureLog(
        postId,
        err,
        "la fila ya no esta en 'publishing' (¿perdio el claim, o ya fue procesada por otro camino?)"
      );
      log.error(message, meta);
    }
  } catch (persistErr) {
    const causeMessage = persistErr instanceof Error ? persistErr.message : String(persistErr);
    const { message, meta } = buildUncertainOutcomePersistFailureLog(postId, err, causeMessage);
    log.error(message, meta);
  }
}

// INERTE hasta que se apruebe y ejecute la migracion (columnas claimed_at +
// publisher_operation_ref) - mientras CLAIMED_AT_MIGRATION_APPLIED sea false,
// esta funcion no hace nada. Preparada para cuando se active.
//
// Condicion de claim huerfano: status='publishing' AND claimed_at mas antiguo
// que STALE_CLAIM_MINUTES. Un claim que sigue procesando de verdad (ej. la
// subida resumible de YouTube, o el polling de Instagram) actualiza claimed_at
// solo UNA vez al ganar el claim - por eso el timeout debe ser generoso (30 min,
// ver config.mts) y nunca se toca de nuevo mientras el proceso sigue vivo, asi
// que un claim realmente en curso y uno huerfano solo se distinguen por tiempo.
//
// Fase 5.4 - CASO A vs CASO B/C (ver staleClaimClassification.mts,
// docs/phase-5.4-claim-recovery.md): NUNCA se asume "seguro reintentar" solo
// por el timeout. publisher_operation_ref es la evidencia real: NULL = el
// publisher jamas pudo haberse llamado (CASO A, unico caso que reintenta
// automaticamente); cualquier otro valor = pudo haberse llamado (CASO B/C,
// SIEMPRE termina en verification_required, nunca en pending automatico).
//
// CASO A - interaccion con retry_count: se trata exactamente como un fallo
// reintentable mas (no se inventa un mecanismo de conteo aparte) - reutiliza
// decideRetry() para que la recuperacion respete el mismo limite de
// MAX_RETRIES que cualquier otro fallo (CASO E), evitando que un post se
// recupere en bucle infinito si el crash se repite.
export async function recoverStaleClaims(): Promise<{ recoveredToPending: number; movedToVerification: number; movedToError: number }> {
  if (!CLAIMED_AT_MIGRATION_APPLIED) {
    return { recoveredToPending: 0, movedToVerification: 0, movedToError: 0 };
  }

  const cutoff = new Date(Date.now() - STALE_CLAIM_MINUTES * 60_000).toISOString();
  const { data: stale, error } = await supabaseAdmin
    .from("social_posts")
    .select("id, retry_count, publisher_operation_ref")
    .eq("status", "publishing")
    .lt("claimed_at", cutoff);

  if (error) throw new Error(`Error buscando claims huerfanos: ${error.message}`);

  let recoveredToPending = 0;
  let movedToVerification = 0;
  let movedToError = 0;

  for (const row of stale ?? []) {
    const classification = classifyStaleClaim(row.publisher_operation_ref);

    let updatePayload: Record<string, unknown>;
    if (classification.action === "retry") {
      const decision = decideRetry("retryable", row.retry_count);
      updatePayload = {
        status: decision.nextStatus,
        retry_count: decision.nextRetryCount,
        claimed_at: null,
        publisher_operation_ref: null,
        error_message: `Claim huerfano recuperado tras ${STALE_CLAIM_MINUTES} minutos sin actividad (posible crash del proceso, ${classification.reason}). Intento ${decision.nextRetryCount}/${MAX_RETRIES}.`,
      };
    } else {
      updatePayload = {
        status: "verification_required",
        claimed_at: null,
        error_message: `Claim huerfano con posible intento de publicación real (${classification.reason}). Requiere reconciliación o revisión humana - NO reintentado automáticamente.`,
      };
    }

    // .select() + .maybeSingle() en el UPDATE condicional deja ver si ESTE
    // proceso realmente gano la fila (fila devuelta) o si otro barrido
    // concurrente ya la habia recuperado primero (0 filas, WHERE ya no
    // coincide) - sin esto, dos recuperadores simultaneos contarian la misma
    // fila dos veces en sus totales aunque el dato en si ya este protegido.
    const { data: updated, error: updateError } = await supabaseAdmin
      .from("social_posts")
      .update(updatePayload)
      .eq("id", row.id)
      .eq("status", "publishing") // sigue siendo un UPDATE condicional - atomico frente a otro barrido concurrente
      .select("id")
      .maybeSingle();
    if (updateError) throw new Error(`Error recuperando claim huerfano ${row.id}: ${updateError.message}`);
    if (!updated) continue; // otro recuperador concurrente ya la tomo primero

    if (updatePayload.status === "verification_required") movedToVerification++;
    else if (updatePayload.status === "pending") recoveredToPending++;
    else movedToError++;
  }

  return { recoveredToPending, movedToVerification, movedToError };
}

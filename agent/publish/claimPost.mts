// Claim atomico SIN necesidad de migracion ni funcion RPC: un UPDATE condicional
// (WHERE id=? AND status='pending') ya es atomico en Postgres bajo READ COMMITTED -
// el motor toma el lock de fila y vuelve a evaluar el WHERE despues de obtenerlo,
// asi que dos procesos concurrentes NUNCA pueden ganar el mismo claim. Ver informe
// de Fase 4B.1 para la justificacion completa.
import { supabaseAdmin } from "../supabaseClient.mts";
import { CLAIMED_AT_MIGRATION_APPLIED, STALE_CLAIM_MINUTES, MAX_RETRIES } from "./config.mts";
import { decideRetry } from "./retryPolicy.mts";
import { classifyStaleClaim, publishAttemptPlaceholder, isRealOperationRef } from "./staleClaimClassification.mts";
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
// Fase 5.10-B — allowedAccountIds es OBLIGATORIO (Decision K.6: incluso el
// modo dirigido POST_ID debe pasar por aqui con su scope resuelto). El
// filtro de scope vive DENTRO del mismo UPDATE condicional (mismo `.eq`
// chain que ya garantiza el CAS atomico de status='pending') - nunca un
// SELECT previo para decidir si el post esta en scope (eso abriria la
// ventana de carrera que Fase 5.10 explicitamente prohibe). Lista vacia
// (Decision K.2, K.5) nunca ejecuta `.in("account_id", [])`: se retorna
// null directamente, exactamente el mismo resultado que "perdio el claim" -
// el llamador (run.mts) ya trata null de forma segura sin distinguir el
// motivo.
export async function claimPost(postId: string, allowedAccountIds: string[]): Promise<SocialPostRow | null> {
  if (allowedAccountIds.length === 0) return null;

  const updatePayload: Record<string, unknown> = { status: "publishing" };
  if (CLAIMED_AT_MIGRATION_APPLIED) {
    updatePayload.claimed_at = new Date().toISOString();
  }

  const { data, error } = await supabaseAdmin
    .from("social_posts")
    .update(updatePayload)
    .eq("id", postId)
    .eq("status", "pending")
    .in("account_id", allowedAccountIds)
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

// H4-B (correccion del hallazgo #11 de la auditoria final de seguridad) —
// ANTES esta funcion lanzaba (Promise<void>) si el UPDATE fallaba o afectaba
// 0 filas. Eso obligaba a quien la invocara a decidir entre "propagar la
// excepcion" (aborta el intento, aunque el publisher ya haya obtenido una
// referencia real) o "envolverla en try/catch y perder la referencia" (el
// escenario exacto que #11 encontro: la excepcion se propagaba como Error
// PLANO, indistinguible de un fallo pre-operacion, y el valor real de `ref`
// se perdia para siempre en cuanto la funcion terminaba). Ahora devuelve un
// resultado ESTRUCTURADO: quien llama decide que hacer con el fallo, y - de
// forma critica - `ref` (el valor recibido como parametro) sigue disponible
// en el AMBITO DE QUIEN LLAMA independientemente de si la persistencia tuvo
// exito, porque nunca dependio de que esta funcion lo devolviera. Este
// cambio, por si solo, no resuelve #11 - lo que lo resuelve es que run.mts
// (unico llamador real) ahora conserva `ref` el mismo antes de invocar esto,
// nunca solo dentro de aqui.
export type PersistOperationRefResult =
  | { ok: true }
  | { ok: false; reason: "migration_inactive" | "supabase_error" | "not_publishing"; detail?: string };

export async function persistOperationRef(postId: string, ref: string): Promise<PersistOperationRefResult> {
  if (!CLAIMED_AT_MIGRATION_APPLIED) return { ok: true }; // inerte - mismo comportamiento previo (no habia nada seguro que escribir)
  const { data, error } = await supabaseAdmin
    .from("social_posts")
    .update({ publisher_operation_ref: ref })
    .eq("id", postId)
    .eq("status", "publishing")
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, reason: "supabase_error", detail: error.message };
  // 0 filas afectadas: el WHERE status='publishing' ya no coincidio. Bajo el
  // diseno de claim exclusivo de este proyecto, la unica forma normal de que
  // esto ocurra es que ESTE MISMO post ya haya sido movido por otro camino
  // (ej. recoverStaleClaims(), tras STALE_CLAIM_MINUTES) - NUNCA significa
  // "otro proceso publico este post" (nadie mas puede tener el claim
  // mientras siga en 'publishing'). No se hace ningun UPDATE incondicional
  // de respaldo: si la fila ya cambio de estado, ese estado se respeta tal
  // cual - la responsabilidad de conservar la evidencia recae en quien llama
  // (ver run.mts), nunca en un segundo intento de escritura aqui.
  if (!data) return { ok: false, reason: "not_publishing" };
  return { ok: true };
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
// H4-B — `capturedOperationRef` es OPCIONAL y aditivo: cuando se omite (todo
// llamador anterior a esta fase), el comportamiento es IDENTICO al de antes
// - el payload nunca incluye publisher_operation_ref, se preserva tal cual
// ya estuviera en la fila. Se usa UNICAMENTE para el caso #11: el publisher
// obtuvo una referencia real pero persistOperationRef() no logro escribirla
// -  aqui, en la MISMA transaccion atomica que transiciona a
// verification_required (misma condicion `WHERE status='publishing'`, sin
// ningun mecanismo de lock nuevo), se le da una segunda oportunidad de
// quedar persistida. Fail-closed: solo se incluye si
// isRealOperationRef(capturedOperationRef) es verdadero - nunca se escribe
// un placeholder ni un valor vacio en esta columna por este camino.
export async function finishWithUncertainOutcome(postId: string, err: PublicationOutcomeUncertainError, capturedOperationRef?: string | null): Promise<void> {
  const updatePayload = buildUncertainOutcomeUpdatePayload(err);
  if (isRealOperationRef(capturedOperationRef)) {
    updatePayload.publisher_operation_ref = capturedOperationRef;
  }
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
//
// RecoverStaleClaimsDeps: unica adicion de esta auditoria (cierre de la
// brecha "recoverStaleClaims() sin ejecutar" - ver test-recover-stale-claims.mts).
// Extrae las DOS operaciones de persistencia que esta funcion ya hacia
// (buscar filas huerfanas, UPDATE atomico condicional por fila) detras de una
// interfaz inyectable, con un default que reproduce EXACTAMENTE el mismo
// SELECT/UPDATE de siempre contra supabaseAdmin - cero cambio de
// comportamiento cuando se llama sin argumentos (run.mts:424 sigue
// invocandola igual). Esto permite probar la funcion REAL (no una copia) con
// una base de datos en memoria, sin tocar Supabase real ni inventar una
// segunda implementacion de la logica de recuperacion.
// Fase 5.10-B — findStaleClaims() ahora recibe allowedAccountIds ademas del
// cutoff: el mismo scope que ya protege claimPost() debe proteger tambien la
// recuperacion de reclamos huerfanos, para que un worker en un RUN_SCOPE no
// pueda "rescatar" (y por tanto tocar) un post que quedo colgado bajo otro
// scope.
export interface RecoverStaleClaimsDeps {
  findStaleClaims: (
    cutoffIso: string,
    allowedAccountIds: string[]
  ) => Promise<Array<{ id: string; retry_count: number; publisher_operation_ref: string | null }>>;
  // Fase 5.10 (endurecimiento post-revision de 5.10-B) — allowedAccountIds
  // ahora tambien viaja hasta aqui: aunque findStaleClaims() ya filtra por
  // scope (y account_id es inmutable tras el INSERT, asi que no habia una
  // ventana de carrera real), el UPDATE de recuperacion debe llevar el MISMO
  // filtro que claimPost() por consistencia estructural - "scope dentro del
  // mismo CAS", nunca un UPDATE por id a secas confiando en que el SELECT
  // previo alcanza.
  updateIfPublishing: (postId: string, payload: Record<string, unknown>, allowedAccountIds: string[]) => Promise<boolean>; // true = esta llamada gano el UPDATE condicional
}

const defaultRecoverStaleClaimsDeps: RecoverStaleClaimsDeps = {
  async findStaleClaims(cutoffIso, allowedAccountIds) {
    if (allowedAccountIds.length === 0) return []; // Decision K.2 - nunca `.in("account_id", [])`
    const { data, error } = await supabaseAdmin
      .from("social_posts")
      .select("id, retry_count, publisher_operation_ref")
      .eq("status", "publishing")
      .lt("claimed_at", cutoffIso)
      .in("account_id", allowedAccountIds);
    if (error) throw new Error(`Error buscando claims huerfanos: ${error.message}`);
    return (data ?? []) as Array<{ id: string; retry_count: number; publisher_operation_ref: string | null }>;
  },
  async updateIfPublishing(postId, payload, allowedAccountIds) {
    if (allowedAccountIds.length === 0) return false; // Decision K.2 - nunca `.in("account_id", [])`
    const { data, error } = await supabaseAdmin
      .from("social_posts")
      .update(payload)
      .eq("id", postId)
      .eq("status", "publishing")
      .in("account_id", allowedAccountIds)
      .select("id")
      .maybeSingle();
    if (error) throw new Error(`Error recuperando claim huerfano ${postId}: ${error.message}`);
    return !!data;
  },
};

// Fase 5.10-B — allowedAccountIds es OBLIGATORIO (Decision K.6). Lista
// vacia = nada que recuperar, sin llamar a deps.findStaleClaims (Decision K.2).
export async function recoverStaleClaims(
  allowedAccountIds: string[],
  deps: RecoverStaleClaimsDeps = defaultRecoverStaleClaimsDeps
): Promise<{ recoveredToPending: number; movedToVerification: number; movedToError: number }> {
  if (!CLAIMED_AT_MIGRATION_APPLIED) {
    return { recoveredToPending: 0, movedToVerification: 0, movedToError: 0 };
  }
  if (allowedAccountIds.length === 0) {
    return { recoveredToPending: 0, movedToVerification: 0, movedToError: 0 };
  }

  const cutoff = new Date(Date.now() - STALE_CLAIM_MINUTES * 60_000).toISOString();
  const stale = await deps.findStaleClaims(cutoff, allowedAccountIds);

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

    // deps.updateIfPublishing() devuelve si ESTE proceso realmente gano la
    // fila (UPDATE condicional, WHERE status='publishing' sigue vigente) o si
    // otro barrido concurrente ya la habia recuperado primero (false, WHERE
    // ya no coincide) - sin esto, dos recuperadores simultaneos contarian la
    // misma fila dos veces en sus totales aunque el dato en si ya este
    // protegido por la condicion atomica del UPDATE real (ver defaultRecoverStaleClaimsDeps).
    const updated = await deps.updateIfPublishing(row.id, updatePayload, allowedAccountIds);
    if (!updated) continue; // otro recuperador concurrente ya la tomo primero

    if (updatePayload.status === "verification_required") movedToVerification++;
    else if (updatePayload.status === "pending") recoveredToPending++;
    else movedToError++;
  }

  return { recoveredToPending, movedToVerification, movedToError };
}

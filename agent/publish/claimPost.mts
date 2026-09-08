// Claim atomico SIN necesidad de migracion ni funcion RPC: un UPDATE condicional
// (WHERE id=? AND status='pending') ya es atomico en Postgres bajo READ COMMITTED -
// el motor toma el lock de fila y vuelve a evaluar el WHERE despues de obtenerlo,
// asi que dos procesos concurrentes NUNCA pueden ganar el mismo claim. Ver informe
// de Fase 4B.1 para la justificacion completa.
import { supabaseAdmin } from "../supabaseClient.mts";
import { CLAIMED_AT_MIGRATION_APPLIED, STALE_CLAIM_MINUTES, MAX_RETRIES } from "./config.mts";
import { decideRetry } from "./retryPolicy.mts";
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
  }
  const { error } = await supabaseAdmin.from("social_posts").update(updatePayload).eq("id", postId).eq("status", "publishing");
  if (error) throw new Error(`Error al revertir social_post ${postId} a pending: ${error.message}`);
}

// INERTE hasta que se apruebe y ejecute la migracion "ADD COLUMN claimed_at" -
// mientras CLAIMED_AT_MIGRATION_APPLIED sea false, esta funcion no hace nada y
// nunca se llama desde run.mts. Preparada para cuando se active.
//
// Condicion de claim huerfano: status='publishing' AND claimed_at mas antiguo
// que STALE_CLAIM_MINUTES. Un claim que sigue procesando de verdad (ej. la
// subida resumible de YouTube, o el polling de Instagram) actualiza claimed_at
// solo UNA vez al ganar el claim - por eso el timeout debe ser generoso (30 min,
// ver config.mts) y nunca se toca de nuevo mientras el proceso sigue vivo, asi
// que un claim realmente en curso y uno huerfano solo se distinguen por tiempo.
//
// Interaccion con retry_count: recuperar un claim huerfano se trata exactamente
// como un fallo reintentable mas (no se inventa un mecanismo de conteo aparte) -
// reutiliza decideRetry() para que la recuperacion respete el mismo limite de
// MAX_RETRIES que cualquier otro fallo, evitando que un post se recupere en
// bucle infinito si el crash se repite.
export async function recoverStaleClaims(): Promise<{ recoveredToPending: number; movedToError: number }> {
  if (!CLAIMED_AT_MIGRATION_APPLIED) {
    return { recoveredToPending: 0, movedToError: 0 };
  }

  const cutoff = new Date(Date.now() - STALE_CLAIM_MINUTES * 60_000).toISOString();
  const { data: stale, error } = await supabaseAdmin
    .from("social_posts")
    .select("id, retry_count")
    .eq("status", "publishing")
    .lt("claimed_at", cutoff);

  if (error) throw new Error(`Error buscando claims huerfanos: ${error.message}`);

  let recoveredToPending = 0;
  let movedToError = 0;

  for (const row of stale ?? []) {
    const decision = decideRetry("retryable", row.retry_count);
    // .select() + .maybeSingle() en el UPDATE condicional deja ver si ESTE
    // proceso realmente gano la fila (fila devuelta) o si otro barrido
    // concurrente ya la habia recuperado primero (0 filas, WHERE ya no
    // coincide) - sin esto, dos recuperadores simultaneos contarian la misma
    // fila dos veces en sus totales aunque el dato en si ya este protegido.
    const { data: updated, error: updateError } = await supabaseAdmin
      .from("social_posts")
      .update({
        status: decision.nextStatus,
        retry_count: decision.nextRetryCount,
        claimed_at: null,
        error_message: `Claim huerfano recuperado tras ${STALE_CLAIM_MINUTES} minutos sin actividad (posible crash del proceso). Intento ${decision.nextRetryCount}/${MAX_RETRIES}.`,
      })
      .eq("id", row.id)
      .eq("status", "publishing") // sigue siendo un UPDATE condicional - atomico frente a otro barrido concurrente
      .select("id")
      .maybeSingle();
    if (updateError) throw new Error(`Error recuperando claim huerfano ${row.id}: ${updateError.message}`);
    if (!updated) continue; // otro recuperador concurrente ya la tomo primero
    if (decision.nextStatus === "pending") recoveredToPending++;
    else movedToError++;
  }

  return { recoveredToPending, movedToError };
}

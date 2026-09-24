// H4-A (auditoria final de seguridad) — cierra ÚNICAMENTE el problema
// confirmado: `finishWithFailure()` (run.mts) SIEMPRE destruye
// `publisher_operation_ref` al transicionar a `pending`/`error`, incluso
// cuando ese campo, en el instante del fallo, contenía una referencia REAL
// de una operación externa ya iniciada (creationId de Instagram, uploadUrl
// de YouTube) — haciendo indistinguible, en reposo, un `error` pre-operación
// de uno post-operación/ambiguo.
//
// Alcance DELIBERADAMENTE limitado: esto NO implementa `error → pending`
// (eso es una fase posterior, todavía sin diseñar). Esto SOLO decide, en el
// momento de manejar un fallo, si corresponde el camino normal
// (`finishWithFailure`, sin cambios) o si hay que preservar evidencia
// (reutilizando `finishWithUncertainOutcome`, YA EXISTENTE, SIN MODIFICAR).
//
// Por qué vive en un archivo nuevo y no dentro de claimPost.mts/run.mts:
// mismo patrón ya establecido en este proyecto (channelAuthorization.mts,
// staleClaimClassification.mts, humanReviewGate.mts) para lógica de decisión
// separable y testeable sin ejecutar main() ni tocar Supabase real en los
// tests. `fetchFreshOperationRef` SÍ importa supabaseClient.mts (a
// diferencia de esos archivos) porque su única razón de existir es hacer
// precisamente la lectura fresca que este hallazgo exige - se aísla en su
// propia función exportada para poder inyectar un fake en los tests sin
// tocar Supabase real.
import { supabaseAdmin } from "../supabaseClient.mts";
import { isRealOperationRef } from "./staleClaimClassification.mts";
import { PublicationOutcomeUncertainError } from "../../lib/social/types.ts";
import type { SocialPlatform } from "./types.mts";

export type FailureRoutingDecision = "verification_required" | "normal_failure";

// LECTURA FRESCA — deliberadamente una consulta NUEVA a Supabase, nunca el
// objeto `post` en memoria que `processPost()` obtuvo en el momento del
// claim (`claimPost.mts::claimPost()`, un `SELECT *` ejecutado ANTES de
// `markPublishAttemptStarted()`/`persistOperationRef()`). Ese objeto en
// memoria jamás se actualiza durante la ejecución de `processPost()` — sus
// campos reflejan el instante del claim, no el estado actual de la fila.
// Usar `post.publisher_operation_ref` aquí SIEMPRE daría el valor de ANTES
// de que el publisher escribiera el placeholder o la referencia real,
// típicamente `null` — un falso negativo que anularía por completo esta
// corrección (exactamente el escenario que el Test 8 pedido demuestra).
export async function fetchFreshOperationRef(postId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin.from("social_posts").select("publisher_operation_ref").eq("id", postId).maybeSingle();
  if (error) throw new Error(`Error al leer publisher_operation_ref fresco para ${postId}: ${error.message}`);
  return (data?.publisher_operation_ref as string | null | undefined) ?? null;
}

// Pura — reutiliza isRealOperationRef() (staleClaimClassification.mts) SIN
// duplicar su lógica ni modificarla. Ya distingue exactamente lo que este
// hallazgo necesita: null/ausente -> no real; "pending:<platform>" -> no
// real (placeholder); cualquier otro string no vacío -> real.
export function decideFailureRouting(freshOperationRef: string | null): FailureRoutingDecision {
  return isRealOperationRef(freshOperationRef) ? "verification_required" : "normal_failure";
}

// Construye el PublicationOutcomeUncertainError SINTÉTICO que permite
// reutilizar finishWithUncertainOutcome() (claimPost.mts, SIN MODIFICAR) tal
// cual - esa función ya hace exactamente lo que Caso B necesita: UPDATE
// atómico condicionado a `WHERE status='publishing'` (mismo CAS/exclusión
// mutua que el resto del proyecto, sin inventar un mecanismo nuevo),
// transición a 'verification_required', y NUNCA toca
// publisher_operation_ref/claimed_at/publication_authorized_at/_by -
// exactamente las garantías de H1 y de preservación de evidencia que este
// hallazgo exige, sin escribir ni una línea de UPDATE nueva.
//
// H4-A.2 (verificación de seguridad, eliminación de duplicación en
// error_message) — ANTES este mensaje incluía el valor CRUDO de
// freshOperationRef embebido literalmente (`publisher_operation_ref='${...}'`).
// Ese mensaje se persiste tal cual en social_posts.error_message (ver
// buildUncertainOutcomeUpdatePayload(), uncertainOutcome.mts) - para YouTube,
// freshOperationRef es la uploadUrl de la sesión resumible (contiene un
// identificador de sesión con función equivalente a un bearer token para esa
// subida); duplicarla ahí no aportaba ningún valor diagnóstico nuevo (el
// valor real YA vive en publisher_operation_ref, columna dedicada) y sí
// exponía innecesariamente ese dato en una columna de texto libre pensada
// para prosa de diagnóstico, no para secretos operacionales. El mensaje
// ahora describe el hecho (se encontró evidencia real) sin citar el valor -
// quien necesite el valor real ya lo tiene disponible en
// publisher_operation_ref (la misma fila). No cambia `err.operationRef`
// (details, segundo argumento) - eso sigue disponible para quien construya
// el error par uso programático; solo cambia el TEXTO libre que termina en
// error_message.
export function buildEvidenceCapturedError(platform: SocialPlatform, originalReason: string, freshOperationRef: string): PublicationOutcomeUncertainError {
  return new PublicationOutcomeUncertainError(
    `Fallo clasificado originalmente como error/retryable, pero una lectura FRESCA de Supabase (no el objeto en memoria) encontró evidencia real de que la operación externa pudo haber comenzado (ver columna publisher_operation_ref de esta misma fila - no se duplica aquí por seguridad). Para no destruir esa evidencia, se trata como resultado incierto (verification_required) en vez del camino normal de error/pending. Motivo original del fallo: ${originalReason}`,
    { platform, operationRef: freshOperationRef }
  );
}

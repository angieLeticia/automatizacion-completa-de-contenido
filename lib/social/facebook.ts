import { PublicationOutcomeUncertainError } from "./types";
import { composeCaptionWithHashtags } from "./captionComposition";
import type { PublishResult, SocialPost } from "./types";

const GRAPH_VERSION = "v19.0";

export interface FacebookCredentials {
  page_id: string;
  access_token: string;
}

// Fase 5.20 (Phase A3) — DECISIÓN TÉCNICA (auditoría post-piloto, opción B):
// la Graph API de Meta SÍ ofrece un protocolo de subida por fases
// ("resumable upload": start -> transfer por chunks -> finish, con un
// video_id consultable desde la fase "start") que permitiría un operationRef
// real y reconciliación real, igual que YouTube/Instagram. Pero ESTE código
// usa el método simple de una sola llamada con `file_url` (Meta descarga la
// URL él mismo) - con ESE método, el `id` del video solo se conoce si la
// ÚNICA llamada responde con éxito; si el fetch nunca recibe respuesta, no
// hay ningún identificador que reportar ni consultar después. Migrar al
// protocolo por fases es un cambio estructural (subida por chunks, nueva
// máquina de estados) fuera del alcance de "corrección mínima" de esta fase
// - no se implementa aquí.
//
// Consecuencia aceptada explícitamente: un resultado incierto de Facebook
// NUNCA es reconciliable automáticamente (reconciliation.mts ya lo confirma:
// reconcileUnknownPublication() cae siempre en CANNOT_VERIFY para Facebook).
// Lo que SÍ se cierra aquí es que ese resultado incierto sea tratado como
// tal - fail-closed - y no como un fallo retryable normal (ver más abajo).
export async function publishToFacebook(post: SocialPost, creds: FacebookCredentials): Promise<PublishResult> {
  // Fase 5.20 (Phase A3) — markPublishAttemptStarted() (agent/publish/claimPost.mts)
  // ya escribió el placeholder "pending:facebook" ANTES de esta llamada, para
  // TODAS las plataformas. Si fetch() en sí LANZA (corte de red, sin
  // respuesta HTTP), no hay forma de saber si Meta ya creó el video - se
  // trata igual que un éxito con cuerpo no interpretable (mismo
  // PublicationOutcomeUncertainError de más abajo, Fase 5.4.1): termina en
  // verification_required, NUNCA en un reintento automático ciego, NUNCA
  // vuelve a pending. No se inventa un operationRef propio (Facebook nunca
  // tuvo uno) - el placeholder "pending:facebook" ya persistido es, por
  // diseño (staleClaimClassification.mts), suficiente para que
  // recoverStaleClaims() NUNCA reintente automáticamente un claim de
  // Facebook huérfano (CASO B/C siempre, nunca CASO A) - la intervención
  // humana/verificación externa directa en Facebook es, hoy, la única forma
  // de resolver esto, y así queda documentado explícitamente.
  let res: Response;
  try {
    res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${creds.page_id}/videos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        file_url: post.video_url,
        // Fase 5.20 (Phase A1) — mismo mecanismo de composición que Instagram.
        description: composeCaptionWithHashtags(post.caption || post.title || "", post.hashtags),
        access_token: creds.access_token,
      }),
    });
  } catch (err) {
    throw new PublicationOutcomeUncertainError(
      `Fallo de red durante la publicación en Facebook sin respuesta HTTP recibida - no se puede confirmar si el video fue creado. Facebook no tiene reconciliación automática (ver reconciliation.mts) - requiere verificación MANUAL directa en la página de Facebook: ${err instanceof Error ? err.message : String(err)}`,
      { platform: "facebook", originalError: err }
    );
  }
  if (!res.ok) {
    throw new Error(`Falló la publicación en Facebook: ${res.status} ${await res.text()}`);
  }
  // Fase 5.4.1 — a partir de aquí, res.ok=true significa que Facebook YA
  // aceptó/creó el video (Facebook no tiene una fase intermedia separada como
  // YouTube/Instagram - esta ÚNICA llamada es la acción irreversible/pública).
  // Facebook no tiene un operationRef real que reportar (ver
  // agent/publish/claimPost.mts::markPublishAttemptStarted, que ya escribió
  // el placeholder "pending:facebook" ANTES de esta llamada) - no se inventa
  // uno aquí; run.mts es quien preserva ese placeholder al no sobrescribirlo.
  try {
    const data = (await res.json()) as { id?: string };
    // Fase 5.11 (auditoría de Facebook) — gap encontrado: antes de este fix,
    // un JSON válido pero sin `id` (o con `id` vacío) se trataba como éxito
    // pleno, devolviendo un externalPostId inválido/undefined que run.mts
    // habría escrito tal cual en `published`. Un `id` ausente/no-string es
    // exactamente la misma incertidumbre que un JSON malformado — Facebook
    // respondió HTTP éxito pero no tenemos una confirmación utilizable de
    // qué se creó — así que se trata igual, vía PublicationOutcomeUncertainError,
    // en vez de silenciarlo como un "éxito" con dato inválido.
    if (typeof data.id !== "string" || data.id.length === 0) {
      throw new PublicationOutcomeUncertainError(
        `Facebook respondió éxito (HTTP ${res.status}) pero el cuerpo no trae un 'id' válido - no se puede afirmar que el video no se haya creado.`,
        { platform: "facebook", httpStatus: res.status, originalError: data }
      );
    }
    return { externalPostId: data.id };
  } catch (err) {
    if (err instanceof PublicationOutcomeUncertainError) throw err;
    throw new PublicationOutcomeUncertainError(
      `Facebook respondió éxito (HTTP ${res.status}) a la publicación del video, pero no se pudo interpretar la respuesta - no se puede afirmar que el video no se haya creado.`,
      { platform: "facebook", httpStatus: res.status, originalError: err }
    );
  }
}

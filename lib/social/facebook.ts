import { PublicationOutcomeUncertainError } from "./types";
import type { PublishResult, SocialPost } from "./types";

const GRAPH_VERSION = "v19.0";

export interface FacebookCredentials {
  page_id: string;
  access_token: string;
}

export async function publishToFacebook(post: SocialPost, creds: FacebookCredentials): Promise<PublishResult> {
  const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${creds.page_id}/videos`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      file_url: post.video_url,
      description: post.caption || post.title || "",
      access_token: creds.access_token,
    }),
  });
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

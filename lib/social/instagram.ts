import { PublicationOutcomeUncertainError } from "./types";
import { composeCaptionWithHashtags } from "./captionComposition";
import type { PublishResult, SocialPost } from "./types";

const GRAPH_VERSION = "v19.0";
const POLL_INTERVAL_MS = 5000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000; // Instagram puede tardar varios minutos en procesar el vídeo

export interface InstagramCredentials {
  ig_user_id: string;
  access_token: string;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function publishToInstagram(
  post: SocialPost,
  creds: InstagramCredentials,
  onOperationRef?: (ref: string) => void | Promise<void>
): Promise<PublishResult> {
  const createRes = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${creds.ig_user_id}/media`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      media_type: "REELS",
      video_url: post.video_url,
      // Fase 5.20 (Phase A1) — composeCaptionWithHashtags() agrega
      // social_posts.hashtags al final del caption, sin duplicar los que ya
      // estén presentes en el texto original.
      caption: composeCaptionWithHashtags(post.caption || post.title || "", post.hashtags),
      access_token: creds.access_token,
    }),
  });
  if (!createRes.ok) {
    throw new Error(`No se pudo crear el contenedor de Instagram: ${createRes.status} ${await createRes.text()}`);
  }
  const { id: creationId } = (await createRes.json()) as { id: string };

  // Fase 5.4 — reporta la referencia real ANTES del polling (hasta 5 min) y
  // antes de media_publish. Confirmado por documentación oficial de Meta:
  // GET /{creation_id}?fields=status_code está pensado exactamente para
  // reconciliar este escenario (ver agent/publish/reconciliation.mts).
  if (onOperationRef) await onOperationRef(creationId);

  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let statusCode = "IN_PROGRESS";
  while (statusCode === "IN_PROGRESS" && Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    const statusRes = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${creationId}?fields=status_code&access_token=${creds.access_token}`
    );
    if (!statusRes.ok) {
      throw new Error(`No se pudo consultar el estado del contenedor de Instagram: ${statusRes.status} ${await statusRes.text()}`);
    }
    const statusData = (await statusRes.json()) as { status_code: string };
    statusCode = statusData.status_code;
  }
  if (statusCode !== "FINISHED") {
    throw new Error(`El contenedor de Instagram no terminó de procesar a tiempo (estado: ${statusCode}).`);
  }

  // Fase 5.20 (Phase A2) — a partir de aquí creationId YA está persistido
  // (onOperationRef más arriba). Si fetch() en sí LANZA (corte de red, sin
  // respuesta HTTP) NO se puede descartar que media_publish ya haya
  // ejecutado del lado de Meta - mismo motivo y mismo patrón que el cierre
  // de YouTube (lib/social/youtube.ts, Fase 5.20). Nunca reintentable
  // automáticamente. Un HTTP de error SÍ recibido (!publishRes.ok, más
  // abajo) es distinto: Meta contestó rechazando, seguro reintentar.
  let publishRes: Response;
  try {
    publishRes = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${creds.ig_user_id}/media_publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ creation_id: creationId, access_token: creds.access_token }),
    });
  } catch (err) {
    throw new PublicationOutcomeUncertainError(
      `Fallo de red durante media_publish de Instagram sin respuesta HTTP recibida - no se puede confirmar si el post fue aceptado: ${err instanceof Error ? err.message : String(err)}`,
      { platform: "instagram", operationRef: creationId, originalError: err }
    );
  }
  if (!publishRes.ok) {
    throw new Error(`Falló la publicación en Instagram: ${publishRes.status} ${await publishRes.text()}`);
  }
  // Fase 5.4.1 — a partir de aquí, publishRes.ok=true significa que Instagram
  // YA ejecutó media_publish (la acción irreversible/pública, distinta de
  // crear el contenedor o del polling de estado, ninguno de los cuales
  // publica nada todavía). Cualquier fallo de parseo del cuerpo NO debe
  // tratarse como "seguro reintentar" - el creationId (ya persistido vía
  // onOperationRef más arriba) se conserva para reconciliar.
  try {
    const published = (await publishRes.json()) as { id: string };
    return { externalPostId: published.id };
  } catch (err) {
    throw new PublicationOutcomeUncertainError(
      `Instagram respondió éxito (HTTP ${publishRes.status}) a media_publish, pero no se pudo interpretar la respuesta - no se puede afirmar que el post no se haya publicado.`,
      { platform: "instagram", operationRef: creationId, httpStatus: publishRes.status, originalError: err }
    );
  }
}

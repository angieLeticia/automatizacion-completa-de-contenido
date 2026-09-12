// Fase 5.20 (auditoria previa) — publishToYouTube() tenia privacyStatus:"public"
// fijo en codigo, sin ningun control externo: cualquier publicacion real salia
// publica sin excepcion, incluida la primera prueba controlada que se queria
// hacer en PRIVATE. Esta funcion vive separada (pura, sin red, sin Supabase)
// por el mismo motivo que channelAuthorization.mts/humanReviewGate.mts - deja
// probar la regla de resolucion sin depender de ninguna llamada real.
//
// Se resuelve DENTRO de publishToYouTube() (lib/social/youtube.ts), es decir
// DESPUES de que claim atomico + resolveContentFile + resolveIdentity +
// DRY_RUN/channel_status/Human Review + identidad estructural de YouTube ya
// dejaron pasar - esta variable NUNCA participa en esas decisiones, solo
// decide el valor de un campo del payload de subida una vez que publicar ya
// esta autorizado por todo lo demas.
export type YoutubeUploadPrivacyStatus = "private" | "unlisted" | "public";

const VALID_PRIVACY_STATUSES: readonly YoutubeUploadPrivacyStatus[] = ["private", "unlisted", "public"];

export type YoutubePrivacyResolution =
  | { ok: true; value: YoutubeUploadPrivacyStatus }
  | { ok: false; reason: string };

// Fail-closed: variable AUSENTE (o vacia/solo espacios) -> "private" - nunca
// "public". Un valor PRESENTE pero invalido BLOQUEA (ok:false) en vez de
// adivinar - nunca cae silenciosamente a "private" ni a "public" ante un
// typo, y nunca acepta abreviaturas/sinonimos ("priv", "unlist", "1", etc.).
// La unica normalizacion es recortar espacios y pasar a minusculas -
// determinista, sin ambiguedad.
export function resolveYoutubeUploadPrivacyStatus(env: NodeJS.ProcessEnv): YoutubePrivacyResolution {
  const raw = env.YOUTUBE_UPLOAD_PRIVACY_STATUS;
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return { ok: true, value: "private" };
  }

  const normalized = raw.trim().toLowerCase();
  if ((VALID_PRIVACY_STATUSES as readonly string[]).includes(normalized)) {
    return { ok: true, value: normalized as YoutubeUploadPrivacyStatus };
  }

  return {
    ok: false,
    reason:
      `YOUTUBE_UPLOAD_PRIVACY_STATUS='${raw}' no es un valor válido - se esperaba exactamente uno de: ` +
      `${VALID_PRIVACY_STATUSES.join(", ")} (sin abreviaturas ni sinónimos). No se publica.`,
  };
}

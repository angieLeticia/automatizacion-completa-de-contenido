// Fase 5.21 — identidad estructural real de Facebook: Page Access Token ->
// Meta Graph API GET /me?fields=id,name (el token se auto-identifica, el
// mismo principio que channels.list(mine=true) de YouTube, Fase 5.18) ->
// pageId real -> comparación EXACTA contra credentials.page_id (el mismo
// campo que publishToFacebook() ya usa para publicar - lib/social/facebook.ts).
// NUNCA usa name/label/email como sustituto.
//
// DECISIÓN DE DISEÑO (auditoría previa a implementar, documentada aquí
// porque el encargo original pedía "social_accounts.channel_id = Page ID"):
// social_accounts.channel_id es una columna INTERNA ya existente
// (UUID NOT NULL REFERENCES social_channels(id) - ver supabase/schema.sql)
// - NO es ni puede ser el Page ID real de Facebook (un string numérico tipo
// "1341123142414097" jamás pasaría esa FK). Es EXACTAMENTE la misma colisión
// de nombres ya encontrada y resuelta para YouTube en Fase 5.18
// (credentials.channel_id, no social_accounts.channel_id). La resolución es
// la misma por precedente directo: la identidad externa de Facebook se
// verifica contra `credentials.page_id` — campo que YA EXISTE, que
// publishToFacebook() YA usa para el path real de la API
// (`/${creds.page_id}/videos`), y que credentialFields.ts YA declara como
// requerido para la plataforma. Cero columnas nuevas, cero migraciones.
//
// Separación deliberada (mismo patrón que youtubeChannelIdentity.mts/
// reconciliation.mts): evaluateFacebookPageIdentityMatch() es pura y decide
// sin red - es la que implementa la regla FAIL-CLOSED, 100% testeable sin
// credenciales reales. verifyFacebookPageIdentity() es el wrapper fino que
// sí llama a Meta.
import { GRAPH_VERSION } from "../../lib/social/facebook.ts";

export type FacebookIdentityStatus =
  | "VERIFIED"
  | "IDENTITY_UNVERIFIED" // configuredPageId ausente - nunca se configuró
  | "IDENTITY_MISMATCH" // configurado, pero no coincide con la Página real del token
  | "CHECK_FAILED"; // no se pudo completar la verificación (red/HTTP/parseo) - NUNCA se asume VERIFIED

export interface FacebookIdentityResult {
  status: FacebookIdentityStatus;
  reason: string;
  retryable: boolean; // true SOLO para CHECK_FAILED (posible transitorio); false para UNVERIFIED/MISMATCH (config, no se arregla solo)
}

// Pura - sin red, sin Supabase. Compara EXACTAMENTE el Page ID real (string
// devuelto por Meta en /me) contra el configurado en credentials.page_id.
// Nunca acepta un fallback por nombre/label/email.
export function evaluateFacebookPageIdentityMatch(realPageId: string | null, configuredPageId: string | null | undefined): FacebookIdentityResult {
  if (typeof configuredPageId !== "string" || configuredPageId.length === 0) {
    return {
      status: "IDENTITY_UNVERIFIED",
      reason: "credentials.page_id está ausente/vacío - nunca se configuró la identidad estructural de esta cuenta. No se autoriza publicación hasta configurarlo explícitamente.",
      retryable: false,
    };
  }
  if (typeof realPageId !== "string" || realPageId.length === 0) {
    return {
      status: "CHECK_FAILED",
      reason: "La respuesta real de Meta no trajo un Page ID utilizable (respuesta malformada o vacía) - no se puede verificar identidad, no se asume coincidencia.",
      retryable: true,
    };
  }
  if (realPageId !== configuredPageId) {
    return {
      status: "IDENTITY_MISMATCH",
      reason: `El Page ID real de Meta ('${realPageId}') no coincide con el configurado en credentials.page_id ('${configuredPageId}') - identidad inválida, NO se autoriza publicación.`,
      retryable: false,
    };
  }
  return { status: "VERIFIED", reason: "Page ID real coincide exactamente con credentials.page_id.", retryable: false };
}

// Llama a Meta de verdad - envuelto en try/catch (mismo motivo que
// verifyYoutubeChannelIdentity(), Fase 5.18: un fallo de red/HTTP/parseo debe
// resolver a CHECK_FAILED, nunca lanzar sin control ni asumir VERIFIED por
// defecto). GET /me?fields=id,name con el Page Access Token: Meta devuelve la
// identidad REAL a la que ese token pertenece - exactamente el mismo
// principio que channels.list(mine=true) de YouTube (Fase 5.18), nunca una
// consulta por ID conocido (eso solo probaría que el Page ID existe, no que
// ESTE token le pertenece).
export async function verifyFacebookPageIdentity(credentials: { page_id: string; access_token: string }): Promise<FacebookIdentityResult> {
  const configuredPageId = credentials.page_id ?? null;
  // Si nunca se configuró, no hace falta ni llamar a Meta - fail closed inmediato.
  if (typeof configuredPageId !== "string" || configuredPageId.length === 0) {
    return evaluateFacebookPageIdentityMatch(null, configuredPageId);
  }
  if (typeof credentials.access_token !== "string" || credentials.access_token.length === 0) {
    return {
      status: "CHECK_FAILED",
      reason: "credentials.access_token está ausente/vacío - no se puede verificar identidad sin token.",
      retryable: false,
    };
  }

  try {
    const meRes = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/me?fields=id,name`, {
      headers: { Authorization: `Bearer ${credentials.access_token}` },
    });
    if (!meRes.ok) {
      // Incluye 401 (token inválido/expirado) y 403 (permiso insuficiente) -
      // mismo tratamiento uniforme que verifyYoutubeChannelIdentity() ya usa
      // para cualquier fallo HTTP del lado de la verificación: bloquea igual
      // (status !== VERIFIED), nunca se asume identidad por defecto.
      return { status: "CHECK_FAILED", reason: `Meta /me falló al verificar identidad (HTTP ${meRes.status}).`, retryable: true };
    }
    const meData = (await meRes.json()) as { id?: string };
    const realPageId = typeof meData.id === "string" && meData.id.length > 0 ? meData.id : null;

    return evaluateFacebookPageIdentityMatch(realPageId, configuredPageId);
  } catch (err) {
    return {
      status: "CHECK_FAILED",
      reason: `Excepción verificando identidad de Página: ${err instanceof Error ? err.message : String(err)}`,
      retryable: true,
    };
  }
}

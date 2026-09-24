// Fase 17 — identidad estructural real de Instagram: Access Token -> Meta
// Graph API GET /{ig_user_id}?fields=id,username (el token se auto-identifica
// consultando el MISMO ig_user_id configurado - el mismo principio que
// channels.list(mine=true) de YouTube (Fase 5.18) y GET /me de Facebook
// (Fase 5.21)) -> id real -> comparación EXACTA contra credentials.ig_user_id
// (el mismo campo que publishToInstagram() ya usa - lib/social/instagram.ts).
// NUNCA usa username/label/email como sustituto - que exista username, que
// el nombre "coincida" a ojo, o que la llamada responda HTTP 200 NO son
// suficientes por si solos; solo cuenta returned.id === configured.ig_user_id.
//
// DECISION DE DISEÑO (mismo precedente exacto que youtubeChannelIdentity.mts
// Fase 5.18 y facebookPageIdentity.mts Fase 5.21): social_accounts.channel_id
// es una columna INTERNA (UUID NOT NULL REFERENCES social_channels(id)) -
// NUNCA es ni puede ser el Instagram User ID real (un string numerico largo
// tipo "17841400000000000" jamas pasaria esa FK). La identidad externa de
// Instagram se verifica exclusivamente contra `credentials.ig_user_id` -
// campo que YA EXISTE, que publishToInstagram() YA usa para el path real de
// la API (`/${creds.ig_user_id}/media`), y que credentialFields.ts YA
// declara como requerido para esta plataforma. Cero columnas nuevas, cero
// migraciones.
//
// Separacion deliberada (mismo patron que youtubeChannelIdentity.mts/
// facebookPageIdentity.mts): evaluateInstagramAccountIdentityMatch() es pura
// y decide sin red - implementa la regla FAIL-CLOSED, 100% testeable sin
// credenciales reales. verifyInstagramAccountIdentity() es el wrapper fino
// que si llama a Meta.
import { GRAPH_VERSION } from "../../lib/social/instagram.ts";

export type InstagramIdentityStatus =
  | "VERIFIED"
  | "IDENTITY_UNVERIFIED" // configuredIgUserId ausente - nunca se configuro
  | "IDENTITY_MISMATCH" // configurado, pero no coincide con la cuenta real del token
  | "CHECK_FAILED"; // no se pudo completar la verificacion (red/HTTP/parseo) - NUNCA se asume VERIFIED

export interface InstagramIdentityResult {
  status: InstagramIdentityStatus;
  reason: string;
  retryable: boolean; // true SOLO para CHECK_FAILED (posible transitorio); false para UNVERIFIED/MISMATCH (config, no se arregla solo)
}

// Pura - sin red, sin Supabase. Compara EXACTAMENTE el Instagram User ID real
// (string devuelto por Meta en /{ig_user_id}) contra el configurado en
// credentials.ig_user_id. Nunca acepta un fallback por username/nombre.
// "FAKE_TEST_IG_USER_ID" (o cualquier valor de prueba) nunca puede producir
// VERIFIED aqui: o bien Meta lo rechaza (CHECK_FAILED, no es un ID real
// consultable), o si por algun motivo Meta respondiera con un id real
// distinto, seria IDENTITY_MISMATCH - en ningun camino se asume coincidencia.
export function evaluateInstagramAccountIdentityMatch(realIgUserId: string | null, configuredIgUserId: string | null | undefined): InstagramIdentityResult {
  if (typeof configuredIgUserId !== "string" || configuredIgUserId.length === 0) {
    return {
      status: "IDENTITY_UNVERIFIED",
      reason: "credentials.ig_user_id está ausente/vacío - nunca se configuró la identidad estructural de esta cuenta. No se autoriza publicación hasta configurarlo explícitamente.",
      retryable: false,
    };
  }
  if (typeof realIgUserId !== "string" || realIgUserId.length === 0) {
    return {
      status: "CHECK_FAILED",
      reason: "La respuesta real de Meta no trajo un Instagram User ID utilizable (respuesta malformada o vacía) - no se puede verificar identidad, no se asume coincidencia.",
      retryable: true,
    };
  }
  if (realIgUserId !== configuredIgUserId) {
    return {
      status: "IDENTITY_MISMATCH",
      reason: `El Instagram User ID real de Meta ('${realIgUserId}') no coincide con el configurado en credentials.ig_user_id ('${configuredIgUserId}') - identidad inválida, NO se autoriza publicación.`,
      retryable: false,
    };
  }
  return { status: "VERIFIED", reason: "Instagram User ID real coincide exactamente con credentials.ig_user_id.", retryable: false };
}

// Llama a Meta de verdad - envuelto en try/catch (mismo motivo que
// verifyYoutubeChannelIdentity()/verifyFacebookPageIdentity(): un fallo de
// red/HTTP/parseo debe resolver a CHECK_FAILED, nunca lanzar sin control ni
// asumir VERIFIED por defecto). GET /{ig_user_id}?fields=id,username con el
// access_token: Meta devuelve la identidad REAL a la que esa combinación
// (token + ID consultado) tiene acceso - si el ig_user_id configurado es
// falso/inexistente (ej. "FAKE_TEST_IG_USER_ID"), Meta rechazará la llamada
// (HTTP 400/404) antes de devolver ningún id, resolviendo a CHECK_FAILED -
// nunca a VERIFIED.
export async function verifyInstagramAccountIdentity(credentials: { ig_user_id: string; access_token: string }): Promise<InstagramIdentityResult> {
  const configuredIgUserId = credentials.ig_user_id ?? null;
  // Si nunca se configuro, no hace falta ni llamar a Meta - fail closed inmediato.
  if (typeof configuredIgUserId !== "string" || configuredIgUserId.length === 0) {
    return evaluateInstagramAccountIdentityMatch(null, configuredIgUserId);
  }
  if (typeof credentials.access_token !== "string" || credentials.access_token.length === 0) {
    return {
      status: "CHECK_FAILED",
      reason: "credentials.access_token está ausente/vacío - no se puede verificar identidad sin token.",
      retryable: false,
    };
  }

  try {
    const meRes = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${configuredIgUserId}?fields=id,username`, {
      headers: { Authorization: `Bearer ${credentials.access_token}` },
    });
    if (!meRes.ok) {
      // Incluye 401 (token invalido/expirado), 403 (permiso insuficiente) y
      // 404 (ig_user_id no existe, ej. "FAKE_TEST_IG_USER_ID") - mismo
      // tratamiento uniforme que verifyFacebookPageIdentity()/
      // verifyYoutubeChannelIdentity() ya usan para cualquier fallo HTTP del
      // lado de la verificacion: bloquea igual (status !== VERIFIED), nunca
      // se asume identidad por defecto.
      return { status: "CHECK_FAILED", reason: `Meta /${configuredIgUserId} falló al verificar identidad (HTTP ${meRes.status}).`, retryable: true };
    }
    const meData = (await meRes.json()) as { id?: string };
    const realIgUserId = typeof meData.id === "string" && meData.id.length > 0 ? meData.id : null;

    return evaluateInstagramAccountIdentityMatch(realIgUserId, configuredIgUserId);
  } catch (err) {
    return {
      status: "CHECK_FAILED",
      reason: `Excepción verificando identidad de cuenta de Instagram: ${err instanceof Error ? err.message : String(err)}`,
      retryable: true,
    };
  }
}

// Fase 5.18 — identidad estructural real de YouTube: OAuth account ->
// Google channels.list(mine=true) -> channelId real -> comparación exacta
// contra credentials.channel_id (configurado, Fase 5.18). NUNCA usa label/
// title/customUrl/email/is_active como sustituto - eso era exactamente la
// brecha encontrada en Fase 5.17 (identidad verificada "a ojo" por nombre).
//
// Separación deliberada (mismo patrón que reconciliation.mts): la función
// pura (evaluateChannelIdentityMatch) decide, sin red - es la que de verdad
// implementa la regla FAIL-CLOSED y es 100% testeable sin credenciales
// reales. verifyYoutubeChannelIdentity() es el wrapper fino que sí llama a
// Google - no se puede probar contra la API real sin OAuth (ver
// docs/phase-5.18-youtube-identity-hardening.md para la evidencia real
// obtenida en esta fase con la cuenta piloto).
export type ChannelIdentityStatus =
  | "VERIFIED"
  | "IDENTITY_UNVERIFIED" // configuredChannelId ausente - nunca se configuró
  | "IDENTITY_MISMATCH" // configurado, pero no coincide con el canal real
  | "CHECK_FAILED"; // no se pudo completar la verificación (red/HTTP/parseo) - NUNCA se asume VERIFIED

export interface ChannelIdentityResult {
  status: ChannelIdentityStatus;
  reason: string;
  retryable: boolean; // true SOLO para CHECK_FAILED (posible transitorio); false para UNVERIFIED/MISMATCH (config, no se arregla solo)
}

// Pura - sin red, sin Supabase. Compara EXACTAMENTE el channel ID real
// (string de Google, ej. "UCHtU7U5zZ1gndN5o-C2eeFQ") contra el configurado
// en credentials.channel_id. Nunca acepta un fallback por nombre/label.
export function evaluateChannelIdentityMatch(realChannelId: string | null, configuredChannelId: string | null | undefined): ChannelIdentityResult {
  if (typeof configuredChannelId !== "string" || configuredChannelId.length === 0) {
    return {
      status: "IDENTITY_UNVERIFIED",
      reason: "credentials.channel_id está ausente/vacío - nunca se configuró la identidad estructural de esta cuenta. No se autoriza publicación hasta configurarlo explícitamente.",
      retryable: false,
    };
  }
  if (typeof realChannelId !== "string" || realChannelId.length === 0) {
    return {
      status: "CHECK_FAILED",
      reason: "La respuesta real de Google no trajo un channel ID utilizable (respuesta malformada o vacía) - no se puede verificar identidad, no se asume coincidencia.",
      retryable: true,
    };
  }
  if (realChannelId !== configuredChannelId) {
    return {
      status: "IDENTITY_MISMATCH",
      reason: `El channel ID real de Google ('${realChannelId}') no coincide con el configurado en credentials.channel_id ('${configuredChannelId}') - identidad inválida, NO se autoriza publicación.`,
      retryable: false,
    };
  }
  return { status: "VERIFIED", reason: "channel ID real coincide exactamente con credentials.channel_id.", retryable: false };
}

// Llama a Google de verdad - envuelto en try/catch (mismo motivo que
// reconciliation.mts, Fase 5.10: un fallo de red/parseo debe resolver a
// CHECK_FAILED, nunca lanzar sin control ni asumir VERIFIED por defecto).
export async function verifyYoutubeChannelIdentity(credentials: {
  client_id: string;
  client_secret: string;
  refresh_token: string;
  channel_id?: string;
}): Promise<ChannelIdentityResult> {
  const configuredChannelId = credentials.channel_id ?? null;
  // Si nunca se configuró, no hace falta ni llamar a Google - fail closed inmediato.
  if (typeof configuredChannelId !== "string" || configuredChannelId.length === 0) {
    return evaluateChannelIdentityMatch(null, configuredChannelId);
  }

  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: credentials.client_id,
        client_secret: credentials.client_secret,
        refresh_token: credentials.refresh_token,
        grant_type: "refresh_token",
      }),
    });
    if (!tokenRes.ok) {
      return { status: "CHECK_FAILED", reason: `No se pudo obtener access_token para verificar identidad (HTTP ${tokenRes.status}).`, retryable: true };
    }
    const tokenData = (await tokenRes.json()) as { access_token: string };

    const channelRes = await fetch("https://www.googleapis.com/youtube/v3/channels?part=id&mine=true", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    if (!channelRes.ok) {
      return { status: "CHECK_FAILED", reason: `channels.list falló al verificar identidad (HTTP ${channelRes.status}).`, retryable: true };
    }
    const channelData = (await channelRes.json()) as { items?: Array<{ id?: string }> };
    const realChannelId = channelData.items?.[0]?.id ?? null;

    return evaluateChannelIdentityMatch(realChannelId, configuredChannelId);
  } catch (err) {
    return {
      status: "CHECK_FAILED",
      reason: `Excepción verificando identidad de canal: ${err instanceof Error ? err.message : String(err)}`,
      retryable: true,
    };
  }
}

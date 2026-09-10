// Fase 5.2.1 — cierre del gap detectado en Fase 5.2: content_accounts.channel_status
// (ACTIVE/READY/TEST/BLOCKED/HISTORICAL, supabase/schema.sql) ya gatea el RENDER via
// scripts/pipeline/channelRegistry.mts, pero ningún punto de la ruta de publicación
// lo leía. No se inventan estados nuevos — se usan los 5 ya reales.
//
// Vive en su PROPIO archivo, sin ningún import de supabaseClient.mts/supabaseAdmin.ts
// a propósito: esos módulos construyen el cliente Supabase real en el momento del
// import (createClient(...) al nivel superior de lib/social/supabaseAdmin.ts), lo que
// lanza "supabaseUrl is required" en cuanto se importan si faltan las credenciales —
// confirmado directamente en este worktree. Si esta función viviera dentro de
// resolveIdentity.mts (que sí importa supabaseClient.mts), sería imposible probarla
// sin credenciales reales aunque la función en sí no toque Supabase. Separarla es lo
// que permite demostrar la lógica de autorización sin conexión real (Fase 5.2.1 §9).
//
// BLOCKED/HISTORICAL: igual que en render (resolveRenderProvider los rechaza con
// ChannelNotProducibleError) — nunca publicables. Se bloquean aquí explícitamente,
// ANTES de llegar al claim/publish adapter.
//
// READY: el contrato de render (channelRegistry.mts) lo trata como producible, pero
// ningún documento define "READY" como autorización de publicación REAL — es
// ambiguo a propósito. Ante esa ambigüedad se usa la opción segura: NO autoriza
// publicación real (mismo tratamiento que TEST), sin bloquear el resto del flujo.
//
// TEST: nunca debe llegar a publicación real, independientemente del DRY_RUN global
// (activar DRY_RUN=false para un canal ACTIVE nunca debe arrastrar consigo canales
// TEST). No bloquea — claim/schedule/DRY_RUN branch siguen funcionando igual que hoy.
//
// ACTIVE: único estado que autoriza publicación real — sigue sujeto a TODOS los
// demás controles ya existentes (DRY_RUN global, identidad válida, credenciales,
// claim atómico) — channel_status nunca es el único control (ver run.mts).
export interface ChannelAuthorizationOutcome {
  blocked: boolean;
  reason?: string;
  authorizedForRealPublication: boolean;
}

export function evaluateChannelAuthorization(channelStatus: string | null): ChannelAuthorizationOutcome {
  if (channelStatus === "BLOCKED" || channelStatus === "HISTORICAL") {
    return {
      blocked: true,
      reason: `El canal tiene channel_status='${channelStatus}' - no autorizado para publicación.`,
      authorizedForRealPublication: false,
    };
  }
  return { blocked: false, authorizedForRealPublication: channelStatus === "ACTIVE" };
}

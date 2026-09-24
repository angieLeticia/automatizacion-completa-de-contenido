// Fase 4.8 — pruebas reales del registro de canales y la resolución de
// RenderProvider. Mismo patrón ad-hoc del proyecto: asserts explícitos, sin
// mocks, contra los 8 canales reales ya documentados (docs/operational-status.md).
import { resolveChannelConfig, resolveScannableChannels, listKnownChannels } from "./channelRegistry.mts";
import {
  resolveRenderProvider,
  ChannelNotFoundError,
  ChannelNotProducibleError,
  ChannelProviderNotFoundError,
} from "./renderProviderRegistry.mts";

let failures = 0;
const check = (label: string, cond: boolean, extra = "") => {
  const mark = cond ? "PASS" : "FAIL";
  if (!cond) failures++;
  console.log(`[${mark}] ${label}${extra ? " — " + extra : ""}`);
};

async function main() {
  // ---- Registro: los 9 canales reales conocidos (8 de la Fase 4.8 + CHISMES,
  // real en disco desde D:\MATERIAL VIDEOS, HISTORICAL, ya documentado en
  // operational-status.md — la Fase 4.8 no lo listó explícitamente, pero
  // excluirlo del registro sería menos preciso que la evidencia ya real). ----
  const known = listKnownChannels();
  check("channelRegistry — conoce los 9 canales reales (8 de Fase 4.8 + CHISMES ya documentado)", known.length === 9, `${known.length} canales`);

  // ---- resolveScannableChannels(): hoy debe ser exactamente ["SIN EXPLICACIÓN"] ----
  const scannable = resolveScannableChannels();
  check(
    'resolveScannableChannels() — resuelve exactamente ["SIN EXPLICACIÓN"] (único canal con provider real)',
    scannable.length === 1 && scannable[0] === "SIN EXPLICACIÓN",
    JSON.stringify(scannable)
  );

  // ---- Canal desconocido ----
  check("resolveChannelConfig('CANAL_INEXISTENTE') — devuelve null, no lanza", resolveChannelConfig("CANAL_INEXISTENTE") === null);
  let unknownThrew = false;
  try {
    resolveRenderProvider("CANAL_INEXISTENTE");
  } catch (err) {
    unknownThrew = err instanceof ChannelNotFoundError;
  }
  check("resolveRenderProvider('CANAL_INEXISTENTE') — lanza ChannelNotFoundError", unknownThrew);

  // ---- SIN EXPLICACIÓN: único canal con provider real resuelto ----
  const provider = resolveRenderProvider("SIN EXPLICACIÓN");
  check('resolveRenderProvider("SIN EXPLICACIÓN") — resuelve el provider real "documentary-remotion"', provider.id === "documentary-remotion");
  check("RenderProvider — expone renderMain/renderClip reales (funciones)", typeof provider.renderMain === "function" && typeof provider.renderClip === "function");

  // ---- Canales BLOCKED/HISTORICAL: nunca deben resolver un provider, sin importar si tienen uno declarado ----
  // FASE 5.10-AD/AH — OBJETOS MALDITOS y LUNA VERDE se movieron aquí desde el
  // grupo "TEST sin provider" de abajo: channelRegistry.mts tenía
  // channelStatus="TEST" hardcodeado para ambos, pero la auditoría confirmó
  // (verificado directamente contra Supabase real) que su channel_status real
  // es "HISTORICAL" — se corrigió el registro local para que coincida, así
  // que ahora entran por esta rama (ChannelNotProducibleError), no por la de
  // ChannelProviderNotFoundError.
  const blockedOrHistorical = ["ENCIENDE EL CAOS", "OBJETOS MALDITOS", "LUNA VERDE", "ALZA LA VOZ", "ASMR", "PELICULAS", "MUSICA", "CHISMES"];
  for (const channel of blockedOrHistorical) {
    let threwCorrectly = false;
    try {
      resolveRenderProvider(channel);
    } catch (err) {
      threwCorrectly = err instanceof ChannelNotProducibleError;
    }
    check(`resolveRenderProvider("${channel}") — BLOCKED/HISTORICAL, lanza ChannelNotProducibleError (nunca produce, aunque declare provider)`, threwCorrectly);
  }

  // ---- ChannelProviderNotFoundError (canal TEST/READY/ACTIVE sin provider) ----
  // FASE 5.10-AD/AH — ya no hay ningún canal real con channelStatus="TEST" en
  // el registro (los últimos dos, OBJETOS MALDITOS/LUNA VERDE, se corrigieron
  // arriba a "HISTORICAL" para coincidir con Supabase real). Este error ya no
  // se puede ejercitar contra datos reales del registro — se prueba la clase
  // directamente en vez de inventar un canal falso en CHANNEL_REGISTRY solo
  // para forzar esta rama.
  check(
    "ChannelProviderNotFoundError — mensaje incluye el nombre del canal (misma forma que los demás errores tipados de este archivo)",
    new ChannelProviderNotFoundError("CANAL_SIN_PROVIDER").message.includes("CANAL_SIN_PROVIDER")
  );

  // ---- Fase 5.1: ALZA LA VOZ ya tiene provider REAL e integrado
  // ("quote-video-remotion", migrado del repositorio externo) — pero sigue
  // BLOCKED (ninguna migración de código promueve un canal automáticamente,
  // ver Sección "REGLA DE ESTADOS"). resolveRenderProvider debe seguir
  // rechazándolo con el MISMO error que antes de la migración. ----
  const alzaConfig = resolveChannelConfig("ALZA LA VOZ");
  check('channelRegistry — ALZA LA VOZ tiene renderProviderId="quote-video-remotion" (migrado, ya no "-external")', alzaConfig?.renderProviderId === "quote-video-remotion");
  let alzaStillBlocked = false;
  try {
    resolveRenderProvider("ALZA LA VOZ");
  } catch (err) {
    alzaStillBlocked = err instanceof ChannelNotProducibleError;
  }
  check("resolveRenderProvider(\"ALZA LA VOZ\") — sigue BLOCKED aunque el provider ya sea real (ninguna migración promueve un canal solo por tener código)", alzaStillBlocked);

  // ---- El provider migrado SÍ existe y expone la operación real que este
  // contenido necesita (renderVideo), directamente importable sin pasar por
  // el gate de canal — igual que se prueba documentaryRemotionProvider en
  // machine:test sin necesidad de que el canal esté ACTIVE. ----
  const { quoteVideoProvider } = await import("./quoteVideoProvider.mts");
  check('quoteVideoProvider.id === "quote-video-remotion"', quoteVideoProvider.id === "quote-video-remotion");
  check("quoteVideoProvider expone renderVideo() real", typeof quoteVideoProvider.renderVideo === "function");
  let renderMainThrew = false;
  try {
    await quoteVideoProvider.renderMain("x");
  } catch {
    renderMainThrew = true;
  }
  check("quoteVideoProvider.renderMain() — no aplica a este contenido, lanza explícito en vez de fingir soporte", renderMainThrew);

  const { videos: alzaVideos } = await import("../../channels/alza-la-voz/videos.ts");
  check("channels/alza-la-voz/videos.ts — 4 videos reales migrados (motivadoras/mujeres/dia-a-dia/estudiantes)", alzaVideos.length === 4);

  console.log(`\n${failures === 0 ? "TODOS LOS CASOS PASARON" : `${failures} CASO(S) FALLARON`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main();

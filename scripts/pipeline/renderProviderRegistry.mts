// Fase 4.8 — resolución channel -> RenderProvider. Único punto donde
// processOne.mts pide un provider; nunca un if/else por canal. Errores
// tipados y explícitos en vez de "Cannot read undefined" cuando un canal no
// puede producirse todavía.
import { resolveChannelConfig } from "./channelRegistry.mts";
import { documentaryRemotionProvider } from "./documentaryRemotionProvider.mts";
import { quoteVideoProvider } from "./quoteVideoProvider.mts";
import { chaosNewsRemotionProvider } from "./chaosNewsRemotionProvider.mts";
import { lunaVerdeRemotionProvider } from "./lunaVerdeRemotionProvider.mts";
import { objetosMalditosRemotionProvider } from "./objetosMalditosRemotionProvider.mts";
import type { RenderProvider } from "./renderProvider.mts";

// Fase 5.1 — "quote-video-remotion" migrado desde el repositorio externo de
// ALZA LA VOZ (ver docs/system-contracts.md §7 para el detalle de la
// migración) — ya vive dentro de este repositorio (remotion/QuoteVideo.tsx +
// channels/alza-la-voz/videos.ts), sin proceso externo ni segundo repositorio.
//
// Fase 1.5.5 — exportada (antes privada). Único uso nuevo: processOne.mts
// puede resolver un provider REAL ya existente por id directo
// (context.renderProviderId), sin pasar por resolveRenderProvider()/
// channelRegistry.mts, SOLO cuando hay un PipelineExecutionContext explícito.
// resolveRenderProvider() de abajo NO CAMBIA — sigue siendo el único camino
// de producción real.
// FASE 5.10-AR — "chaos-news-remotion" (ENCIENDE EL CAOS) registrado aquí
// por el MISMO motivo que "quote-video-remotion": el registro técnico del
// provider es independiente de la activación operativa del canal. Este
// registro NO hace escaneable a ENCIENDE EL CAOS — channelRegistry.mts
// sigue reportando channelStatus="HISTORICAL" para ese canal (sin cambios
// en esta fase), y resolveScannableChannels() excluye cualquier canal
// HISTORICAL sin importar si tiene renderProviderId — ver
// test-chaos-news-provider.mts, sección "seguridad operativa", para la
// verificación explícita de esto.
// FASE 9 — "luna-verde-remotion"/"objetos-malditos-remotion" registrados por
// el MISMO motivo que "chaos-news-remotion" (Fase 5): el registro técnico
// del provider es independiente de la activación operativa del canal.
// channelRegistry.mts sigue reportando channelStatus="HISTORICAL" para
// ambos (sin cambios en esta fase) — resolveScannableChannels() los sigue
// excluyendo sin importar si tienen renderProviderId.
export const RENDER_PROVIDERS: Record<string, RenderProvider> = {
  "documentary-remotion": documentaryRemotionProvider,
  "quote-video-remotion": quoteVideoProvider,
  "chaos-news-remotion": chaosNewsRemotionProvider,
  "luna-verde-remotion": lunaVerdeRemotionProvider,
  "objetos-malditos-remotion": objetosMalditosRemotionProvider,
};

export class ChannelNotFoundError extends Error {
  constructor(channelFolderName: string) {
    super(`CHANNEL_NOT_FOUND: "${channelFolderName}" no está en el registro de canales conocidos.`);
  }
}

export class ChannelNotProducibleError extends Error {
  constructor(channelFolderName: string, status: string, notes: string) {
    super(`CHANNEL_${status}: "${channelFolderName}" no puede producirse en su estado actual — ${notes}`);
  }
}

export class ChannelProviderNotFoundError extends Error {
  constructor(channelFolderName: string) {
    super(`CHANNEL_PROVIDER_NOT_FOUND: "${channelFolderName}" no tiene render provider configurado todavía.`);
  }
}

export class ChannelProviderNotIntegratedError extends Error {
  constructor(channelFolderName: string, providerId: string, notes: string) {
    super(
      `CHANNEL_PROVIDER_NOT_INTEGRATED: "${providerId}" está declarado para "${channelFolderName}" ` +
        `pero no implementado en este repositorio — ${notes}`
    );
  }
}

export function resolveRenderProvider(channelFolderName: string): RenderProvider {
  const config = resolveChannelConfig(channelFolderName);
  if (!config) throw new ChannelNotFoundError(channelFolderName);

  if (config.channelStatus === "BLOCKED" || config.channelStatus === "HISTORICAL") {
    throw new ChannelNotProducibleError(channelFolderName, config.channelStatus, config.notes);
  }
  if (!config.renderProviderId) {
    throw new ChannelProviderNotFoundError(channelFolderName);
  }
  const provider = RENDER_PROVIDERS[config.renderProviderId];
  if (!provider) {
    throw new ChannelProviderNotIntegratedError(channelFolderName, config.renderProviderId, config.notes);
  }
  return provider;
}

// Fase 1.5.3 — tipo compartido, SIN lógica. Existe únicamente para que
// processOne.mts/episodeRegistrar.mts/renderer.mts/renderBridge.mts (y los
// dos pass-through de render provider) no dupliquen la misma forma de objeto
// ni dependan unos de otros solo para importar un tipo. Nunca se crea un
// contexto por defecto acá — la ausencia de contexto (`undefined`) es y debe
// seguir siendo el camino de producción real, sin excepción.
export type PipelineExecutionContext = {
  episodesFile: string; // reemplaza remotion/lib/episodes.ts real (solo para nextChapterNumber/registerEpisode/assertCompositionExists)
  dataRoot: string; // reemplaza remotion/data/ real
  publicAssetsRoot: string; // reemplaza public/assets/ real (subcarpetas video/images/audio iguales)
  outputRoot: string; // reemplaza REPO_ROOT para out/ real
  // Fase 1.5.5 — opcional dentro de un contexto ya opcional (doble opt-in,
  // nunca implícito): permite resolver un RenderProvider REAL ya existente
  // (nunca uno nuevo/"sandbox"/"mock") directamente por id, sin pasar por
  // channelRegistry.mts. Ausente -> processOne.mts sigue resolviendo por
  // canal real exactamente como siempre (ver processOne.mts).
  renderProviderId?: string;
};

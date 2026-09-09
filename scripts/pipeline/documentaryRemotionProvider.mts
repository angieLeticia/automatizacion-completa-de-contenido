// Fase 4.8 — único RenderProvider real hoy. Envuelve exactamente lo que
// processOne.mts ya hacía directamente contra MachineBridge.render desde la
// Fase 4.6/4.7 (mismo compositionId, mismo out/*.mp4, sin reuseIfExists ni
// timeoutMs para no cambiar comportamiento) — cero lógica nueva de render,
// solo la misma llamada detrás de la interfaz RenderProvider.
import { machineBridge } from "../../agent/machine/machineBridge.mts";
import type { RenderProvider } from "./renderProvider.mts";

if (!machineBridge.render) {
  throw new Error("MachineBridge.render debe estar implementado para usar documentaryRemotionProvider.");
}
const render = machineBridge.render;

export const documentaryRemotionProvider: RenderProvider = {
  id: "documentary-remotion",
  async renderMain(episodeId) {
    return render.renderComposition(`MainDocumentary-${episodeId}`, `main-${episodeId}.mp4`);
  },
  async renderClip(episodeId, clipIndex) {
    return render.renderComposition(`Short-${episodeId}-${clipIndex}`, `Short-${episodeId}-${clipIndex}.mp4`);
  },
};

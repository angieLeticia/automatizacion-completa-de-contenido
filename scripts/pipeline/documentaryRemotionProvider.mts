// Fase 4.8 — único RenderProvider real hoy. Envuelve exactamente lo que
// processOne.mts ya hacía directamente contra MachineBridge.render desde la
// Fase 4.6/4.7 (mismo compositionId, mismo out/*.mp4, sin reuseIfExists ni
// timeoutMs para no cambiar comportamiento) — cero lógica nueva de render,
// solo la misma llamada detrás de la interfaz RenderProvider.
import { machineBridge } from "../../agent/machine/machineBridge.mts";
import type { RenderProvider } from "./renderProvider.mts";
import type { PipelineExecutionContext } from "./pipelineExecutionContext.mts";

if (!machineBridge.render) {
  throw new Error("MachineBridge.render debe estar implementado para usar documentaryRemotionProvider.");
}
const render = machineBridge.render;

// Fase 1.5.3 — `context` se reenvía tal cual a renderBridge.mts como parte de
// `opts` (que ya existía con `reuseIfExists`/`timeoutMs`, ver Fase 4.5) — sin
// contexto, `opts.context` es `undefined` y renderBridge/renderer usan
// exactamente sus rutas reales de siempre.
export const documentaryRemotionProvider: RenderProvider = {
  id: "documentary-remotion",
  async renderMain(episodeId, context?: PipelineExecutionContext) {
    return render.renderComposition(`MainDocumentary-${episodeId}`, `main-${episodeId}.mp4`, { context });
  },
  async renderClip(episodeId, clipIndex, context?: PipelineExecutionContext) {
    return render.renderComposition(`Short-${episodeId}-${clipIndex}`, `Short-${episodeId}-${clipIndex}.mp4`, { context });
  },
};

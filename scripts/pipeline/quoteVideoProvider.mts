// Fase 5.1 — RenderProvider real para el template QuoteVideo (migrado del
// repositorio externo de ALZA LA VOZ). Envuelve exactamente el mismo
// MachineBridge.render que documentaryRemotionProvider.mts — mismo motor,
// sin inventar un segundo mecanismo de render. `renderMain`/`renderClip` no
// aplican al concepto de "video/formato" de este canal (no tiene noción de
// episodio ni de clips derivados de un video largo) — se expone
// `renderVideo(videoId, format)` como la operación nombrada real que este
// contenido necesita, además de cumplir con la interfaz RenderProvider
// mínima (lanzando un error explícito si algo la llama por error).
import { machineBridge } from "../../agent/machine/machineBridge.mts";
import type { RenderProvider } from "./renderProvider.mts";

if (!machineBridge.render) {
  throw new Error("MachineBridge.render debe estar implementado para usar quoteVideoProvider.");
}
const render = machineBridge.render;

export type QuoteFormat = "vertical" | "square";

export const quoteVideoProvider: RenderProvider & {
  renderVideo(videoId: string, format: QuoteFormat): ReturnType<typeof render.renderComposition>;
} = {
  id: "quote-video-remotion",
  async renderMain() {
    throw new Error("quoteVideoProvider no implementa renderMain() — usar renderVideo(videoId, format).");
  },
  async renderClip() {
    throw new Error("quoteVideoProvider no implementa renderClip() — este contenido no tiene clips derivados de un video largo.");
  },
  async renderVideo(videoId, format) {
    return render.renderComposition(`Quote-alza-la-voz-${videoId}-${format}`, `alza-la-voz-${videoId}-${format}.mp4`);
  },
};

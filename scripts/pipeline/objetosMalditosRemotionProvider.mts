// FASE 9 — RenderProvider técnico de OBJETOS MALDITOS. Mismo motor de render
// que lunaVerdeRemotionProvider.mts — ver ese archivo para el razonamiento
// general del mecanismo (props reales, RealDataRenderProvider).
//
// Cierre de identidad (post-Fase 11): `theme` ya NO es placeholder — viene
// de objetosMalditosMainFixture/objetosMalditosClipFixture, que a su vez
// importan `objetosMalditosTheme` (channels/objetos-malditos/theme.ts,
// paleta/tipografía real aprobada). Este archivo no cambió su forma de
// tomar el theme — el cambio real vive únicamente en theme.ts, tal como
// debía ser.
//
// `watermark` SIGUE siendo `undefined` (objetosMalditosMainFixture/
// objetosMalditosClipFixture nunca lo definen) — a propósito: no existe
// ningún logo real de OBJETOS MALDITOS en D:\MATERIAL VIDEOS\OBJETOS MALDITOS
// (búsqueda real confirmada, cero resultados). GenericDocumentaryMain.tsx/
// GenericDocumentaryClip.tsx ya solo montan <Watermark> cuando
// `watermark?.imageSrc` existe de verdad — este provider está YA preparado
// para aceptar un asset real en cuanto exista: bastaría con agregar
// `watermark: { imageSrc: staticFile("assets/images/<logo real>") }` a
// `objetosMalditosMainIdentity`/`objetosMalditosClipIdentity` de abajo — sin
// tocar ninguna composición ni este archivo en ningún otro punto.
import { machineBridge } from "../../agent/machine/machineBridge.mts";
import type { RenderProvider, RealDataRenderProvider } from "./renderProvider.mts";
import type { PipelineExecutionContext } from "./pipelineExecutionContext.mts";
import { objetosMalditosMainFixture, objetosMalditosClipFixture } from "../../remotion/lib/objetosMalditosFixture.ts";
import type { DocumentaryEpisodeConfig, DocumentaryClipConfig } from "../../remotion/lib/documentaryEpisode.ts";

if (!machineBridge.render) {
  throw new Error("MachineBridge.render debe estar implementado para usar objetosMalditosRemotionProvider.");
}
const render = machineBridge.render;

export const OBJETOS_MALDITOS_MAIN_COMPOSITION_ID = "ObjetosMalditosMain";
export const OBJETOS_MALDITOS_CLIP_COMPOSITION_ID = "ObjetosMalditosClip";

// Cierre de identidad — el hook de un clip real SIEMPRE debe salir de texto
// REAL del episodio, nunca inventado. processOne.mts (flujo real) ya pasa
// `data.hookText`, calculado de verdad por clipSelector.mts a partir del
// propio guion/transcripción (ver ClipMark, remotion/lib/clips.ts) — se usa
// tal cual, sin reescribirlo ni "mejorarlo" (eso sería inventar una
// afirmación sobre el episodio). Las frases de tono que el usuario dio
// como ejemplo ("Nadie quería tocar este objeto...") son guía de ESTILO
// para quien escriba guiones/copy real — nunca hooks fijos hardcodeados
// aquí. Si esta función se llama fuera del flujo real de processOne.mts
// (ej. una prueba directa) y no hay hookText real disponible, se usa un
// marcador explícito que jamás afirma nada sobre el episodio.
const resolveHookText = (realHookText: string | undefined): string =>
  realHookText && realHookText.trim().length > 0 ? realHookText : "[SIN HOOK REAL DISPONIBLE — este clip se generó sin pasar por clipSelector.mts]";

type ObjetosMalditosMainIdentity = Pick<DocumentaryEpisodeConfig, "theme" | "audio" | "watermark">;
type ObjetosMalditosClipIdentity = Pick<DocumentaryClipConfig, "theme" | "audio" | "watermark">;

const objetosMalditosMainIdentity: ObjetosMalditosMainIdentity = {
  theme: objetosMalditosMainFixture.theme,
  audio: objetosMalditosMainFixture.audio,
  watermark: objetosMalditosMainFixture.watermark,
};
const objetosMalditosClipIdentity: ObjetosMalditosClipIdentity = {
  theme: objetosMalditosClipFixture.theme,
  audio: objetosMalditosClipFixture.audio,
  watermark: objetosMalditosClipFixture.watermark,
};

export const objetosMalditosRemotionProvider: RenderProvider &
  RealDataRenderProvider & {
    renderMainWithProps(episodeId: string, props: unknown, context?: PipelineExecutionContext): ReturnType<typeof render.renderComposition>;
    renderClipWithProps(episodeId: string, clipIndex: number, props: unknown, context?: PipelineExecutionContext): ReturnType<typeof render.renderComposition>;
  } = {
  id: "objetos-malditos-remotion",
  async renderMain(episodeId, context) {
    return render.renderComposition(OBJETOS_MALDITOS_MAIN_COMPOSITION_ID, `objetos-malditos-main-${episodeId}.mp4`, { context });
  },
  async renderClip(episodeId, clipIndex, context) {
    return render.renderComposition(OBJETOS_MALDITOS_CLIP_COMPOSITION_ID, `objetos-malditos-clip-${episodeId}-${clipIndex}.mp4`, { context });
  },
  async renderMainWithProps(episodeId, props, context) {
    return render.renderComposition(OBJETOS_MALDITOS_MAIN_COMPOSITION_ID, `objetos-malditos-main-${episodeId}.mp4`, { context, props });
  },
  async renderClipWithProps(episodeId, clipIndex, props, context) {
    return render.renderComposition(OBJETOS_MALDITOS_CLIP_COMPOSITION_ID, `objetos-malditos-clip-${episodeId}-${clipIndex}.mp4`, { context, props });
  },
  async renderMainWithRealData(episodeId, data, context) {
    const config: DocumentaryEpisodeConfig = { ...objetosMalditosMainIdentity, ...data };
    return render.renderComposition(OBJETOS_MALDITOS_MAIN_COMPOSITION_ID, `objetos-malditos-main-${episodeId}.mp4`, { context, props: { config } });
  },
  async renderClipWithRealData(episodeId, clipIndex, data, context) {
    const config: DocumentaryClipConfig = {
      ...objetosMalditosClipIdentity,
      captions: data.captions,
      videoPool: data.videoPool,
      imagePool: data.imagePool,
      shots: data.shots,
      narrationFile: data.narrationFile,
      reelOptions: data.reelOptions,
      startFrame: data.startFrame,
      endFrame: data.endFrame,
      objectPosition: data.objectPosition,
      hookText: resolveHookText(data.hookText),
    };
    return render.renderComposition(OBJETOS_MALDITOS_CLIP_COMPOSITION_ID, `objetos-malditos-clip-${episodeId}-${clipIndex}.mp4`, { context, props: { config } });
  },
};

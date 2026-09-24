// FASE 9 — RenderProvider técnico de LUNA VERDE. Mismo motor real
// (MachineBridge.render) que documentaryRemotionProvider.mts/
// chaosNewsRemotionProvider.mts, nunca un segundo mecanismo de render.
// Mapeo EXPLÍCITO en esta capa de configuración: "main" -> composición
// LunaVerdeMain, "clip" -> composición LunaVerdeClip.
//
// Cierre de identidad (post-Fase 11, mismo criterio ya aplicado a
// OBJETOS MALDITOS): `theme` ya NO es placeholder — viene de
// lunaVerdeMainFixture/lunaVerdeClipFixture, que a su vez importan
// `lunaVerdeTheme` (channels/luna-verde/theme.ts, paleta/tipografía real
// aprobada). Este archivo no cambió su forma de tomar el theme — el cambio
// real vive únicamente en theme.ts.
//
// `watermark` SIGUE siendo `undefined` (los fixtures nunca lo definen) — a
// propósito: no existe ningún logo real de LUNA VERDE en
// D:\MATERIAL VIDEOS\LUNA VERDE (búsqueda real confirmada, cero
// resultados). GenericDocumentaryMain.tsx/GenericDocumentaryClip.tsx ya
// solo montan <Watermark> cuando `watermark?.imageSrc` existe de verdad —
// este provider está YA preparado para aceptar un asset real en cuanto
// exista: bastaría con agregar
// `watermark: { imageSrc: staticFile("assets/images/<logo real>") }` a
// `lunaVerdeMainIdentity`/`lunaVerdeClipIdentity` de abajo — sin tocar
// ninguna composición ni este archivo en ningún otro punto.
import { machineBridge } from "../../agent/machine/machineBridge.mts";
import type { RenderProvider, RealDataRenderProvider } from "./renderProvider.mts";
import type { PipelineExecutionContext } from "./pipelineExecutionContext.mts";
import { lunaVerdeMainFixture, lunaVerdeClipFixture } from "../../remotion/lib/lunaVerdeFixture.ts";
import type { DocumentaryEpisodeConfig, DocumentaryClipConfig } from "../../remotion/lib/documentaryEpisode.ts";

if (!machineBridge.render) {
  throw new Error("MachineBridge.render debe estar implementado para usar lunaVerdeRemotionProvider.");
}
const render = machineBridge.render;

export const LUNA_VERDE_MAIN_COMPOSITION_ID = "LunaVerdeMain";
export const LUNA_VERDE_CLIP_COMPOSITION_ID = "LunaVerdeClip";

// Cierre de identidad — el hook de un clip real SIEMPRE debe salir de texto
// REAL del episodio, nunca inventado. processOne.mts (flujo real) ya pasa
// `data.hookText`, calculado de verdad por clipSelector.mts a partir del
// propio guion/transcripción (ver ClipMark, remotion/lib/clips.ts) — se usa
// tal cual, sin reescribirlo ni "mejorarlo" (eso sería inventar una
// afirmación sobre el episodio). Las frases de tono que el usuario dio como
// ejemplo ("Tal vez esto que estás sintiendo no sea casualidad...") son
// guía de ESTILO para quien escriba guiones/copy real — nunca hooks fijos
// hardcodeados aquí. Si esta función se llama fuera del flujo real de
// processOne.mts (ej. una prueba directa) y no hay hookText real
// disponible, se usa un marcador explícito que jamás afirma nada sobre el
// episodio.
const resolveHookText = (realHookText: string | undefined): string =>
  realHookText && realHookText.trim().length > 0 ? realHookText : "[SIN HOOK REAL DISPONIBLE — este clip se generó sin pasar por clipSelector.mts]";

// Identidad creativa: theme real (ver channels/luna-verde/theme.ts);
// audio/watermark siguen ausentes (sin música/logo real todavía). Cuando
// exista contenido real adicional, este extractor es lo único que debe
// cambiar — nunca processOne.mts.
type LunaVerdeMainIdentity = Pick<DocumentaryEpisodeConfig, "theme" | "audio" | "watermark">;
type LunaVerdeClipIdentity = Pick<DocumentaryClipConfig, "theme" | "audio" | "watermark">;

const lunaVerdeMainIdentity: LunaVerdeMainIdentity = {
  theme: lunaVerdeMainFixture.theme,
  audio: lunaVerdeMainFixture.audio,
  watermark: lunaVerdeMainFixture.watermark,
};
const lunaVerdeClipIdentity: LunaVerdeClipIdentity = {
  theme: lunaVerdeClipFixture.theme,
  audio: lunaVerdeClipFixture.audio,
  watermark: lunaVerdeClipFixture.watermark,
};

export const lunaVerdeRemotionProvider: RenderProvider &
  RealDataRenderProvider & {
    renderMainWithProps(episodeId: string, props: unknown, context?: PipelineExecutionContext): ReturnType<typeof render.renderComposition>;
    renderClipWithProps(episodeId: string, clipIndex: number, props: unknown, context?: PipelineExecutionContext): ReturnType<typeof render.renderComposition>;
  } = {
  id: "luna-verde-remotion",
  async renderMain(episodeId, context) {
    return render.renderComposition(LUNA_VERDE_MAIN_COMPOSITION_ID, `luna-verde-main-${episodeId}.mp4`, { context });
  },
  async renderClip(episodeId, clipIndex, context) {
    return render.renderComposition(LUNA_VERDE_CLIP_COMPOSITION_ID, `luna-verde-clip-${episodeId}-${clipIndex}.mp4`, { context });
  },
  async renderMainWithProps(episodeId, props, context) {
    return render.renderComposition(LUNA_VERDE_MAIN_COMPOSITION_ID, `luna-verde-main-${episodeId}.mp4`, { context, props });
  },
  async renderClipWithProps(episodeId, clipIndex, props, context) {
    return render.renderComposition(LUNA_VERDE_CLIP_COMPOSITION_ID, `luna-verde-clip-${episodeId}-${clipIndex}.mp4`, { context, props });
  },
  async renderMainWithRealData(episodeId, data, context) {
    const config: DocumentaryEpisodeConfig = { ...lunaVerdeMainIdentity, ...data };
    return render.renderComposition(LUNA_VERDE_MAIN_COMPOSITION_ID, `luna-verde-main-${episodeId}.mp4`, { context, props: { config } });
  },
  async renderClipWithRealData(episodeId, clipIndex, data, context) {
    const config: DocumentaryClipConfig = {
      ...lunaVerdeClipIdentity,
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
    return render.renderComposition(LUNA_VERDE_CLIP_COMPOSITION_ID, `luna-verde-clip-${episodeId}-${clipIndex}.mp4`, { context, props: { config } });
  },
};

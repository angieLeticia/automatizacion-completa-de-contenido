// FASE 5.10-AR (Fase 5 — RenderProvider de ENCIENDE EL CAOS) — mismo motor
// real (MachineBridge.render) que documentaryRemotionProvider.mts y
// quoteVideoProvider.mts, nunca un segundo mecanismo de render. Mapeo
// EXPLÍCITO en esta capa de configuración (nunca dentro de un componente
// React, nunca un if/else por nombre de canal): "main" -> composición
// ChaosNewsMain, "clip" -> composición ChaosNewsClip — nunca
// MainDocumentary/ShortClip/ningún id histórico.
//
// HALLAZGO REAL de Fase 5 (reportado, no resuelto en silencio) — RESUELTO EN
// FASE 6.5, solo a nivel de mecanismo: scripts/pipeline/renderer.mts
// ::renderComposition() ahora acepta un `props` opcional que serializa a
// --props=<archivo temporal> (ver renderProps.mts). renderMain/renderClip de
// abajo quedan IDÉNTICOS a Fase 5 (sin props — siguen dependiendo de
// chaosMainFixture/chaosClipFixture registrados como defaultProps en
// Root.tsx). Los dos métodos ADITIVOS `renderMainWithProps`/
// `renderClipWithProps` (fuera del contrato RenderProvider, mismo patrón que
// quoteVideoProvider.renderVideo) son el único punto donde un caller puede
// inyectar un ChaosEpisodeConfig/ChaosClipConfig real. processOne.mts NO
// llama a estos dos métodos todavía (decisión explícita de Fase 6.5, PASO
// 10 — conectar datos reales de un episodio requeriría cambios en
// processOne.mts fuera de alcance de esa fase). Sin esa conexión futura,
// este provider sigue sin poder producir contenido real de ENCIENDE EL
// CAOS en el flujo automático — solo demuestra, de forma aislada y
// sintética, que el mecanismo de props ya no está bloqueado.
import { machineBridge } from "../../agent/machine/machineBridge.mts";
import type { RenderProvider, RealDataRenderProvider } from "./renderProvider.mts";
import type { PipelineExecutionContext } from "./pipelineExecutionContext.mts";
import { chaosMainFixture, chaosClipFixture } from "../../remotion/lib/chaosFixture.ts";
import type { ChaosEpisodeConfig, ChaosClipConfig } from "../../remotion/lib/chaosEpisode.ts";

if (!machineBridge.render) {
  throw new Error("MachineBridge.render debe estar implementado para usar chaosNewsRemotionProvider.");
}
const render = machineBridge.render;

// IDs de composición FIJOS (Fase 4 — sin episode_id embebido, ver
// remotion/Root.tsx y agent/machine/renderBridge.mts::FIXED_COMPOSITION_IDS).
export const CHAOS_NEWS_MAIN_COMPOSITION_ID = "ChaosNewsMain";
export const CHAOS_NEWS_CLIP_COMPOSITION_ID = "ChaosNewsClip";

// Cierre del pendiente editorial (post-análisis Opción A vs B — se mantiene
// ChaosNewsMain/ChaosNewsClip, adaptación mínima): theme/extraColors/audio/
// bumper/closing/watermark siguen siendo identidad ESTÁTICA (bumper.channelName
// ya es real desde Fase 4; audio/closing/watermark siguen ausentes — sin
// música/cierre/logo real todavía, channelRegistry.mts sigue "PENDING").
//
// `hook` YA NO vive en esta identidad estática — se deriva POR EPISODIO a
// partir de las captions reales (ver resolveMainHookText más abajo), nunca
// de un valor fijo.
//
// `breakingTags`/`twists` YA NO salen del fixture para datos reales: no
// existe hoy ninguna señal fiable para decidir qué fragmento del guion es
// un "twist" o una alerta de última hora — se usan arrays vacíos
// (preferible no mostrar ninguno a fabricar uno, instrucción explícita).
// El fixture (chaosMainFixture/chaosClipFixture, usado solo por
// renderMain/renderClip/renderMainWithProps — nunca por datos reales) sigue
// intacto, sin tocar.
type ChaosMainIdentity = Pick<ChaosEpisodeConfig, "theme" | "extraColors" | "audio" | "bumper" | "closing" | "watermark">;
type ChaosClipIdentity = Pick<ChaosClipConfig, "theme" | "extraColors" | "audio" | "watermark" | "objectPosition">;

const chaosMainIdentity: ChaosMainIdentity = {
  theme: chaosMainFixture.theme,
  extraColors: chaosMainFixture.extraColors,
  audio: chaosMainFixture.audio,
  bumper: chaosMainFixture.bumper,
  closing: chaosMainFixture.closing,
  watermark: chaosMainFixture.watermark,
};

const chaosClipIdentity: ChaosClipIdentity = {
  theme: chaosClipFixture.theme,
  extraColors: chaosClipFixture.extraColors,
  audio: chaosClipFixture.audio,
  watermark: chaosClipFixture.watermark,
  objectPosition: chaosClipFixture.objectPosition,
};

// CAMBIO 1 — hook real del MAIN: captionTagger.mts ya marca type="hook" en
// los fragmentos cortos (≤6 palabras) del tramo de apertura real del guion
// (antes del primer CAPÍTULO) — son, literalmente, el cold-open real del
// episodio (ver captionTagger.mts::captionType()). Se usan tal cual, sin
// reescribirlos. Si el episodio no tiene ningún fragmento marcado "hook"
// (guion sin cold-open corto), se cae al primer caption real disponible,
// recortado — mismo criterio que clipSelector.mts ya usa para el hookText
// de clips (texto real, nunca inventado). Si no hay NINGÚN caption real
// (caso excepcional), se usa un marcador explícito que nunca simula
// contenido real.
const MAX_HOOK_CHARS = 140;
// Exportadas (no solo internas) para poder probarlas de forma directa y
// rápida — sin renderizar nada — verificando que el texto real llega tal
// cual y que ningún camino devuelve "[FIXTURE]". Ver test-chaos-news-provider.mts.
export const resolveMainHookText = (captions: ChaosEpisodeConfig["captions"]): string => {
  const hookFragments = captions.filter((c) => c.type === "hook").map((c) => c.text);
  if (hookFragments.length > 0) return hookFragments.join(" ").slice(0, MAX_HOOK_CHARS);
  if (captions.length > 0) return captions[0].text.slice(0, MAX_HOOK_CHARS);
  return "[SIN HOOK REAL DISPONIBLE — episodio sin captions]";
};

// CAMBIO 4 — hook real del CLIP: mismo mecanismo exacto ya usado en
// lunaVerdeRemotionProvider.mts/objetosMalditosRemotionProvider.mts.
// processOne.mts/renderProvider.mts ya pasan `data.hookText` real
// (clipSelector.mts) — no se tocan, solo se consume el dato aquí.
export const resolveHookText = (realHookText: string | undefined): string =>
  realHookText && realHookText.trim().length > 0 ? realHookText : "[SIN HOOK REAL DISPONIBLE — este clip se generó sin pasar por clipSelector.mts]";

export const chaosNewsRemotionProvider: RenderProvider &
  RealDataRenderProvider & {
    // Fase 6.5 — ADITIVO, fuera del contrato RenderProvider compartido (mismo
    // patrón que quoteVideoProvider.renderVideo: una operación nombrada real
    // que este canal necesita, sin forzarla sobre documentaryRemotionProvider/
    // quoteVideoProvider ni sobre processOne.mts). `props` va SIEMPRE junto al
    // `context` del sandbox de prueba (nunca se usa contra producción real,
    // ver test-chaos-news-props-e2e.mts).
    renderMainWithProps(episodeId: string, props: unknown, context?: PipelineExecutionContext): ReturnType<typeof render.renderComposition>;
    renderClipWithProps(episodeId: string, clipIndex: number, props: unknown, context?: PipelineExecutionContext): ReturnType<typeof render.renderComposition>;
  } = {
  id: "chaos-news-remotion",
  // `episodeId` se conserva en la firma por compatibilidad ESTRUCTURAL con
  // el contrato RenderProvider (processOne.mts siempre lo pasa) — a
  // diferencia de documentaryRemotionProvider.mts, aquí NUNCA se usa para
  // construir el id de composición Remotion (que es siempre el mismo id
  // fijo, ver nota de cabecera) — solo se usa para nombrar el archivo de
  // salida, mismo patrón de nomenclatura que documentaryRemotionProvider.mts
  // ya usa (`main-${episodeId}.mp4`).
  async renderMain(episodeId, context) {
    return render.renderComposition(CHAOS_NEWS_MAIN_COMPOSITION_ID, `chaos-news-main-${episodeId}.mp4`, { context });
  },
  async renderClip(episodeId, clipIndex, context) {
    return render.renderComposition(CHAOS_NEWS_CLIP_COMPOSITION_ID, `chaos-news-clip-${episodeId}-${clipIndex}.mp4`, { context });
  },
  async renderMainWithProps(episodeId, props, context) {
    return render.renderComposition(CHAOS_NEWS_MAIN_COMPOSITION_ID, `chaos-news-main-${episodeId}.mp4`, { context, props });
  },
  async renderClipWithProps(episodeId, clipIndex, props, context) {
    return render.renderComposition(CHAOS_NEWS_CLIP_COMPOSITION_ID, `chaos-news-clip-${episodeId}-${clipIndex}.mp4`, { context, props });
  },
  // Bloque 1 — implementa la capacidad genérica RealDataRenderProvider
  // (renderProvider.mts). processOne.mts la detecta por duck typing (nunca
  // por nombre de canal) y, si está presente, la usa en vez de renderMain.
  // Mezcla los DATOS REALES del episodio (captions/videoPool/imagePool/
  // shots/narración — calculados por processOne.mts con whisper/ffprobe
  // reales) con la identidad creativa TODAVÍA-fixture de arriba, y reutiliza
  // el mismo renderMainWithProps ya probado en Fase 6.5 — no un tercer
  // mecanismo de render.
  async renderMainWithRealData(episodeId, data, context) {
    const config: ChaosEpisodeConfig = {
      ...chaosMainIdentity,
      // CAMBIO 1 — hook real (nunca chaosMainFixture.hook.text). duration
      // se conserva del fixture (valor técnico de timing, no de contenido).
      hook: { text: resolveMainHookText(data.captions), durationInFrames: chaosMainFixture.hook.durationInFrames },
      // CAMBIO 2/3 — vacíos para datos reales (nunca chaosMainFixture.breakingTags/.twists).
      breakingTags: [],
      twists: [],
      captions: data.captions,
      videoPool: data.videoPool,
      imagePool: data.imagePool,
      shots: data.shots,
      narrationFile: data.narrationFile,
      narrationDurationSeconds: data.narrationDurationSeconds,
      reelOptions: data.reelOptions,
    };
    return render.renderComposition(CHAOS_NEWS_MAIN_COMPOSITION_ID, `chaos-news-main-${episodeId}.mp4`, { context, props: { config } });
  },
  async renderClipWithRealData(episodeId, clipIndex, data, context) {
    const config: ChaosClipConfig = {
      ...chaosClipIdentity,
      // CAMBIO 2/3 — vacíos para datos reales (nunca chaosClipFixture.breakingTags/.twists).
      breakingTags: [],
      twists: [],
      captions: data.captions,
      videoPool: data.videoPool,
      imagePool: data.imagePool,
      shots: data.shots,
      narrationFile: data.narrationFile,
      reelOptions: data.reelOptions,
      startFrame: data.startFrame,
      endFrame: data.endFrame,
      // CAMBIO 4 — hook real del clip (nunca chaosClipFixture.hookText).
      hookText: resolveHookText(data.hookText),
    };
    return render.renderComposition(CHAOS_NEWS_CLIP_COMPOSITION_ID, `chaos-news-clip-${episodeId}-${clipIndex}.mp4`, { context, props: { config } });
  },
};

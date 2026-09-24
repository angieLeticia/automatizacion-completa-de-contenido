// FASE 9 (post-6.5/Bloque 1-6) — contrato de datos para la arquitectura
// PROVISIONAL "documental genérico" (LUNA VERDE y OBJETOS MALDITOS, por
// instrucción explícita: "usa MainDocumentary como base, con identidad
// propia"). Deliberadamente NO reutiliza remotion/lib/episodes.ts
// (MainDocumentary.tsx real, de SIN EXPLICACIÓN, está acoplado a
// getEpisode(episodeId) contra ese catálogo ESTÁTICO y COMPARTIDO — escribir
// ahí para otro canal arriesgaría el archivo real de producción de SIN
// EXPLICACIÓN, exactamente lo que "SIN EXPLICACIÓN debe permanecer intacto"
// prohíbe). En su lugar, mismo patrón ya probado en Fase 4 con
// chaosEpisode.ts: identidad + datos reales llegan vía props, nunca vía el
// catálogo compartido — reutiliza directamente RealEpisodeData/RealClipData
// (renderProvider.mts, Bloque 1) para la parte de datos reales, y solo
// agrega la capa de identidad (theme/audio/watermark) que MainDocumentary.tsx
// importa hoy de forma fija desde "./theme" (SIN EXPLICACIÓN).
import type { ChannelVisualTheme } from "../theme";
import type { AmbientAudioConfig } from "./musicBed";
import type { RealEpisodeData, RealClipData } from "../../scripts/pipeline/renderProvider.mts";

export type DocumentaryWatermarkConfig = {
  imageSrc?: string; // sin logo real, Watermark.tsx cae a su propio default histórico de SIN EXPLICACIÓN — ver GenericDocumentaryMain.tsx sobre por qué esto no es aceptable y cómo se evita
  size?: number;
  opacity?: number;
  margin?: number;
};

export type DocumentaryEpisodeConfig = RealEpisodeData & {
  theme: ChannelVisualTheme;
  audio?: AmbientAudioConfig; // omitido = sin cama de música/textura (nunca hereda la de SIN EXPLICACIÓN)
  watermark?: DocumentaryWatermarkConfig;
};

// Config de un clip vertical — mismo criterio que ChaosClipConfig (Fase 4):
// un subconjunto del episodio completo más el rango [startFrame, endFrame) y
// un hookText corto para el HookCard inicial (mismo componente genérico que
// ya usa ChaosNewsClip.tsx).
export type DocumentaryClipConfig = Omit<RealClipData, "narrationDurationSeconds"> & {
  theme: ChannelVisualTheme;
  audio?: AmbientAudioConfig;
  watermark?: DocumentaryWatermarkConfig;
  hookText: string;
  objectPosition?: string;
};

const FPS = 30; // mismo valor global que theme.ts::FPS — evita importar theme.ts (SIN EXPLICACIÓN) desde un archivo puramente de tipos/helpers genérico
const secToFrames = (sec: number) => Math.round(sec * FPS);

// Duración total: máximo entre narración y captions — mismo criterio que
// mainDurationInFrames() (episodes.ts) y chaosMainDurationInFrames()
// (chaosEpisode.ts), sin hook/bumper/cierre (esta arquitectura no los tiene).
export const documentaryMainDurationInFrames = (config: DocumentaryEpisodeConfig): number => {
  const captionsEnd = config.captions.length === 0 ? 0 : Math.max(...config.captions.map((c) => secToFrames(c.end)));
  return Math.max(secToFrames(config.narrationDurationSeconds), captionsEnd);
};

export const documentaryClipDurationInFrames = (config: DocumentaryClipConfig): number => Math.max(config.endFrame - config.startFrame, 1);

// Fase 4.8 — contrato RenderProvider. Agent 2 pide "renderiza este episodio
// para este canal" y el provider resuelto decide cómo — sin que processOne.mts
// necesite saber qué motor de render usa cada canal (Remotion en este repo,
// un Remotion independiente externo, o lo que llegue después).
import type { PipelineExecutionContext } from "./pipelineExecutionContext.mts";
import type { Caption } from "../../remotion/lib/captions.ts";
import type { SourceVideo, SourceImage, Shot, ReelOptions } from "../../remotion/lib/broll.ts";

export type RenderResult = { path: string; hash: string; reused: boolean };

// Fase 1.5.3 — `context` opcional agregado al ÚNICO conducto entre
// processOne.mts y renderBridge.mts/renderer.mts. Sin él (producción real),
// el provider se comporta exactamente igual que antes de esta fase — no es un
// archivo de los 6 aprobados en el diseño de Fase 1.5.2, pero es
// estructuralmente inevitable: es la interfaz que decide qué motor de render
// usa cada canal (Fase 4.8), y no hay otro punto por donde pasar el contexto
// sin él. Extensión puramente mecánica (un parámetro más, sin lógica nueva).
export interface RenderProvider {
  id: string;
  renderMain(episodeId: string, context?: PipelineExecutionContext): Promise<RenderResult>;
  renderClip(episodeId: string, clipIndex: number, context?: PipelineExecutionContext): Promise<RenderResult>;
}

// Bloque 1 (post-Fase 6.5) — datos REALES de un episodio que processProject()
// ya calcula para CUALQUIER canal, antes de siquiera resolver un
// RenderProvider (whisper real, ffprobe real, assignVisuals() real) —
// reutiliza exactamente los tipos ya existentes (Caption/SourceVideo/
// SourceImage/Shot/ReelOptions, los mismos que episodeRegistrar.mts ya
// escribe a remotion/data/*.json), nunca una estructura nueva. NO incluye
// identidad creativa (theme/hook/bumper/twists/watermark/audio) — eso sigue
// siendo responsabilidad exclusiva de cada provider (ver
// chaosNewsRemotionProvider.mts), nunca de processOne.mts, que permanece
// channel-agnostic.
export type RealEpisodeData = {
  captions: Caption[];
  videoPool: SourceVideo[];
  imagePool: SourceImage[];
  // FASE 9 — opcional (no obligatorio): processOne.mts SIEMPRE lo provee con
  // datos reales (assignVisuals()), pero un fixture técnico (defaultProps de
  // Root.tsx) puede omitirlo y dejar que la composición lo calcule vía
  // buildReel() — mismo criterio que ChaosEpisodeConfig.shots?/EpisodeConfig.shots?
  // ya usan. Cambio retrocompatible (un campo requerido que pasa a opcional
  // nunca rompe a quien ya lo proveía).
  shots?: Shot[];
  narrationFile?: string; // relativo a public/assets/audio/, igual que copyEpisodeAssets() ya produce
  narrationDurationSeconds: number;
  reelOptions?: ReelOptions;
};

// `hookText`/`objectPosition` — hallazgo real (cierre de identidad de
// OBJETOS MALDITOS): clipSelector.mts YA calcula un `hookText` real por
// clip (derivado de texto real de caption/guion, ver ClipMark en
// remotion/lib/clips.ts) — antes de este campo, processOne.mts lo
// descartaba silenciosamente al construir los datos para
// renderClipWithRealData(), forzando a cada provider a inventar un
// placeholder. Opcional (no todos los providers lo necesitan todavía) —
// nunca cambia el comportamiento de quien no lo lee.
export type RealClipData = RealEpisodeData & { startFrame: number; endFrame: number; hookText?: string; objectPosition?: string };

// Capacidad OPCIONAL y ADITIVA de un RenderProvider: recibir los datos reales
// de arriba en vez de depender de defaultProps/fixtures estáticos. Ningún
// provider existente (documentary-remotion, quote-video-remotion) la
// implementa ni está obligado a implementarla — RenderProvider (la interfaz
// base) no cambia. processOne.mts detecta esta capacidad con
// isRealDataRenderProvider() (duck typing genérico, nunca un
// `if (channel === ...)`) y, si el provider resuelto la tiene, la usa en vez
// de renderMain/renderClip; si no, el camino es exactamente el de siempre.
export interface RealDataRenderProvider extends RenderProvider {
  renderMainWithRealData(episodeId: string, data: RealEpisodeData, context?: PipelineExecutionContext): Promise<RenderResult>;
  renderClipWithRealData(episodeId: string, clipIndex: number, data: RealClipData, context?: PipelineExecutionContext): Promise<RenderResult>;
}

export function isRealDataRenderProvider(provider: RenderProvider): provider is RealDataRenderProvider {
  const p = provider as Partial<RealDataRenderProvider>;
  return typeof p.renderMainWithRealData === "function" && typeof p.renderClipWithRealData === "function";
}

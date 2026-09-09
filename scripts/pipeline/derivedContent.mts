// Fase 4.9 — contrato DerivedContent (Sección 8). Formaliza qué es un
// artefacto derivado del video largo (CLIP/HIGHLIGHT/VERTICAL) sin tocar
// ClipMark (remotion/lib/clips.ts) — ese tipo sigue siendo exactamente lo que
// Root.tsx/ShortClip ya consumen, sin cambios. DerivedContent es una capa de
// REPORTE/CONTRATO por encima, no un reemplazo.
//
// Representación en base de datos (PROPUESTA, NO aplicada — ver
// docs/database-contract.md): no se necesita una tabla `derived_content`
// nueva. `content_files.folder_type` ya distingue 'completo'/'clip' — extender
// su CHECK a incluir 'highlight'/'vertical' (migración no destructiva)
// alcanza, siempre que existan las carpetas de salida físicas correspondientes
// y se agreguen a agent/config.mts::OUTPUT_FOLDERS.
import type { ClipMark } from "../../remotion/lib/clips.ts";

export type DerivedContentType = "CLIP" | "HIGHLIGHT" | "VERTICAL";

export type DerivedContentQualityStatus = "pending" | "passed" | "failed";

export type DerivedContent = {
  id: string; // estable: `${channel}::${episodeId}::${type}::${index}`
  channel: string;
  episodeId: string;
  parentContentFileId: string | null; // id real en content_files cuando exista (Agent 3); null si no se ha registrado todavía
  type: DerivedContentType;
  sourceStart: number; // segundos, dentro del video largo
  sourceEnd: number;
  durationSeconds: number;
  aspectRatio: "16:9" | "9:16" | "1:1";
  outputPath: string | null; // null hasta que se renderiza de verdad
  checksum: string | null; // sha256, null hasta que se renderiza de verdad
  qualityStatus: DerivedContentQualityStatus;
  createdAt: string; // ISO
};

let counter = 0;
const nextId = (channel: string, episodeId: string, type: DerivedContentType): string => {
  counter += 1;
  return `${channel}::${episodeId}::${type}::${counter}`;
};

// Adapta un ClipMark REAL (ya producido por clipSelector.mts/highlightSelector.mts)
// a la forma DerivedContent — no recalcula nada, solo re-expresa lo que ya
// existe con la identidad/metadata que Sección 8 pide. FPS viene de
// remotion/theme.ts (mismo que usa todo el pipeline, sin duplicar el valor).
export function clipMarkToDerivedContent(
  mark: ClipMark,
  type: DerivedContentType,
  context: { channel: string; episodeId: string; fps: number; aspectRatio: DerivedContent["aspectRatio"] }
): DerivedContent {
  const sourceStart = mark.startFrame / context.fps;
  const sourceEnd = mark.endFrame / context.fps;
  return {
    id: nextId(context.channel, context.episodeId, type),
    channel: context.channel,
    episodeId: context.episodeId,
    parentContentFileId: null,
    type,
    sourceStart,
    sourceEnd,
    durationSeconds: sourceEnd - sourceStart,
    aspectRatio: context.aspectRatio,
    outputPath: null,
    checksum: null,
    qualityStatus: "pending",
    createdAt: new Date().toISOString(),
  };
}

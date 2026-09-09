// Fase 4.9 — Sección 10: separa el ORIGEN editorial (CLIP/HIGHLIGHT) del
// DESTINO de plataforma (VerticalPlatform). "Short" no es un tercer tipo de
// contenido — es un DerivedContent (type=CLIP o HIGHLIGHT) llevado a un
// VerticalAsset para una plataforma concreta. No se asume que todas las
// plataformas usan el mismo tratamiento editorial: cada VerticalAsset es una
// instancia propia, aunque hoy todas compartan el mismo render 1080x1920
// (ShortClip, sin cambios) por ausencia de un motivo real para diferenciarlas.
import type { DerivedContent } from "./derivedContent.mts";
import type { MediaInfo } from "../../agent/machine/types.mts";

export type VerticalPlatform = "youtube_shorts" | "instagram_reels" | "facebook_reels" | "tiktok";

export type VerticalAsset = {
  id: string; // `${derivedContent.id}::${platform}`
  sourceDerivedContentId: string;
  sourceType: DerivedContent["type"]; // CLIP o HIGHLIGHT — nunca VERTICAL (no hay verticales de verticales)
  channel: string;
  episodeId: string;
  platform: VerticalPlatform;
  outputPath: string | null;
  checksum: string | null;
  validation: VerticalValidationResult | null;
};

export type VerticalValidationResult =
  | { ok: true }
  | { ok: false; reasons: string[] };

const TARGET_WIDTH = 1080;
const TARGET_HEIGHT = 1920;

// Validación real contra MediaInfo real (el mismo shape que ya produce
// MachineBridge.media.probe — Fase 4.5) — no inventa un validador nuevo de
// ffprobe, reusa el contrato ya existente.
export function validateVerticalAsset(info: MediaInfo): VerticalValidationResult {
  const reasons: string[] = [];
  if (info.width !== TARGET_WIDTH || info.height !== TARGET_HEIGHT) {
    reasons.push(`resolución ${info.width}x${info.height}, se esperaba ${TARGET_WIDTH}x${TARGET_HEIGHT} (9:16)`);
  }
  if (info.durationSeconds <= 0) {
    reasons.push("duración inválida (<= 0s)");
  }
  if (!info.hasAudioStream) {
    reasons.push("sin pista de audio");
  }
  return reasons.length === 0 ? { ok: true } : { ok: false, reasons };
}

export function buildVerticalAsset(source: DerivedContent, platform: VerticalPlatform): VerticalAsset {
  if (source.type === "VERTICAL") {
    throw new Error("VERTICAL no puede derivarse de otro VERTICAL — solo de CLIP o HIGHLIGHT.");
  }
  return {
    id: `${source.id}::${platform}`,
    sourceDerivedContentId: source.id,
    sourceType: source.type,
    channel: source.channel,
    episodeId: source.episodeId,
    platform,
    outputPath: null,
    checksum: null,
    validation: null,
  };
}

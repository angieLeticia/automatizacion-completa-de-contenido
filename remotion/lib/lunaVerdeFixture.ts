// FASE 9 — FIXTURE TÉCNICO, no contenido real. Usado EXCLUSIVAMENTE como
// `defaultProps` para poder registrar/validar LunaVerdeMain/LunaVerdeClip en
// Root.tsx (Remotion exige defaultProps completos y válidos para poder
// listar/previsualizar una composición) y para pruebas automatizadas. Mismo
// patrón exacto que remotion/lib/chaosFixture.ts (Fase 4) — todo texto
// marcado "[FIXTURE]", assets sintéticos generados solo para pruebas
// puntuales, nunca apuntan a D:\MATERIAL VIDEOS ni a ningún asset real.
import type { DocumentaryEpisodeConfig, DocumentaryClipConfig } from "./documentaryEpisode";
import { lunaVerdeTheme } from "../../channels/luna-verde/theme";
import type { Caption } from "./captions";
import type { SourceVideo, SourceImage } from "./broll";

const FIXTURE_CAPTIONS: Caption[] = [
  { start: 0, end: 3, text: "[FIXTURE] Texto de caption de prueba uno.", type: "normal" },
  { start: 3, end: 6, text: "[FIXTURE] Texto de caption de prueba dos.", type: "normal" },
];

const FIXTURE_VIDEO_POOL: SourceVideo[] = [{ kind: "video", file: "_fixture_luna_verde/clip-a.mp4", durationSec: 4, width: 1920, height: 1080 }];
const FIXTURE_IMAGE_POOL: SourceImage[] = [{ kind: "image", file: "_fixture_luna_verde/image-a.jpg", width: 1920, height: 1080 }];

export const lunaVerdeMainFixture: DocumentaryEpisodeConfig = {
  theme: lunaVerdeTheme,
  captions: FIXTURE_CAPTIONS,
  videoPool: FIXTURE_VIDEO_POOL,
  imagePool: FIXTURE_IMAGE_POOL,
  narrationDurationSeconds: 9,
};

export const lunaVerdeClipFixture: DocumentaryClipConfig = {
  theme: lunaVerdeTheme,
  startFrame: 0,
  endFrame: 270, // 9s @ 30fps, corto a propósito solo para que la validación sea rápida
  hookText: "[FIXTURE] Hook de clip de prueba",
  captions: FIXTURE_CAPTIONS,
  videoPool: FIXTURE_VIDEO_POOL,
  imagePool: FIXTURE_IMAGE_POOL,
};

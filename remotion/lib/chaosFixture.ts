// FASE 5.10-AQ (Fase 4) — FIXTURE TÉCNICO, no contenido real. Usado
// EXCLUSIVAMENTE como `defaultProps` para poder registrar/validar
// ChaosNewsMain/ChaosNewsClip en Root.tsx (Remotion exige defaultProps
// completos y válidos para poder listar/previsualizar una composición) y
// para pruebas automatizadas. Todo texto está marcado explícitamente como
// "FIXTURE" — ningún hook, nombre de celebridad, titular ni CTA real. Los
// archivos de video/imagen/audio referenciados son sintéticos, generados
// solo para pruebas puntuales (ver test-enciende-el-caos-compositions.mts)
// — nunca apuntan a D:\MATERIAL VIDEOS ni a ningún asset real.
import type { ChaosEpisodeConfig, ChaosClipConfig } from "./chaosEpisode";
import { enciendeElCaosTheme, enciendeElCaosExtraColors } from "../../channels/enciende-el-caos/theme";
import type { Caption } from "./captions";
import type { SourceVideo, SourceImage } from "./broll";

const FIXTURE_CAPTIONS: Caption[] = [
  { start: 0, end: 3, text: "[FIXTURE] Texto de caption de prueba uno.", type: "hook" },
  { start: 3, end: 6, text: "[FIXTURE] Texto de caption de prueba dos.", type: "normal" },
  { start: 6, end: 9, text: "[FIXTURE] Texto de caption de prueba tres.", type: "reveal" },
];

// Dimensiones/duraciones inventadas SOLO como metadata técnica (nunca se
// generan archivos reales desde este módulo) — quien ejecute un render real
// de validación provee los archivos sintéticos reales por separado y los
// referencia con estos mismos nombres relativos.
const FIXTURE_VIDEO_POOL: SourceVideo[] = [{ kind: "video", file: "_fixture_chaos/clip-a.mp4", durationSec: 4, width: 1920, height: 1080 }];
const FIXTURE_IMAGE_POOL: SourceImage[] = [{ kind: "image", file: "_fixture_chaos/image-a.jpg", width: 1920, height: 1080 }];

export const chaosMainFixture: ChaosEpisodeConfig = {
  theme: enciendeElCaosTheme,
  extraColors: enciendeElCaosExtraColors,
  // Sin audio config real todavía (PASO 7) — omitido a propósito.
  hook: { text: "[FIXTURE] Titular de prueba — no es contenido real", durationInFrames: 60 },
  bumper: { channelName: "ENCIENDE EL CAOS", durationInFrames: 45 },
  breakingTags: [{ text: "[FIXTURE TAG]", startFrame: 120, durationInFrames: 60, position: "top-left" }],
  twists: [{ title: "[FIXTURE] Giro de prueba", startFrame: 200, durationInFrames: 90, displayMode: "overlay" }],
  // Sin cierre real todavía — se omite a propósito (nunca se inventa un CTA).
  captions: FIXTURE_CAPTIONS,
  videoPool: FIXTURE_VIDEO_POOL,
  imagePool: FIXTURE_IMAGE_POOL,
  // Sin narrationFile real todavía (sin voz) — se omite a propósito.
  narrationDurationSeconds: 9,
};

export const chaosClipFixture: ChaosClipConfig = {
  theme: enciendeElCaosTheme,
  extraColors: enciendeElCaosExtraColors,
  startFrame: 0,
  endFrame: 270, // 9s @ 30fps, dentro del rango objetivo de 1-2 min pedido (el fixture es corto solo para que la validación sea rápida)
  hookText: "[FIXTURE] Hook de clip de prueba",
  captions: FIXTURE_CAPTIONS,
  videoPool: FIXTURE_VIDEO_POOL,
  imagePool: FIXTURE_IMAGE_POOL,
};

// FASE 9 — FIXTURE TÉCNICO, no contenido real. Mismo criterio exacto que
// remotion/lib/lunaVerdeFixture.ts / remotion/lib/chaosFixture.ts (Fase 4).
import type { DocumentaryEpisodeConfig, DocumentaryClipConfig } from "./documentaryEpisode";
import { objetosMalditosTheme } from "../../channels/objetos-malditos/theme";
import type { Caption } from "./captions";
import type { SourceVideo, SourceImage } from "./broll";

const FIXTURE_CAPTIONS: Caption[] = [
  { start: 0, end: 3, text: "[FIXTURE] Texto de caption de prueba uno.", type: "normal" },
  { start: 3, end: 6, text: "[FIXTURE] Texto de caption de prueba dos.", type: "normal" },
];

const FIXTURE_VIDEO_POOL: SourceVideo[] = [{ kind: "video", file: "_fixture_objetos_malditos/clip-a.mp4", durationSec: 4, width: 1920, height: 1080 }];
const FIXTURE_IMAGE_POOL: SourceImage[] = [{ kind: "image", file: "_fixture_objetos_malditos/image-a.jpg", width: 1920, height: 1080 }];

export const objetosMalditosMainFixture: DocumentaryEpisodeConfig = {
  theme: objetosMalditosTheme,
  captions: FIXTURE_CAPTIONS,
  videoPool: FIXTURE_VIDEO_POOL,
  imagePool: FIXTURE_IMAGE_POOL,
  narrationDurationSeconds: 9,
};

export const objetosMalditosClipFixture: DocumentaryClipConfig = {
  theme: objetosMalditosTheme,
  startFrame: 0,
  endFrame: 270,
  hookText: "[FIXTURE] Hook de clip de prueba",
  captions: FIXTURE_CAPTIONS,
  videoPool: FIXTURE_VIDEO_POOL,
  imagePool: FIXTURE_IMAGE_POOL,
};

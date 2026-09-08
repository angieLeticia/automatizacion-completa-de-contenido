import { existsSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";

export type QaResult = { ok: true } | { ok: false; reason: string };

// Comprobación de sanidad de un .mp4 recién renderizado: existe, tiene peso
// razonable, ffprobe puede leerlo sin errores, tiene stream de video y de
// audio, y la duración está dentro de lo esperado (con tolerancia).
export const checkRenderedVideo = (
  filePath: string,
  expectedDurationSeconds: number,
  toleranceSeconds = 5
): QaResult => {
  if (!existsSync(filePath)) return { ok: false, reason: `no existe ${filePath}` };

  const size = statSync(filePath).size;
  if (size < 100_000) return { ok: false, reason: `archivo sospechosamente pequeño (${size} bytes)` };

  const probe = spawnSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "stream=codec_type,duration", "-show_entries", "format=duration", "-of", "json", filePath],
    { encoding: "utf-8" }
  );
  if (probe.status !== 0) return { ok: false, reason: `ffprobe falló: ${probe.stderr}` };

  let parsed: { streams?: { codec_type: string; duration?: string }[]; format?: { duration?: string } };
  try {
    parsed = JSON.parse(probe.stdout);
  } catch {
    return { ok: false, reason: "ffprobe devolvió JSON inválido" };
  }

  const streams = parsed.streams ?? [];
  if (!streams.some((s) => s.codec_type === "video")) return { ok: false, reason: "sin stream de video" };
  if (!streams.some((s) => s.codec_type === "audio")) return { ok: false, reason: "sin stream de audio" };

  const duration = Number(parsed.format?.duration ?? 0);
  if (Math.abs(duration - expectedDurationSeconds) > toleranceSeconds) {
    return {
      ok: false,
      reason: `duración ${duration.toFixed(1)}s difiere de la esperada ${expectedDurationSeconds.toFixed(1)}s`,
    };
  }

  return { ok: true };
};

export const checkClip = (filePath: string, minSeconds: number, maxSeconds: number): QaResult => {
  if (!existsSync(filePath)) return { ok: false, reason: `no existe ${filePath}` };

  const probe = spawnSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "stream=codec_type,width,height", "-show_entries", "format=duration", "-of", "json", filePath],
    { encoding: "utf-8" }
  );
  if (probe.status !== 0) return { ok: false, reason: `ffprobe falló: ${probe.stderr}` };

  let parsed: { streams?: { codec_type: string; width?: number; height?: number }[]; format?: { duration?: string } };
  try {
    parsed = JSON.parse(probe.stdout);
  } catch {
    return { ok: false, reason: "ffprobe devolvió JSON inválido" };
  }

  const streams = parsed.streams ?? [];
  if (!streams.some((s) => s.codec_type === "video")) return { ok: false, reason: "sin stream de video" };
  if (!streams.some((s) => s.codec_type === "audio")) return { ok: false, reason: "sin stream de audio" };

  const videoStream = streams.find((s) => s.codec_type === "video");
  if (videoStream?.width && videoStream?.height && videoStream.height <= videoStream.width) {
    return { ok: false, reason: `no es vertical 9:16 (${videoStream.width}x${videoStream.height})` };
  }

  const duration = Number(parsed.format?.duration ?? 0);
  if (duration < minSeconds) return { ok: false, reason: `dura ${duration.toFixed(1)}s, menos del mínimo ${minSeconds}s` };
  if (duration > maxSeconds + 5) return { ok: false, reason: `dura ${duration.toFixed(1)}s, más del máximo ${maxSeconds}s` };

  return { ok: true };
};

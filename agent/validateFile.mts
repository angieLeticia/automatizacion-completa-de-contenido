// Validación de archivo terminado: usa el ffprobe ya instalado en esta PC (el mismo
// que usa scripts/pipeline) — el agente no genera ni transcodifica nada, solo
// confirma que lo que hay en disco es un video real y coherente.
import { execFileSync } from "node:child_process";
import { statSync } from "node:fs";
import { MIN_FILE_SIZE_BYTES } from "./config.mts";

export interface ValidationResult {
  ok: boolean;
  reason?: string;
  durationSec?: number;
  width?: number;
  height?: number;
}

type FfprobeStream = { codec_type?: string; width?: number; height?: number; duration?: string };
type FfprobeOutput = { streams?: FfprobeStream[]; format?: { duration?: string } };

export function validateFile(filePath: string): ValidationResult {
  const size = statSync(filePath).size;
  if (size < MIN_FILE_SIZE_BYTES) {
    return { ok: false, reason: `archivo demasiado pequeño (${size} bytes)` };
  }

  let info: FfprobeOutput;
  try {
    const out = execFileSync(
      "ffprobe",
      [
        "-v", "error",
        "-show_entries", "stream=codec_type,width,height,duration",
        "-show_entries", "format=duration",
        "-of", "json",
        filePath,
      ],
      { encoding: "utf-8" }
    );
    info = JSON.parse(out) as FfprobeOutput;
  } catch (err) {
    return { ok: false, reason: `ffprobe falló: ${err instanceof Error ? err.message : String(err)}` };
  }

  const videoStream = info.streams?.find((s) => s.codec_type === "video");
  if (!videoStream) {
    return { ok: false, reason: "no se encontró ningún stream de vídeo" };
  }

  const durationSec = Number(videoStream.duration ?? info.format?.duration ?? 0);
  if (!durationSec || durationSec <= 0) {
    return { ok: false, reason: "duración inválida o no detectada" };
  }

  return { ok: true, durationSec, width: videoStream.width, height: videoStream.height };
}

export function assertFfprobeAvailable(): void {
  try {
    execFileSync("ffprobe", ["-version"], { stdio: "ignore" });
  } catch {
    throw new Error("ffprobe no está disponible en el PATH — instálalo antes de correr el agente.");
  }
}

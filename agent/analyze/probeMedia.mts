// ffprobe propio de la Fase 3 - deliberadamente NO reutiliza agent/validateFile.mts
// (que es de la Fase 2 ya probada) para no arriesgar ese codigo. Duplica unas pocas
// lineas de parseo a cambio de aislamiento total.
import { execFileSync } from "node:child_process";

export interface MediaInfo {
  durationSeconds: number;
  width: number;
  height: number;
  hasAudioStream: boolean;
}

type FfprobeStream = { codec_type?: string; width?: number; height?: number; duration?: string };
type FfprobeOutput = { streams?: FfprobeStream[]; format?: { duration?: string } };

export class ProbeError extends Error {
  constructor(public code: "ffprobe_missing" | "ffprobe_failed", message: string) {
    super(message);
  }
}

export function probeMedia(filePath: string): MediaInfo {
  let out: string;
  try {
    out = execFileSync(
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
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isMissing = /ENOENT/.test(message);
    throw new ProbeError(
      isMissing ? "ffprobe_missing" : "ffprobe_failed",
      isMissing ? "ffprobe no esta disponible en el PATH" : `ffprobe fallo: ${message}`
    );
  }

  let info: FfprobeOutput;
  try {
    info = JSON.parse(out) as FfprobeOutput;
  } catch (err) {
    throw new ProbeError("ffprobe_failed", `Salida de ffprobe no es JSON valido: ${err instanceof Error ? err.message : String(err)}`);
  }

  const videoStream = info.streams?.find((s) => s.codec_type === "video");
  const audioStream = info.streams?.find((s) => s.codec_type === "audio");
  const durationSeconds = Number(videoStream?.duration ?? info.format?.duration ?? 0);

  return {
    durationSeconds,
    width: videoStream?.width ?? 0,
    height: videoStream?.height ?? 0,
    hasAudioStream: Boolean(audioStream),
  };
}

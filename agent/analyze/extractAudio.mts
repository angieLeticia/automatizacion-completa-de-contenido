// Extrae la pista de audio a WAV mono 16kHz (formato que mejor procesa Whisper),
// usando el ffmpeg ya instalado en esta PC. Nunca envia el video completo a nadie -
// esto es solo para uso local, el archivo se borra despues de transcribir.
import { execFileSync } from "node:child_process";
import path from "node:path";

export class AudioExtractError extends Error {
  constructor(public code: "ffmpeg_missing" | "ffmpeg_failed" | "temp_dir_failed", message: string) {
    super(message);
  }
}

export function extractAudioToWav(videoPath: string, outDir: string): string {
  const wavPath = path.join(outDir, "audio.wav");
  try {
    execFileSync(
      "ffmpeg",
      ["-y", "-i", videoPath, "-vn", "-ac", "1", "-ar", "16000", wavPath],
      { stdio: ["ignore", "ignore", "pipe"], encoding: "utf-8" }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isMissing = /ENOENT/.test(message);
    throw new AudioExtractError(
      isMissing ? "ffmpeg_missing" : "ffmpeg_failed",
      isMissing ? "ffmpeg no esta disponible en el PATH" : `ffmpeg fallo extrayendo audio: ${message}`
    );
  }
  return wavPath;
}

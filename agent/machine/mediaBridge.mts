// Implementación real de MediaBridge (Fase 4.5). Envuelve el código YA
// AUDITADO (ver docs/machine-access.md §Auditoría) sin reescribirlo:
//   probe            -> agent/analyze/probeMedia.mts (única función que ya
//                        devuelve el shape exacto de MediaInfo)
//   extractAudioToWav-> agent/analyze/extractAudio.mts
//   detectSilences   -> scripts/pipeline/silenceDetector.mts
//   concatAudio      -> scripts/pipeline/voiceGenerator.mts::concatAudioFiles
//                        (extraída en esta misma fase, ver ese archivo)
//   transcribe       -> scripts/pipeline/transcriber.mts (withTimestamps=true,
//                        segmentos reales de whisper) o
//                        agent/analyze/transcribe.mts (withTimestamps=false,
//                        un solo segmento con el texto completo)
import path from "node:path";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { MATERIAL_ROOT } from "../../scripts/pipeline/config.mts";
import { INBOX_ROOT } from "../ingestion/config.mts";
import { resolveSafeSubmissionPath as resolveSafePath } from "../ingestion/pathSafety.mts";
import { probeMedia } from "../analyze/probeMedia.mts";
import { extractAudioToWav as extractAudioToWavImpl } from "../analyze/extractAudio.mts";
import { transcribeAudio } from "../analyze/transcribe.mts";
import { detectSilences as detectSilencesImpl } from "../../scripts/pipeline/silenceDetector.mts";
import { concatAudioFiles } from "../../scripts/pipeline/voiceGenerator.mts";
import { transcribeNarration } from "../../scripts/pipeline/transcriber.mts";
import type { MediaBridge, MediaInfo, Silence, TranscriptSegment } from "./types.mts";
import { PathViolationError } from "./machineBridge.mts";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");

// Raíces permitidas para cualquier ruta de contenido (no de trabajo temporal)
// que entre a MediaBridge: el material fuente (MATERIAL_ROOT), la bandeja de
// entrada (INBOX_ROOT), los assets ya copiados para Remotion y las salidas de
// render — exactamente los lugares donde el código real ya lee/escribe medios
// hoy. No es una raíz nueva inventada, es la unión de las que ya existen.
const ALLOWED_MEDIA_ROOTS = [MATERIAL_ROOT, INBOX_ROOT, path.join(REPO_ROOT, "public", "assets"), path.join(REPO_ROOT, "out")];

// Reutiliza resolveSafeSubmissionPath (que exige una ruta RELATIVA a una
// raíz) probando cada raíz permitida por turno: se exige que filePath sea
// absoluta y que, al expresarla como relativa a alguna raíz permitida,
// resuelva de vuelta dentro de esa raíz (bloquea "..", UNC y rutas fuera de
// las raíces conocidas exactamente igual que filesystemBridge).
function requireSafeMediaPath(filePath: string): string {
  if (typeof filePath !== "string" || !path.isAbsolute(filePath)) {
    throw new PathViolationError("(ruta absoluta requerida)", String(filePath));
  }
  for (const root of ALLOWED_MEDIA_ROOTS) {
    const resolved = resolveSafePath(root, path.relative(root, filePath));
    if (resolved) return resolved;
  }
  throw new PathViolationError(ALLOWED_MEDIA_ROOTS.join(" | "), filePath);
}

export const mediaBridge: MediaBridge = {
  async probe(filePath: string): Promise<MediaInfo> {
    return probeMedia(requireSafeMediaPath(filePath));
  },

  async extractAudioToWav(videoPath: string, outDir: string): Promise<string> {
    const safeVideoPath = requireSafeMediaPath(videoPath);
    mkdirSync(outDir, { recursive: true });
    return extractAudioToWavImpl(safeVideoPath, outDir);
  },

  async detectSilences(audioPath: string): Promise<Silence[]> {
    return detectSilencesImpl(requireSafeMediaPath(audioPath));
  },

  async concatAudio(chunkPaths: string[], outputPath: string): Promise<void> {
    const safeChunks = chunkPaths.map((p) => requireSafeMediaPath(p));
    const safeOutput = requireSafeMediaPath(outputPath);
    concatAudioFiles(safeChunks, safeOutput);
  },

  async transcribe(audioPath: string, withTimestamps: boolean): Promise<TranscriptSegment[]> {
    const safeAudioPath = requireSafeMediaPath(audioPath);
    if (withTimestamps) {
      return transcribeNarration(safeAudioPath);
    }
    const outDir = mkdtempSync(path.join(tmpdir(), "mediabridge-transcribe-"));
    try {
      const result = transcribeAudio(safeAudioPath, outDir);
      const info = await mediaBridge.probe(safeAudioPath);
      return [{ start: 0, end: info.durationSeconds, text: result.transcript }];
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  },
};

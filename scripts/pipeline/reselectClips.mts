// Recalcula y renderiza SOLO los clips de un episodio ya producido (reusa
// captions/silencios en caché, no repite narración/whisper/video largo). Útil
// cuando se ajusta la heurística de selección de clips y no hace falta volver
// a pagar el render largo (~30 min) para probarla.
// Uso: npx tsx scripts/pipeline/reselectClips.mts "SIN EXPLICACIÓN" 008
import "./env.mts"; // SIEMPRE primero — ver env.mts para por qué el orden importa
import path from "node:path";
import { readFileSync } from "node:fs";
import { scanEpisode } from "./materialScanner.mts";
import { analyzeScript } from "./scriptAnalyzer.mts";
import { alignedSentencesFor, tagCaptions } from "./captionTagger.mts";
import { detectSilences } from "./silenceDetector.mts";
import { selectClips, selectClipsSequential } from "./clipSelector.mts";
import { probeAudioDurationSeconds } from "./mediaCatalog.mts";
import { writeClips } from "./episodeRegistrar.mts";
import { renderShort } from "./renderer.mts";
import { checkClip } from "./qualityChecker.mts";
import { exportClip } from "./exportManager.mts";
import { CLIP_MAX_SECONDS, CLIP_MIN_SECONDS } from "./config.mts";
import { FPS } from "../../remotion/theme.ts";
import type { RawSegment } from "./transcriber.mts";

const log = (msg: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);

async function main() {
  const [account, episodeId] = process.argv.slice(2);
  if (!account || !episodeId) {
    console.error('Uso: npx tsx scripts/pipeline/reselectClips.mts "SIN EXPLICACIÓN" 008');
    process.exit(1);
  }

  const ep = scanEpisode(account, episodeId);
  const script = analyzeScript(ep.scriptFile!);

  const captionsPath = path.join(import.meta.dirname, "..", "..", "remotion", "data", `captions-${episodeId}.json`);
  const cached = JSON.parse(readFileSync(captionsPath, "utf-8")) as { start: number; end: number; text: string }[];
  const segments: RawSegment[] = cached.map((c) => ({ start: c.start, end: c.end, text: c.text }));

  const captions = tagCaptions(segments, script);
  const aligned = alignedSentencesFor(segments, script);
  const silences = detectSilences(ep.narrationFile!);
  const narrationDurationSeconds = probeAudioDurationSeconds(ep.narrationFile!);

  // Dos modalidades, ambas pedidas: "Clip" = mejores momentos (editorial, con
  // huecos, cantidad variable) + "Parte" = corte secuencial de cobertura
  // completa (sin huecos, tamaño parejo). Se combinan en un solo clips-{id}.json
  // porque Root.tsx genera una composition Short-{id}-{i} por cada entrada.
  const editorial = selectClips(captions, aligned, silences, narrationDurationSeconds);
  const sequential = selectClipsSequential(captions, silences, narrationDurationSeconds);
  const clips = [...editorial, ...sequential];
  log(`${editorial.length} clips editoriales (mejores momentos) + ${sequential.length} partes secuenciales`);
  writeClips(episodeId, clips);

  const exportedClips: string[] = [];
  for (let i = 0; i < clips.length; i++) {
    const isSequential = i >= editorial.length;
    const label = isSequential ? "Parte" : "Clip";
    const localIndex = isSequential ? i - editorial.length : i;
    log(`Renderizando ${label} ${localIndex + 1} (${i + 1}/${clips.length})...`);
    const clipOut = renderShort(episodeId, i);
    const clipDurationSec = (clips[i].endFrame - clips[i].startFrame) / FPS;
    const clipQa = checkClip(clipOut, CLIP_MIN_SECONDS, CLIP_MAX_SECONDS);
    if (!clipQa.ok) {
      log(`  QA FALLÓ: ${clipQa.reason} — se omite`);
      continue;
    }
    const exported = exportClip(account, episodeId, script.title, localIndex, clipOut, label);
    exportedClips.push(exported);
    log(`  OK (${clipDurationSec.toFixed(0)}s) -> ${exported}`);
  }

  log(`Listo: ${exportedClips.length}/${clips.length} clips exportados.`);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});

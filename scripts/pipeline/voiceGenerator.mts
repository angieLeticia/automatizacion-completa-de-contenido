import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import type { TtsChapter } from "./scriptAnalyzer.mts";
import { DEFAULT_MODEL_ID, DEFAULT_VOICE_SETTINGS, findVoiceByName, textToSpeech } from "./elevenLabsClient.mts";

// "Kate — Velvet Midnight Narrator" — ver Prompt de Voz - ElevenLabs.md, la
// voz que ya usa el canal. Si cambia de nombre en la cuenta de ElevenLabs,
// ajustar este patrón.
const NARRATOR_VOICE_PATTERN = /kate|velvet.?midnight/i;

// El endpoint de TTS tiene límite de caracteres por request — partimos por
// capítulo primero (nunca a mitad de frase) y, si un capítulo solo se pasa,
// lo partimos más por línea.
const MAX_CHUNK_CHARS = 2500;

// Cuánto texto del fragmento vecino se manda como previous_text/next_text —
// le da a ElevenLabs contexto de prosodia para que el corte entre fragmentos
// no se note (ver TtsContext en elevenLabsClient.mts).
const CONTEXT_CHARS = 300;

const splitLongChapter = (text: string, maxChars: number): string[] => {
  if (text.length <= maxChars) return [text];
  const lines = text.split("\n");
  const chunks: string[] = [];
  let current = "";
  for (const line of lines) {
    if (current && current.length + line.length + 1 > maxChars) {
      chunks.push(current);
      current = line;
    } else {
      current = current ? `${current}\n${line}` : line;
    }
  }
  if (current) chunks.push(current);
  return chunks;
};

// Genera la narración completa del episodio en ElevenLabs (voz + ajustes ya
// documentados por la usuaria para este canal) y la deja como un único mp3 en
// `outputPath`. Gasta créditos reales de ElevenLabs — se loggea el total de
// caracteres antes de arrancar para que quede visible en los logs del agente.
export const generateNarration = async (
  chapters: TtsChapter[],
  outputPath: string,
  onProgress?: (msg: string) => void
): Promise<void> => {
  const voice = await findVoiceByName(NARRATOR_VOICE_PATTERN);
  onProgress?.(`Voz: "${voice.name}" (${voice.voice_id})`);

  const textChunks = chapters.flatMap((ch) => splitLongChapter(ch.text, MAX_CHUNK_CHARS));
  const totalChars = textChunks.reduce((n, t) => n + t.length, 0);
  onProgress?.(`${textChunks.length} fragmentos, ${totalChars} caracteres totales (consumo real de créditos ElevenLabs)`);

  const tmpDir = mkdtempSync(path.join(tmpdir(), "pipeline-tts-"));
  try {
    const chunkFiles: string[] = [];
    for (let i = 0; i < textChunks.length; i++) {
      onProgress?.(`  fragmento ${i + 1}/${textChunks.length} (${textChunks[i].length} caracteres)...`);
      const previousText = i > 0 ? textChunks[i - 1].slice(-CONTEXT_CHARS) : undefined;
      const nextText = i < textChunks.length - 1 ? textChunks[i + 1].slice(0, CONTEXT_CHARS) : undefined;
      const audio = await textToSpeech(voice.voice_id, textChunks[i], DEFAULT_VOICE_SETTINGS, DEFAULT_MODEL_ID, {
        previousText,
        nextText,
      });
      const chunkPath = path.join(tmpDir, `chunk-${String(i).padStart(3, "0")}.mp3`);
      writeFileSync(chunkPath, audio);
      chunkFiles.push(chunkPath);
    }

    concatAudioFiles(chunkFiles, outputPath);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
};

// Extraído de generateNarration (antes estaba inline en su if/else) para que
// agent/machine/mediaBridge.mts pueda envolver el mismo concat de audio por
// ffmpeg sin duplicar la invocación — comportamiento idéntico, incluido el
// atajo de un solo archivo (copia directa, sin pasar por ffmpeg).
export const concatAudioFiles = (chunkPaths: string[], outputPath: string): void => {
  if (chunkPaths.length === 1) {
    writeFileSync(outputPath, readFileSync(chunkPaths[0]));
    return;
  }
  const tmpDir = mkdtempSync(path.join(tmpdir(), "pipeline-concat-"));
  try {
    const listPath = path.join(tmpDir, "list.txt");
    const listContent = chunkPaths.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join("\n");
    writeFileSync(listPath, listContent);
    const result = spawnSync("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", outputPath]);
    if (result.status !== 0) {
      throw new Error(`ffmpeg concat falló: ${result.stderr?.toString()}`);
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
};

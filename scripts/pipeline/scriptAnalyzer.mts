import { readFileSync } from "node:fs";
import type { ScriptAnalysis, ScriptChapter, ScriptSentence } from "./types.mts";

const BREAK_RE = /<break\s+time="([\d.]+)s?"\s*\/>/i;
const HEADING_RE = /^(#{1,3})\s+(.*)$/;
const CHAPTER_HEADING_RE = /^cap[ií]tulo\s+\d+/i;
const FINAL_HEADING_RE = /^final$/i;

// Convierte el guion (markdown con tags SSML de ElevenLabs) en una lista de
// oraciones con metadata narrativa (capítulo, si abre capítulo, énfasis,
// pregunta, silencios alrededor). No inventa tiempos reales — el timing real
// de cada oración se obtiene alineando esto contra la transcripción de whisper
// (ver captionTagger.mts). Este análisis solo aporta ESTRUCTURA y SEÑALES.
export const analyzeScript = (scriptPath: string): ScriptAnalysis => {
  const raw = readFileSync(scriptPath, "utf-8");
  const lines = raw.split(/\r?\n/);

  let title = "";
  const preTitleHeadings: string[] = []; // h1/h2/h3 antes del primer capítulo — el más específico (último) es el título real
  const chapters: ScriptChapter[] = [{ index: 0, title: "Hook" }];
  const sentences: ScriptSentence[] = [];

  let chapterIndex = 0;
  let chapterTitle = "Hook";
  let sawChapterOpening = true; // el hook ya "abrió" desde la primera oración
  let pendingBreakBefore = 0;
  let inFinal = false;
  const plainParts: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const breakMatch = line.match(BREAK_RE);
    if (breakMatch) {
      pendingBreakBefore = Number(breakMatch[1]);
      // el break se anota como "después" de la última oración vista
      if (sentences.length > 0) sentences[sentences.length - 1].breakAfterSeconds = pendingBreakBefore;
      continue;
    }

    const headingMatch = line.match(HEADING_RE);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = headingMatch[2].replace(/[❓#]/g, "").trim();
      if (level === 1 && CHAPTER_HEADING_RE.test(text)) {
        chapterIndex += 1;
        chapterTitle = text;
        chapters.push({ index: chapterIndex, title: chapterTitle });
        sawChapterOpening = false;
        inFinal = false;
      } else if (level === 1 && FINAL_HEADING_RE.test(text)) {
        chapterIndex += 1;
        chapterTitle = "Final";
        chapters.push({ index: chapterIndex, title: chapterTitle });
        sawChapterOpening = false;
        inFinal = true;
      } else if (chapterIndex === 0) {
        // h1 (nombre del show), h2 (nº de expediente) o h3 (título del caso) antes
        // del primer capítulo — nos quedamos con el más específico como título.
        preTitleHeadings.push(text);
      }
      continue;
    }

    // Línea de contenido narrado.
    const hasEmphasis = /\*\*/.test(line);
    const text = line.replace(/\*\*/g, "").replace(/^["“]|["”]$/g, "").trim();
    if (!text) continue;

    plainParts.push(text);
    sentences.push({
      index: sentences.length,
      text,
      chapterIndex,
      chapterTitle,
      isChapterOpening: !sawChapterOpening,
      isHookSection: chapterIndex === 0,
      isFinalSection: inFinal,
      hasEmphasis,
      isQuestion: text.endsWith("?"),
      breakBeforeSeconds: pendingBreakBefore,
      breakAfterSeconds: 0,
      positionRatio: 0, // se completa abajo, cuando ya sabemos el total
    });
    sawChapterOpening = true;
    pendingBreakBefore = 0;
  }

  sentences.forEach((s, i) => {
    s.positionRatio = sentences.length <= 1 ? 0 : i / (sentences.length - 1);
  });

  title = preTitleHeadings[preTitleHeadings.length - 1] || preTitleHeadings[0] || "";

  return {
    title: title || "Sin título",
    chapters,
    sentences,
    plainText: plainParts.join(" "),
  };
};

export type TtsChapter = { index: number; title: string; text: string };

// Reconstruye el texto por capítulo tal como se le pega a ElevenLabs — igual
// que "se pega el guion tal cual" (ver Prompt de Voz - ElevenLabs.md): frase
// + su <break> original, sin negritas ni encabezados markdown. Se parte por
// capítulo (no todo el guion junto) porque el endpoint de TTS tiene límite de
// caracteres por request.
export const buildTtsChapters = (script: ScriptAnalysis): TtsChapter[] => {
  const byChapter = new Map<number, ScriptSentence[]>();
  for (const s of script.sentences) {
    if (!byChapter.has(s.chapterIndex)) byChapter.set(s.chapterIndex, []);
    byChapter.get(s.chapterIndex)!.push(s);
  }
  return script.chapters
    .map((ch) => {
      const sentences = byChapter.get(ch.index) ?? [];
      const text = sentences
        .map((s) => (s.breakAfterSeconds > 0 ? `${s.text}\n<break time="${s.breakAfterSeconds}s" />` : s.text))
        .join("\n");
      return { index: ch.index, title: ch.title, text };
    })
    .filter((c) => c.text.length > 0);
};

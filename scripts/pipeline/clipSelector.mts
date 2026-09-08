import type { Caption } from "../../remotion/lib/captions.ts";
import { secToFrames } from "../../remotion/lib/captions.ts";
import type { ClipMark } from "../../remotion/lib/clips.ts";
import type { ScriptSentence } from "./types.mts";
import { CLIP_MAX_SECONDS, CLIP_MIN_SECONDS } from "./config.mts";
import { nearestSilenceBoundary, type Silence } from "./silenceDetector.mts";

type Candidate = { start: number; end: number; score: number; hookText: string };

const wordCount = (text: string): number => text.trim().split(/\s+/).filter(Boolean).length;

// Puntaje de "qué tan buena semilla de clip es esta oración" — deliberadamente
// más generoso que captionType() en captionTagger.mts (que decide el efecto
// visual on-screen y se mantiene conservador a propósito). Un episodio de
// ~10 capítulos casi siempre tiene una apertura de capítulo y un silencio
// largo de cierre por capítulo — usar esas señales además de negrita/pregunta
// reparte las semillas por TODO el episodio en vez de solo el cold-open.
const anchorScore = (sentence: ScriptSentence | null): number => {
  if (!sentence) return 0;
  let score = 0;
  if (sentence.hasEmphasis) score += 3;
  if (sentence.isQuestion) score += 2;
  if (sentence.isChapterOpening) score += 1;
  if (sentence.isHookSection && wordCount(sentence.text) <= 6) score += 1;
  if (sentence.breakAfterSeconds >= 2) score += 1;
  return score;
};

// Genera clips a partir del video largo YA renderizado — nunca vuelve a
// mezclar el material crudo. Cada caption con anchorScore > 0 es una
// "semilla": arma una ventana de 60-120s a su alrededor, ajustada a los
// silencios más cercanos para no cortar a mitad de frase, puntúa la ventana
// por la suma de anchorScore de lo que cae adentro, y hace selección
// no-solapada de mayor a menor score — cantidad de clips variable, no fija.
export const selectClips = (
  captions: Caption[],
  sentences: (ScriptSentence | null)[],
  silences: Silence[],
  totalDurationSeconds: number
): ClipMark[] => {
  const scores = captions.map((_, i) => anchorScore(sentences[i] ?? null));
  const seedIndices = scores.map((s, i) => (s > 0 ? i : -1)).filter((i) => i >= 0);
  if (seedIndices.length === 0) return [];

  const targetSpan = CLIP_MIN_SECONDS + (CLIP_MAX_SECONDS - CLIP_MIN_SECONDS) * 0.5;
  const candidates: Candidate[] = [];

  for (const seedIdx of seedIndices) {
    const seed = captions[seedIdx];
    const idealStart = Math.max(0, seed.start - targetSpan * 0.3);
    const idealEnd = idealStart + targetSpan;

    const start = nearestSilenceBoundary(silences, idealStart, 3) ?? idealStart;
    let end = nearestSilenceBoundary(silences, idealEnd, 3) ?? idealEnd;
    end = Math.min(end, totalDurationSeconds);
    if (end - start < CLIP_MIN_SECONDS) end = Math.min(totalDurationSeconds, start + CLIP_MIN_SECONDS);
    if (end - start > CLIP_MAX_SECONDS) end = start + CLIP_MAX_SECONDS;
    if (end - start < CLIP_MIN_SECONDS) continue; // no queda espacio suficiente cerca del final

    let windowScore = 0;
    for (let i = 0; i < captions.length; i++) {
      if (captions[i].start >= start && captions[i].end <= end) windowScore += scores[i];
    }

    candidates.push({ start, end, score: windowScore, hookText: seed.text.slice(0, 70) });
  }

  candidates.sort((a, b) => b.score - a.score);
  const chosen: Candidate[] = [];
  for (const c of candidates) {
    const overlaps = chosen.some((ch) => c.start < ch.end && c.end > ch.start);
    if (!overlaps) chosen.push(c);
  }
  chosen.sort((a, b) => a.start - b.start);

  return chosen.map((c) => ({
    startFrame: secToFrames(c.start),
    endFrame: secToFrames(c.end),
    hookText: c.hookText,
  }));
};

// Segunda modalidad, pedida explícitamente además de la editorial: corta el
// video completo en tramos consecutivos de ~90s (60-120s) SIN dejar nada
// afuera — cobertura total, tamaño parejo. Los límites igual se ajustan al
// silencio más cercano para no cortar a mitad de frase.
export const selectClipsSequential = (captions: Caption[], silences: Silence[], totalDurationSeconds: number): ClipMark[] => {
  const targetSpan = CLIP_MIN_SECONDS + (CLIP_MAX_SECONDS - CLIP_MIN_SECONDS) * 0.5;
  const count = Math.max(1, Math.round(totalDurationSeconds / targetSpan));
  const evenSpan = totalDurationSeconds / count;

  const marks: ClipMark[] = [];
  let cursor = 0;
  for (let i = 0; i < count; i++) {
    const isLast = i === count - 1;
    const idealEnd = cursor + evenSpan;
    const end = isLast ? totalDurationSeconds : (nearestSilenceBoundary(silences, idealEnd, 3) ?? idealEnd);
    const start = cursor;

    const firstCaption = captions.find((c) => c.start >= start && c.text.trim().length > 0);
    marks.push({
      startFrame: secToFrames(start),
      endFrame: secToFrames(end),
      hookText: (firstCaption?.text ?? "").slice(0, 70),
    });
    cursor = end;
  }
  return marks;
};

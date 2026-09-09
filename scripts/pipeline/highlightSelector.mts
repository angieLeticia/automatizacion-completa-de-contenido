// Fase 4.9 — Sección 9: HIGHLIGHT formalizado, distinto de CLIP secuencial/
// editorial (clipSelector.mts). Un highlight es "el momento más interesante",
// no "una parte del video" — la señal real ya existente para eso son los
// captions marcados type="hook"|"reveal" por tagCaptions() (captionTagger.mts,
// sin tocar), que ya codifica exactamente esa intención editorial. No se
// inventa IA externa: es una heurística de densidad sobre datos ya reales.
import type { Caption } from "../../remotion/lib/captions.ts";
import type { ClipMark } from "../../remotion/lib/clips.ts";
import { secToFrames } from "../../remotion/lib/captions.ts";
import { CLIP_MAX_SECONDS, CLIP_MIN_SECONDS } from "./config.mts";
import { nearestSilenceBoundary, type Silence } from "./silenceDetector.mts";

export type HighlightCandidate = ClipMark & {
  score: number;
  reason: string; // ej. "2 hook + 1 reveal en la ventana"
};

const WEIGHT: Record<Caption["type"], number> = { normal: 0, hook: 2, reveal: 3 };

// Misma lógica de ventana/ajuste-a-silencio que clipSelector.mts (reusa
// nearestSilenceBoundary, mismos CLIP_MIN/MAX_SECONDS — un highlight sigue
// siendo un clip reproducible, solo cambia CÓMO se elige la semilla), para no
// duplicar la mecánica de recorte, solo la señal de selección.
export const selectHighlights = (
  captions: Caption[],
  silences: Silence[],
  totalDurationSeconds: number,
  maxHighlights = 3
): HighlightCandidate[] => {
  const seedIndices = captions
    .map((c, i) => (c.type !== "normal" ? i : -1))
    .filter((i) => i >= 0);
  if (seedIndices.length === 0) return [];

  const targetSpan = CLIP_MIN_SECONDS + (CLIP_MAX_SECONDS - CLIP_MIN_SECONDS) * 0.4; // ventanas algo más cortas que un clip editorial
  type Candidate = { start: number; end: number; score: number; hooks: number; reveals: number; hookText: string };
  const candidates: Candidate[] = [];

  for (const seedIdx of seedIndices) {
    const seed = captions[seedIdx];
    const idealStart = Math.max(0, seed.start - targetSpan * 0.25);
    const idealEnd = idealStart + targetSpan;

    const start = nearestSilenceBoundary(silences, idealStart, 3) ?? idealStart;
    let end = nearestSilenceBoundary(silences, idealEnd, 3) ?? idealEnd;
    end = Math.min(end, totalDurationSeconds);
    if (end - start < CLIP_MIN_SECONDS) end = Math.min(totalDurationSeconds, start + CLIP_MIN_SECONDS);
    if (end - start > CLIP_MAX_SECONDS) end = start + CLIP_MAX_SECONDS;
    if (end - start < CLIP_MIN_SECONDS) continue;

    let score = 0;
    let hooks = 0;
    let reveals = 0;
    for (const c of captions) {
      if (c.start >= start && c.end <= end) {
        score += WEIGHT[c.type];
        if (c.type === "hook") hooks += 1;
        if (c.type === "reveal") reveals += 1;
      }
    }
    if (score === 0) continue;

    candidates.push({ start, end, score, hooks, reveals, hookText: seed.text.slice(0, 70) });
  }

  candidates.sort((a, b) => b.score - a.score);
  const chosen: Candidate[] = [];
  for (const c of candidates) {
    const overlaps = chosen.some((ch) => c.start < ch.end && c.end > ch.start);
    if (!overlaps) chosen.push(c);
    if (chosen.length >= maxHighlights) break;
  }
  chosen.sort((a, b) => a.start - b.start);

  return chosen.map((c) => ({
    startFrame: secToFrames(c.start),
    endFrame: secToFrames(c.end),
    hookText: c.hookText,
    score: c.score,
    reason: `${c.hooks} hook + ${c.reveals} reveal en la ventana`,
  }));
};

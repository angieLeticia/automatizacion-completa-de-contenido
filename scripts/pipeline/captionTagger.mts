import type { Caption, CaptionType } from "../../remotion/lib/captions.ts";
import type { RawSegment } from "./transcriber.mts";
import type { ScriptAnalysis, ScriptSentence } from "./types.mts";
import { contentWords } from "./textUtils.mts";

// Alineación a nivel de PALABRA, no de oración/segmento completo. whisper
// trocea el audio por pausas naturales, que casi nunca coinciden con los
// saltos de línea del guion — una misma oración del guion puede llegar
// partida en 3-4 segmentos de whisper, o al revés, 3 oraciones cortas del
// guion pueden llegar fundidas en un solo segmento. Alinear oración-contra-
// segmento con un puntero monótono (versión anterior) se desincroniza apenas
// la granularidad difiere y nunca se recupera. Alineando palabra por palabra
// (mismo contenido hablado, mismo orden) el desajuste de un ASR típico
// (números en dígitos, tildes, alguna palabra de más/menos) se autocorrige
// solo, porque cada match reancla el puntero a la posición real.
const WORD_LOOKAHEAD = 10;

type GuionWord = { word: string; sentenceIndex: number };
type SegmentWord = { word: string; segmentIndex: number };

const flattenGuionWords = (sentences: ScriptSentence[]): GuionWord[] =>
  sentences.flatMap((s) => contentWords(s.text).map((word) => ({ word, sentenceIndex: s.index })));

const flattenSegmentWords = (segments: RawSegment[]): SegmentWord[] =>
  segments.flatMap((seg, segmentIndex) => contentWords(seg.text).map((word) => ({ word, segmentIndex })));

const alignToScript = (segments: RawSegment[], sentences: ScriptSentence[]): (ScriptSentence | null)[] => {
  const guionWords = flattenGuionWords(sentences);
  const segWords = flattenSegmentWords(segments);
  const sentenceBySegment: number[] = new Array(segments.length).fill(-1);

  let gi = 0;
  for (const { word, segmentIndex } of segWords) {
    let found = -1;
    for (let k = 0; k < WORD_LOOKAHEAD && gi + k < guionWords.length; k++) {
      if (guionWords[gi + k].word === word) {
        found = gi + k;
        break;
      }
    }
    if (found === -1) continue; // palabra sin match cercano (error de ASR) — no mueve el puntero
    gi = found;
    if (sentenceBySegment[segmentIndex] === -1) sentenceBySegment[segmentIndex] = guionWords[gi].sentenceIndex;
    gi += 1;
  }

  // Un segmento sin ninguna palabra alineada hereda la oración del segmento
  // anterior (sigue en la misma vecindad narrativa) en vez de quedar "normal"
  // solo porque el ASR erró todas sus palabras.
  let last = -1;
  const bySentenceIndex = new Map(sentences.map((s) => [s.index, s]));
  return sentenceBySegment.map((idx) => {
    const resolved = idx === -1 ? last : idx;
    last = resolved;
    return resolved === -1 ? null : (bySentenceIndex.get(resolved) ?? null);
  });
};

const wordCount = (text: string): number => text.trim().split(/\s+/).filter(Boolean).length;

const captionType = (sentence: ScriptSentence | null): CaptionType => {
  if (!sentence) return "normal";
  // La usuaria ya marcó en negrita, a mano en el guion, los momentos que
  // quiere como revelación (ej. "CROATOAN.") — es la señal más confiable
  // que tenemos sin IA, así que reveal se reserva para eso.
  if (sentence.hasEmphasis) return "reveal";
  // El cold open (antes del primer "CAPÍTULO") suele ser una serie de
  // fragmentos cortos y contundentes ("Ni cuerpos.", "Ni señales de una
  // batalla.") — esos son los que funcionan como texto "hook" en pantalla.
  if (sentence.isHookSection && wordCount(sentence.text) <= 6) return "hook";
  return "normal";
};

// Construye los captions finales (timing real de whisper + type heurístico
// derivado del guion) — reemplaza el `type: "normal"` fijo de
// scripts/build-captions.mjs.
export const tagCaptions = (segments: RawSegment[], script: ScriptAnalysis): Caption[] => {
  const aligned = alignToScript(segments, script.sentences);
  return segments.map((seg, i) => ({
    start: seg.start,
    end: seg.end,
    text: seg.text,
    type: captionType(aligned[i]),
  }));
};

// Expone la alineación palabra-por-palabra para quien necesite algo más rico
// que el `type` visual (ver clipSelector.mts) — el `type` se mantiene
// deliberadamente conservador (solo negrita + cold-open corto) para no
// saturar el video de efectos de glitch/pop, pero elegir clips necesita más
// señales (preguntas, aperturas de capítulo, silencios largos) repartidas por
// todo el episodio, no solo las 2-3 más dramáticas.
export const alignedSentencesFor = (segments: RawSegment[], script: ScriptAnalysis): (ScriptSentence | null)[] =>
  alignToScript(segments, script.sentences);

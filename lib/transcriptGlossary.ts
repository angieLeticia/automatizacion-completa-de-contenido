// Glosario CONSERVADOR de correcciones de transcripción: arregla nombres propios
// que Whisper suele transcribir mal, por canal (y opcionalmente por episodio).
// Puro y sin dependencias a propósito: lo importan tanto Agent 2
// (scripts/pipeline/processOne.mts) como Agent 1 (agent/analyze/processOne.mts)
// sin crear un acoplamiento entre ambos.
//
// Reglas de seguridad:
//  - Solo reemplaza la FRASE COMPLETA de cada regla, como palabras completas
//    (nunca dentro de otra palabra).
//  - Un canal sin reglas devuelve el texto idéntico.
//  - No toca timestamps ni segmentación: solo el campo `text`.
export interface GlossaryRule {
  from: string;
  to: string;
  // Si se define, la regla solo aplica a esos episodios (episodeId crudo, ej. "009").
  episodeIds?: string[];
}

// Solo ENCIENDE EL CAOS tiene reglas activas hoy; los demás canales quedan
// declarados vacíos para agregar términos propios cuando haga falta.
export const TRANSCRIPT_GLOSSARY: Record<string, GlossaryRule[]> = {
  "ENCIENDE EL CAOS": [
    { from: "Megan Distallion", to: "Megan Thee Stallion" },
    { from: "Megan Distalion", to: "Megan Thee Stallion" },
    { from: "Megan Stallion", to: "Megan Thee Stallion" },
    { from: "Clay Thompson", to: "Klay Thompson" },
    // "Clay" suelto SOLO en el episodio 009 (Klay Thompson es el sujeto de ese
    // episodio); nunca una regla global del canal ni de otros canales.
    { from: "Clay", to: "Klay", episodeIds: ["009"] },
  ],
  "SIN EXPLICACIÓN": [],
  "LUNA VERDE": [],
  "OBJETOS MALDITOS": [],
};

const normalizeKey = (s: string): string => s.normalize("NFC").trim().toUpperCase();

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Palabras completas: sin letra/dígito/guion bajo pegados a ninguno de los dos
// lados; espacios internos flexibles (Whisper a veces duplica espacios).
const buildPattern = (phrase: string): RegExp => {
  const body = phrase.trim().split(/\s+/).map(escapeRegExp).join("\\s+");
  return new RegExp(`(?<![\\p{L}\\p{N}_])${body}(?![\\p{L}\\p{N}_])`, "giu");
};

const isAllCaps = (s: string): boolean => s === s.toUpperCase() && s !== s.toLowerCase();

export function applyTranscriptGlossary(
  text: string,
  channelName: string | undefined,
  episodeId?: string,
  glossary: Record<string, GlossaryRule[]> = TRANSCRIPT_GLOSSARY
): string {
  if (!text || !channelName) return text;
  const key = Object.keys(glossary).find((k) => normalizeKey(k) === normalizeKey(channelName));
  if (!key) return text;

  let result = text;
  for (const rule of glossary[key]) {
    if (rule.episodeIds && (!episodeId || !rule.episodeIds.includes(episodeId))) continue;
    result = result.replace(buildPattern(rule.from), (match) => (isAllCaps(match) ? rule.to.toUpperCase() : rule.to));
  }
  return result;
}

// Aplica el glosario a segmentos de transcripción conservando TODO lo demás
// (start/end/type/etc.): devuelve objetos nuevos, cambia solo `text`.
export function applyTranscriptGlossaryToSegments<T extends { text: string }>(segments: T[], channelName: string | undefined, episodeId?: string): T[] {
  return segments.map((s) => ({ ...s, text: applyTranscriptGlossary(s.text, channelName, episodeId) }));
}

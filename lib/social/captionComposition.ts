// Fase 5.20 (Phase A1) — composición determinista caption+hashtags,
// compartida por Instagram y Facebook (ambos usan un único campo de texto
// libre, sin API de hashtags separada - a diferencia de YouTube, que sí
// tiene un campo `tags` real, ver youtubeHashtags.ts). Pura, sin red.
//
// Reglas: no duplica un hashtag ya presente en el caption/description
// original (comparación case-insensitive, exacta con el símbolo '#'), nunca
// modifica caracteres del caption (acentos/emojis se preservan tal cual),
// conserva el orden de aparición de los hashtags, y maneja caption/hashtags
// vacíos sin producir separadores sobrantes.
export function composeCaptionWithHashtags(caption: string | null | undefined, hashtags: readonly string[] | null | undefined): string {
  const trimmedCaption = typeof caption === "string" ? caption.trim() : "";
  const captionLower = trimmedCaption.toLowerCase();

  const seen = new Set<string>();
  const normalizedTags: string[] = [];
  for (const raw of hashtags ?? []) {
    if (typeof raw !== "string") continue;
    const trimmed = raw.trim();
    if (trimmed.length === 0) continue;

    const withHash = trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
    const key = withHash.toLowerCase();
    if (seen.has(key)) continue; // duplicado dentro de la misma lista
    if (captionLower.includes(key)) continue; // ya presente en el caption original - no duplicar

    seen.add(key);
    normalizedTags.push(withHash);
  }

  if (normalizedTags.length === 0) return trimmedCaption;

  const hashtagLine = normalizedTags.join(" ");
  if (trimmedCaption.length === 0) return hashtagLine;

  return `${trimmedCaption}\n\n${hashtagLine}`;
}

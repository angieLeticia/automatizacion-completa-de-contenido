// Fase 5.20 (Phase A1) — cierra el gap encontrado en la auditoría post-piloto:
// social_posts.hashtags existe, Agent 1/2 lo genera, el piloto real tenía
// hashtags reales, pero publishToYouTube() nunca los enviaba. Pura, sin red,
// sin Supabase - mismo patrón que youtubeUploadPrivacy.ts.
//
// Limite real documentado por YouTube (Data API v3, videos.insert): la suma
// de caracteres de todos los tags combinados debe ser menor a 500 - las
// comas entre tags cuentan como caracter. No hay un limite oficial publico
// por tag individual mas alla de ese total, asi que no se inventa uno.
const YOUTUBE_TAGS_MAX_TOTAL_LENGTH = 500;

// No trunca un tag a la mitad para caber en el limite - si el siguiente tag
// no cabe completo, se detiene ahi (mejor menos tags validos que uno cortado).
export function resolveYoutubeTags(hashtags: readonly string[] | null | undefined, description: string | null | undefined): string[] {
  if (!hashtags || hashtags.length === 0) return [];

  const descriptionLower = (description ?? "").toLowerCase();
  const seen = new Set<string>();
  const result: string[] = [];
  let totalLength = 0;

  for (const raw of hashtags) {
    if (typeof raw !== "string") continue;
    const stripped = raw.trim().replace(/^#+/, "").trim();
    if (stripped.length === 0) continue;

    const key = stripped.toLowerCase();
    if (seen.has(key)) continue; // duplicado dentro de la misma lista de hashtags
    if (descriptionLower.includes(`#${key}`)) continue; // ya visible tal cual en la descripcion - no duplicar

    // +1 por la coma separadora que YouTube cuenta entre tags (no aplica al primero).
    const addedLength = stripped.length + (result.length > 0 ? 1 : 0);
    if (totalLength + addedLength > YOUTUBE_TAGS_MAX_TOTAL_LENGTH) break;

    seen.add(key);
    totalLength += addedLength;
    result.push(stripped);
  }

  return result;
}

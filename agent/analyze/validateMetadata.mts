// Valida la respuesta del LLM local antes de guardarla: estructura exacta por
// plataforma, longitudes razonables, hashtags con formato correcto y sin
// duplicados, descripciones no identicas entre plataformas, palabras prohibidas.
// La relevancia semantica de los hashtags no se puede validar de forma 100%
// confiable por codigo - se mitiga sobre todo con las instrucciones del prompt,
// y aqui solo se hace una verificacion heuristica que se registra como aviso,
// nunca como motivo de rechazo duro.
import { HASHTAG_MAX_COUNT, HASHTAG_MIN_COUNT, PLATFORMS_BY_FOLDER_TYPE, PLATFORM_LIMITS, type PlatformKey } from "./config.mts";
import type { AccountStyle } from "./config.mts";

export interface PlatformMetadata {
  title: string;
  description: string;
  hashtags: string[];
}
export type ParsedMetadata = {
  topic_summary: string;
  platforms: Partial<Record<PlatformKey, PlatformMetadata>>;
};

export type ValidationResult =
  | { ok: true; data: ParsedMetadata; warnings: string[] }
  | { ok: false; reason: string };

function stripCodeFences(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  return fenced ? fenced[1] : raw;
}

const normalize = (s: string) => s.trim().toLowerCase();

function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function tokenize(text: string): Set<string> {
  return new Set(
    stripAccents(text.toLowerCase())
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 2)
  );
}

export function validateMetadata(
  rawResponse: string,
  folderType: "completo" | "clip",
  style: AccountStyle,
  contentContext: string // transcript + topic_summary, para la heuristica de relevancia
): ValidationResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFences(rawResponse));
  } catch (err) {
    return { ok: false, reason: `Respuesta de Claude no es JSON valido: ${err instanceof Error ? err.message : String(err)}` };
  }

  if (typeof parsed !== "object" || parsed === null) {
    return { ok: false, reason: "Respuesta de Claude no es un objeto JSON." };
  }
  const obj = parsed as Record<string, unknown>;

  if (typeof obj.topic_summary !== "string" || obj.topic_summary.trim().length < 5) {
    return { ok: false, reason: "Falta 'topic_summary' o es demasiado corto." };
  }

  if (typeof obj.platforms !== "object" || obj.platforms === null) {
    return { ok: false, reason: "Falta el objeto 'platforms'." };
  }
  const platformsObj = obj.platforms as Record<string, unknown>;

  const expectedKeys = PLATFORMS_BY_FOLDER_TYPE[folderType];
  const actualKeys = Object.keys(platformsObj);
  const missing = expectedKeys.filter((k) => !actualKeys.includes(k));
  const extra = actualKeys.filter((k) => !(expectedKeys as string[]).includes(k));
  if (missing.length > 0) {
    return { ok: false, reason: `Faltan claves de plataforma esperadas: ${missing.join(", ")}` };
  }
  if (extra.length > 0) {
    return { ok: false, reason: `Claves de plataforma no esperadas para folder_type='${folderType}': ${extra.join(", ")}` };
  }

  const warnings: string[] = [];
  const result: ParsedMetadata["platforms"] = {};
  const descriptionsSeen = new Map<string, string>();

  for (const key of expectedKeys) {
    const limits = PLATFORM_LIMITS[key];
    const block = platformsObj[key];
    if (typeof block !== "object" || block === null) {
      return { ok: false, reason: `El bloque de '${key}' no es un objeto.` };
    }
    const b = block as Record<string, unknown>;

    if (typeof b.title !== "string" || b.title.trim().length === 0) {
      return { ok: false, reason: `'${key}.title' vacio o invalido.` };
    }
    if (b.title.length > limits.titleMax) {
      return { ok: false, reason: `'${key}.title' excede ${limits.titleMax} caracteres (tiene ${b.title.length}).` };
    }

    if (typeof b.description !== "string" || b.description.trim().length < limits.descMin) {
      return { ok: false, reason: `'${key}.description' vacio o muy corto (minimo ${limits.descMin} caracteres).` };
    }
    if (b.description.length > limits.descMax) {
      return { ok: false, reason: `'${key}.description' excede ${limits.descMax} caracteres (tiene ${b.description.length}).` };
    }

    if (!Array.isArray(b.hashtags) || !b.hashtags.every((h) => typeof h === "string")) {
      return { ok: false, reason: `'${key}.hashtags' debe ser un arreglo de strings.` };
    }
    const rawHashtags = b.hashtags as string[];
    if (rawHashtags.length < HASHTAG_MIN_COUNT || rawHashtags.length > HASHTAG_MAX_COUNT) {
      return { ok: false, reason: `'${key}.hashtags' debe tener entre ${HASHTAG_MIN_COUNT} y ${HASHTAG_MAX_COUNT} elementos (tiene ${rawHashtags.length}).` };
    }

    const normalizedTags: string[] = [];
    const seenTags = new Set<string>();
    for (const raw of rawHashtags) {
      const withHash = raw.trim().startsWith("#") ? raw.trim() : `#${raw.trim()}`;
      const tagBody = withHash.slice(1);
      if (!/^[\p{L}\p{N}_]+$/u.test(tagBody)) {
        return { ok: false, reason: `Hashtag con formato invalido en '${key}': "${raw}"` };
      }
      const key2 = normalize(tagBody);
      if (seenTags.has(key2)) {
        return { ok: false, reason: `Hashtag duplicado en '${key}': "${raw}"` };
      }
      seenTags.add(key2);
      normalizedTags.push(withHash);
    }

    // Descripciones no identicas entre plataformas (comparacion normalizada).
    const descNorm = normalize(b.description);
    for (const [otherKey, otherDesc] of descriptionsSeen) {
      if (otherDesc === descNorm) {
        return { ok: false, reason: `La descripcion de '${key}' es identica a la de '${otherKey}' - deben estar adaptadas por plataforma.` };
      }
    }
    descriptionsSeen.set(key, descNorm);

    // Palabras prohibidas de la cuenta.
    const forbidden = style.palabras_prohibidas ?? [];
    const haystack = normalize(`${b.title} ${b.description} ${normalizedTags.join(" ")}`);
    for (const word of forbidden) {
      if (word.trim() && haystack.includes(normalize(word))) {
        return { ok: false, reason: `Se detecto la palabra prohibida "${word}" en '${key}'.` };
      }
    }

    result[key] = { title: b.title.trim(), description: b.description.trim(), hashtags: normalizedTags };
  }

  // Heuristica de relevancia de hashtags (aviso, no bloquea): al menos parte de los
  // hashtags deben compartir palabras con el contenido real o con los temas/hashtags
  // base de la cuenta - no es una prueba semantica confiable, solo una senal.
  const contentTokens = tokenize(`${contentContext} ${(style.temas ?? []).join(" ")} ${(style.hashtags_base ?? []).join(" ")}`);
  for (const [key, meta] of Object.entries(result) as [PlatformKey, PlatformMetadata][]) {
    const related = meta.hashtags.filter((h) => {
      const body = stripAccents(h.slice(1).toLowerCase());
      return [...contentTokens].some((t) => body.includes(t) || t.includes(body));
    });
    const ratio = related.length / meta.hashtags.length;
    if (ratio < 0.3) {
      warnings.push(`Aviso: en '${key}', menos del 30% de los hashtags parecen relacionados con el contenido/tema de la cuenta - revisar manualmente.`);
    }
  }

  return { ok: true, data: { topic_summary: obj.topic_summary.trim(), platforms: result }, warnings };
}

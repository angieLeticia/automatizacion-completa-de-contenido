// Valida el analisis canonico devuelto por Ollama - deliberadamente simple, sin
// validacion semantica compleja (eso queda para mas adelante si hace falta).
// Independiente de validateMetadata.mts a proposito - son etapas distintas del
// pipeline, con formas de JSON completamente distintas.
export interface CanonicalAnalysis {
  topic: string;
  summary: string;
  hook: string;
  content_keywords: string[];
}

export type CanonicalValidationResult = { ok: true; data: CanonicalAnalysis } | { ok: false; reason: string };

function stripCodeFences(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  return fenced ? fenced[1] : raw;
}

// Detecta placeholders del prompt que el modelo pudo haber copiado literalmente
// (ej. "TEMA_CENTRAL_EN_UNA_FRASE_CORTA") - dos o mas segmentos en mayusculas
// unidos por guion bajo es un patron que el texto real en español practicamente
// nunca produce, asi que es una senal confiable sin falsos positivos esperados.
const PLACEHOLDER_PATTERN = /[A-Z]{2,}_[A-Z_]{2,}/;

const MIN_FIELD_LENGTH = 5;
const MIN_KEYWORDS = 5;
const MAX_KEYWORDS = 8;

export function validateCanonical(rawResponse: string): CanonicalValidationResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFences(rawResponse));
  } catch (err) {
    return { ok: false, reason: `Respuesta de Ollama no es JSON valido: ${err instanceof Error ? err.message : String(err)}` };
  }

  if (typeof parsed !== "object" || parsed === null) {
    return { ok: false, reason: "Respuesta de Ollama no es un objeto JSON." };
  }
  const obj = parsed as Record<string, unknown>;

  for (const field of ["topic", "summary", "hook"] as const) {
    const value = obj[field];
    if (typeof value !== "string" || value.trim().length < MIN_FIELD_LENGTH) {
      return { ok: false, reason: `Campo '${field}' vacio o demasiado corto.` };
    }
    if (PLACEHOLDER_PATTERN.test(value)) {
      return { ok: false, reason: `Campo '${field}' contiene un placeholder sin reemplazar: "${value}"` };
    }
  }

  if (!Array.isArray(obj.content_keywords) || !obj.content_keywords.every((k) => typeof k === "string")) {
    return { ok: false, reason: "'content_keywords' debe ser un arreglo de strings." };
  }
  const keywords = (obj.content_keywords as string[]).map((k) => k.trim()).filter((k) => k.length > 0);

  if (keywords.length < MIN_KEYWORDS || keywords.length > MAX_KEYWORDS) {
    return { ok: false, reason: `'content_keywords' debe tener entre ${MIN_KEYWORDS} y ${MAX_KEYWORDS} elementos (tiene ${keywords.length}).` };
  }
  for (const k of keywords) {
    if (PLACEHOLDER_PATTERN.test(k)) {
      return { ok: false, reason: `Un elemento de 'content_keywords' contiene un placeholder sin reemplazar: "${k}"` };
    }
  }

  return {
    ok: true,
    data: {
      topic: (obj.topic as string).trim(),
      summary: (obj.summary as string).trim(),
      hook: (obj.hook as string).trim(),
      content_keywords: keywords,
    },
  };
}

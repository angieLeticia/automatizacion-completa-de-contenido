// NO SE USA en esta version (Fase 3 corre 100% local con Ollama, LLM_PROVIDER="local").
// Se conserva movido aqui, listo por si en el futuro se agrega un proveedor de pago
// como opcion adicional - agent/analyze/llm/index.mts tendria que agregar un caso
// "anthropic" explicito para que esto llegue a invocarse; hoy no hay ningun camino
// de codigo que lo llame.
//
// IMPORTANTE: ninguna funcion de este archivo debe recibir el logger ni pasar la
// clave a ningun log - los errores solo describen el problema, nunca el valor de
// process.env.ANTHROPIC_API_KEY.
const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";
const ANTHROPIC_MAX_OUTPUT_TOKENS = 2000;

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: "image/jpeg"; data: string } };

export type ClaudeErrorCode = "anthropic_key_missing" | "anthropic_http_error" | "anthropic_network_error";

export class ClaudeError extends Error {
  constructor(public code: ClaudeErrorCode, message: string) {
    super(message);
  }
}

export async function callClaude(system: string, userContent: ContentBlock[]): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new ClaudeError("anthropic_key_missing", "Falta ANTHROPIC_API_KEY en el entorno (variable de servidor, no la NEXT_PUBLIC_).");
  }

  let res: Response;
  try {
    res = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: ANTHROPIC_MAX_OUTPUT_TOKENS,
        system,
        messages: [{ role: "user", content: userContent }],
      }),
    });
  } catch (err) {
    throw new ClaudeError("anthropic_network_error", `No se pudo contactar la API de Anthropic: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    throw new ClaudeError("anthropic_http_error", `La API de Anthropic respondio ${res.status}: ${bodyText.slice(0, 500)}`);
  }

  const data = (await res.json()) as { content: Array<{ type: string; text?: string }> };
  const textBlock = data.content.find((b) => b.type === "text");
  if (!textBlock?.text) {
    throw new ClaudeError("anthropic_http_error", "La respuesta de Anthropic no trajo ningun bloque de texto.");
  }
  return textBlock.text;
}

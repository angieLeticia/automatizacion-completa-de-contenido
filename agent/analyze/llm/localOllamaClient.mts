// Cliente contra Ollama local (http://localhost:11434). Sin JSON Schema forzado a
// proposito (las pruebas manuales demostraron que el schema estructurado + el modo
// "thinking" del modelo puede colgarse durante horas sin responder nunca). Se usa
// format:"json" basico + think:false, y validateMetadata.mts como autoridad final
// sobre si el JSON recibido es realmente valido y utilizable.
import { OLLAMA_BASE_URL, OLLAMA_MODEL, OLLAMA_MAX_OUTPUT_TOKENS } from "../config.mts";
import type { LlmProvider, LlmResult } from "./types.mts";

export type OllamaErrorCode = "ollama_unreachable" | "ollama_http_error" | "ollama_empty_response";

export class OllamaError extends Error {
  constructor(public code: OllamaErrorCode, message: string) {
    super(message);
  }
}

interface OllamaChatResponse {
  message?: { role: string; content?: string; thinking?: string };
  done?: boolean;
  error?: string;
  eval_count?: number;
  eval_duration?: number;
  load_duration?: number;
}

export const localOllamaProvider: LlmProvider = {
  async generateMetadata(prompt: string): Promise<LlmResult> {
    let res: Response;
    try {
      res = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: OLLAMA_MODEL,
          messages: [{ role: "user", content: prompt }],
          think: false, // si el modelo/version no lo soporta, Ollama lo ignora sin error - se comprueba abajo
          format: "json",
          stream: false,
          keep_alive: "0", // libera el modelo de RAM inmediatamente al terminar esta respuesta
          options: { num_predict: OLLAMA_MAX_OUTPUT_TOKENS },
        }),
      });
    } catch (err) {
      throw new OllamaError(
        "ollama_unreachable",
        `No se pudo contactar Ollama en ${OLLAMA_BASE_URL}: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    if (!res.ok) {
      const bodyText = await res.text().catch(() => "");
      throw new OllamaError("ollama_http_error", `Ollama respondio ${res.status}: ${bodyText.slice(0, 500)}`);
    }

    const data = (await res.json()) as OllamaChatResponse;
    if (data.error) {
      throw new OllamaError("ollama_http_error", `Ollama devolvio un error: ${data.error}`);
    }

    const content = data.message?.content ?? "";
    const thinkingDetected = Boolean(data.message?.thinking && data.message.thinking.length > 0);

    if (!content.trim()) {
      throw new OllamaError(
        "ollama_empty_response",
        `Ollama devolvio una respuesta vacia${thinkingDetected ? " (el modelo gasto la generacion en 'thinking' sin llegar a responder)" : ""}.`
      );
    }

    return { content, thinkingDetected };
  },
};

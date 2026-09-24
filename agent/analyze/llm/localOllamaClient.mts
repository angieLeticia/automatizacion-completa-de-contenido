// Cliente contra Ollama local (http://localhost:11434). Sin JSON Schema forzado a
// proposito (las pruebas manuales demostraron que el schema estructurado + el modo
// "thinking" del modelo puede colgarse durante horas sin responder nunca). Se usa
// format:"json" basico + think:false, y validateMetadata.mts como autoridad final
// sobre si el JSON recibido es realmente valido y utilizable.
import { OLLAMA_BASE_URL, OLLAMA_MODEL, OLLAMA_MAX_OUTPUT_TOKENS, OLLAMA_REQUEST_TIMEOUT_MS } from "../config.mts";
import { log } from "../../logger.mts";
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
  // Fase 5.10-M — Ollama la incluye en la respuesta no-streaming cuando la
  // API la reporta: "stop" = el modelo termino naturalmente, "length" = se
  // corto porque se alcanzo options.num_predict (el caso diagnosticado en
  // Fase 5.10-L), ausente = esta version/endpoint de Ollama no la reporta.
  // Antes no se leia en absoluto - la respuesta se trataba igual sin
  // importar el motivo real del corte.
  done_reason?: string;
  error?: string;
  eval_count?: number;
  eval_duration?: number;
  load_duration?: number;
}

export const localOllamaProvider: LlmProvider = {
  async generateMetadata(prompt: string): Promise<LlmResult> {
    // Fase 5.10-U — timeout explicito propio, vía AbortController: antes de
    // esta fase el fetch no tenia NINGUN timeout propio (dependia del default
    // silencioso de undici, ~300s) - ahora, si Ollama no responde dentro de
    // OLLAMA_REQUEST_TIMEOUT_MS, ESTE codigo aborta la peticion con un motivo
    // identificable (isTimeout=true en el log de abajo), en vez de depender
    // de un limite ajeno e invisible.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), OLLAMA_REQUEST_TIMEOUT_MS);

    let res: Response;
    try {
      res = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          model: OLLAMA_MODEL,
          messages: [{ role: "user", content: prompt }],
          think: false, // si el modelo/version no lo soporta, Ollama lo ignora sin error - se comprueba abajo
          format: "json",
          stream: false,
          keep_alive: "0", // libera el modelo de RAM inmediatamente al terminar esta respuesta - SIN CAMBIOS en esta fase, ver nota de Fase 5.10-T/U
          options: { num_predict: OLLAMA_MAX_OUTPUT_TOKENS },
        }),
      });
    } catch (err) {
      // Fase 5.10-U — diagnostico seguro del fallo: nunca imprime el prompt,
      // el transcript, ni ningun contenido generado - solo metadatos de
      // error (nombre, mensaje, y campos seguros de `cause` si Node los
      // expone, como `code`/`errno`/`syscall`, nunca el objeto `cause`
      // completo sin filtrar). Antes de esta fase, `err.cause` nunca se leia
      // en absoluto - un timeout y una caida de red real eran indistinguibles
      // en los logs (ambos aparecian como el mismo "fetch failed" generico).
      const isTimeout = err instanceof Error && err.name === "AbortError";
      const cause = err instanceof Error ? (err.cause as { code?: string; errno?: number; syscall?: string } | undefined) : undefined;
      log.error("[OLLAMA] fallo al contactar Ollama - diagnostico seguro (sin prompt/transcript/respuesta)", {
        errName: err instanceof Error ? err.name : typeof err,
        errMessage: err instanceof Error ? err.message : String(err),
        isTimeout,
        timeoutMs: isTimeout ? OLLAMA_REQUEST_TIMEOUT_MS : undefined,
        causeCode: cause?.code,
        causeErrno: cause?.errno,
        causeSyscall: cause?.syscall,
      });
      throw new OllamaError(
        "ollama_unreachable",
        isTimeout
          ? `Timeout esperando respuesta de Ollama en ${OLLAMA_BASE_URL} tras ${OLLAMA_REQUEST_TIMEOUT_MS / 1000}s (AbortController propio, ver config.mts::OLLAMA_REQUEST_TIMEOUT_MS).`
          : `No se pudo contactar Ollama en ${OLLAMA_BASE_URL}: ${err instanceof Error ? err.message : String(err)}${cause?.code ? ` (cause.code=${cause.code})` : ""}`
      );
    } finally {
      clearTimeout(timeoutId);
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

    return { content, thinkingDetected, doneReason: data.done_reason };
  },
};

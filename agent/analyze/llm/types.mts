// Interfaz comun para cualquier proveedor de LLM (local, o en el futuro otro).
// processOne.mts solo conoce esta interfaz, nunca los detalles de Ollama/Anthropic/etc.
export interface LlmResult {
  content: string;
  thinkingDetected: boolean;
  // Fase 5.10-M — motivo por el que el proveedor dejo de generar, si lo
  // reporta ("length" = corto por num_predict/limite de tokens, "stop" =
  // termino naturalmente, undefined = el proveedor no lo reporta). Nunca
  // contiene contenido generado, solo esta etiqueta - seguro de loguear.
  doneReason?: string;
}

export interface LlmProvider {
  generateMetadata(prompt: string): Promise<LlmResult>;
}

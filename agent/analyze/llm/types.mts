// Interfaz comun para cualquier proveedor de LLM (local, o en el futuro otro).
// processOne.mts solo conoce esta interfaz, nunca los detalles de Ollama/Anthropic/etc.
export interface LlmResult {
  content: string;
  thinkingDetected: boolean;
}

export interface LlmProvider {
  generateMetadata(prompt: string): Promise<LlmResult>;
}

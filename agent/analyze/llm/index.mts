// Fabrica del proveedor de LLM - processOne.mts solo llama a getLlmProvider(),
// nunca sabe si es Ollama, Anthropic u otro. Cambiar de proveedor en el futuro
// significa agregar un caso aqui, no tocar el resto del pipeline.
import { LLM_PROVIDER } from "../config.mts";
import { localOllamaProvider } from "./localOllamaClient.mts";
import type { LlmProvider } from "./types.mts";

export function getLlmProvider(): LlmProvider {
  switch (LLM_PROVIDER) {
    case "local":
      return localOllamaProvider;
    default:
      throw new Error(
        `LLM_PROVIDER="${LLM_PROVIDER}" no esta soportado en esta version. Solo "local" (Ollama) esta implementado.`
      );
  }
}

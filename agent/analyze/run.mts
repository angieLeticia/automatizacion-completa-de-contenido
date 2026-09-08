// Punto de entrada de la Fase 3: sondea content_files/content_metadata pendientes
// y los procesa uno a la vez (Whisper y Ollama siempre en serie, nunca en paralelo,
// para no exceder la memoria disponible en esta PC). NO programa publicaciones, NO
// sube nada a Supabase Storage para publicar, NO llama a ninguna red social, NO
// crea social_posts, NO llama a ningun servicio externo de pago - solo genera y
// guarda metadata en content_metadata usando un LLM 100% local (Ollama).
// Debe ser el primer import: carga .env.local antes de que cualquier otro modulo
// (via claimWork.mts -> supabaseClient.mts) intente leer variables de entorno.
import "./config.mts";
import { recoverStaleClaims, findPendingWork } from "./claimWork.mts";
import { processOne } from "./processOne.mts";
import { assertAnalysisToolsAvailable } from "./checkEnvironment.mts";
import { POLL_INTERVAL_MS, LLM_PROVIDER, OLLAMA_BASE_URL, OLLAMA_MODEL } from "./config.mts";
import { log } from "../logger.mts";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  log.info("[ANALYSIS] Arrancando analizador de contenido - Fase 3 (solo genera y guarda metadata, no publica ni programa nada).");
  log.info(`[ANALYSIS] Proveedor LLM: ${LLM_PROVIDER} (${OLLAMA_BASE_URL}, modelo ${OLLAMA_MODEL}) - vision desactivada, solo texto/transcripcion.`);

  await assertAnalysisToolsAvailable();
  log.info("[ANALYSIS] Comprobaciones de entorno OK (ffmpeg, ffprobe, whisper, Ollama alcanzable, modelo instalado).");

  while (true) {
    await recoverStaleClaims();

    const items = await findPendingWork();
    if (items.length === 0) {
      log.info("[ANALYSIS] Sin archivos pendientes de analisis por ahora.");
    } else {
      log.info(`[ANALYSIS] ${items.length} archivo(s) pendiente(s) de analisis.`);
      for (const item of items) {
        await processOne(item);
      }
    }

    await sleep(POLL_INTERVAL_MS);
  }
}

main().catch((err) => {
  log.error("[ERROR] Fallo fatal del analizador de contenido", { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});

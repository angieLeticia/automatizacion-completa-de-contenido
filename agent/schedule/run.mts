// Punto de entrada de la Fase 4A: recorre todo content_metadata en status='ready'
// y crea social_posts programados (status='pending', scheduled_at futuro).
// NO publica nada, NO ejecuta publishers, NO llama a Whisper/Ollama.
import "./config.mts"; // primero: garantiza que .env.local ya este cargado
import { supabaseAdmin } from "../supabaseClient.mts";
import { log } from "../logger.mts";
import { scheduleReadyContent } from "./scheduleContent.mts";

async function main() {
  log.info("[SCHEDULE] Iniciando planificador (Fase 4A) - solo crea social_posts programados, no publica.");

  const { data: readyRows, error } = await supabaseAdmin.from("content_metadata").select("id").eq("status", "ready");

  if (error) {
    log.error("[SCHEDULE] Error consultando content_metadata en status='ready'", { error: error.message });
    process.exitCode = 1;
    return;
  }

  log.info(`[SCHEDULE] ${readyRows?.length ?? 0} contenido(s) en status='ready' encontrados.`);

  for (const row of readyRows ?? []) {
    const outcomes = await scheduleReadyContent(row.id);
    log.info("[SCHEDULE] Resultado para content_metadata", { contentMetadataId: row.id, outcomes });
  }

  log.info("[SCHEDULE] Planificacion finalizada.");
}

main();

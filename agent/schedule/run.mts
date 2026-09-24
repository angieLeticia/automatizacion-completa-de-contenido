// Punto de entrada de la Fase 4A: recorre todo content_metadata en status='ready'
// y crea social_posts programados (status='pending', scheduled_at futuro).
// NO publica nada, NO ejecuta publishers, NO llama a Whisper/Ollama.
//
// Fase 1.7 (aislamiento dirigido) — CONTENT_METADATA_ID es OPCIONAL: ausente
// (o vacio) conserva el comportamiento GLOBAL de siempre, sin ninguna rama
// nueva ejecutandose (ver targetSelection.mts::resolveScheduleMode). Presente
// -> modo "directed": la consulta global de mas abajo NUNCA se ejecuta (la
// rama dirigida sale por completo de esa ruta, ver bloque `if` mas abajo) -
// se consulta UNICAMENTE ese id, y un target invalido/inexistente/no-ready
// termina en CERO ids a procesar, NUNCA en un fallback a la cola global
// (computeSelection() es pura y fail-closed, ver targetSelection.mts).
import "./config.mts"; // primero: garantiza que .env.local ya este cargado
import { supabaseAdmin } from "../supabaseClient.mts";
import { log } from "../logger.mts";
import { scheduleReadyContent } from "./scheduleContent.mts";
import { resolveScheduleMode, computeSelection, type TargetContentMetadataRow } from "./targetSelection.mts";
import { resolveRunScope } from "../runScope.mts";

async function main() {
  // Fase 5.10-B — RUN_SCOPE obligatorio para TODO modo (Decision K.6),
  // resuelto UNA SOLA VEZ por pasada (este script es de una sola pasada, sin
  // while(true) propio - Decision K.4 no aplica un bucle interno aqui, pero
  // el principio es el mismo: una resolucion por invocacion, nunca por fila).
  const scope = await resolveRunScope();
  log.info(`[SCHEDULE] [RUN_SCOPE] ${scope.runScope} — ${scope.allowedContentAccountIds.length} cuenta(s) permitida(s).`);

  const mode = resolveScheduleMode(process.env);

  if (mode.mode === "directed") {
    log.info("[SCHEDULE] Iniciando planificador - modo dirigido, la cola global NUNCA se consulta en este modo.", {
      mode: "directed",
      contentMetadataId: mode.targetId,
      runScope: scope.runScope,
    });

    const { data: row, error } = await supabaseAdmin
      .from("content_metadata")
      .select("id, status, content_file_id")
      .eq("id", mode.targetId)
      .maybeSingle();

    if (error) {
      log.error("[SCHEDULE] Error consultando el CONTENT_METADATA_ID solicitado", { contentMetadataId: mode.targetId, error: error.message });
      process.exitCode = 1;
      return;
    }

    // Fase 5.10-B (Decision K.6) — CONTENT_METADATA_ID por si solo NO es una
    // frontera suficiente: identifica una fila exacta, pero esa fila puede
    // pertenecer a CUALQUIER cuenta. Se resuelve su content_account_id (via
    // content_files) y se bloquea ANTES de cualquier otra evaluacion si cae
    // fuera del RUN_SCOPE de este proceso.
    if (row) {
      const { data: fileRow, error: fileError } = await supabaseAdmin
        .from("content_files")
        .select("content_account_id")
        .eq("id", row.content_file_id)
        .maybeSingle();
      if (fileError || !fileRow) {
        log.error("[SCHEDULE] Modo dirigido BLOQUEADO - no se pudo resolver la content_account del content_metadata solicitado", {
          contentMetadataId: mode.targetId,
          error: fileError?.message,
        });
        process.exitCode = 1;
        return;
      }
      if (!scope.allowedContentAccountIds.includes(fileRow.content_account_id as string)) {
        log.error("[SCHEDULE] Modo dirigido BLOQUEADO - content_metadata fuera del RUN_SCOPE actual, la cola global NUNCA se consulto", {
          contentMetadataId: mode.targetId,
          runScope: scope.runScope,
        });
        process.exitCode = 1;
        return;
      }
    }

    const selection = computeSelection({ mode, directedRow: row as TargetContentMetadataRow | null });

    if (selection.ids.length === 0) {
      log.error("[SCHEDULE] Modo dirigido BLOQUEADO - no se procesa nada, la cola global NUNCA se consulto", {
        contentMetadataId: mode.targetId,
        reason: selection.skippedGlobalQueue ? selection.blockedReason : undefined,
      });
      process.exitCode = 1;
      return;
    }

    log.info("[SCHEDULE] Modo dirigido: procesando UNICAMENTE este content_metadata_id - global_queue_skipped=true", {
      contentMetadataId: mode.targetId,
    });
    const outcomes = await scheduleReadyContent(mode.targetId);
    log.info("[SCHEDULE] Resultado para content_metadata (modo dirigido)", { contentMetadataId: mode.targetId, outcomes });
    log.info("[SCHEDULE] Planificacion finalizada (modo dirigido).");
    return;
  }

  log.info("[SCHEDULE] Iniciando planificador (Fase 4A) - solo crea social_posts programados, no publica.");

  // Fase 5.10-B — reemplaza la consulta global de content_metadata.status='ready'
  // por el patron de 2 consultas ya establecido en
  // agent/analyze/claimWork.mts::findPendingWork(): content_files scoped
  // PRIMERO (por content_account_id permitido), content_metadata filtrado
  // despues por esos content_file_id - nunca una seleccion global filtrada
  // en memoria. Scope sin cuentas = cero trabajo, sin consultar Supabase
  // (Decision K.2).
  if (scope.allowedContentAccountIds.length === 0) {
    log.info("[SCHEDULE] Scope sin cuentas permitidas - 0 contenido(s) en status='ready' a procesar.");
    log.info("[SCHEDULE] Planificacion finalizada.");
    return;
  }

  const { data: scopedFiles, error: scopedFilesError } = await supabaseAdmin
    .from("content_files")
    .select("id")
    .in("content_account_id", scope.allowedContentAccountIds);

  if (scopedFilesError) {
    log.error("[SCHEDULE] Error resolviendo content_files del scope", { error: scopedFilesError.message });
    process.exitCode = 1;
    return;
  }

  const scopedFileIds = (scopedFiles ?? []).map((f) => f.id as string);
  if (scopedFileIds.length === 0) {
    log.info("[SCHEDULE] Ningun content_file dentro del scope actual - 0 contenido(s) en status='ready' a procesar.");
    log.info("[SCHEDULE] Planificacion finalizada.");
    return;
  }

  const { data: readyRows, error } = await supabaseAdmin
    .from("content_metadata")
    .select("id")
    .eq("status", "ready")
    .in("content_file_id", scopedFileIds);

  if (error) {
    log.error("[SCHEDULE] Error consultando content_metadata en status='ready'", { error: error.message });
    process.exitCode = 1;
    return;
  }

  log.info(`[SCHEDULE] ${readyRows?.length ?? 0} contenido(s) en status='ready' encontrados dentro del scope.`);

  for (const row of readyRows ?? []) {
    const outcomes = await scheduleReadyContent(row.id);
    log.info("[SCHEDULE] Resultado para content_metadata", { contentMetadataId: row.id, outcomes });
  }

  log.info("[SCHEDULE] Planificacion finalizada.");
}

main();

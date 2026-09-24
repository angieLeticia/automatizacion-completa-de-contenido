// Punto de entrada de la Fase 3: sondea content_files/content_metadata pendientes
// y los procesa uno a la vez (Whisper y Ollama siempre en serie, nunca en paralelo,
// para no exceder la memoria disponible en esta PC). NO programa publicaciones, NO
// sube nada a Supabase Storage para publicar, NO llama a ninguna red social, NO
// crea social_posts, NO llama a ningun servicio externo de pago - solo genera y
// guarda metadata en content_metadata usando un LLM 100% local (Ollama).
// Debe ser el primer import: carga .env.local antes de que cualquier otro modulo
// (via claimWork.mts -> supabaseClient.mts) intente leer variables de entorno.
//
// Fase 3.3 (aislamiento dirigido) — CONTENT_FILE_ID es OPCIONAL: ausente (o
// vacio) conserva el modo GLOBAL de siempre (while(true) + findPendingWork()),
// sin ninguna rama nueva ejecutandose. Presente -> modo "directed":
// findPendingWork() NUNCA se llama, y el modo dirigido procesa UN SOLO
// WorkItem y termina - sin while(true), sin sleep(POLL_INTERVAL_MS). Mismo
// principio ya validado en agent/schedule/run.mts (Fase 1.7) y
// agent/run.mts (Fase 3.3, watcher).
import "./config.mts";
import { recoverStaleClaims, findPendingWork, claimNewFile, claimRetry, type WorkItem } from "./claimWork.mts";
import { processOne } from "./processOne.mts";
import { assertAnalysisToolsAvailable } from "./checkEnvironment.mts";
import { POLL_INTERVAL_MS, LLM_PROVIDER, OLLAMA_BASE_URL, OLLAMA_MODEL, MAX_RETRIES, type AccountStyle } from "./config.mts";
import { resolveAnalyzeMode, evaluateAnalyzeEligibility } from "./targetSelection.mts";
import { resolveRunScope, type ResolvedRunScope } from "../runScope.mts";
import { supabaseAdmin } from "../supabaseClient.mts";
import { log } from "../logger.mts";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Fase 3.3 — reclama y procesa UN UNICO content_file_id, reutilizando
// integramente claimNewFile()/claimRetry() (claimWork.mts, sin cambiar su
// logica) y processOne() (sin cambios). NUNCA llama a findPendingWork() -
// la consulta global queda fuera de esta funcion por completo.
async function runDirected(targetId: string, scope: ResolvedRunScope): Promise<void> {
  log.info("[ANALYSIS] Iniciando en modo dirigido - findPendingWork() NUNCA se ejecuta en este modo.", {
    mode: "directed",
    contentFileId: targetId,
    runScope: scope.runScope,
  });

  const { data: fileRow, error: fileError } = await supabaseAdmin
    .from("content_files")
    .select("id, status, file_path, folder_type, content_account_id, episode_id")
    .eq("id", targetId)
    .maybeSingle();

  if (fileError) {
    log.error("[ANALYSIS] Modo dirigido BLOQUEADO - error consultando content_files", { contentFileId: targetId, error: fileError.message });
    process.exitCode = 1;
    return;
  }

  // Fase 5.10-B (Decision K.6) — CONTENT_FILE_ID por si solo NO es una
  // frontera suficiente: identifica una fila exacta, pero esa fila puede
  // pertenecer a CUALQUIER cuenta, incluida una fuera del RUN_SCOPE de este
  // proceso. Se bloquea aqui, ANTES de evaluar elegibilidad o reclamar nada,
  // igual que cualquier otro motivo de bloqueo de este mismo modo.
  if (fileRow && !scope.allowedContentAccountIds.includes(fileRow.content_account_id as string)) {
    log.error("[ANALYSIS] Modo dirigido BLOQUEADO - content_file fuera del RUN_SCOPE actual, findPendingWork() NUNCA se consulto", {
      contentFileId: targetId,
      runScope: scope.runScope,
    });
    process.exitCode = 1;
    return;
  }

  const { data: metaRow, error: metaError } = await supabaseAdmin
    .from("content_metadata")
    .select("id, status, retry_count, transcript, claude_raw_response")
    .eq("content_file_id", targetId)
    .maybeSingle();

  if (metaError) {
    log.error("[ANALYSIS] Modo dirigido BLOQUEADO - error consultando content_metadata", { contentFileId: targetId, error: metaError.message });
    process.exitCode = 1;
    return;
  }

  const eligibility = evaluateAnalyzeEligibility(
    fileRow ? { id: fileRow.id as string, status: fileRow.status as string } : null,
    metaRow ? { id: metaRow.id as string, status: metaRow.status as string, retry_count: metaRow.retry_count as number } : null,
    targetId,
    MAX_RETRIES
  );

  if (!eligibility.ok) {
    log.error("[ANALYSIS] Modo dirigido BLOQUEADO - target no elegible, findPendingWork() NUNCA se consulto", {
      contentFileId: targetId,
      reason: eligibility.reason,
    });
    process.exitCode = 1;
    return;
  }

  const { data: account, error: accountError } = await supabaseAdmin
    .from("content_accounts")
    .select("id, folder_name, style")
    .eq("id", fileRow!.content_account_id)
    .maybeSingle();

  if (accountError || !account) {
    log.error("[ANALYSIS] Modo dirigido BLOQUEADO - no se pudo resolver la content_account", {
      contentFileId: targetId,
      error: accountError?.message,
    });
    process.exitCode = 1;
    return;
  }

  const metadataRowId = eligibility.claimKind === "new" ? await claimNewFile(targetId) : await claimRetry(eligibility.metadataId);

  if (!metadataRowId) {
    log.error(
      "[ANALYSIS] Modo dirigido BLOQUEADO - no se pudo reclamar la fila (otra corrida ya la tomo primero) - NUNCA se reintenta ni se cae al modo global",
      { contentFileId: targetId }
    );
    process.exitCode = 1;
    return;
  }

  const item: WorkItem = {
    contentFileId: targetId,
    filePath: fileRow!.file_path as string,
    folderType: fileRow!.folder_type as "completo" | "clip",
    accountFolderName: account.folder_name as string,
    accountStyle: (account.style ?? {}) as AccountStyle,
    metadataRowId,
    episodeId: (fileRow!.episode_id as string | null) ?? null,
    retryCountAtClaim: eligibility.claimKind === "retry" ? eligibility.retryCountAtClaim : 0,
    cachedTranscript: (metaRow?.transcript as string | null) ?? null,
    cachedCanonicalRaw: (metaRow?.claude_raw_response as string | null) ?? null,
  };

  log.info("[ANALYSIS] Modo dirigido: procesando UNICAMENTE este content_file_id - global_query_skipped=true", { contentFileId: targetId });
  await processOne(item);
  log.info("[ANALYSIS] Modo dirigido finalizado (procesamiento unico, sin bucle, sin sleep).", { contentFileId: targetId });
}

async function main(): Promise<void> {
  log.info("[ANALYSIS] Arrancando analizador de contenido - Fase 3 (solo genera y guarda metadata, no publica ni programa nada).");
  log.info(`[ANALYSIS] Proveedor LLM: ${LLM_PROVIDER} (${OLLAMA_BASE_URL}, modelo ${OLLAMA_MODEL}) - vision desactivada, solo texto/transcripcion.`);

  // Fase 5.10-B — RUN_SCOPE obligatorio para TODO modo (Decision K.6),
  // resuelto UNA SOLA VEZ aqui, antes del while(true) (Decision K.4) - un
  // cambio de scope exige reiniciar el proceso, nunca se re-resuelve en
  // cada pasada del bucle.
  const scope = await resolveRunScope();
  log.info(`[ANALYSIS] [RUN_SCOPE] ${scope.runScope} — ${scope.allowedContentAccountIds.length} cuenta(s) permitida(s).`);

  await assertAnalysisToolsAvailable();
  log.info("[ANALYSIS] Comprobaciones de entorno OK (ffmpeg, ffprobe, whisper, Ollama alcanzable, modelo instalado).");

  const mode = resolveAnalyzeMode(process.env);
  if (mode.mode === "directed") {
    // Fase 3.3 — ni recoverStaleClaims() (barre TODOS los claims huerfanos,
    // ajeno al target) ni el while(true) se ejecutan en este modo - la rama
    // dirigida termina aqui, con su propio return, ANTES de cualquier codigo
    // del modo global.
    await runDirected(mode.targetId, scope);
    return;
  }

  while (true) {
    await recoverStaleClaims(scope.allowedContentAccountIds);

    const items = await findPendingWork(scope.allowedContentAccountIds);
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

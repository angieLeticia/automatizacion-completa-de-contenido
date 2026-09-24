// Fase 3.3 (aislamiento dirigido de Agent 1, etapa de analisis) — mismo
// patron ya usado por agent/schedule/targetSelection.mts (Agent 2): vive en
// su propio archivo, sin ningun import de supabaseClient.mts, para poder
// probar la decision pura sin conexion real.
//
// CONTENT_FILE_ID es opcional: ausente (o vacio) conserva el modo "global"
// (comportamiento existente de findPendingWork(), sin cambios). Presente ->
// modo "directed" - la elegibilidad puede bloquear, pero JAMAS degrada de
// vuelta a "procesa todos los analyzing".
export type AnalyzeMode = { mode: "global" } | { mode: "directed"; targetId: string };

function readNonEmpty(value: string | undefined): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

export function resolveAnalyzeMode(env: NodeJS.ProcessEnv): AnalyzeMode {
  const targetId = readNonEmpty(env.CONTENT_FILE_ID);
  if (!targetId) return { mode: "global" };
  return { mode: "directed", targetId };
}

export interface TargetContentFileRow {
  id: string;
  status: string;
}

export interface TargetContentMetadataRow {
  id: string;
  status: string;
  retry_count: number;
}

// Replica EXACTAMENTE, para una unica fila, la misma decision que
// findPendingWork() (claimWork.mts) ya toma para el lote completo:
//   - sin content_metadata -> reclamable como NUEVO ("new")
//   - content_metadata.status='error' Y retry_count<maxRetries -> reclamable
//     como REINTENTO ("retry")
//   - cualquier otro caso (ready, en progreso por otra corrida, o reintentos
//     agotados) -> NO elegible, bloqueado
export type TargetEligibility =
  | { ok: true; claimKind: "new" }
  | { ok: true; claimKind: "retry"; metadataId: string; retryCountAtClaim: number }
  | { ok: false; reason: string };

export function evaluateAnalyzeEligibility(
  fileRow: TargetContentFileRow | null,
  metaRow: TargetContentMetadataRow | null,
  targetId: string,
  maxRetries: number
): TargetEligibility {
  if (!fileRow) {
    return { ok: false, reason: `CONTENT_FILE_ID='${targetId}' no existe en content_files - bloqueado.` };
  }
  if (fileRow.status !== "analyzing") {
    return { ok: false, reason: `CONTENT_FILE_ID='${targetId}' no esta en content_files.status='analyzing' (actual='${fileRow.status}') - bloqueado.` };
  }
  if (!metaRow) {
    return { ok: true, claimKind: "new" };
  }
  if (metaRow.status === "error" && metaRow.retry_count < maxRetries) {
    return { ok: true, claimKind: "retry", metadataId: metaRow.id, retryCountAtClaim: metaRow.retry_count };
  }
  return {
    ok: false,
    reason: `CONTENT_FILE_ID='${targetId}' ya tiene content_metadata en status='${metaRow.status}' (retry_count=${metaRow.retry_count}/${maxRetries}) - no reclamable, bloqueado.`,
  };
}

export interface AnalyzeSelectionInput {
  mode: AnalyzeMode;
  // Modo "global": los ids YA consultados por quien llama (findPendingWork(),
  // sin cambios) - nunca construidos aqui.
  globalIds?: string[];
  // Modo "directed": el resultado YA evaluado por evaluateAnalyzeEligibility()
  // para el unico id solicitado.
  eligibility?: TargetEligibility;
}

export type AnalyzeSelectionResult =
  | { ids: string[]; skippedGlobalQuery: false }
  | { ids: string[]; skippedGlobalQuery: true; blockedReason?: string };

// Pura - decide la lista final de content_file.id a procesar. En modo
// "directed", un target invalido/inexistente/no-elegible produce `ids: []`
// (fail-closed, CERO fallback a la cola global), nunca mas de un elemento.
export function computeAnalyzeSelection(input: AnalyzeSelectionInput): AnalyzeSelectionResult {
  if (input.mode.mode === "global") {
    return { ids: input.globalIds ?? [], skippedGlobalQuery: false };
  }
  const eligibility = input.eligibility;
  if (!eligibility || !eligibility.ok) {
    return { ids: [], skippedGlobalQuery: true, blockedReason: eligibility && !eligibility.ok ? eligibility.reason : undefined };
  }
  return { ids: [input.mode.targetId], skippedGlobalQuery: true };
}

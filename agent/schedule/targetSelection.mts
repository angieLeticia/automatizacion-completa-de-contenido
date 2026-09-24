// Fase 1.7 (aislamiento dirigido de Agent 2) — mismo patron ya usado por
// agent/publish/targetPostSelection.mts: vive en su propio archivo, sin
// ningun import de supabaseClient.mts, para poder probar la decision pura sin
// conexion real. Generico a proposito - no hardcodea ningun content_metadata/
// content_file/cuenta/canal.
//
// CONTENT_METADATA_ID es opcional: si se omite, el modo es SIEMPRE "global"
// (comportamiento existente, sin cambios). Si esta presente (no vacio), el
// modo es SIEMPRE "directed" - la elegibilidad puede bloquear el
// procesamiento, pero JAMAS degrada de vuelta a "procesa todos los ready".
// Mismo criterio de "opcional-pero-obligatorio-si-esta-presente" ya usado
// para POST_ID en agent/publish/targetPostSelection.mts.
export type ScheduleMode = { mode: "global" } | { mode: "directed"; targetId: string };

function readNonEmpty(value: string | undefined): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

// Pura - sin red, sin Supabase. Ausencia de CONTENT_METADATA_ID (o vacio/solo
// espacios) = comportamiento existente sin cambios (modo "global").
export function resolveScheduleMode(env: NodeJS.ProcessEnv): ScheduleMode {
  const targetId = readNonEmpty(env.CONTENT_METADATA_ID);
  if (!targetId) return { mode: "global" };
  return { mode: "directed", targetId };
}

export interface TargetContentMetadataRow {
  id: string;
  status: string;
}

export type TargetEligibility = { ok: true } | { ok: false; reason: string };

// Pura - sin red. `row` ya viene resuelto por quien llama (una unica consulta
// por id, nunca la cola global) - esta funcion SOLO decide, nunca consulta
// Supabase. Bloquea (ok:false) ante cualquier discrepancia; nunca "adivina" ni
// permite pasar por defecto.
export function evaluateTargetEligibility(row: TargetContentMetadataRow | null, targetId: string): TargetEligibility {
  if (!row) {
    return { ok: false, reason: `CONTENT_METADATA_ID='${targetId}' no existe en content_metadata - bloqueado.` };
  }
  if (row.status !== "ready") {
    return { ok: false, reason: `CONTENT_METADATA_ID='${targetId}' no esta en status='ready' (actual='${row.status}') - bloqueado.` };
  }
  return { ok: true };
}

export interface SelectionInput {
  mode: ScheduleMode;
  // Modo "global": los ids YA consultados por quien llama con status='ready'
  // (la misma consulta que ya existia antes de esta fase, sin cambios).
  globalReadyIds?: string[];
  // Modo "directed": la fila YA consultada por quien llama, buscando
  // UNICAMENTE ese id (nunca la cola global) - null si no existe.
  directedRow?: TargetContentMetadataRow | null;
}

export type SelectionResult =
  | { ids: string[]; skippedGlobalQueue: false }
  | { ids: string[]; skippedGlobalQueue: true; blockedReason?: string };

// Pura - decide la lista final de content_metadata.id a procesar. Nunca
// consulta Supabase por si misma: en modo "directed" jamas construye ni
// necesita `globalReadyIds` (el llamador, agent/schedule/run.mts, nunca debe
// ejecutar esa consulta cuando el modo es "directed" - ver run.mts). Un
// target invalido/inexistente/no-ready produce `ids: []` (fail-closed, CERO
// fallback a la cola global), nunca `ids` con mas de un elemento.
export function computeSelection(input: SelectionInput): SelectionResult {
  if (input.mode.mode === "global") {
    return { ids: input.globalReadyIds ?? [], skippedGlobalQueue: false };
  }
  const eligibility = evaluateTargetEligibility(input.directedRow ?? null, input.mode.targetId);
  if (!eligibility.ok) {
    return { ids: [], skippedGlobalQueue: true, blockedReason: eligibility.reason };
  }
  return { ids: [input.mode.targetId], skippedGlobalQueue: true };
}

// Mecanismo de claim/lock atomico contra Supabase - no es una simple comprobacion
// previa: cada reclamo es un UPDATE/INSERT condicional de una sola sentencia, para
// que dos ejecuciones del agente nunca puedan procesar el mismo archivo a la vez.
import { supabaseAdmin } from "../supabaseClient.mts";
import { log } from "../logger.mts";
import { MAX_RETRIES, STALE_CLAIM_MINUTES, type AccountStyle } from "./config.mts";

export interface WorkItem {
  contentFileId: string;
  filePath: string;
  folderType: "completo" | "clip";
  accountFolderName: string;
  accountStyle: AccountStyle;
  metadataRowId: string;
  // content_files.episode_id (puede ser null) — solo para el alcance por
  // episodio del glosario de transcripción (lib/transcriptGlossary.ts).
  episodeId?: string | null;
  retryCountAtClaim: number;
  // Si un intento anterior ya obtuvo transcripcion (aunque fallara despues), se
  // reutiliza en el reintento en vez de correr Whisper de nuevo.
  cachedTranscript: string | null;
  // Si un intento anterior ya obtuvo y valido el analisis canonico de Ollama (aunque
  // la GENERACION DETERMINISTA o la validacion final fallaran despues), se reutiliza
  // sin volver a llamar a Ollama. Se guarda en claude_raw_response - ver processOne.mts.
  cachedCanonicalRaw: string | null;
}

// Si un proceso se cayo a mitad de transcripcion/muestreo/generacion, la fila queda
// "colgada" en un estado no terminal. Pasado STALE_CLAIM_MINUTES sin actualizarse,
// se recupera pasandola a 'error' (cuenta como intento fallido) para que un futuro
// ciclo la pueda reintentar (si retry_count todavia lo permite).
// Fase 5.10-B — allowedContentAccountIds es OBLIGATORIO (scope resuelto una
// sola vez en agent/analyze/run.mts::main()). content_metadata NO tiene
// columna de cuenta propia — se resuelve primero el conjunto de
// content_file_id permitidos (content_files.content_account_id) y se filtra
// la busqueda de huerfanos con ese conjunto, nunca con un SELECT global
// filtrado despues en memoria. Lista de cuentas vacia = nada que recuperar,
// sin consultar Supabase (Decision K.2).
export async function recoverStaleClaims(allowedContentAccountIds: string[]): Promise<void> {
  if (allowedContentAccountIds.length === 0) {
    log.info("Scope sin cuentas permitidas - sin reclamos huerfanos que recuperar.");
    return;
  }

  const { data: scopedFiles, error: scopedFilesError } = await supabaseAdmin
    .from("content_files")
    .select("id")
    .in("content_account_id", allowedContentAccountIds);

  if (scopedFilesError) {
    log.error("Error resolviendo content_files del scope para recuperar reclamos huerfanos", { error: scopedFilesError.message });
    return;
  }
  const scopedFileIds = (scopedFiles ?? []).map((f) => f.id as string);
  if (scopedFileIds.length === 0) return; // sin archivos en este scope - nada que recuperar, sin consultar content_metadata

  const staleThreshold = new Date(Date.now() - STALE_CLAIM_MINUTES * 60_000).toISOString();

  const { data: staleRows, error } = await supabaseAdmin
    .from("content_metadata")
    .select("id, status, retry_count")
    .in("status", ["transcribing", "sampling_frames", "generating_metadata"])
    .lt("updated_at", staleThreshold)
    .in("content_file_id", scopedFileIds);

  if (error) {
    log.error("Error buscando reclamos colgados en content_metadata", { error: error.message });
    return;
  }
  if (!staleRows || staleRows.length === 0) return;

  for (const row of staleRows) {
    // El segundo .eq("status", row.status) actua como comprobacion optimista: si
    // otra corrida ya cambio el estado entre el SELECT y este UPDATE, no se pisa.
    const { data: updated } = await supabaseAdmin
      .from("content_metadata")
      .update({
        status: "error",
        retry_count: row.retry_count + 1,
        error_message: "Proceso interrumpido (reclamo expirado, posible caida a mitad de proceso). Cuenta como intento.",
      })
      .eq("id", row.id)
      .eq("status", row.status)
      .select("id");

    if (updated && updated.length > 0) {
      log.warn("Reclamo colgado recuperado", { metadataId: row.id, nuevoRetryCount: row.retry_count + 1 });
    }
  }
}

// Fase 3.3 — exportada (sin cambiar su logica) para que el modo dirigido de
// agent/analyze/run.mts (CONTENT_FILE_ID) pueda reclamar exactamente UNA fila
// con el mismo mecanismo atomico que ya usa findPendingWork(), sin duplicarlo.
export async function claimNewFile(contentFileId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from("content_metadata")
    .upsert({ content_file_id: contentFileId, status: "transcribing" }, { onConflict: "content_file_id", ignoreDuplicates: true })
    .select("id");

  if (error) {
    log.error("Error reclamando archivo nuevo para analisis", { contentFileId, error: error.message });
    return null;
  }
  return data && data.length > 0 ? data[0].id : null;
}

// Fase 3.3 — exportada por el mismo motivo que claimNewFile() arriba.
export async function claimRetry(metadataId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from("content_metadata")
    .update({ status: "transcribing", error_message: null })
    .eq("id", metadataId)
    .eq("status", "error")
    .lt("retry_count", MAX_RETRIES)
    .select("id");

  if (error) {
    log.error("Error reclamando reintento", { metadataId, error: error.message });
    return null;
  }
  return data && data.length > 0 ? data[0].id : null;
}

// Fase 5.10-B — allowedContentAccountIds es OBLIGATORIO. Lista vacia = sin
// trabajo, sin consultar Supabase (Decision K.2) — nunca un fallback a
// "todos los content_files en analyzing".
export async function findPendingWork(allowedContentAccountIds: string[]): Promise<WorkItem[]> {
  if (allowedContentAccountIds.length === 0) return [];

  const { data: analyzingFiles, error: filesError } = await supabaseAdmin
    .from("content_files")
    .select("id, file_path, folder_type, content_account_id, episode_id")
    .eq("status", "analyzing")
    .in("content_account_id", allowedContentAccountIds);

  if (filesError) {
    log.error("Error listando content_files pendientes de analisis", { error: filesError.message });
    return [];
  }
  if (!analyzingFiles || analyzingFiles.length === 0) return [];

  const fileIds = analyzingFiles.map((f) => f.id);
  const { data: existingMeta, error: metaError } = await supabaseAdmin
    .from("content_metadata")
    .select("id, content_file_id, status, retry_count, transcript, claude_raw_response")
    .in("content_file_id", fileIds);

  if (metaError) {
    log.error("Error listando content_metadata existente", { error: metaError.message });
    return [];
  }
  const metaByFile = new Map((existingMeta ?? []).map((m) => [m.content_file_id as string, m]));

  const accountIds = [...new Set(analyzingFiles.map((f) => f.content_account_id as string))];
  const { data: accounts, error: accountsError } = await supabaseAdmin
    .from("content_accounts")
    .select("id, folder_name, style")
    .in("id", accountIds);

  if (accountsError) {
    log.error("Error cargando content_accounts para analisis", { error: accountsError.message });
    return [];
  }
  const accountById = new Map((accounts ?? []).map((a) => [a.id as string, a]));

  const items: WorkItem[] = [];
  for (const file of analyzingFiles) {
    const meta = metaByFile.get(file.id as string);
    const account = accountById.get(file.content_account_id as string);
    if (!account) continue; // sin identidad de cuenta no se procesa, por seguridad

    let metadataRowId: string | null = null;
    let retryCountAtClaim = 0;

    if (!meta) {
      metadataRowId = await claimNewFile(file.id as string);
    } else if (meta.status === "error" && meta.retry_count < MAX_RETRIES) {
      retryCountAtClaim = meta.retry_count;
      metadataRowId = await claimRetry(meta.id as string);
    } else {
      continue; // ready, en progreso por otra corrida, o ya agoto los reintentos
    }

    if (!metadataRowId) continue; // otra corrida se adelanto reclamando esta fila

    items.push({
      contentFileId: file.id as string,
      filePath: file.file_path as string,
      folderType: file.folder_type as "completo" | "clip",
      accountFolderName: account.folder_name as string,
      accountStyle: (account.style ?? {}) as AccountStyle,
      metadataRowId,
      episodeId: (file.episode_id as string | null) ?? null,
      retryCountAtClaim,
      cachedTranscript: (meta?.transcript as string | null) ?? null,
      cachedCanonicalRaw: (meta?.claude_raw_response as string | null) ?? null,
    });
  }

  return items;
}

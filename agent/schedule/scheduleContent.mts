// Orquesta READY -> SCHEDULED para UN content_metadata en status='ready':
//   1. Resuelve identidad (content_file -> content_account -> social_accounts activas)
//   2. Por cada plataforma resuelta: si ya existe social_posts (idempotencia), no
//      duplica; si no existe, busca la proxima ventana libre y crea la fila.
// NO llama a Whisper ni a Ollama. NO publica nada. Usa unicamente
// content_metadata.platform_metadata ya generado en la Fase 3.
import { supabaseAdmin } from "../supabaseClient.mts";
import { log } from "../logger.mts";
import { resolveTargetsForContentAccount } from "./resolveIdentity.mts";
import { findNextAvailableWindow } from "./findNextWindow.mts";

export type ScheduleStatus = "scheduled" | "skipped" | "already_scheduled" | "error";

export interface ScheduleOutcome {
  platformKey: string;
  socialPlatform?: string;
  status: ScheduleStatus;
  reason?: string;
  scheduledAtUtc?: string;
  socialPostId?: string;
}

export async function scheduleReadyContent(contentMetadataId: string): Promise<ScheduleOutcome[]> {
  const outcomes: ScheduleOutcome[] = [];

  const { data: meta, error: metaError } = await supabaseAdmin
    .from("content_metadata")
    .select("id, content_file_id, platform_metadata, status")
    .eq("id", contentMetadataId)
    .single();

  if (metaError || !meta) {
    log.error("[SCHEDULE] No se pudo cargar content_metadata", { contentMetadataId, error: metaError?.message });
    return outcomes;
  }
  if (meta.status !== "ready") {
    log.warn("[SCHEDULE] content_metadata no esta en status='ready' - se omite", { contentMetadataId, status: meta.status });
    return outcomes;
  }

  const { data: file, error: fileError } = await supabaseAdmin
    .from("content_files")
    .select("id, content_account_id, file_path")
    .eq("id", meta.content_file_id)
    .single();

  if (fileError || !file) {
    log.error("[SCHEDULE] No se pudo cargar content_files asociado a content_metadata", { contentMetadataId, error: fileError?.message });
    return outcomes;
  }

  const platformKeys = Object.keys((meta.platform_metadata as Record<string, unknown>) ?? {});
  const { targets, skipped } = await resolveTargetsForContentAccount(file.content_account_id, platformKeys);

  for (const skip of skipped) {
    log.warn(`[SCHEDULE] Plataforma omitida: ${skip.reason}`, { contentFileId: file.id, platformKey: skip.platformKey });
    outcomes.push({ platformKey: skip.platformKey, status: "skipped", reason: skip.reason });
  }

  for (const target of targets) {
    // Idempotencia: la combinacion (content_file_id, account_id) identifica de forma
    // unica "este archivo ya programado para esta cuenta social" - repetir el
    // scheduler nunca debe crear una segunda fila para el mismo par.
    const { data: existing, error: existingError } = await supabaseAdmin
      .from("social_posts")
      .select("id, scheduled_at")
      .eq("content_file_id", file.id)
      .eq("account_id", target.socialAccountId)
      .maybeSingle();

    if (existingError) {
      log.error("[SCHEDULE] Error verificando idempotencia", { contentFileId: file.id, platformKey: target.platformKey, error: existingError.message });
      outcomes.push({ platformKey: target.platformKey, socialPlatform: target.socialPlatform, status: "error", reason: existingError.message });
      continue;
    }

    if (existing) {
      log.info("[SCHEDULE] Ya existia una publicacion programada para este archivo+cuenta - no se duplica", {
        contentFileId: file.id,
        platformKey: target.platformKey,
        socialPostId: existing.id,
      });
      outcomes.push({
        platformKey: target.platformKey,
        socialPlatform: target.socialPlatform,
        status: "already_scheduled",
        scheduledAtUtc: existing.scheduled_at,
        socialPostId: existing.id,
      });
      continue;
    }

    const window = await findNextAvailableWindow(file.content_account_id, target.socialAccountId, target.socialPlatform, target.timezone);
    if ("error" in window) {
      log.warn(`[SCHEDULE] No se pudo encontrar ventana disponible: ${window.error}`, { contentFileId: file.id, platformKey: target.platformKey });
      outcomes.push({ platformKey: target.platformKey, socialPlatform: target.socialPlatform, status: "error", reason: window.error });
      continue;
    }

    const platformMeta = (meta.platform_metadata as Record<string, { title: string; description: string; hashtags: string[] }>)[target.platformKey];

    // Aun no se sube el video real (fuera del alcance de este scheduler) - se
    // reserva una ruta convencional, dejando explicito que la subida real es
    // un paso pendiente futuro (ver agent/publish/storageBridge.mts).
    //
    // Fase 13 (Regla 9, documentado explicitamente) — video_path/video_url
    // son NOT NULL en el schema (supabase/schema.sql) y este INSERT ocurre
    // ANTES de que exista ningun archivo subido a ningun backend - por eso
    // siguen siendo un placeholder puramente ESTRUCTURAL, nunca operativo.
    // Ya NO se llama a Supabase Storage (getPublicUrl) aqui: ese proveedor
    // dejo de ser la fuente operativa de video_url/video_path para
    // Instagram/Facebook (ahora es Backblaze B2, ver storageBridge.mts). El
    // placeholder de video_url usa un esquema "placeholder://" deliberado
    // (nunca un HTTPS real) para que sea imposible confundirlo con una URL
    // usable - la URL real que SI se usa para publicar se genera dinamica y
    // temporalmente en agent/publish/run.mts (presigned URL de B2, con
    // expiracion corta, nunca persistida), y ese mismo run.mts valida
    // explicitamente que este placeholder JAMAS llegue al publisher. El
    // object key real (video_path) se persiste de vuelta a la fila SOLO tras
    // una publicacion exitosa (ver run.mts) - cierra el bug de cleanup ya
    // documentado en STORAGE_META_AUDIT.
    const extension = file.file_path.includes(".") ? file.file_path.slice(file.file_path.lastIndexOf(".")) : ".mp4";
    const videoPath = `pending-upload/${file.id}${extension}`;
    const videoUrl = `placeholder://pending-upload/${file.id}${extension}`;

    const { data: inserted, error: insertError } = await supabaseAdmin
      .from("social_posts")
      .insert({
        account_id: target.socialAccountId,
        content_file_id: file.id,
        video_url: videoUrl,
        video_path: videoPath,
        title: platformMeta.title,
        caption: platformMeta.description,
        hashtags: platformMeta.hashtags,
        scheduled_at: window.scheduledAtUtc.toISOString(),
        schedule_rule_id: window.ruleId,
        status: "pending",
        retry_count: 0,
      })
      .select("id")
      .single();

    if (insertError) {
      log.error("[SCHEDULE] Error creando social_post", { contentFileId: file.id, platformKey: target.platformKey, error: insertError.message });
      outcomes.push({ platformKey: target.platformKey, socialPlatform: target.socialPlatform, status: "error", reason: insertError.message });
      continue;
    }

    log.info("[SCHEDULE] Publicacion programada correctamente", {
      contentFileId: file.id,
      platformKey: target.platformKey,
      socialPlatform: target.socialPlatform,
      scheduledAtUtc: window.scheduledAtUtc.toISOString(),
      socialPostId: inserted!.id,
    });
    outcomes.push({
      platformKey: target.platformKey,
      socialPlatform: target.socialPlatform,
      status: "scheduled",
      scheduledAtUtc: window.scheduledAtUtc.toISOString(),
      socialPostId: inserted!.id,
    });
  }

  return outcomes;
}

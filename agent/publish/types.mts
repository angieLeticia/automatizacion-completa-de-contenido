// Tipos propios de este modulo - NO se importan de lib/social/types.ts porque esa
// interfaz SocialPost quedo desactualizada desde la Fase 1 (le faltan
// content_file_id/hashtags/retry_count/schedule_rule_id) y no se toca aqui.
export type SocialPlatform = "youtube" | "instagram" | "facebook" | "tiktok";
// Fase 5.4 — "verification_required": un post cuyo claim venció Y para el que
// existe evidencia (real o de placeholder, ver claimPost.mts) de que se pudo
// haber llamado al publisher real. Nunca se alcanza por inferencia/timeout
// solo — requiere reconciliación explícita o revisión humana para salir de
// aquí (ver docs/phase-5.4-claim-recovery.md).
export type SocialPostStatus = "pending" | "publishing" | "published" | "error" | "verification_required";

export interface SocialPostRow {
  id: string;
  account_id: string;
  content_file_id: string | null;
  video_url: string;
  video_path: string;
  title: string | null;
  caption: string | null;
  hashtags: string[];
  scheduled_at: string;
  status: SocialPostStatus;
  external_post_id: string | null;
  error_message: string | null;
  retry_count: number;
  schedule_rule_id: string | null;
  created_at: string;
  published_at: string | null;
  // Fase 5.4 — solo se lee/escribe si CLAIMED_AT_MIGRATION_APPLIED=true (la
  // columna todavía no existe en producción real, ver supabase/schema.sql).
  claimed_at?: string | null;
  // Fase 5.4 — NULL = nunca se intentó llamar al publisher real (seguro
  // reintentar). "pending:<platform>" = intento marcado pero sin referencia
  // real de la plataforma (ej. Facebook). Cualquier otro valor = referencia
  // real de la plataforma (uploadUrl de YouTube, creationId de Instagram) —
  // ver agent/publish/staleClaimClassification.mts.
  publisher_operation_ref?: string | null;
  // Fase 5.14 — gate de revisión humana POR PUBLICACIÓN, condición ADICIONAL
  // a DRY_RUN/channel_status (nunca un sustituto). Ambas columnas todavía NO
  // existen en producción real (propuestas, no aplicadas — ver
  // docs/phase-5.14-human-review.md) - por eso son opcionales aquí: una
  // fila obtenida vía `SELECT *` antes de aplicar la migración simplemente
  // no trae estas claves (undefined, no un error), lo cual
  // humanReviewGate.mts::isPublicationAuthorized() trata igual que null -
  // "no autorizado" es siempre el default seguro, con o sin la migración.
  publication_authorized_at?: string | null;
  publication_authorized_by?: string | null;
}

export interface SocialAccountRow {
  id: string;
  channel_id: string;
  platform: SocialPlatform;
  label: string | null;
  credentials: Record<string, string>;
  is_active: boolean;
}

export interface ContentFileRow {
  id: string;
  content_account_id: string;
  file_path: string;
  file_hash: string;
}

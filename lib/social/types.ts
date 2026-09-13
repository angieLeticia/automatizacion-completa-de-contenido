export type SocialPlatform = "youtube" | "instagram" | "facebook" | "tiktok";

export type SocialPostStatus = "pending" | "publishing" | "published" | "error";

export interface SocialChannel {
  id: string;
  name: string;
  is_active: boolean;
  created_at: string;
}

export interface SocialAccount {
  id: string;
  channel_id: string;
  platform: SocialPlatform;
  label: string | null;
  credentials: Record<string, string>;
  is_active: boolean;
  created_at: string;
}

export interface SocialPost {
  id: string;
  account_id: string;
  video_url: string;
  video_path: string;
  title: string | null;
  caption: string | null;
  scheduled_at: string;
  status: SocialPostStatus;
  external_post_id: string | null;
  error_message: string | null;
  created_at: string;
  published_at: string | null;
  // Entrega directa desde disco (Fase 4B.5, YouTube) - cuando esta presente, el
  // publisher debe leer el archivo local en vez de descargar video_url. Opcional:
  // Instagram/Facebook y el flujo legacy via Storage no la usan.
  local_file_path?: string;
  // Fase 5.20 (Phase A1) — opcional por el mismo motivo que local_file_path:
  // la columna real (social_posts.hashtags) existe desde antes, pero esta
  // interfaz nunca la declaraba (ver agent/publish/types.mts, comentario de
  // cabecera). Ahora SÍ se consume: YouTube -> tags; Instagram/Facebook ->
  // se componen dentro de caption/description (ver captionComposition.ts).
  hashtags?: string[];
}

export interface PublishResult {
  externalPostId: string;
}

// Fase 5.4.1 — significa EXCLUSIVAMENTE: "la plataforma respondió HTTP
// exitoso (res.ok === true) - ya pudo haber aceptado/publicado de verdad -
// pero no pudimos completar de forma segura la interpretación/persistencia
// del resultado". NUNCA se lanza para un rechazo HTTP normal (400/401/403/
// 404/rate-limit) ni para un fallo de red ANTES de recibir respuesta - esos
// casos conservan el comportamiento existente (agent/publish/retryPolicy.mts).
// Un publisher NUNCA debe silenciar esta excepción ni reintentar solo -
// debe propagarla tal cual a quien lo invoque.
export class PublicationOutcomeUncertainError extends Error {
  readonly platform: SocialPlatform;
  readonly operationRef?: string;
  readonly httpStatus?: number;
  readonly originalError?: unknown;

  constructor(
    message: string,
    details: { platform: SocialPlatform; operationRef?: string; httpStatus?: number; originalError?: unknown }
  ) {
    super(message);
    this.name = "PublicationOutcomeUncertainError";
    this.platform = details.platform;
    this.operationRef = details.operationRef;
    this.httpStatus = details.httpStatus;
    this.originalError = details.originalError;
  }
}

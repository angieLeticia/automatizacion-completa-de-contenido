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
}

export interface PublishResult {
  externalPostId: string;
}

// Tipos propios de este modulo - NO se importan de lib/social/types.ts porque esa
// interfaz SocialPost quedo desactualizada desde la Fase 1 (le faltan
// content_file_id/hashtags/retry_count/schedule_rule_id) y no se toca aqui.
export type SocialPlatform = "youtube" | "instagram" | "facebook" | "tiktok";
export type SocialPostStatus = "pending" | "publishing" | "published" | "error";

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

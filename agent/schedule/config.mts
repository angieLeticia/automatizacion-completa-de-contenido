// Configuracion de la Fase 4A (planificacion/programacion - todavia NO publica).
import path from "node:path";

try {
  process.loadEnvFile(path.join(import.meta.dirname, "..", "..", ".env.local"));
} catch {
  // .env.local no existe o ya esta cargado por el shell - seguimos sin frenar.
}

export const SCHEDULE_LOOKAHEAD_DAYS = 14;

// Mapea las claves internas de content_metadata.platform_metadata (que distinguen
// formato: youtube_shorts vs youtube largo, instagram_reels, facebook_reels) a la
// columna real social_accounts.platform, que NO distingue formato - un YouTube
// Short se publica con la MISMA cuenta/credenciales que un video largo de YouTube.
export const PLATFORM_KEY_TO_SOCIAL_PLATFORM: Record<string, "youtube" | "instagram" | "facebook" | "tiktok"> = {
  youtube: "youtube",
  youtube_shorts: "youtube",
  instagram_reels: "instagram",
  facebook_reels: "facebook",
  tiktok: "tiktok",
};

// Mismo bucket que ya usa el panel /admin/social (lib/social - sin modificar).
export const SOCIAL_VIDEOS_BUCKET = "social-videos";

import type { SocialPlatform } from "./types";

export interface PlatformInfo {
  key: SocialPlatform;
  label: string;
  accentColor: string;
}

// Lista fija de plataformas que el sistema sabe publicar (código). No confundir
// con los "canales" (líneas/marcas) del usuario, que viven en la tabla
// social_channels y se crean/editan desde el panel, no aquí.
//
// Añadir soporte a una plataforma nueva: agrega su entrada aquí + su función
// publishToX en publishers.ts + sus campos de credenciales en credentialFields.ts
// + el valor en el CHECK de supabase/schema.sql.
export const PLATFORMS: PlatformInfo[] = [
  { key: "youtube", label: "YouTube", accentColor: "#FF0000" },
  { key: "instagram", label: "Instagram", accentColor: "#E1306C" },
  { key: "facebook", label: "Facebook", accentColor: "#1877F2" },
  // { key: "tiktok", label: "TikTok", accentColor: "#000000" }, // pendiente de aprobación de la Content Posting API
];

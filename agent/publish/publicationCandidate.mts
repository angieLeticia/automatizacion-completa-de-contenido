// Fase 4.9 — Sección 15: contrato PublicationCandidate. Vive ANTES de que
// algo se convierta en una fila real de `social_posts` (SocialPostRow, ver
// ./types.mts, que sigue siendo la forma real de la tabla — no se duplica ni
// se reemplaza). PublicationCandidate es lo que Agent 3 recibiría de
// "derivados + metadata por plataforma", con la regla explícita de que el
// texto NUNCA es idéntico entre plataformas.
//
// NO activa publicación. NO llama a ningún publisher. Es un contrato de
// datos, consumido eventualmente por agent/schedule/scheduleContent.mts para
// construir la fila real de social_posts (fuera de alcance de esta fase).
import type { SocialPlatform } from "./types.mts";

export type PublicationAuthorization =
  | { authorized: false }
  | { authorized: true; authorizedAt: string; authorizedBy: string };

export type YouTubeMetadata = {
  title: string;
  description: string;
  hashtags: string[];
  tags?: string[]; // categorización adicional de YouTube, distinta de hashtags en el texto
};

export type InstagramMetadata = {
  caption: string;
  hashtags: string[];
};

export type FacebookMetadata = {
  caption: string;
  hashtags: string[];
};

export type TikTokMetadata = {
  caption: string;
  hashtags: string[];
};

export type PlatformMetadata =
  | { platform: "youtube"; metadata: YouTubeMetadata }
  | { platform: "instagram"; metadata: InstagramMetadata }
  | { platform: "facebook"; metadata: FacebookMetadata }
  | { platform: "tiktok"; metadata: TikTokMetadata };

export type PublicationCandidate = {
  channel: string;
  channelId: string | null; // content_accounts.id real, cuando se resuelva (Agent 3 ya sabe hacerlo — ver agent/discoverAccounts.mts)
  episodeId: string;
  contentFileId: string | null; // content_files.id real, cuando exista
  derivedContentId: string | null; // DerivedContent.id (Sección 8) — null para el video principal
  platformMetadata: PlatformMetadata;
  videoPath: string;
  thumbnailPath: string | null;
  authorization: PublicationAuthorization;
  schedule: { scheduledAt: string; timezone: string } | null;
  correlationId: string; // para logs/observabilidad (Sección 20) — nunca un secreto
};

// Regla explícita de la Sección 15: nunca copiar el mismo texto a todas las
// plataformas. Esta función NO genera contenido (no hay LLM acá) — solo
// valida que, si se armaron metadatas para varias plataformas del mismo
// candidato, no sean el mismo texto literal (detecta el error más común:
// copiar y pegar sin adaptar).
export function assertPlatformTextsDiffer(candidates: PublicationCandidate[]): void {
  const texts = candidates.map((c) => {
    const m = c.platformMetadata.metadata;
    return "title" in m ? `${m.title}\n${m.description}` : m.caption;
  });
  const seen = new Set<string>();
  for (let i = 0; i < texts.length; i++) {
    if (seen.has(texts[i])) {
      throw new Error(
        `PLATFORM_TEXT_DUPLICATED: dos plataformas del mismo contenido tienen exactamente el mismo texto ` +
          `(candidato ${i}) — cada plataforma requiere su propia metadata, nunca copiada literal.`
      );
    }
    seen.add(texts[i]);
  }
}

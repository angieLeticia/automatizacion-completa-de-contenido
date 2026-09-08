// Resuelve la cadena de identidad completa, SIEMPRE por relaciones de la base de
// datos, nunca por nombre de archivo:
//   content_file -> content_account -> channel_id -> social_accounts (activa)
// Si algo en la cadena falta o es ambiguo, se omite esa plataforma (no se programa)
// y se documenta el motivo - nunca se infiere ni se asume.
import { supabaseAdmin } from "../supabaseClient.mts";
import { PLATFORM_KEY_TO_SOCIAL_PLATFORM } from "./config.mts";

// Publishers YA EXISTENTES (lib/social, sin modificar): son la fuente de verdad de
// que plataforma tiene integracion real. Si una plataforma no tiene publisher
// (hoy: tiktok), nunca se crea una publicacion para ella - programar algo que
// fallara inevitablemente al publicarse seria peor que no programarlo.
import { PUBLISHERS } from "../../lib/social/publishers.ts";

export type SocialPlatform = "youtube" | "instagram" | "facebook" | "tiktok";

export interface ResolvedTarget {
  platformKey: string; // clave interna de content_metadata.platform_metadata (ej. "youtube_shorts")
  socialPlatform: SocialPlatform;
  socialAccountId: string;
  timezone: string;
}

export interface IdentitySkip {
  platformKey: string;
  reason: string;
}

export async function resolveTargetsForContentAccount(
  contentAccountId: string,
  requestedPlatformKeys: string[]
): Promise<{ targets: ResolvedTarget[]; skipped: IdentitySkip[] }> {
  const targets: ResolvedTarget[] = [];
  const skipped: IdentitySkip[] = [];

  const { data: account, error: accountError } = await supabaseAdmin
    .from("content_accounts")
    .select("id, channel_id, timezone")
    .eq("id", contentAccountId)
    .single();

  if (accountError || !account) {
    for (const platformKey of requestedPlatformKeys) {
      skipped.push({ platformKey, reason: `No se pudo resolver content_account id=${contentAccountId}: ${accountError?.message ?? "no encontrada"}` });
    }
    return { targets, skipped };
  }

  const { data: socialAccounts, error: saError } = await supabaseAdmin
    .from("social_accounts")
    .select("id, platform, is_active")
    .eq("channel_id", account.channel_id);

  if (saError) {
    for (const platformKey of requestedPlatformKeys) {
      skipped.push({ platformKey, reason: `Error consultando social_accounts: ${saError.message}` });
    }
    return { targets, skipped };
  }

  for (const platformKey of requestedPlatformKeys) {
    const socialPlatform = PLATFORM_KEY_TO_SOCIAL_PLATFORM[platformKey];
    if (!socialPlatform) {
      skipped.push({ platformKey, reason: `Clave de plataforma desconocida en platform_metadata: '${platformKey}'.` });
      continue;
    }
    if (!PUBLISHERS[socialPlatform]) {
      skipped.push({
        platformKey,
        reason: `Sin integracion oficial disponible/configurada para '${socialPlatform}' (no existe publisher en lib/social/publishers.ts) - no se programa para evitar una publicacion que fallaria inevitablemente.`,
      });
      continue;
    }

    const matches = (socialAccounts ?? []).filter((sa) => sa.platform === socialPlatform && sa.is_active);
    if (matches.length === 0) {
      skipped.push({ platformKey, reason: `No existe una social_account activa para la plataforma '${socialPlatform}' en el canal de esta cuenta de contenido.` });
      continue;
    }
    if (matches.length > 1) {
      skipped.push({ platformKey, reason: `Ambiguedad: existe mas de una social_account activa para '${socialPlatform}' en este canal - no se programa hasta resolver manualmente.` });
      continue;
    }

    targets.push({ platformKey, socialPlatform, socialAccountId: matches[0].id, timezone: account.timezone });
  }

  return { targets, skipped };
}

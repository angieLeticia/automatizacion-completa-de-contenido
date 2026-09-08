// Verificacion de identidad EN EL MOMENTO DE PUBLICAR - defensa en profundidad,
// independiente de que agent/schedule ya haya resuelto la identidad al crear la
// fila. Nunca busca una cuenta "parecida"; si algo no cuadra exactamente, NO PUBLICAR.
import { supabaseAdmin } from "../supabaseClient.mts";
import { PUBLISHERS } from "../../lib/social/publishers.ts";
import { CREDENTIAL_FIELDS } from "../../lib/social/credentialFields.ts";
import type { SocialAccountRow, SocialPlatform } from "./types.mts";

export type IdentityOutcome =
  | { ok: true; account: SocialAccountRow }
  | { ok: false; reason: string };

export async function resolveAndValidateIdentity(accountId: string, contentAccountId: string | null): Promise<IdentityOutcome> {
  const { data: account, error } = await supabaseAdmin
    .from("social_accounts")
    .select("id, channel_id, platform, label, credentials, is_active")
    .eq("id", accountId)
    .single();

  if (error || !account) {
    return { ok: false, reason: `No se pudo resolver social_accounts id=${accountId}: ${error?.message ?? "no encontrada"}` };
  }
  if (!account.is_active) {
    return { ok: false, reason: `La social_account '${account.label ?? account.id}' esta inactiva - no se publica.` };
  }

  const platform = account.platform as SocialPlatform;
  if (!PUBLISHERS[platform]) {
    return { ok: false, reason: `No existe publisher implementado para la plataforma '${platform}'.` };
  }

  const requiredFields = CREDENTIAL_FIELDS[platform] ?? [];
  const missing = requiredFields.filter((f) => {
    const value = account.credentials?.[f.key];
    return typeof value !== "string" || value.trim().length === 0;
  });
  if (missing.length > 0) {
    return { ok: false, reason: `Faltan credenciales requeridas para '${platform}': ${missing.map((f) => f.key).join(", ")}.` };
  }

  // Consistencia defensiva: el content_file y la social_account deben pertenecer
  // al MISMO canal. Nada en el schema impide una fila corrupta/mal creada
  // manualmente que mezcle canales - esta comprobacion existe para que, si eso
  // pasara, NUNCA se publique cruzado entre cuentas.
  if (contentAccountId) {
    const { data: contentAccount, error: caError } = await supabaseAdmin
      .from("content_accounts")
      .select("channel_id")
      .eq("id", contentAccountId)
      .single();
    if (caError || !contentAccount) {
      return { ok: false, reason: `No se pudo verificar consistencia de canal: content_account id=${contentAccountId} no encontrada.` };
    }
    if (contentAccount.channel_id !== account.channel_id) {
      return { ok: false, reason: `Inconsistencia de canal detectada: el content_file pertenece a un canal distinto al de la social_account (${contentAccount.channel_id} != ${account.channel_id}) - NO PUBLICAR.` };
    }
  }

  return { ok: true, account: account as SocialAccountRow };
}

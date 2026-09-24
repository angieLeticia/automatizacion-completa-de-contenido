// Fase 5.1 — inventario READ-ONLY de las 4 cuentas reales. Nunca selecciona
// ni imprime valores de credentials — solo boolean de presencia por campo
// requerido (CREDENTIAL_FIELDS), nunca el valor.
import "./env.mts";
import { supabaseAdmin } from "../../agent/supabaseClient.mts";
import { CREDENTIAL_FIELDS } from "../../lib/social/credentialFields.ts";

async function main() {
  const { data: channels } = await supabaseAdmin.from("social_channels").select("id, name, is_active");
  const { data: accounts } = await supabaseAdmin
    .from("content_accounts")
    .select("id, folder_name, channel_id, channel_status, is_active, timezone");
  const { data: socialAccounts } = await supabaseAdmin
    .from("social_accounts")
    .select("id, channel_id, platform, label, is_active, credentials");

  for (const ch of channels ?? []) {
    const contentAccount = (accounts ?? []).find((a) => a.channel_id === ch.id);
    console.log(`\n========== CANAL: ${ch.name} ==========`);
    console.log(`channel_id=${ch.id} channel.is_active=${ch.is_active}`);
    console.log(`content_account_id=${contentAccount?.id} folder_name=${contentAccount?.folder_name} channel_status=${contentAccount?.channel_status} content_account.is_active=${contentAccount?.is_active} timezone=${contentAccount?.timezone}`);

    for (const platform of ["youtube", "instagram", "facebook", "tiktok"] as const) {
      const sa = (socialAccounts ?? []).find((s) => s.channel_id === ch.id && s.platform === platform);
      if (!sa) {
        console.log(`  [${platform}] NO EXISTE`);
        continue;
      }
      const requiredFields = CREDENTIAL_FIELDS[platform] ?? [];
      const presence = requiredFields.map((f) => `${f.key}=${typeof sa.credentials?.[f.key] === "string" && sa.credentials[f.key].trim().length > 0 ? "configured=true" : "configured=false"}`);
      console.log(`  [${platform}] id=${sa.id} label="${sa.label}" is_active=${sa.is_active} campos=[${presence.join(", ")}]`);
    }
  }
}

main().catch((err) => {
  console.error("Error:", err instanceof Error ? err.message : err);
  process.exit(1);
});

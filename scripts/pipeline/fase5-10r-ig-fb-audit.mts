// FASE 5.10-R — auditoria READ-ONLY de credenciales Instagram/Facebook de
// SIN EXPLICACIÓN. NUNCA selecciona/imprime valores de `credentials` -
// solo PRESENT/MISSING por campo requerido (CREDENTIAL_FIELDS).
import "./env.mts";
import { supabaseAdmin } from "../../agent/supabaseClient.mts";
import { CREDENTIAL_FIELDS } from "../../lib/social/credentialFields.ts";

const SIN_EXPLICACION_ID = "d875e649-d554-4a36-897b-bb3161244b6d";

async function main() {
  const { data: account, error: accError } = await supabaseAdmin
    .from("content_accounts")
    .select("id, folder_name, channel_id, channel_status")
    .eq("id", SIN_EXPLICACION_ID)
    .maybeSingle();
  if (accError) throw new Error(accError.message);
  console.log("=== content_account ===");
  console.log(JSON.stringify(account));

  const { data: socialAccounts, error } = await supabaseAdmin
    .from("social_accounts")
    .select("id, channel_id, platform, label, is_active, credentials")
    .eq("channel_id", account!.channel_id)
    .in("platform", ["instagram", "facebook"]);
  if (error) throw new Error(error.message);

  for (const sa of socialAccounts ?? []) {
    console.log(`\n=== ${sa.platform} (social_account ${sa.id}) ===`);
    console.log(JSON.stringify({ id: sa.id, channel_id: sa.channel_id, platform: sa.platform, is_active: sa.is_active, channel_coincide: sa.channel_id === account!.channel_id }));
    const requiredFields = CREDENTIAL_FIELDS[sa.platform as "instagram" | "facebook"] ?? [];
    const creds = (sa.credentials ?? {}) as Record<string, unknown>;
    for (const field of requiredFields) {
      const value = creds[field.key];
      const present = typeof value === "string" && value.trim().length > 0;
      console.log(`  ${field.key}: ${present ? "PRESENT" : "MISSING"}`);
    }
  }
}

main().catch((err) => {
  console.error("Error:", err instanceof Error ? err.message : err);
  process.exit(1);
});

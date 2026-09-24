// FASE 5.10-AF — auditoría READ-ONLY del estado de credenciales Meta
// (facebook/instagram) para los 4 canales reales. NUNCA imprime valores de
// credenciales — solo CONFIGURADO/FALTA por campo (mismo patrón que
// fase54-check-facebook.mts), usando CREDENTIAL_FIELDS como fuente de verdad
// de qué campos exige cada plataforma. Cero escritura, cero llamadas a Meta.
import "./env.mts";
import { supabaseAdmin } from "../../agent/supabaseClient.mts";
import { CREDENTIAL_FIELDS } from "../../lib/social/credentialFields.ts";

const CHANNEL_NAMES = ["SIN EXPLICACIÓN", "ENCIENDE EL CAOS", "LUNA VERDE", "OBJETOS MALDITOS"];
const PLATFORMS = ["facebook", "instagram"] as const;

function fieldStatus(credentials: Record<string, unknown> | null | undefined, key: string): "CONFIGURADO" | "FALTA" {
  const v = credentials?.[key];
  return typeof v === "string" && v.trim().length > 0 ? "CONFIGURADO" : "FALTA";
}

async function main() {
  const { data: channels, error: chErr } = await supabaseAdmin.from("social_channels").select("id, name");
  if (chErr) throw new Error(`ABORTADO — error leyendo social_channels: ${chErr.message}`);

  const { data: accounts, error: accErr } = await supabaseAdmin
    .from("social_accounts")
    .select("id, channel_id, platform, is_active, credentials");
  if (accErr) throw new Error(`ABORTADO — error leyendo social_accounts: ${accErr.message}`);

  console.log("=== ESTADO DE CREDENCIALES META POR CANAL (solo presencia, nunca valores) ===\n");

  for (const channelName of CHANNEL_NAMES) {
    const channel = (channels ?? []).find((c) => c.name === channelName);
    console.log(`--- ${channelName} ---`);
    if (!channel) {
      console.log("  social_channels: NO EXISTE una fila con este nombre exacto.\n");
      continue;
    }
    console.log(`  social_channels.id: presente (fila encontrada)`);

    for (const platform of PLATFORMS) {
      const matches = (accounts ?? []).filter((a) => a.channel_id === channel.id && a.platform === platform);
      if (matches.length === 0) {
        console.log(`  [${platform}] fila en social_accounts: NO EXISTE`);
        continue;
      }
      if (matches.length > 1) {
        console.log(`  [${platform}] ADVERTENCIA — se encontraron ${matches.length} filas (se esperaba 1). Reportando todas:`);
      }
      for (const row of matches) {
        console.log(`  [${platform}] fila: EXISTE (id=${row.id}) is_active=${row.is_active}`);
        const fields = CREDENTIAL_FIELDS[platform as keyof typeof CREDENTIAL_FIELDS] ?? [];
        for (const f of fields) {
          console.log(`    ${f.key}: ${fieldStatus(row.credentials as Record<string, unknown>, f.key)}`);
        }
      }
    }
    console.log("");
  }
}

main().catch((err) => {
  console.error("Error:", err instanceof Error ? err.message : err);
  process.exit(1);
});

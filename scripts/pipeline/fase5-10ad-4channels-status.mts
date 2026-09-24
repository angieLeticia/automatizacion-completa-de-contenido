// FASE 5.10-AD — verificacion READ-ONLY del channel_status real (Supabase)
// de los 4 canales de PRODUCTION, para responder si HISTORICAL sigue
// existiendo como problema real hoy. Cero escritura.
import "./env.mts";
import { supabaseAdmin } from "../../agent/supabaseClient.mts";

const REAL_CHANNELS = ["SIN EXPLICACIÓN", "ENCIENDE EL CAOS", "LUNA VERDE", "OBJETOS MALDITOS"];

async function main() {
  const { data, error } = await supabaseAdmin
    .from("content_accounts")
    .select("id, folder_name, channel_id, channel_status")
    .in("folder_name", REAL_CHANNELS);
  if (error) throw new Error(error.message);

  console.log("=== content_accounts.channel_status (fresco, Supabase real) ===");
  for (const name of REAL_CHANNELS) {
    const row = (data ?? []).find((r) => r.folder_name === name);
    console.log(JSON.stringify({ folder_name: name, existe: Boolean(row), channel_status: row?.channel_status ?? null, id: row?.id ?? null }));
  }

  const { data: socialAccounts, error: saError } = await supabaseAdmin
    .from("social_accounts")
    .select("id, channel_id, platform, is_active");
  if (saError) throw new Error(saError.message);

  console.log("\n=== social_accounts por canal (platform/is_active, sin credenciales) ===");
  for (const acc of data ?? []) {
    const matches = (socialAccounts ?? []).filter((s) => s.channel_id === acc.channel_id);
    console.log(
      JSON.stringify({
        folder_name: acc.folder_name,
        social_accounts: matches.map((m) => ({ platform: m.platform, is_active: m.is_active })),
      })
    );
  }
}

main().catch((err) => {
  console.error("Error:", err instanceof Error ? err.message : err);
  process.exit(1);
});

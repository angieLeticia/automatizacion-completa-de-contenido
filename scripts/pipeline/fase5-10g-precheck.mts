// FASE 5.10-G, PASO 1 — precheck READ-ONLY antes de cambiar
// content_accounts.channel_status de SIN EXPLICACIÓN. Cero credenciales
// seleccionadas, cero INSERT/UPDATE/DELETE.
import "./env.mts";
import { supabaseAdmin } from "../../agent/supabaseClient.mts";

async function main() {
  console.log("=== content_accounts (SIN EXPLICACIÓN) ===");
  const { data: account, error: accError } = await supabaseAdmin
    .from("content_accounts")
    .select("id, folder_name, channel_id, channel_status")
    .eq("folder_name", "SIN EXPLICACIÓN")
    .maybeSingle();
  if (accError) throw new Error(accError.message);
  console.log(JSON.stringify(account));

  console.log("\n=== social_channels (por channel_id) ===");
  const { data: channel, error: chError } = await supabaseAdmin
    .from("social_channels")
    .select("*")
    .eq("id", account!.channel_id)
    .maybeSingle();
  if (chError) throw new Error(chError.message);
  // Filtra cualquier columna inesperada que pudiera contener algo sensible - hoy
  // social_channels solo tiene id/name/is_active/created_at (schema.sql), pero
  // se imprime solo lo esperado por seguridad.
  const safeChannel = channel ? { id: channel.id, name: channel.name, is_active: channel.is_active, has_channel_status_column: "channel_status" in channel } : null;
  console.log(JSON.stringify(safeChannel));

  console.log("\n=== social_accounts (del channel_id de SIN EXPLICACIÓN) ===");
  const { data: socialAccounts, error: saError } = await supabaseAdmin
    .from("social_accounts")
    .select("id, channel_id, platform, is_active")
    .eq("channel_id", account!.channel_id);
  if (saError) throw new Error(saError.message);
  for (const s of socialAccounts ?? []) console.log(JSON.stringify(s));

  console.log("\n=== Confirmacion cruzada ===");
  console.log(`content_accounts.folder_name='SIN EXPLICACIÓN' -> channel_id=${account!.channel_id}`);
  console.log(`social_channels.id=${channel?.id} name='${channel?.name}' -> coincide: ${channel?.name === "SIN EXPLICACIÓN"}`);
}

main().catch((err) => {
  console.error("Error:", err instanceof Error ? err.message : err);
  process.exit(1);
});

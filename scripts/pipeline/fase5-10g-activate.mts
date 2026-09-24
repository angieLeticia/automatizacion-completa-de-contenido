// FASE 5.10-G, PASO 2 — UNICO UPDATE autorizado: content_accounts.channel_status
// de SIN EXPLICACIÓN, HISTORICAL -> ACTIVE. Condicion maximamente especifica
// (id exacto + folder_name exacto + valor actual esperado) para que sea
// estructuralmente imposible afectar otra fila. Luego SELECT de verificacion
// de las 4 cuentas reales.
import "./env.mts";
import { supabaseAdmin } from "../../agent/supabaseClient.mts";

const SIN_EXPLICACION_ID = "d875e649-d554-4a36-897b-bb3161244b6d";
const PRODUCTION_FOLDER_NAMES = ["SIN EXPLICACIÓN", "ENCIENDE EL CAOS", "LUNA VERDE", "OBJETOS MALDITOS"];

async function main() {
  console.log("=== UPDATE (condicion: id + folder_name + channel_status='HISTORICAL' exactos) ===");
  const { data: updated, error } = await supabaseAdmin
    .from("content_accounts")
    .update({ channel_status: "ACTIVE" })
    .eq("id", SIN_EXPLICACION_ID)
    .eq("folder_name", "SIN EXPLICACIÓN")
    .eq("channel_status", "HISTORICAL")
    .select("id, folder_name, channel_status");

  if (error) throw new Error(error.message);
  console.log(`Filas afectadas: ${updated?.length ?? 0}`);
  for (const row of updated ?? []) console.log(JSON.stringify(row));

  if ((updated?.length ?? 0) !== 1) {
    console.error("ADVERTENCIA: se esperaba exactamente 1 fila afectada. Deteniendose sin asumir nada mas.");
    process.exit(1);
  }

  console.log("\n=== SELECT de verificacion — las 4 cuentas reales ===");
  const { data: all, error: allError } = await supabaseAdmin
    .from("content_accounts")
    .select("id, folder_name, channel_status")
    .in("folder_name", PRODUCTION_FOLDER_NAMES)
    .order("folder_name");
  if (allError) throw new Error(allError.message);
  for (const row of all ?? []) console.log(JSON.stringify(row));
}

main().catch((err) => {
  console.error("Error:", err instanceof Error ? err.message : err);
  process.exit(1);
});

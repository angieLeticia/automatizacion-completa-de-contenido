// FASE 5.10-H, PASO 3 — SOLO LECTURA: calcula (sin escribir nada) que
// scheduled_at devolveria findNextAvailableWindow() para YouTube/SIN EXPLICACIÓN
// hoy, reutilizando la funcion real (100% lectura: SELECT posting_schedule_rules
// + SELECT count social_posts, cero INSERT/UPDATE).
import "./env.mts";
import { findNextAvailableWindow } from "../../agent/schedule/findNextWindow.mts";

const SIN_EXPLICACION_ID = "d875e649-d554-4a36-897b-bb3161244b6d";
const SIN_EXPLICACION_YOUTUBE_ACCOUNT_ID = "20c85b1b-350e-43d5-b126-ce8f393ba919";

async function main() {
  const result = await findNextAvailableWindow(SIN_EXPLICACION_ID, SIN_EXPLICACION_YOUTUBE_ACCOUNT_ID, "youtube", "America/Bogota");
  console.log(JSON.stringify(result));
}

main().catch((err) => {
  console.error("Error:", err instanceof Error ? err.message : err);
  process.exit(1);
});

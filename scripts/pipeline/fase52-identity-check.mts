// Fase 5.2 — validación REAL de identidad (solo lectura contra las APIs de
// YouTube/Meta) para los 4 canales reales × 3 plataformas. Reutiliza
// EXACTAMENTE las funciones ya existentes (verifyYoutubeChannelIdentity/
// verifyFacebookPageIdentity/verifyInstagramAccountIdentity) — nunca
// reimplementa la lógica de verificación. NUNCA publica, NUNCA sube nada,
// NUNCA crea un social_post. NUNCA imprime credenciales — solo status/reason
// (que puede incluir IDs públicos de plataforma, nunca tokens/secrets).
import "./env.mts";
import { supabaseAdmin } from "../../agent/supabaseClient.mts";
import { verifyYoutubeChannelIdentity } from "../../agent/publish/youtubeChannelIdentity.mts";
import { verifyFacebookPageIdentity } from "../../agent/publish/facebookPageIdentity.mts";
import { verifyInstagramAccountIdentity } from "../../agent/publish/instagramAccountIdentity.mts";

type Row = { channel: string; platform: string; accountId: string; label: string; credentials: Record<string, string> };

async function main() {
  const { data: channels } = await supabaseAdmin.from("social_channels").select("id, name");
  const { data: socialAccounts } = await supabaseAdmin.from("social_accounts").select("id, channel_id, platform, label, credentials");

  const rows: Row[] = [];
  for (const ch of channels ?? []) {
    for (const platform of ["youtube", "instagram", "facebook"] as const) {
      const sa = (socialAccounts ?? []).find((s) => s.channel_id === ch.id && s.platform === platform);
      if (sa) rows.push({ channel: ch.name, platform, accountId: sa.id, label: sa.label, credentials: sa.credentials });
    }
  }

  console.log(`Cuentas a validar: ${rows.length} (esperado 12 = 4 canales x 3 plataformas)\n`);

  const results: { channel: string; platform: string; status: string; reason: string }[] = [];

  for (const row of rows) {
    console.log(`--- ${row.channel} / ${row.platform} (${row.label}) ---`);
    let result: { status: string; reason: string; retryable?: boolean };
    try {
      if (row.platform === "youtube") {
        result = await verifyYoutubeChannelIdentity(row.credentials as never);
      } else if (row.platform === "facebook") {
        result = await verifyFacebookPageIdentity(row.credentials as never);
      } else {
        result = await verifyInstagramAccountIdentity(row.credentials as never);
      }
    } catch (err) {
      result = { status: "CHECK_FAILED", reason: `Excepción no controlada: ${err instanceof Error ? err.message : String(err)}` };
    }
    console.log(`  status=${result.status}`);
    console.log(`  reason=${result.reason}`);
    results.push({ channel: row.channel, platform: row.platform, status: result.status, reason: result.reason });
    console.log("");
  }

  console.log("=== RESUMEN ===");
  for (const r of results) console.log(`${r.channel} / ${r.platform}: ${r.status}`);
}

main().catch((err) => {
  console.error("Error:", err instanceof Error ? err.message : err);
  process.exit(1);
});

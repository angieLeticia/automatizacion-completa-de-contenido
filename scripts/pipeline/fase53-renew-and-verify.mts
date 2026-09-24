// Fase 5.3 — actualiza ÚNICAMENTE credentials.refresh_token de UNA
// social_account de YouTube (preservando el resto de credentials tal cual),
// leyendo el nuevo token desde YOUTUBE_REFRESH_TOKEN_<CANAL> en .env.local
// (nunca impreso), y verifica inmediatamente con verifyYoutubeChannelIdentity()
// real (sin mocks). Nunca imprime client_secret/refresh_token/access_token.
import "./env.mts";
import { supabaseAdmin } from "../../agent/supabaseClient.mts";
import { verifyYoutubeChannelIdentity } from "../../agent/publish/youtubeChannelIdentity.mts";

const SOCIAL_ACCOUNT_ID = process.argv[2];
const ENV_VAR_NAME = process.argv[3];

async function main() {
  if (!SOCIAL_ACCOUNT_ID || !ENV_VAR_NAME) {
    console.error("Uso: fase53-renew-and-verify.mts <social_account_id> <ENV_VAR_NAME>");
    process.exit(1);
  }

  const newRefreshToken = process.env[ENV_VAR_NAME];
  if (!newRefreshToken || newRefreshToken.trim().length === 0) {
    console.error(`ABORTADO — ${ENV_VAR_NAME} está ausente/vacío en .env.local. No se modifica nada.`);
    process.exit(1);
  }

  const { data: account, error: readErr } = await supabaseAdmin
    .from("social_accounts")
    .select("id, label, credentials")
    .eq("id", SOCIAL_ACCOUNT_ID)
    .single();
  if (readErr || !account) {
    console.error(`ABORTADO — no se pudo leer la fila: ${readErr?.message}`);
    process.exit(1);
  }
  console.log(`Fila objetivo: ${account.label} (id=${account.id})`);
  const previousKeys = Object.keys(account.credentials ?? {});
  console.log(`Campos actuales en credentials (solo nombres): ${previousKeys.join(", ")}`);

  const updatedCredentials = { ...account.credentials, refresh_token: newRefreshToken };

  const { error: updateErr } = await supabaseAdmin
    .from("social_accounts")
    .update({ credentials: updatedCredentials })
    .eq("id", SOCIAL_ACCOUNT_ID);
  if (updateErr) {
    console.error(`ABORTADO — falló el UPDATE: ${updateErr.message}`);
    process.exit(1);
  }
  const newKeys = Object.keys(updatedCredentials);
  console.log(`credentials.refresh_token actualizado. Campos preservados: ${newKeys.filter((k) => k !== "refresh_token").join(", ")} (sin cambios) + refresh_token (renovado).`);

  console.log("\n=== Verificación REAL de identidad (verifyYoutubeChannelIdentity, sin mocks) ===");
  const result = await verifyYoutubeChannelIdentity(updatedCredentials as never);
  console.log(`status=${result.status}`);
  console.log(`reason=${result.reason}`);
}

main().catch((err) => {
  console.error("Error:", err instanceof Error ? err.message : err);
  process.exit(1);
});

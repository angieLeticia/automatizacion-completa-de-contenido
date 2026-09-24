// Fase 5.2 — diagnóstico adicional SOLO de los 5 fallos ya observados.
// Reusa exactamente el mismo endpoint/llamada ya ejecutada (ningún request
// nuevo que no se haya hecho ya) — únicamente captura el campo de error
// estándar de OAuth/Graph (error/error_description/code), que es información
// de diagnóstico pública, NUNCA una credencial. El token/secret nunca se
// imprime en ningún punto de este archivo.
import "./env.mts";
import { supabaseAdmin } from "../../agent/supabaseClient.mts";

async function diagnoseYoutube(label: string, creds: { client_id: string; client_secret: string; refresh_token: string }) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: creds.client_id, client_secret: creds.client_secret, refresh_token: creds.refresh_token, grant_type: "refresh_token" }),
  });
  const body = (await res.json().catch(() => ({}))) as { error?: string; error_description?: string };
  console.log(`[YouTube] ${label}: HTTP ${res.status} error="${body.error ?? "?"}" description="${body.error_description ?? "?"}"`);
}

async function diagnoseFacebook(label: string, creds: { access_token: string }) {
  const res = await fetch(`https://graph.facebook.com/v19.0/me?fields=id,name`, { headers: { Authorization: `Bearer ${creds.access_token}` } });
  const body = (await res.json().catch(() => ({}))) as { error?: { message?: string; type?: string; code?: number; error_subcode?: number } };
  console.log(`[Facebook] ${label}: HTTP ${res.status} type="${body.error?.type ?? "?"}" code=${body.error?.code ?? "?"} subcode=${body.error?.error_subcode ?? "?"} message="${body.error?.message ?? "?"}"`);
}

async function main() {
  const { data: accounts } = await supabaseAdmin.from("social_accounts").select("channel_id, platform, label, credentials");
  const { data: channels } = await supabaseAdmin.from("social_channels").select("id, name");
  const nameFor = (channelId: string) => (channels ?? []).find((c) => c.id === channelId)?.name ?? channelId;

  for (const a of accounts ?? []) {
    if (a.platform === "youtube") await diagnoseYoutube(`${nameFor(a.channel_id)} (${a.label})`, a.credentials as never);
  }
  const encienceFb = (accounts ?? []).find((a) => a.platform === "facebook" && nameFor(a.channel_id) === "ENCIENDE EL CAOS");
  if (encienceFb) await diagnoseFacebook(`ENCIENDE EL CAOS (${encienceFb.label})`, encienceFb.credentials as never);
}

main().catch((err) => {
  console.error("Error:", err instanceof Error ? err.message : err);
  process.exit(1);
});

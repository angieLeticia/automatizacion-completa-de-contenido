// Fase 5.4.4 — actualiza ÚNICAMENTE credentials.access_token de la fila
// social_accounts de Facebook de ENCIENDE EL CAOS. Reutiliza EXACTAMENTE
// fetchAccountsPage() (metaAssetDiscovery.mts, sin modificar) para obtener
// los nodos crudos de /me/accounts — el inventario seguro (buildSafeInventory)
// nunca persiste el valor real del token, así que se extrae en memoria acá,
// una sola vez, y nunca se imprime ni se escribe a ningún archivo.
import "./env.mts";
import { readFileSync } from "node:fs";
import { createHash as hash } from "node:crypto";
import { supabaseAdmin } from "../../agent/supabaseClient.mts";
import { verifyFacebookPageIdentity } from "../../agent/publish/facebookPageIdentity.mts";
import { fetchAccountsPage, type RawPageNode } from "../metaAssetDiscovery.mts";

const TARGET_PAGE_ID = "1263072480232692";
const CHANNEL_NAME = "ENCIENDE EL CAOS";
const GRAPH_VERSION = "v19.0";
const TOKEN_FILE = "C:\\Users\\angie\\meta-oauth-token.local";

function safeHash(value: string): string {
  return hash("sha256").update(value).digest("hex").slice(0, 12); // truncado — no reversible, solo para comparar
}

async function main() {
  // --- 1. Precheck: fila única, canal correcto, plataforma correcta, page_id correcto ---
  const { data: channels } = await supabaseAdmin.from("social_channels").select("id, name");
  const targetChannel = (channels ?? []).find((c) => c.name === CHANNEL_NAME);
  if (!targetChannel) throw new Error(`ABORTADO — no se encontró el canal '${CHANNEL_NAME}'.`);

  const { data: matches, error: matchErr } = await supabaseAdmin
    .from("social_accounts")
    .select("id, channel_id, platform, label, credentials")
    .eq("channel_id", targetChannel.id)
    .eq("platform", "facebook");
  if (matchErr) throw new Error(`ABORTADO — error consultando social_accounts: ${matchErr.message}`);
  if (!matches || matches.length !== 1) {
    throw new Error(`ABORTADO — se esperaba exactamente 1 fila (canal=${CHANNEL_NAME}, platform=facebook), se encontraron ${matches?.length ?? 0}. No se escribe nada.`);
  }
  const row = matches[0];
  const currentPageId = row.credentials?.page_id;
  if (currentPageId !== TARGET_PAGE_ID) {
    throw new Error(`ABORTADO — page_id de la fila ('${currentPageId}') no coincide con el esperado ('${TARGET_PAGE_ID}'). No se escribe nada.`);
  }
  const oldToken = row.credentials?.access_token;
  const oldTokenPresent = typeof oldToken === "string" && oldToken.trim().length > 0;
  console.log(`Fila objetivo única: PASS (id=${row.id}, label="${row.label}")`);
  console.log(`page_id correcto: YES (${TARGET_PAGE_ID})`);
  console.log(`Token actual: ${oldTokenPresent ? "PRESENT" : "MISSING"}`);
  const oldTokenHash = oldTokenPresent ? safeHash(oldToken as string) : null;

  // --- 2. Extraer el Page Access Token real EN MEMORIA (nunca impreso, nunca guardado en archivo) ---
  let userToken: string;
  try {
    const content = readFileSync(TOKEN_FILE, "utf-8");
    const m = content.match(/^META_LONG_LIVED_ACCESS_TOKEN=(.*)$/m);
    if (!m || !m[1] || m[1].trim().length === 0) throw new Error("META_LONG_LIVED_ACCESS_TOKEN ausente/vacío");
    userToken = m[1].trim();
  } catch (err) {
    throw new Error(`ABORTADO — no se pudo leer el token de usuario: ${err instanceof Error ? err.message : String(err)}`);
  }

  const fields = "id,name,access_token";
  const initialUrl = `https://graph.facebook.com/${GRAPH_VERSION}/me/accounts?fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(userToken)}`;
  let newPageToken: string | null = null;
  let url: string | null = initialUrl;
  while (url) {
    const result = await fetchAccountsPage(url, fetch);
    const found = (result.pages as RawPageNode[]).find((p) => p.id === TARGET_PAGE_ID);
    if (found && typeof found.access_token === "string" && found.access_token.length > 0) {
      newPageToken = found.access_token;
      break;
    }
    url = result.nextUrl;
  }
  if (!newPageToken) throw new Error(`ABORTADO — no se encontró un Page Access Token para page_id=${TARGET_PAGE_ID} en /me/accounts. No se escribe nada.`);
  const newTokenHash = safeHash(newPageToken);

  // --- 3. UPDATE — únicamente credentials.access_token de esta fila ---
  const updatedCredentials = { ...row.credentials, access_token: newPageToken };
  const { error: updateErr } = await supabaseAdmin.from("social_accounts").update({ credentials: updatedCredentials }).eq("id", row.id);
  if (updateErr) throw new Error(`ABORTADO — falló el UPDATE: ${updateErr.message}`);
  console.log(`Token Facebook actualizado: YES`);
  console.log(`Token anterior != token nuevo (hash sha256 truncado, no reversible): ${oldTokenHash !== newTokenHash ? "YES" : "NO"}`);

  // --- 4. Post-check ---
  const { data: after } = await supabaseAdmin.from("social_accounts").select("id, credentials").eq("id", row.id).single();
  const afterPageId = after?.credentials?.page_id;
  const afterTokenPresent = typeof after?.credentials?.access_token === "string" && after.credentials.access_token.trim().length > 0;
  console.log(`Post-check — page_id sigue siendo ${TARGET_PAGE_ID}: ${afterPageId === TARGET_PAGE_ID ? "YES" : "NO"}`);
  console.log(`Post-check — access_token PRESENT: ${afterTokenPresent ? "YES" : "NO"}`);

  // --- 5. Verificación de identidad REAL ---
  console.log("\n=== Verificación REAL de identidad (verifyFacebookPageIdentity, sin mocks) ===");
  const identity = await verifyFacebookPageIdentity(updatedCredentials as never);
  console.log(`status=${identity.status}`);
  console.log(`reason=${identity.reason}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

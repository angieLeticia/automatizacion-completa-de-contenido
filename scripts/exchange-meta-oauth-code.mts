// Fase 18 — intercambio manual y seguro: OAuth authorization code -> Meta
// access token (larga duración). Ejecución LOCAL únicamente, nunca en CI,
// nunca en GitHub Actions, nunca en el callback estático de GitHub Pages.
//
// Uso:
//   npm exec tsx scripts/exchange-meta-oauth-code.mts -- --code "EL_CODE_DE_META"
//
// Credenciales (META_APP_ID, META_APP_SECRET) se leen de un archivo EXTERNO
// al repositorio - mismo patrón ya usado para Backblaze B2
// (agent/publish/config.mts::B2_CREDENTIALS_FILE): nunca en .env.local del
// proyecto, nunca en Git. Ruta por defecto: C:\Users\angie\meta-oauth.local
// (configurable via META_OAUTH_CREDENTIALS_FILE si se prefiere otra ruta).
//
// NUNCA imprime: client_secret, access_token completo, el `code` completo, ni
// la URL completa de ninguna petición a Meta (contendría el secreto).
import { writeFileSync } from "node:fs";
import {
  exchangeCodeForShortLivedToken,
  exchangeForLongLivedToken,
  MetaOAuthHttpError,
  type MetaOAuthConfig,
} from "./metaOAuthExchange.mts";

const DEFAULT_CREDENTIALS_FILE = "C:\\Users\\angie\\meta-oauth.local";
const DEFAULT_TOKEN_OUTPUT_FILE = "C:\\Users\\angie\\meta-oauth-token.local";
const GRAPH_VERSION = "v19.0"; // misma version usada por lib/social/facebook.ts y lib/social/instagram.ts
const REDIRECT_URI = "https://angieleticia.github.io/automatizacion-completa-de-contenido/oauth/callback.html";

function parseArgs(argv: string[]): { code?: string } {
  const result: { code?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--code") {
      result.code = argv[i + 1];
      i++;
    }
  }
  return result;
}

function maskLength(value: string | undefined): string {
  return value ? `PRESENT (length=${value.length})` : "MISSING";
}

async function main(): Promise<void> {
  const credentialsFile = process.env.META_OAUTH_CREDENTIALS_FILE || DEFAULT_CREDENTIALS_FILE;
  try {
    process.loadEnvFile(credentialsFile);
  } catch {
    // Archivo ausente/ilegible - se valida explícitamente abajo (PRESENT/MISSING),
    // nunca se asume ni se inventa un valor.
  }

  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  const { code } = parseArgs(process.argv.slice(2));

  console.log(`META_APP_ID=${appId ? "PRESENT" : "MISSING"}`);
  console.log(`META_APP_SECRET=${maskLength(appSecret)}`);
  console.log(`CODE=${maskLength(code)}`);
  console.log(`REDIRECT_URI=${REDIRECT_URI}`);
  console.log(`GRAPH_VERSION=${GRAPH_VERSION}`);
  console.log(`CREDENTIALS_FILE=${credentialsFile}`);
  console.log(`TOKEN_OUTPUT_FILE=${process.env.META_OAUTH_TOKEN_OUTPUT_FILE || DEFAULT_TOKEN_OUTPUT_FILE}`);

  if (!appId || !appSecret || !code) {
    console.log("DETENIDO — falta META_APP_ID, META_APP_SECRET o --code. No se llama a Meta.");
    process.exitCode = 1;
    return;
  }

  const config: MetaOAuthConfig = { appId, appSecret, redirectUri: REDIRECT_URI, graphVersion: GRAPH_VERSION };

  console.log("\nPaso 1/2 — intercambiando code por token de corta duración...");
  let shortLived;
  try {
    shortLived = await exchangeCodeForShortLivedToken(config, code);
  } catch (err) {
    reportError(err);
    console.log("\nSi el code ya expiró o ya fue usado: NO reintentar con el mismo. Genera un `code` nuevo repitiendo el login de Meta.");
    process.exitCode = 1;
    return;
  }
  console.log(`  OK — access_token: PRESENT (length=${shortLived.access_token.length}), token_type=${shortLived.token_type ?? "N/A"}, expires_in=${shortLived.expires_in ?? "N/A"}s`);

  console.log("\nPaso 2/2 — intercambiando por token de LARGA duración (fb_exchange_token)...");
  let longLived;
  try {
    longLived = await exchangeForLongLivedToken(config, shortLived.access_token);
  } catch (err) {
    reportError(err);
    console.log("\nEl token de CORTA duración del Paso 1 SÍ se obtuvo, pero no se persiste (por diseño solo se guarda el de larga duración). Repite el intercambio completo con un `code` nuevo.");
    process.exitCode = 1;
    return;
  }

  const tokenOutputFile = process.env.META_OAUTH_TOKEN_OUTPUT_FILE || DEFAULT_TOKEN_OUTPUT_FILE;
  const fileContent = [
    `META_LONG_LIVED_ACCESS_TOKEN=${longLived.access_token}`,
    `META_TOKEN_TYPE=long_lived_user_access_token`,
    `META_TOKEN_OBTAINED_AT=${new Date().toISOString()}`,
    `META_TOKEN_EXPIRES_IN_SECONDS=${longLived.expires_in ?? ""}`,
    "",
  ].join("\n");
  writeFileSync(tokenOutputFile, fileContent, { encoding: "utf8" });

  console.log("\nSUCCESS");
  console.log(`token: PRESENT`);
  console.log(`token_length: ${longLived.access_token.length}`);
  console.log(`token_type: long_lived_user_access_token`);
  console.log(`expires_in_seconds: ${longLived.expires_in ?? "N/A"}`);
  console.log(`Guardado en: ${tokenOutputFile}`);
  console.log("\nEste token es un User Access Token de LARGA duración (no un Page/Instagram token todavía) - sigue siendo necesario, como en pasos anteriores de este proyecto, obtener el token específico de la Página/cuenta de Instagram a partir de este (ej. GET /me/accounts), fuera del alcance de este script.");
}

function reportError(err: unknown): void {
  if (err instanceof MetaOAuthHttpError) {
    console.log(`ERROR — HTTP ${err.status}: ${err.sanitizedMessage}`);
    return;
  }
  console.log(`ERROR — ${err instanceof Error ? err.message : String(err)}`);
}

main();

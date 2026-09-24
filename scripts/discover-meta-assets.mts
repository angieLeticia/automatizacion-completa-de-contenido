// Fase 19 — herramienta LOCAL de descubrimiento de activos Meta: usa el User
// Access Token de larga duración (ya obtenido en Fase 18) para descubrir las
// Páginas de Facebook autorizadas y su Instagram Business Account asociado,
// si existe. Ejecución LOCAL únicamente. NO conecta con Agent 3, Supabase ni
// B2 - es exclusivamente de descubrimiento/auditoría.
//
// Uso:
//   npm exec tsx scripts/discover-meta-assets.mts
//
// El token se lee de C:\Users\angie\meta-oauth-token.local (mismo archivo
// externo que generó scripts/exchange-meta-oauth-code.mts en la Fase 18) -
// nunca se pide por consola, nunca se imprime.
import { writeFileSync } from "node:fs";
import { discoverAllPages, buildSafeInventory, type DiscoveredPage } from "./metaAssetDiscovery.mts";

const DEFAULT_TOKEN_FILE = "C:\\Users\\angie\\meta-oauth-token.local";
const DEFAULT_INVENTORY_FILE = "C:\\Users\\angie\\meta-assets-inventory.json";
const GRAPH_VERSION = "v19.0"; // misma version que el resto del proyecto (lib/social/facebook.ts, lib/social/instagram.ts, scripts/exchange-meta-oauth-code.mts) - no se cambia sin necesidad

async function main(): Promise<void> {
  const tokenFile = process.env.META_OAUTH_TOKEN_OUTPUT_FILE || DEFAULT_TOKEN_FILE;
  try {
    process.loadEnvFile(tokenFile);
  } catch {
    // Archivo ausente/ilegible - se valida explícitamente abajo (PRESENT/MISSING).
  }

  const userAccessToken = process.env.META_LONG_LIVED_ACCESS_TOKEN;

  console.log("=== META ASSET DISCOVERY ===");
  console.log(`Graph API: ${GRAPH_VERSION}`);
  console.log(`User Access Token: ${userAccessToken ? `PRESENT (length=${userAccessToken.length})` : "MISSING"}`);

  if (!userAccessToken) {
    console.log(`DETENIDO — no se encontró META_LONG_LIVED_ACCESS_TOKEN en '${tokenFile}'. Genera el token primero (Fase 18: scripts/exchange-meta-oauth-code.mts).`);
    process.exitCode = 1;
    return;
  }

  // Field expansion en UNA sola llamada: pide, para cada Página, su
  // access_token (Page Access Token) Y su instagram_business_account
  // (id/username/name) sin necesitar una segunda llamada por Página. Patrón
  // oficial y estable de Graph API, sin dependencia de una version concreta
  // más allá de v19.0 ya en uso.
  const fields = "id,name,access_token,instagram_business_account{id,username,name}";
  const initialUrl = `https://graph.facebook.com/${GRAPH_VERSION}/me/accounts?fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(userAccessToken)}`;

  let result;
  try {
    result = await discoverAllPages(initialUrl);
  } catch (err) {
    console.log(`ERROR — fallo inesperado durante el descubrimiento: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
    return;
  }

  console.log(`Páginas encontradas: ${result.pages.length}`);

  result.pages.forEach((page: DiscoveredPage, idx: number) => {
    console.log(`\n--- Página ${idx + 1} ---`);
    console.log(`Name: ${page.name}`);
    console.log(`Page ID: ${page.id}`);
    console.log(`Page Access Token: ${page.pageAccessTokenPresent ? `PRESENT (length=${page.pageAccessTokenLength})` : "MISSING"}`);
    if (page.instagram) {
      console.log(`Instagram Business Account: PRESENT`);
      console.log(`Instagram User ID: ${page.instagram.id}`);
      console.log(`Instagram Name: ${page.instagram.username ?? page.instagram.name ?? "(sin username/name disponible)"}`);
    } else if (page.instagramError) {
      console.log(`Instagram Business Account: ERROR (${page.instagramError})`);
    } else {
      console.log(`Instagram Business Account: ABSENT (esta Página no tiene una cuenta de Instagram vinculada)`);
    }
  });

  if (result.warnings.length > 0) {
    console.log(`\n--- Advertencias del descubrimiento (${result.warnings.length}) ---`);
    for (const w of result.warnings) console.log(`  - ${w}`);
  }

  const inventoryFile = process.env.META_ASSETS_INVENTORY_FILE || DEFAULT_INVENTORY_FILE;
  const inventory = buildSafeInventory(result.pages, result.warnings, GRAPH_VERSION);
  writeFileSync(inventoryFile, JSON.stringify(inventory, null, 2), { encoding: "utf8" });

  console.log(`\nInventario seguro (sin tokens) escrito en: ${inventoryFile}`);
  console.log(`Páginas con Instagram asociado: ${inventory.pages_with_instagram} de ${inventory.pages_found}`);
}

main();

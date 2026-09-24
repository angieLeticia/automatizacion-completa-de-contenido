// Fase 19 — pruebas del descubrimiento de activos Meta. Sin red real, sin
// credenciales reales, SIN llamar nunca a Meta. Mismo patrón stubFetch ya
// usado en test-exchange-meta-oauth-code.mts.
import { writeFileSync, unlinkSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  parsePageNode,
  fetchAccountsPage,
  discoverAllPages,
  buildSafeInventory,
  MetaGraphHttpError,
} from "./metaAssetDiscovery.mts";

let failures = 0;
const check = (label: string, cond: boolean, extra = "") => {
  const mark = cond ? "PASS" : "FAIL";
  if (!cond) failures++;
  console.log(`[${mark}] ${label}${extra ? " — " + extra : ""}`);
};

type FetchHandler = (url: string, init?: RequestInit) => Promise<Response> | Response;
function stubFetch(handler: FetchHandler): typeof fetch {
  return (async (url: unknown, init?: RequestInit) => handler(String(url), init)) as typeof fetch;
}

function captureLogs(fn: () => Promise<void>): Promise<{ lines: string[] }> {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  return fn()
    .then(() => ({ lines }))
    .finally(() => {
      console.log = original;
    });
}

const FAKE_USER_TOKEN = "user-token-de-prueba-nunca-real-1234567890";
const FAKE_PAGE_TOKEN_1 = "page-token-de-prueba-nunca-real-abcdefghijk";
const FAKE_PAGE_TOKEN_2 = "page-token-de-prueba-nunca-real-zyxwvutsrqp";

async function main() {
  // ==================================================
  // 1. Lectura del token externo (mismo patrón process.loadEnvFile ya usado
  // en Fase 18 - se prueba aislado, sin importar el script CLI que se
  // autoejecuta)
  // ==================================================
  const tmpTokenFile = path.join(tmpdir(), `test-meta-token-${Date.now()}.local`);
  writeFileSync(tmpTokenFile, `META_LONG_LIVED_ACCESS_TOKEN=${FAKE_USER_TOKEN}\nMETA_TOKEN_TYPE=long_lived_user_access_token\n`, "utf8");
  try {
    const before = process.env.META_LONG_LIVED_ACCESS_TOKEN;
    delete process.env.META_LONG_LIVED_ACCESS_TOKEN;
    process.loadEnvFile(tmpTokenFile);
    check("1a. process.loadEnvFile() carga META_LONG_LIVED_ACCESS_TOKEN desde el archivo externo", process.env.META_LONG_LIVED_ACCESS_TOKEN === FAKE_USER_TOKEN);
    delete process.env.META_LONG_LIVED_ACCESS_TOKEN;
    if (before) process.env.META_LONG_LIVED_ACCESS_TOKEN = before;
  } finally {
    unlinkSync(tmpTokenFile);
  }
  let threwOnMissingFile = false;
  try {
    process.loadEnvFile(path.join(tmpdir(), `no-existe-${Date.now()}.local`));
  } catch {
    threwOnMissingFile = true;
  }
  check("1b. Archivo de token ausente -> process.loadEnvFile lanza (el script lo captura y reporta MISSING, no asume nada)", threwOnMissingFile);

  // ==================================================
  // 4/5. parsePageNode() — página CON y SIN Instagram
  // ==================================================
  const withIg = parsePageNode({
    id: "1111111111",
    name: "Página con Instagram",
    access_token: FAKE_PAGE_TOKEN_1,
    instagram_business_account: { id: "17841400000000123", username: "cuenta_ig_real" },
  });
  check("5a. Página CON Instagram -> ok=true", withIg.ok === true);
  if (withIg.ok) {
    check("5b. instagram.id correcto", withIg.page.instagram?.id === "17841400000000123");
    check("5c. instagram.username correcto", withIg.page.instagram?.username === "cuenta_ig_real");
    check("5d. pageAccessTokenPresent=true, pero el VALOR real nunca queda en el objeto devuelto", withIg.page.pageAccessTokenPresent === true && !("access_token" in withIg.page));
    check("5e. pageAccessTokenLength coincide con la longitud real (para reportar, nunca el valor)", withIg.page.pageAccessTokenLength === FAKE_PAGE_TOKEN_1.length);
  }

  const withoutIg = parsePageNode({
    id: "2222222222",
    name: "Página sin Instagram",
    access_token: FAKE_PAGE_TOKEN_2,
    // instagram_business_account ausente por completo - caso real de una Página sin vincular
  });
  check("4a. Página SIN Instagram -> ok=true, instagram=null, instagramError=null", withoutIg.ok === true && (withoutIg as any).page.instagram === null && (withoutIg as any).page.instagramError === null);

  // ==================================================
  // 6. Página con ERROR en instagram_business_account (permiso insuficiente,
  // caso real documentado de Meta) - no debe descartar la página completa
  // ==================================================
  const withIgError = parsePageNode({
    id: "3333333333",
    name: "Página con error de Instagram",
    access_token: FAKE_PAGE_TOKEN_2,
    instagram_business_account: { error: { message: "(#100) Tried accessing nonexisting field (instagram_business_account)", type: "OAuthException" } },
  });
  check("6a. Página con error en instagram_business_account -> ok=true (NO se descarta toda la página)", withIgError.ok === true);
  if (withIgError.ok) {
    check("6b. instagram=null, instagramError contiene el mensaje saneado de Meta", withIgError.page.instagram === null && (withIgError.page.instagramError ?? "").includes("nonexisting field"));
  }

  // Nodo sin id/name utilizable -> se omite explícitamente (no crashea)
  const malformed = parsePageNode({ name: "Sin ID" } as any);
  check("6c. Nodo sin 'id' utilizable -> ok=false, reason explicado, no lanza", malformed.ok === false);

  // ==================================================
  // 2. fetchAccountsPage() — respuesta real de /me/accounts (una sola pagina)
  // ==================================================
  await (async () => {
    let calledUrl = "";
    const result = await fetchAccountsPage(
      "https://graph.facebook.com/v19.0/me/accounts?fields=id,name,access_token,instagram_business_account%7Bid%2Cusername%2Cname%7D&access_token=" + FAKE_USER_TOKEN,
      stubFetch((url) => {
        calledUrl = url;
        return new Response(
          JSON.stringify({
            data: [
              { id: "1111111111", name: "Página con Instagram", access_token: FAKE_PAGE_TOKEN_1, instagram_business_account: { id: "17841400000000123", username: "cuenta_ig_real" } },
            ],
            paging: {},
          }),
          { status: 200 }
        );
      })
    );
    check("2a. fetchAccountsPage devuelve 1 página en 'data'", result.pages.length === 1);
    check("2b. Sin paging.next -> nextUrl=null (fin de la paginación)", result.nextUrl === null);
    check("2c. La URL llamada apunta al endpoint correcto /me/accounts", calledUrl.includes("/me/accounts"));
  })();

  // ==================================================
  // 3. Paginación real — paging.next presente, seguir hasta agotarla
  // ==================================================
  await (async () => {
    let callCount = 0;
    const result = await discoverAllPages(
      "https://graph.facebook.com/v19.0/me/accounts?fields=x&access_token=" + FAKE_USER_TOKEN,
      stubFetch(() => {
        callCount++;
        if (callCount === 1) {
          return new Response(
            JSON.stringify({
              data: [{ id: "AAA", name: "Página A", access_token: FAKE_PAGE_TOKEN_1 }],
              paging: { next: "https://graph.facebook.com/v19.0/me/accounts?fields=x&access_token=" + FAKE_USER_TOKEN + "&after=CURSOR1" },
            }),
            { status: 200 }
          );
        }
        if (callCount === 2) {
          return new Response(
            JSON.stringify({
              data: [{ id: "BBB", name: "Página B", access_token: FAKE_PAGE_TOKEN_2, instagram_business_account: { id: "17841400000000999", username: "otra_cuenta" } }],
              paging: {}, // sin next -> fin
            }),
            { status: 200 }
          );
        }
        throw new Error("no debería llamarse una tercera vez - la paginación ya terminó en la segunda respuesta");
      })
    );
    check("3a. Paginación real: se siguieron AMBAS páginas (2 llamadas HTTP)", callCount === 2);
    check("3b. Se recolectaron las páginas de AMBAS llamadas (A y B)", result.pages.length === 2 && result.pages[0].id === "AAA" && result.pages[1].id === "BBB");
    check("3c. La segunda página (con Instagram) se parseó correctamente dentro de la paginación", result.pages[1].instagram?.id === "17841400000000999");
  })();

  // Límite de seguridad contra bucle infinito
  await (async () => {
    let callCount = 0;
    const result = await discoverAllPages(
      "https://graph.facebook.com/v19.0/me/accounts?fields=x&access_token=" + FAKE_USER_TOKEN,
      stubFetch(() => {
        callCount++;
        return new Response(JSON.stringify({ data: [{ id: `P${callCount}`, name: `Página ${callCount}`, access_token: "t" }], paging: { next: "https://graph.facebook.com/v19.0/me/accounts?fields=x&access_token=x&after=SIEMPRE_HAY_MAS" } }), { status: 200 });
      }),
      5 // maxIterations bajo para la prueba
    );
    check("3d. Límite de seguridad de paginación: se detiene en maxIterations, nunca en un bucle infinito", callCount === 5);
    check("3e. Se registra una advertencia explícita del límite alcanzado", result.warnings.some((w) => w.includes("límite de seguridad")));
  })();

  // ==================================================
  // 6b. Error HTTP en la petición completa (no en un campo individual) -
  // detiene la paginación PERO preserva lo ya descubierto
  // ==================================================
  await (async () => {
    let callCount = 0;
    const result = await discoverAllPages(
      "https://graph.facebook.com/v19.0/me/accounts?fields=x&access_token=" + FAKE_USER_TOKEN,
      stubFetch(() => {
        callCount++;
        if (callCount === 1) {
          return new Response(
            JSON.stringify({ data: [{ id: "AAA", name: "Página A", access_token: FAKE_PAGE_TOKEN_1 }], paging: { next: "https://graph.facebook.com/v19.0/me/accounts?fields=x&access_token=x&after=C2" } }),
            { status: 200 }
          );
        }
        return new Response(JSON.stringify({ error: { message: "Error validating access token.", type: "OAuthException" } }), { status: 401 });
      })
    );
    check("6d. Fallo HTTP en la 2da página -> NO se pierde lo ya descubierto en la 1ra (progreso parcial preservado)", result.pages.length === 1 && result.pages[0].id === "AAA");
    check("6e. Se registra una advertencia clara del fallo, con el status HTTP", result.warnings.some((w) => w.includes("401")));
  })();

  // fetchAccountsPage lanza MetaGraphHttpError tipado en un fallo HTTP directo
  await (async () => {
    let threw = false;
    let status = 0;
    try {
      await fetchAccountsPage("https://graph.facebook.com/v19.0/me/accounts?fields=x&access_token=x", stubFetch(() => new Response(JSON.stringify({ error: { message: "Invalid OAuth access token.", type: "OAuthException" } }), { status: 400 })));
    } catch (err) {
      threw = true;
      if (err instanceof MetaGraphHttpError) status = err.status;
    }
    check("6f. fetchAccountsPage lanza MetaGraphHttpError tipado (no un objeto genérico) en HTTP 400", threw && status === 400);
  })();

  // ==================================================
  // 7. AUDITORÍA DE LOGS — ningún token completo debe aparecer jamás, en
  // ningún escenario (éxito, error, con/sin Instagram)
  // ==================================================
  const { lines } = await captureLogs(async () => {
    const discoverResult = await discoverAllPages(
      "https://graph.facebook.com/v19.0/me/accounts?fields=x&access_token=" + FAKE_USER_TOKEN,
      stubFetch(() =>
        new Response(
          JSON.stringify({
            data: [
              { id: "1111111111", name: "Página con Instagram", access_token: FAKE_PAGE_TOKEN_1, instagram_business_account: { id: "17841400000000123", username: "cuenta_ig_real" } },
              { id: "2222222222", name: "Página sin Instagram", access_token: FAKE_PAGE_TOKEN_2 },
            ],
            paging: {},
          }),
          { status: 200 }
        )
      )
    );
    for (const page of discoverResult.pages) {
      console.log(`Page ID: ${page.id}`);
      console.log(`Page Access Token: ${page.pageAccessTokenPresent ? `PRESENT (length=${page.pageAccessTokenLength})` : "MISSING"}`);
      if (page.instagram) console.log(`Instagram User ID: ${page.instagram.id}`);
    }
  });
  const output = lines.join("\n");
  check("7a. El User Access Token JAMÁS aparece completo en los logs", !output.includes(FAKE_USER_TOKEN));
  check("7b. El Page Access Token #1 JAMÁS aparece completo en los logs", !output.includes(FAKE_PAGE_TOKEN_1));
  check("7c. El Page Access Token #2 JAMÁS aparece completo en los logs", !output.includes(FAKE_PAGE_TOKEN_2));
  check("7d. Los logs SÍ contienen información útil (Page ID, PRESENT/length)", output.includes("1111111111") && output.includes("PRESENT"));

  // ==================================================
  // 8. Generación del inventario seguro — nunca debe contener tokens
  // ==================================================
  const discoveredPages = [
    { id: "1111111111", name: "Página con Instagram", pageAccessTokenPresent: true, pageAccessTokenLength: FAKE_PAGE_TOKEN_1.length, instagram: { id: "17841400000000123", username: "cuenta_ig_real" }, instagramError: null },
    { id: "2222222222", name: "Página sin Instagram", pageAccessTokenPresent: true, pageAccessTokenLength: FAKE_PAGE_TOKEN_2.length, instagram: null, instagramError: null },
  ];
  const inventory = buildSafeInventory(discoveredPages, [], "v19.0", new Date("2026-09-15T20:00:00.000Z"));
  check("8a. pages_found correcto", inventory.pages_found === 2);
  check("8b. pages_with_instagram correcto (solo cuenta la que SÍ tiene instagram)", inventory.pages_with_instagram === 1);
  check("8c. graph_api_version correcto", inventory.graph_api_version === "v19.0");
  check("8d. generated_at es un ISO string derivado de la fecha inyectada (determinista, no Date.now() real)", inventory.generated_at === "2026-09-15T20:00:00.000Z");
  check("8e. La página con Instagram tiene instagram_status=PRESENT", inventory.pages[0].instagram_status === "PRESENT");
  check("8f. La página sin Instagram tiene instagram_status=ABSENT", inventory.pages[1].instagram_status === "ABSENT");

  // Nota: el propio esquema del inventario usa el nombre de campo
  // "page_access_token_status" (que contiene la subcadena "access_token" en
  // su NOMBRE) - eso es correcto y esperado, describe únicamente un estado
  // (PRESENT/MISSING), nunca un valor. Lo que se audita aquí es que ningún
  // VALOR real de token aparezca en ninguna parte del JSON.
  const inventoryJson = JSON.stringify(inventory);
  check("8g. El JSON del inventario NUNCA contiene ningún valor real de token de prueba", !inventoryJson.includes(FAKE_PAGE_TOKEN_1) && !inventoryJson.includes(FAKE_PAGE_TOKEN_2) && !inventoryJson.includes(FAKE_USER_TOKEN));

  // Escritura real a un archivo temporal (fuera del repo) y relectura, para
  // confirmar que el contenido persistido en disco tampoco contiene tokens.
  const tmpInventoryFile = path.join(tmpdir(), `test-meta-inventory-${Date.now()}.json`);
  writeFileSync(tmpInventoryFile, JSON.stringify(inventory, null, 2), "utf8");
  try {
    check("8h. El archivo escrito en disco existe", existsSync(tmpInventoryFile));
    const onDisk = readFileSync(tmpInventoryFile, "utf8");
    check("8i. El archivo en disco NUNCA contiene ningún token de prueba", !onDisk.includes(FAKE_PAGE_TOKEN_1) && !onDisk.includes(FAKE_PAGE_TOKEN_2) && !onDisk.includes(FAKE_USER_TOKEN));
  } finally {
    unlinkSync(tmpInventoryFile);
  }

  console.log(`\n${failures === 0 ? "TODOS LOS CASOS PASARON" : `${failures} CASO(S) FALLARON`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main();

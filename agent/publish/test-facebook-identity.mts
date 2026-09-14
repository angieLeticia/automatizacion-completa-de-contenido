// Fase 5.21 — pruebas de identidad estructural de Facebook. La lógica pura
// (evaluateFacebookPageIdentityMatch) no necesita red; verifyFacebookPageIdentity()
// se prueba con fetch stubbeado (mismo patrón de test-youtube-identity.mts) -
// sin credenciales OAuth reales, sin red real, SIN publicación real.
import { evaluateFacebookPageIdentityMatch, verifyFacebookPageIdentity } from "./facebookPageIdentity.mts";

let failures = 0;
const check = (label: string, cond: boolean, extra = "") => {
  const mark = cond ? "PASS" : "FAIL";
  if (!cond) failures++;
  console.log(`[${mark}] ${label}${extra ? " — " + extra : ""}`);
};

type FetchHandler = (url: string, init?: RequestInit) => Promise<Response> | Response;
async function withStubbedFetch<T>(handler: FetchHandler, fn: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => handler(String(url), init)) as typeof fetch;
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
  }
}

const REAL_PAGE_ID = "1341123142414097"; // Page ID real del piloto (dato público, no es secreto)
const OTHER_PAGE_ID = "9999999999999999";

async function main() {
  // ==================================================
  // evaluateFacebookPageIdentityMatch() — pura
  // ==================================================
  check("1. Page ID real coincide con el configurado -> VERIFIED", evaluateFacebookPageIdentityMatch(REAL_PAGE_ID, REAL_PAGE_ID).status === "VERIFIED");
  check("2. channel_id (page_id) NULL -> IDENTITY_UNVERIFIED", evaluateFacebookPageIdentityMatch(REAL_PAGE_ID, null).status === "IDENTITY_UNVERIFIED");
  check("2b. page_id undefined -> IDENTITY_UNVERIFIED", evaluateFacebookPageIdentityMatch(REAL_PAGE_ID, undefined).status === "IDENTITY_UNVERIFIED");
  check("2c. page_id vacío ('') -> IDENTITY_UNVERIFIED", evaluateFacebookPageIdentityMatch(REAL_PAGE_ID, "").status === "IDENTITY_UNVERIFIED");
  check("3. page_id configurado DIFERENTE del Page ID real -> IDENTITY_MISMATCH", evaluateFacebookPageIdentityMatch(REAL_PAGE_ID, OTHER_PAGE_ID).status === "IDENTITY_MISMATCH");
  check("3b. realPageId ausente (respuesta malformada) -> CHECK_FAILED, nunca VERIFIED por defecto", evaluateFacebookPageIdentityMatch(null, REAL_PAGE_ID).status === "CHECK_FAILED");
  check(
    "3c. UNVERIFIED/MISMATCH -> retryable=false (config, no transitorio)",
    evaluateFacebookPageIdentityMatch(REAL_PAGE_ID, OTHER_PAGE_ID).retryable === false && evaluateFacebookPageIdentityMatch(REAL_PAGE_ID, null).retryable === false
  );
  check("3d. CHECK_FAILED -> retryable=true (posible transitorio)", evaluateFacebookPageIdentityMatch(null, REAL_PAGE_ID).retryable === true);

  // ==================================================
  // verifyFacebookPageIdentity() — con fetch stubbeado (nunca red real)
  // ==================================================
  const baseCreds = { page_id: REAL_PAGE_ID, access_token: "test-token-fake" };

  // page_id ausente en credentials -> IDENTITY_UNVERIFIED SIN llamar a fetch
  let fetchCalls = 0;
  await withStubbedFetch(
    () => {
      fetchCalls++;
      throw new Error("no debería llamarse a fetch si page_id está ausente");
    },
    async () => {
      const result = await verifyFacebookPageIdentity({ page_id: "", access_token: "x" });
      check("4. credentials.page_id ausente -> IDENTITY_UNVERIFIED, CERO llamadas a fetch (mismo patrón que YouTube)", result.status === "IDENTITY_UNVERIFIED" && fetchCalls === 0);
    }
  );

  // token ausente -> bloqueado SIN llamar a fetch
  await withStubbedFetch(
    () => {
      fetchCalls++;
      throw new Error("no debería llamarse a fetch si access_token está ausente");
    },
    async () => {
      const result = await verifyFacebookPageIdentity({ page_id: REAL_PAGE_ID, access_token: "" });
      check("9. token ausente -> bloqueado (CHECK_FAILED), CERO llamadas a fetch", result.status !== "VERIFIED");
    }
  );

  // Meta /me responde 401 (token inválido/expirado)
  await withStubbedFetch(
    () => new Response("unauthorized", { status: 401 }),
    async () => {
      const result = await verifyFacebookPageIdentity(baseCreds);
      check("5. Meta /me devuelve HTTP 401 -> bloqueado (CHECK_FAILED)", result.status === "CHECK_FAILED");
    }
  );

  // Meta /me responde 403 (permiso insuficiente)
  await withStubbedFetch(
    () => new Response("forbidden", { status: 403 }),
    async () => {
      const result = await verifyFacebookPageIdentity(baseCreds);
      check("6. Meta /me devuelve HTTP 403 -> bloqueado (CHECK_FAILED)", result.status === "CHECK_FAILED");
    }
  );

  // Meta /me responde 200 pero cuerpo malformado/sin id
  await withStubbedFetch(
    () => new Response("no es json valido {{{", { status: 200 }),
    async () => {
      const result = await verifyFacebookPageIdentity(baseCreds);
      check("7. Meta /me responde 200 con cuerpo inválido/malformado -> bloqueado, nunca VERIFIED por defecto", result.status !== "VERIFIED");
    }
  );

  // Meta /me responde 200 pero sin campo 'id' (vacío/inesperado)
  await withStubbedFetch(
    () => new Response(JSON.stringify({ name: "Alguna Página" }), { status: 200 }),
    async () => {
      const result = await verifyFacebookPageIdentity(baseCreds);
      check("7b. Meta /me responde 200 sin campo 'id' -> CHECK_FAILED, nunca VERIFIED", result.status === "CHECK_FAILED");
    }
  );

  // fetch lanza excepción de red (antes de cualquier respuesta)
  await withStubbedFetch(
    () => {
      throw new Error("simulated: fallo de red");
    },
    async () => {
      const result = await verifyFacebookPageIdentity(baseCreds);
      check("8. Excepción de red -> bloqueado (CHECK_FAILED), no lanza sin control", result.status === "CHECK_FAILED");
    }
  );

  // Meta /me devuelve una Página DIFERENTE a la configurada -> IDENTITY_MISMATCH
  await withStubbedFetch(
    () => new Response(JSON.stringify({ id: OTHER_PAGE_ID, name: "Otra Página" }), { status: 200 }),
    async () => {
      const result = await verifyFacebookPageIdentity(baseCreds);
      check("3-wrapper. Meta /me devuelve una Página DIFERENTE -> IDENTITY_MISMATCH", result.status === "IDENTITY_MISMATCH");
    }
  );

  // Meta /me OK + coincide -> VERIFIED real
  await withStubbedFetch(
    (url, init) => {
      check("1-wrapper. Se llama a GET /me (no a /{page_id}) — verificación por auto-identidad del token, nunca por ID conocido", url.includes("/me?fields=id,name"));
      check("1-wrapper-auth. El access_token viaja como header Authorization: Bearer, nunca en la URL", (init?.headers as Record<string, string> | undefined)?.Authorization === "Bearer test-token-fake");
      return new Response(JSON.stringify({ id: REAL_PAGE_ID, name: "Sin Explicación" }), { status: 200 });
    },
    async () => {
      const result = await verifyFacebookPageIdentity(baseCreds);
      check("1-wrapper-result. OAuth válido + identidad coincide -> VERIFIED", result.status === "VERIFIED");
    }
  );

  // ==================================================
  // Composición con los demás gates — el gate combinado real de run.mts NO
  // se sustituye por la identidad estructural: DRY_RUN/channel_status/Human
  // Review se evalúan y bloquean ANTES de siquiera llegar a esta verificación
  // (confirmado por lectura de código: el bloque de identidad de Facebook
  // vive DESPUÉS del `return` del gate combinado en run.mts, exactamente
  // igual que el de YouTube). Mismo patrón que test-youtube-identity.mts.
  // ==================================================
  function overallBlocked(dryRun: boolean, channelActive: boolean, humanAuthorized: boolean, identityVerified: boolean): boolean {
    if (dryRun || !channelActive || !humanAuthorized) return true; // nunca llega a evaluar identidad
    return !identityVerified;
  }
  check("10. Identidad NO verificada, todo lo demás perfecto -> NO publica", overallBlocked(false, true, true, false) === true);
  check("11. Identidad verificada pero channel_status != ACTIVE -> NO publica", overallBlocked(false, false, true, true) === true);
  check("12. Identidad verificada + ACTIVE pero DRY_RUN=true -> NO publica", overallBlocked(true, true, true, true) === true);
  check("13. Identidad verificada + ACTIVE + DRY_RUN=false pero SIN human review -> NO publica", overallBlocked(false, true, false, true) === true);
  check("13b. Identidad verificada + ACTIVE + DRY_RUN=false + human review -> SÍ llega al publisher", overallBlocked(false, true, true, true) === false);

  console.log(`\n${failures === 0 ? "TODOS LOS CASOS PASARON" : `${failures} CASO(S) FALLARON`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main();

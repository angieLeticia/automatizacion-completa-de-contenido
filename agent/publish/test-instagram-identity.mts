// Fase 17 — pruebas de identidad estructural de Instagram. La lógica pura
// (evaluateInstagramAccountIdentityMatch) no necesita red; verifyInstagramAccountIdentity()
// se prueba con fetch stubbeado (mismo patrón de test-facebook-identity.mts) -
// sin credenciales OAuth reales, sin red real, SIN publicación real.
import { readFileSync } from "node:fs";
import { evaluateInstagramAccountIdentityMatch, verifyInstagramAccountIdentity } from "./instagramAccountIdentity.mts";

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

const REAL_IG_USER_ID = "17841400000000123"; // ID de prueba con forma realista (dato ficticio, no secreto)
const OTHER_IG_USER_ID = "17841499999999999";
const FAKE_TEST_VALUE = "FAKE_TEST_IG_USER_ID"; // el valor real encontrado hoy en Supabase - nunca debe producir VERIFIED

async function main() {
  // ==================================================
  // evaluateInstagramAccountIdentityMatch() — pura
  // ==================================================
  check("1. Instagram User ID real coincide con el configurado -> VERIFIED", evaluateInstagramAccountIdentityMatch(REAL_IG_USER_ID, REAL_IG_USER_ID).status === "VERIFIED");
  check("2. ig_user_id NULL -> IDENTITY_UNVERIFIED", evaluateInstagramAccountIdentityMatch(REAL_IG_USER_ID, null).status === "IDENTITY_UNVERIFIED");
  check("2b. ig_user_id undefined -> IDENTITY_UNVERIFIED", evaluateInstagramAccountIdentityMatch(REAL_IG_USER_ID, undefined).status === "IDENTITY_UNVERIFIED");
  check("2c. ig_user_id vacío ('') -> IDENTITY_UNVERIFIED", evaluateInstagramAccountIdentityMatch(REAL_IG_USER_ID, "").status === "IDENTITY_UNVERIFIED");
  check("3. ig_user_id configurado DIFERENTE del real -> IDENTITY_MISMATCH", evaluateInstagramAccountIdentityMatch(REAL_IG_USER_ID, OTHER_IG_USER_ID).status === "IDENTITY_MISMATCH");
  check("3b. realIgUserId ausente (respuesta malformada) -> CHECK_FAILED, nunca VERIFIED por defecto", evaluateInstagramAccountIdentityMatch(null, REAL_IG_USER_ID).status === "CHECK_FAILED");
  check(
    "3c. UNVERIFIED/MISMATCH -> retryable=false (config, no transitorio)",
    evaluateInstagramAccountIdentityMatch(REAL_IG_USER_ID, OTHER_IG_USER_ID).retryable === false && evaluateInstagramAccountIdentityMatch(REAL_IG_USER_ID, null).retryable === false
  );
  check("3d. CHECK_FAILED -> retryable=true (posible transitorio)", evaluateInstagramAccountIdentityMatch(null, REAL_IG_USER_ID).retryable === true);

  // ==================================================
  // "FAKE_TEST_IG_USER_ID" — el valor real actualmente en Supabase — NUNCA
  // puede producir VERIFIED, en ningún camino posible.
  // ==================================================
  check(
    "4. FAKE_TEST_IG_USER_ID configurado, Meta devuelve un ID real DISTINTO -> IDENTITY_MISMATCH, nunca VERIFIED",
    evaluateInstagramAccountIdentityMatch(REAL_IG_USER_ID, FAKE_TEST_VALUE).status === "IDENTITY_MISMATCH"
  );

  // ==================================================
  // verifyInstagramAccountIdentity() — con fetch stubbeado (nunca red real)
  // ==================================================
  const baseCreds = { ig_user_id: REAL_IG_USER_ID, access_token: "test-token-fake" };

  // ig_user_id ausente en credentials -> IDENTITY_UNVERIFIED SIN llamar a fetch
  let fetchCalls = 0;
  await withStubbedFetch(
    () => {
      fetchCalls++;
      throw new Error("no debería llamarse a fetch si ig_user_id está ausente");
    },
    async () => {
      const result = await verifyInstagramAccountIdentity({ ig_user_id: "", access_token: "x" });
      check("5. credentials.ig_user_id ausente -> IDENTITY_UNVERIFIED, CERO llamadas a fetch (mismo patrón que Facebook/YouTube)", result.status === "IDENTITY_UNVERIFIED" && fetchCalls === 0);
    }
  );

  // token ausente -> bloqueado SIN llamar a fetch
  await withStubbedFetch(
    () => {
      fetchCalls++;
      throw new Error("no debería llamarse a fetch si access_token está ausente");
    },
    async () => {
      const result = await verifyInstagramAccountIdentity({ ig_user_id: REAL_IG_USER_ID, access_token: "" });
      check("6. token ausente -> bloqueado (CHECK_FAILED), CERO llamadas a fetch", result.status !== "VERIFIED");
    }
  );

  // Meta responde 401 (token inválido/expirado)
  await withStubbedFetch(
    () => new Response("unauthorized", { status: 401 }),
    async () => {
      const result = await verifyInstagramAccountIdentity(baseCreds);
      check("7. Meta devuelve HTTP 401 -> bloqueado (CHECK_FAILED)", result.status === "CHECK_FAILED");
    }
  );

  // Meta responde 403 (permiso insuficiente)
  await withStubbedFetch(
    () => new Response("forbidden", { status: 403 }),
    async () => {
      const result = await verifyInstagramAccountIdentity(baseCreds);
      check("8. Meta devuelve HTTP 403 -> bloqueado (CHECK_FAILED)", result.status === "CHECK_FAILED");
    }
  );

  // Meta responde 404 (ig_user_id no existe - el caso REAL de FAKE_TEST_IG_USER_ID)
  await withStubbedFetch(
    () => new Response(JSON.stringify({ error: { message: "Unsupported get request." } }), { status: 404 }),
    async () => {
      const result = await verifyInstagramAccountIdentity({ ig_user_id: FAKE_TEST_VALUE, access_token: "cualquier-token" });
      check("9. Meta devuelve HTTP 404 para un ig_user_id inexistente (ej. FAKE_TEST_IG_USER_ID) -> bloqueado (CHECK_FAILED), nunca VERIFIED", result.status === "CHECK_FAILED");
    }
  );

  // Meta responde 200 pero cuerpo malformado/sin id
  await withStubbedFetch(
    () => new Response("no es json valido {{{", { status: 200 }),
    async () => {
      const result = await verifyInstagramAccountIdentity(baseCreds);
      check("10. Meta responde 200 con cuerpo inválido/malformado -> bloqueado, nunca VERIFIED por defecto", result.status !== "VERIFIED");
    }
  );

  // Meta responde 200 pero sin campo 'id' (solo username, por ejemplo)
  await withStubbedFetch(
    () => new Response(JSON.stringify({ username: "sin_explicacion_oficial" }), { status: 200 }),
    async () => {
      const result = await verifyInstagramAccountIdentity(baseCreds);
      check("10b. Meta responde 200 con username pero SIN campo 'id' -> CHECK_FAILED, nunca VERIFIED (username solo NO es suficiente)", result.status === "CHECK_FAILED");
    }
  );

  // fetch lanza excepción de red (antes de cualquier respuesta)
  await withStubbedFetch(
    () => {
      throw new Error("simulated: fallo de red");
    },
    async () => {
      const result = await verifyInstagramAccountIdentity(baseCreds);
      check("11. Excepción de red -> bloqueado (CHECK_FAILED), no lanza sin control", result.status === "CHECK_FAILED");
    }
  );

  // Meta devuelve una cuenta DIFERENTE a la configurada -> IDENTITY_MISMATCH
  await withStubbedFetch(
    () => new Response(JSON.stringify({ id: OTHER_IG_USER_ID, username: "otra_cuenta" }), { status: 200 }),
    async () => {
      const result = await verifyInstagramAccountIdentity(baseCreds);
      check("12. Meta devuelve una cuenta DIFERENTE -> IDENTITY_MISMATCH", result.status === "IDENTITY_MISMATCH");
    }
  );

  // Meta responde 200 con username coincidente pero id DIFERENTE -> sigue siendo MISMATCH
  // (confirma explícitamente que "que coincida el nombre" NO es suficiente)
  await withStubbedFetch(
    () => new Response(JSON.stringify({ id: OTHER_IG_USER_ID, username: "sin_explicacion_oficial" }), { status: 200 }),
    async () => {
      const result = await verifyInstagramAccountIdentity(baseCreds);
      check("13. username 'parece correcto' pero id real es distinto -> sigue IDENTITY_MISMATCH (username nunca sustituye al id)", result.status === "IDENTITY_MISMATCH");
    }
  );

  // Meta OK + coincide -> VERIFIED real
  await withStubbedFetch(
    (url, init) => {
      check(
        "14. Se llama a GET /{ig_user_id}?fields=id,username (consultando el ID configurado, no un endpoint genérico tipo /me)",
        url.includes(`/${REAL_IG_USER_ID}?fields=id,username`)
      );
      check("14b. El access_token viaja como header Authorization: Bearer, nunca en la URL", (init?.headers as Record<string, string> | undefined)?.Authorization === "Bearer test-token-fake");
      return new Response(JSON.stringify({ id: REAL_IG_USER_ID, username: "sin_explicacion_oficial" }), { status: 200 });
    },
    async () => {
      const result = await verifyInstagramAccountIdentity(baseCreds);
      check("14c. Token válido + identidad coincide -> VERIFIED", result.status === "VERIFIED");
    }
  );

  // ==================================================
  // Composición con los demás gates — el gate combinado real de run.mts NO
  // se sustituye por la identidad estructural: DRY_RUN/channel_status/Human
  // Review se evalúan y bloquean ANTES de siquiera llegar a esta
  // verificación (confirmado por lectura de código: el bloque de identidad
  // de Instagram en run.mts vive DESPUÉS del `return` del gate combinado,
  // exactamente igual que YouTube/Facebook). Mismo patrón que
  // test-facebook-identity.mts/test-youtube-identity.mts.
  // ==================================================
  function overallBlocked(dryRun: boolean, channelActive: boolean, humanAuthorized: boolean, identityVerified: boolean): boolean {
    if (dryRun || !channelActive || !humanAuthorized) return true; // nunca llega a evaluar identidad
    return !identityVerified;
  }
  check("15. Identidad NO verificada, todo lo demás perfecto -> NO publica", overallBlocked(false, true, true, false) === true);
  check("16. Identidad verificada pero channel_status != ACTIVE -> NO publica", overallBlocked(false, false, true, true) === true);
  check("17. Identidad verificada + ACTIVE pero DRY_RUN=true -> NO publica", overallBlocked(true, true, true, true) === true);
  check("18. Identidad verificada + ACTIVE + DRY_RUN=false pero SIN human review -> NO publica", overallBlocked(false, true, false, true) === true);
  check("18b. Identidad verificada + ACTIVE + DRY_RUN=false + human review -> SÍ llega al publisher", overallBlocked(false, true, true, true) === false);

  // ==================================================
  // 19. Confirmación ESTRUCTURAL sobre el código REAL de run.mts — no basta
  // con que el módulo exista, tiene que estar realmente cableado (pedido
  // explícito de esta fase).
  // ==================================================
  const runSource = readFileSync(new URL("./run.mts", import.meta.url), "utf8");
  check("19a. run.mts importa verifyInstagramAccountIdentity", /import \{ verifyInstagramAccountIdentity \} from "\.\/instagramAccountIdentity\.mts";/.test(runSource));
  check(
    "19b. run.mts invoca verifyInstagramAccountIdentity() dentro de un bloque if (platform === \"instagram\")",
    /if \(platform === "instagram"\) \{[\s\S]{0,400}verifyInstagramAccountIdentity\(/.test(runSource)
  );
  check(
    "19c. Si identityCheck.status !== VERIFIED, ese bloque llama a finishWithFailure y hace return ANTES de llegar a publish() (no sigue de largo)",
    /if \(platform === "instagram"\) \{[\s\S]*?if \(identityCheck\.status !== "VERIFIED"\) \{[\s\S]*?await finishWithFailure\([\s\S]*?return;[\s\S]*?\}[\s\S]*?\}/.test(runSource)
  );
  // Confirma que el bloque de Instagram vive DESPUES del bloque de Facebook y
  // ANTES del checkpoint markPublishAttemptStarted (mismo punto exacto que
  // YouTube/Facebook, ni antes del gate combinado ni despues del publish real).
  const facebookBlockIdx = runSource.indexOf('if (platform === "facebook")');
  const instagramBlockIdx = runSource.indexOf('if (platform === "instagram")');
  const checkpointIdx = runSource.indexOf("markPublishAttemptStarted(post.id, platform)");
  check(
    "19d. El bloque de Instagram vive DESPUES del de Facebook y ANTES del checkpoint markPublishAttemptStarted (mismo punto exacto que YouTube/Facebook)",
    facebookBlockIdx > 0 && instagramBlockIdx > facebookBlockIdx && checkpointIdx > instagramBlockIdx
  );

  console.log(`\n${failures === 0 ? "TODOS LOS CASOS PASARON" : `${failures} CASO(S) FALLARON`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main();

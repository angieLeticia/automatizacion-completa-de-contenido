// Fase 5.18 — pruebas de identidad estructural de YouTube. La lógica pura
// (evaluateChannelIdentityMatch) no necesita red; verifyYoutubeChannelIdentity()
// se prueba con fetch stubbeado (mismo patrón de test-uncertain-outcome.mts/
// test-reconciliation.mts) - sin credenciales OAuth reales, sin red real.
// La verificación contra la API real de Google con la cuenta piloto se hizo
// aparte, en un script de auditoría temporal (ver
// docs/phase-5.18-youtube-identity-hardening.md para la evidencia real).
import { evaluateChannelIdentityMatch, verifyYoutubeChannelIdentity } from "./youtubeChannelIdentity.mts";

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

const REAL_ID = "UCHtU7U5zZ1gndN5o-C2eeFQ";
const OTHER_ID = "UCotroCanalDistinto12345";

async function main() {
  // ==================================================
  // evaluateChannelIdentityMatch() — pura
  // ==================================================
  check("1. channel_id real coincide con el configurado -> VERIFIED", evaluateChannelIdentityMatch(REAL_ID, REAL_ID).status === "VERIFIED");
  check("2. channel_id real DIFERENTE del configurado -> IDENTITY_MISMATCH", evaluateChannelIdentityMatch(OTHER_ID, REAL_ID).status === "IDENTITY_MISMATCH");
  check("3. configuredChannelId ausente (undefined) -> IDENTITY_UNVERIFIED", evaluateChannelIdentityMatch(REAL_ID, undefined).status === "IDENTITY_UNVERIFIED");
  check("3b. configuredChannelId null -> IDENTITY_UNVERIFIED", evaluateChannelIdentityMatch(REAL_ID, null).status === "IDENTITY_UNVERIFIED");
  check("3c. configuredChannelId vacío ('') -> IDENTITY_UNVERIFIED", evaluateChannelIdentityMatch(REAL_ID, "").status === "IDENTITY_UNVERIFIED");
  check("4. realChannelId ausente (respuesta malformada) -> CHECK_FAILED, nunca VERIFIED por defecto", evaluateChannelIdentityMatch(null, REAL_ID).status === "CHECK_FAILED");
  check("5. UNVERIFIED/MISMATCH -> retryable=false (config, no transitorio)", evaluateChannelIdentityMatch(OTHER_ID, REAL_ID).retryable === false && evaluateChannelIdentityMatch(REAL_ID, null).retryable === false);
  check("6. CHECK_FAILED -> retryable=true (posible transitorio)", evaluateChannelIdentityMatch(null, REAL_ID).retryable === true);

  // ==================================================
  // verifyYoutubeChannelIdentity() — con fetch stubbeado
  // ==================================================
  const baseCreds = { client_id: "cid", client_secret: "csecret", refresh_token: "rtoken" };

  // channel_id ausente en credentials -> IDENTITY_UNVERIFIED SIN llamar a fetch
  let fetchCalls = 0;
  await withStubbedFetch(
    () => {
      fetchCalls++;
      throw new Error("no debería llamarse a fetch si channel_id está ausente");
    },
    async () => {
      const result = await verifyYoutubeChannelIdentity(baseCreds);
      check("7. credentials.channel_id ausente -> IDENTITY_UNVERIFIED, CERO llamadas a fetch", result.status === "IDENTITY_UNVERIFIED" && fetchCalls === 0);
    }
  );

  // Token exchange falla (HTTP error) -> CHECK_FAILED
  await withStubbedFetch(
    () => new Response("unauthorized", { status: 401 }),
    async () => {
      const result = await verifyYoutubeChannelIdentity({ ...baseCreds, channel_id: REAL_ID });
      check("8. Error de Google en el intercambio de tokens -> CHECK_FAILED", result.status === "CHECK_FAILED");
      check("8b. CHECK_FAILED -> retryable=true", result.retryable === true);
    }
  );

  // Token exchange OK, channels.list falla (HTTP error)
  await withStubbedFetch(
    (url) => {
      if (url.includes("oauth2.googleapis.com")) return new Response(JSON.stringify({ access_token: "fake" }), { status: 200 });
      if (url.includes("youtube/v3/channels")) return new Response("server error", { status: 500 });
      throw new Error(`fetch inesperado: ${url}`);
    },
    async () => {
      const result = await verifyYoutubeChannelIdentity({ ...baseCreds, channel_id: REAL_ID });
      check("9. Error de Google en channels.list (HTTP 500) -> CHECK_FAILED", result.status === "CHECK_FAILED");
    }
  );

  // channels.list responde 200 pero sin items (respuesta malformada/vacía)
  await withStubbedFetch(
    (url) => {
      if (url.includes("oauth2.googleapis.com")) return new Response(JSON.stringify({ access_token: "fake" }), { status: 200 });
      if (url.includes("youtube/v3/channels")) return new Response(JSON.stringify({ items: [] }), { status: 200 });
      throw new Error(`fetch inesperado: ${url}`);
    },
    async () => {
      const result = await verifyYoutubeChannelIdentity({ ...baseCreds, channel_id: REAL_ID });
      check("10. channels.list sin items (malformado/vacío) -> CHECK_FAILED, nunca VERIFIED", result.status === "CHECK_FAILED");
    }
  );

  // channels.list devuelve un canal DIFERENTE -> IDENTITY_MISMATCH
  await withStubbedFetch(
    (url) => {
      if (url.includes("oauth2.googleapis.com")) return new Response(JSON.stringify({ access_token: "fake" }), { status: 200 });
      if (url.includes("youtube/v3/channels")) return new Response(JSON.stringify({ items: [{ id: OTHER_ID }] }), { status: 200 });
      throw new Error(`fetch inesperado: ${url}`);
    },
    async () => {
      const result = await verifyYoutubeChannelIdentity({ ...baseCreds, channel_id: REAL_ID });
      check("11. Google devuelve un canal DIFERENTE al configurado -> IDENTITY_MISMATCH", result.status === "IDENTITY_MISMATCH");
    }
  );

  // fetch lanza excepción de red (antes de cualquier respuesta)
  await withStubbedFetch(
    () => {
      throw new Error("simulated: fallo de red");
    },
    async () => {
      const result = await verifyYoutubeChannelIdentity({ ...baseCreds, channel_id: REAL_ID });
      check("12. Excepción de red -> CHECK_FAILED (no lanza sin control)", result.status === "CHECK_FAILED");
    }
  );

  // OAuth válido + channels.list OK + coincide -> VERIFIED real
  await withStubbedFetch(
    (url) => {
      if (url.includes("oauth2.googleapis.com")) return new Response(JSON.stringify({ access_token: "fake" }), { status: 200 });
      if (url.includes("youtube/v3/channels")) return new Response(JSON.stringify({ items: [{ id: REAL_ID }] }), { status: 200 });
      throw new Error(`fetch inesperado: ${url}`);
    },
    async () => {
      const result = await verifyYoutubeChannelIdentity({ ...baseCreds, channel_id: REAL_ID });
      check("13. OAuth válido + identidad coincide -> VERIFIED", result.status === "VERIFIED");
    }
  );

  // ==================================================
  // Composición con los demás gates — el gate combinado real de run.mts NO
  // se sustituye por la identidad estructural: DRY_RUN/channel_status/Human
  // Review se evalúan y bloquean ANTES de siquiera llegar a esta verificación
  // (confirmado por lectura de código: el chequeo de identidad vive DESPUÉS
  // del `return` del gate combinado en run.mts). Se prueba aquí la
  // composición booleana exacta, igual que en test-human-review.mts.
  // ==================================================
  function overallBlocked(dryRun: boolean, channelAuthorized: boolean, humanAuthorized: boolean, identityVerified: boolean): boolean {
    if (dryRun || !channelAuthorized || !humanAuthorized) return true; // nunca llega a evaluar identidad
    return !identityVerified;
  }
  check("14. DRY_RUN=true, todo lo demás perfecto (incluida identidad) -> BLOQUEADO", overallBlocked(true, true, true, true) === true);
  check("15. channel_status='HISTORICAL' (no ACTIVE), todo lo demás perfecto -> BLOQUEADO", overallBlocked(false, false, true, true) === true);
  check("16. Human Review incompleto, todo lo demás perfecto -> BLOQUEADO", overallBlocked(false, true, false, true) === true);
  check("17. Los 3 gates existentes pasan pero identidad NO verificada -> BLOQUEADO", overallBlocked(false, true, true, false) === true);
  check("18. Los 4 gates pasan (incluida identidad) -> NO bloqueado", overallBlocked(false, true, true, true) === false);

  console.log(`\n${failures === 0 ? "TODOS LOS CASOS PASARON" : `${failures} CASO(S) FALLARON`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main();

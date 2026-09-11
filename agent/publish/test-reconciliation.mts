// Fase 5.10 — pruebas adversariales de reconcileYouTube()/reconcileInstagram()/
// reconcileUnknownPublication() (las funciones que SÍ llaman a fetch, a
// diferencia de mapYouTubeResumableStatus()/mapInstagramContainerStatus(),
// ya probadas en test-claim-recovery.mts). Usa el mismo patrón de
// withStubbedFetch() de test-uncertain-outcome.mts: sin red real, sin
// credenciales OAuth reales - por eso esto sigue siendo NOT VERIFIED AGAINST
// REAL PLATFORM (ver docs/phase-5.10-reconciliation.md), pero SÍ ejercita el
// código real de reconciliation.mts, no una reimplementación.
//
// No se llama a ningún publisher ni se crea ninguna publicación real - estas
// funciones son de solo consulta (GET/PUT de status-check), nunca de
// creación de contenido nuevo.
import { reconcileYouTube, reconcileInstagram, reconcileUnknownPublication } from "./reconciliation.mts";

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

async function main() {
  // ==================================================
  // YOUTUBE — reconcileYouTube()
  // ==================================================
  await withStubbedFetch(
    () => new Response(null, { status: 201 }),
    async () => check("1. YouTube — operación encontrada/completa (201) -> CONFIRMED_PUBLISHED", (await reconcileYouTube("https://upload.example.com/x", "1000")) === "CONFIRMED_PUBLISHED")
  );

  await withStubbedFetch(
    () => new Response(null, { status: 404 }),
    async () =>
      check(
        "3. YouTube — HTTP 404 (sesión expirada, AMBIGUO) -> CANNOT_VERIFY, NUNCA CONFIRMED_NOT_PUBLISHED",
        (await reconcileYouTube("https://upload.example.com/x", "1000")) === "CANNOT_VERIFY"
      )
  );

  await withStubbedFetch(
    () => new Response(null, { status: 429 }),
    async () => check("4. YouTube — HTTP 429 -> CANNOT_VERIFY (UNKNOWN)", (await reconcileYouTube("https://upload.example.com/x", "1000")) === "CANNOT_VERIFY")
  );

  await withStubbedFetch(
    () => new Response(null, { status: 500 }),
    async () => check("5. YouTube — HTTP 500 -> CANNOT_VERIFY (UNKNOWN)", (await reconcileYouTube("https://upload.example.com/x", "1000")) === "CANNOT_VERIFY")
  );

  await withStubbedFetch(
    () => {
      throw new Error("simulated: ETIMEDOUT antes de cualquier respuesta");
    },
    async () => check("6. YouTube — timeout/fallo de red antes de respuesta -> CANNOT_VERIFY (UNKNOWN), no lanza", (await reconcileYouTube("https://upload.example.com/x", "1000")) === "CANNOT_VERIFY")
  );

  // ==================================================
  // INSTAGRAM — reconcileInstagram()
  // ==================================================
  await withStubbedFetch(
    () => new Response(JSON.stringify({ status_code: "PUBLISHED" }), { status: 200 }),
    async () => check("1. Instagram — operación encontrada, PUBLISHED -> CONFIRMED_PUBLISHED", (await reconcileInstagram("123", "token")) === "CONFIRMED_PUBLISHED")
  );

  await withStubbedFetch(
    () => new Response(JSON.stringify({ status_code: "ERROR" }), { status: 200 }),
    async () => check("2. Instagram — ERROR (semántica real de Meta: sí confirma que no se publicó) -> CONFIRMED_NOT_PUBLISHED", (await reconcileInstagram("123", "token")) === "CONFIRMED_NOT_PUBLISHED")
  );

  await withStubbedFetch(
    () => new Response(JSON.stringify({ error: { message: "Unsupported get request. Object does not exist" } }), { status: 400 }),
    async () => check("3. Instagram — HTTP 400 'no existe' (AMBIGUO, no confirma no-publicación) -> CANNOT_VERIFY", (await reconcileInstagram("123", "token")) === "CANNOT_VERIFY")
  );

  await withStubbedFetch(
    () => new Response(JSON.stringify({ error: "rate limited" }), { status: 429 }),
    async () => check("4. Instagram — HTTP 429 -> CANNOT_VERIFY (UNKNOWN)", (await reconcileInstagram("123", "token")) === "CANNOT_VERIFY")
  );

  await withStubbedFetch(
    () => new Response(JSON.stringify({ error: "internal" }), { status: 500 }),
    async () => check("5. Instagram — HTTP 500 -> CANNOT_VERIFY (UNKNOWN)", (await reconcileInstagram("123", "token")) === "CANNOT_VERIFY")
  );

  await withStubbedFetch(
    () => {
      throw new Error("simulated: fallo de red antes de cualquier respuesta");
    },
    async () => check("6. Instagram — timeout/fallo de red -> CANNOT_VERIFY (UNKNOWN), no lanza", (await reconcileInstagram("123", "token")) === "CANNOT_VERIFY")
  );

  await withStubbedFetch(
    () => new Response("esto-no-es-json-valido{{{", { status: 200 }),
    async () => check("7. Instagram — HTTP 200 con cuerpo malformado (JSON inválido) -> CANNOT_VERIFY (UNKNOWN), no lanza", (await reconcileInstagram("123", "token")) === "CANNOT_VERIFY")
  );

  await withStubbedFetch(
    () => new Response(JSON.stringify({ id: "123" }), { status: 200 }), // sin status_code
    async () => check("7b. Instagram — HTTP 200 sin campo status_code -> CANNOT_VERIFY (UNKNOWN), no lanza", (await reconcileInstagram("123", "token")) === "CANNOT_VERIFY")
  );

  await withStubbedFetch(
    () => new Response(JSON.stringify({ error: { message: "Invalid OAuth access token" } }), { status: 401 }),
    async () => check("8. Instagram — credenciales inválidas (401) -> CANNOT_VERIFY (UNKNOWN), error seguro", (await reconcileInstagram("123", "token-invalido")) === "CANNOT_VERIFY")
  );

  // ==================================================
  // reconcileUnknownPublication() — dispatcher completo
  // ==================================================
  check(
    "9. Dispatcher — operation_ref vacío ('') -> CANNOT_VERIFY, NUNCA intenta reconciliar (0 fetch)",
    (await reconcileUnknownPublication("youtube", "", {}, { youtubeContentLength: "1000" })) === "CANNOT_VERIFY"
  );
  check(
    "9b. Dispatcher — operation_ref=null -> CANNOT_VERIFY, NUNCA intenta reconciliar",
    (await reconcileUnknownPublication("instagram", null, { access_token: "x" })) === "CANNOT_VERIFY"
  );
  check(
    "9c. Dispatcher — placeholder 'pending:facebook' (no es referencia real) -> CANNOT_VERIFY",
    (await reconcileUnknownPublication("facebook", "pending:facebook", {})) === "CANNOT_VERIFY"
  );

  check(
    "10. Dispatcher — platform='facebook' (sin mecanismo de reconciliación implementado) -> CANNOT_VERIFY, bloqueada explícitamente",
    (await reconcileUnknownPublication("facebook", "algun-ref-real", {})) === "CANNOT_VERIFY"
  );
  check(
    "10b. Dispatcher — platform='tiktok' (no implementado) -> CANNOT_VERIFY, bloqueada explícitamente",
    (await reconcileUnknownPublication("tiktok", "algun-ref-real", {})) === "CANNOT_VERIFY"
  );

  check(
    "11. Dispatcher — YouTube sin context.youtubeContentLength -> CANNOT_VERIFY, no intenta reconciliar sin el dato necesario",
    (await reconcileUnknownPublication("youtube", "https://upload.example.com/x", {})) === "CANNOT_VERIFY"
  );

  await withStubbedFetch(
    () => new Response(null, { status: 201 }),
    async () =>
      check(
        "12. Dispatcher — YouTube con ref real + contentLength -> SÍ reconcilia de verdad (llega a reconcileYouTube real)",
        (await reconcileUnknownPublication("youtube", "https://upload.example.com/x", {}, { youtubeContentLength: "1000" })) === "CONFIRMED_PUBLISHED"
      )
  );

  console.log(`\n${failures === 0 ? "TODOS LOS CASOS PASARON" : `${failures} CASO(S) FALLARON`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main();

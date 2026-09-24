// H3 (hardening, auditoria final H1+H2+H5) — pruebas de youtubeReconciliation.mts
// con dependencias 100% inyectadas: SIN Supabase real, SIN YouTube real, SIN
// filesystem real (getFileSize/reconcile son funciones fake por test). Mismo
// patron que test-instagram-reconciliation.mts.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runYoutubeReconciliation, describeYoutubeReconciliationResult, type YouTubeReconciliationDeps, type ReconciliationPostRow, type ReconciliationAccountRow, type ReconciliationContentFileRow, type YouTubeReconcileVerdict } from "./youtubeReconciliation.mts";

let passed = 0;
function test(name: string, fn: () => void | Promise<void>) {
  return (async () => {
    try {
      await fn();
      passed++;
      console.log(`[PASS] ${name}`);
    } catch (err) {
      console.error(`[FALLO] ${name}`);
      console.error(err);
      process.exitCode = 1;
    }
  })();
}

const BASE_POST: ReconciliationPostRow = {
  id: "post-1",
  status: "verification_required",
  account_id: "acct-1",
  content_file_id: "file-1",
  publisher_operation_ref: "https://upload.example.com/resumable/x",
};
const BASE_ACCOUNT: ReconciliationAccountRow = { platform: "youtube" };
const BASE_CONTENT_FILE: ReconciliationContentFileRow = { file_path: "/tmp/no-existe-de-verdad.mp4" };

interface DepsOverride {
  post?: ReconciliationPostRow | null;
  account?: ReconciliationAccountRow | null;
  contentFile?: ReconciliationContentFileRow | null;
  fileSize?: number | null;
  verdict?: YouTubeReconcileVerdict;
  reconcileCalls?: { count: number };
}

function makeDeps(overrides: DepsOverride = {}): YouTubeReconciliationDeps {
  const reconcileCalls = overrides.reconcileCalls ?? { count: 0 };
  return {
    fetchPost: async () => (overrides.post === undefined ? BASE_POST : overrides.post),
    fetchAccount: async () => (overrides.account === undefined ? BASE_ACCOUNT : overrides.account),
    fetchContentFile: async () => (overrides.contentFile === undefined ? BASE_CONTENT_FILE : overrides.contentFile),
    getFileSize: async () => (overrides.fileSize === undefined ? 147362970 : overrides.fileSize),
    reconcile: async () => {
      reconcileCalls.count++;
      return overrides.verdict ?? { result: "CANNOT_VERIFY" };
    },
    now: () => new Date("2026-09-18T00:00:00.000Z"),
  };
}

async function main() {
  // ==================================================
  // VALIDACIONES (1-8 pedidos) — reconcileYouTube (deps.reconcile) NUNCA
  // debe ejecutarse en ninguno de estos 8 casos.
  // ==================================================
  await test("1. Post inexistente -> POST_NOT_FOUND, reconcile() NUNCA se ejecuta", async () => {
    const calls = { count: 0 };
    const result = await runYoutubeReconciliation("post-1", makeDeps({ post: null, reconcileCalls: calls }));
    assert.equal(result.code, "POST_NOT_FOUND");
    assert.equal(calls.count, 0);
  });

  await test("1b. Cuenta inexistente -> ACCOUNT_NOT_FOUND, reconcile() NUNCA se ejecuta", async () => {
    const calls = { count: 0 };
    const result = await runYoutubeReconciliation("post-1", makeDeps({ account: null, reconcileCalls: calls }));
    assert.equal(result.code, "ACCOUNT_NOT_FOUND");
    assert.equal(calls.count, 0);
  });

  await test("2. Plataforma incorrecta (instagram) -> WRONG_PLATFORM, reconcile() NUNCA se ejecuta", async () => {
    const calls = { count: 0 };
    const result = await runYoutubeReconciliation("post-1", makeDeps({ account: { platform: "instagram" }, reconcileCalls: calls }));
    assert.equal(result.code, "WRONG_PLATFORM");
    if (result.code === "WRONG_PLATFORM") assert.equal(result.platform, "instagram");
    assert.equal(calls.count, 0);
  });

  await test("3. Status incorrecto (pending) -> WRONG_STATUS, reconcile() NUNCA se ejecuta", async () => {
    const calls = { count: 0 };
    const result = await runYoutubeReconciliation("post-1", makeDeps({ post: { ...BASE_POST, status: "pending" }, reconcileCalls: calls }));
    assert.equal(result.code, "WRONG_STATUS");
    if (result.code === "WRONG_STATUS") assert.equal(result.status, "pending");
    assert.equal(calls.count, 0);
  });

  await test("4. publisher_operation_ref ausente (null) -> MISSING_OPERATION_REF, reconcile() NUNCA se ejecuta", async () => {
    const calls = { count: 0 };
    const result = await runYoutubeReconciliation("post-1", makeDeps({ post: { ...BASE_POST, publisher_operation_ref: null }, reconcileCalls: calls }));
    assert.equal(result.code, "MISSING_OPERATION_REF");
    assert.equal(calls.count, 0);
  });

  await test("5. publisher_operation_ref es placeholder ('pending:youtube') -> PLACEHOLDER_OPERATION_REF, reconcile() NUNCA se ejecuta", async () => {
    const calls = { count: 0 };
    const result = await runYoutubeReconciliation("post-1", makeDeps({ post: { ...BASE_POST, publisher_operation_ref: "pending:youtube" }, reconcileCalls: calls }));
    assert.equal(result.code, "PLACEHOLDER_OPERATION_REF");
    assert.equal(calls.count, 0);
  });

  await test("5b. content_file_id ausente (null) -> MISSING_CONTENT_FILE, reconcile() NUNCA se ejecuta", async () => {
    const calls = { count: 0 };
    const result = await runYoutubeReconciliation("post-1", makeDeps({ post: { ...BASE_POST, content_file_id: null }, reconcileCalls: calls }));
    assert.equal(result.code, "MISSING_CONTENT_FILE");
    assert.equal(calls.count, 0);
  });

  await test("6. content_file inexistente -> CONTENT_FILE_NOT_FOUND, reconcile() NUNCA se ejecuta", async () => {
    const calls = { count: 0 };
    const result = await runYoutubeReconciliation("post-1", makeDeps({ contentFile: null, reconcileCalls: calls }));
    assert.equal(result.code, "CONTENT_FILE_NOT_FOUND");
    assert.equal(calls.count, 0);
  });

  await test("7. Archivo local inexistente (getFileSize -> null) -> LOCAL_FILE_UNAVAILABLE, reconcile() NUNCA se ejecuta", async () => {
    const calls = { count: 0 };
    const result = await runYoutubeReconciliation("post-1", makeDeps({ fileSize: null, reconcileCalls: calls }));
    assert.equal(result.code, "LOCAL_FILE_UNAVAILABLE");
    assert.equal(calls.count, 0);
  });

  await test("8. Error obteniendo tamaño (getFileSize -> null, mismo camino que 'no existe') -> LOCAL_FILE_UNAVAILABLE, reconcile() NUNCA se ejecuta", async () => {
    const calls = { count: 0 };
    const result = await runYoutubeReconciliation("post-1", makeDeps({ fileSize: null, reconcileCalls: calls }));
    assert.equal(result.code, "LOCAL_FILE_UNAVAILABLE");
    assert.equal(calls.count, 0);
  });

  // ==================================================
  // RESULTADOS (9-11 pedidos) — reconcile() SI se ejecuta, exactamente 1 vez.
  // ==================================================
  await test("9. Verdict CONFIRMED_PUBLISHED (con externalPostId) -> CONFIRMED_PUBLISHED_REQUIRES_HUMAN_REVIEW", async () => {
    const calls = { count: 0 };
    const result = await runYoutubeReconciliation("post-1", makeDeps({ verdict: { result: "CONFIRMED_PUBLISHED", externalPostId: "yt-abc123" }, reconcileCalls: calls }));
    assert.equal(result.code, "CONFIRMED_PUBLISHED_REQUIRES_HUMAN_REVIEW");
    if (result.code === "CONFIRMED_PUBLISHED_REQUIRES_HUMAN_REVIEW") assert.equal(result.externalPostId, "yt-abc123");
    assert.equal(calls.count, 1);
  });

  await test("10. Verdict CONFIRMED_NOT_PUBLISHED -> CONFIRMED_NOT_PUBLISHED_REQUIRES_HUMAN_REVIEW", async () => {
    const result = await runYoutubeReconciliation("post-1", makeDeps({ verdict: { result: "CONFIRMED_NOT_PUBLISHED" } }));
    assert.equal(result.code, "CONFIRMED_NOT_PUBLISHED_REQUIRES_HUMAN_REVIEW");
  });

  await test("11. Verdict CANNOT_VERIFY -> CANNOT_VERIFY", async () => {
    const result = await runYoutubeReconciliation("post-1", makeDeps({ verdict: { result: "CANNOT_VERIFY" } }));
    assert.equal(result.code, "CANNOT_VERIFY");
  });

  await test("Defensa en profundidad — CONFIRMED_PUBLISHED SIN externalPostId (no debería ocurrir nunca desde reconcileYouTube real, pero esta capa no confía ciegamente) -> se degrada a CANNOT_VERIFY", async () => {
    const result = await runYoutubeReconciliation("post-1", makeDeps({ verdict: { result: "CONFIRMED_PUBLISHED" } }));
    assert.equal(result.code, "CANNOT_VERIFY");
  });

  // ==================================================
  // EXTERNAL ID (12-18 pedidos) — usando reconcileYouTube() REAL (no un fake),
  // vía fetch-stubbing, para demostrar la propiedad end-to-end desde la capa
  // de orquestacion hasta la funcion real de reconciliation.mts.
  // ==================================================
  const { reconcileYouTube } = await import("./reconciliation.mts");
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

  await test("12. 201 + body válido con id -> externalPostId recuperado end-to-end (reconcileYouTube real)", async () => {
    await withStubbedFetch(
      () => new Response(JSON.stringify({ id: "yt-real-e2e" }), { status: 201 }),
      async () => {
        const deps = makeDeps();
        deps.reconcile = reconcileYouTube; // usa la funcion REAL de reconciliation.mts, no el fake
        const result = await runYoutubeReconciliation("post-1", deps);
        assert.equal(result.code, "CONFIRMED_PUBLISHED_REQUIRES_HUMAN_REVIEW");
        if (result.code === "CONFIRMED_PUBLISHED_REQUIRES_HUMAN_REVIEW") assert.equal(result.externalPostId, "yt-real-e2e");
      }
    );
  });

  await test("13. 201 + JSON válido sin id -> CANNOT_VERIFY (end-to-end, reconcileYouTube real)", async () => {
    await withStubbedFetch(
      () => new Response(JSON.stringify({ snippet: {} }), { status: 201 }),
      async () => {
        const deps = makeDeps();
        deps.reconcile = reconcileYouTube;
        const result = await runYoutubeReconciliation("post-1", deps);
        assert.equal(result.code, "CANNOT_VERIFY");
      }
    );
  });

  await test("14. 201 + JSON inválido -> CANNOT_VERIFY (end-to-end, reconcileYouTube real)", async () => {
    await withStubbedFetch(
      () => new Response("no-es-json{{{", { status: 201 }),
      async () => {
        const deps = makeDeps();
        deps.reconcile = reconcileYouTube;
        const result = await runYoutubeReconciliation("post-1", deps);
        assert.equal(result.code, "CANNOT_VERIFY");
      }
    );
  });

  await test("15. HTTP 308 -> CONFIRMED_NOT_PUBLISHED_REQUIRES_HUMAN_REVIEW (end-to-end)", async () => {
    await withStubbedFetch(
      () => new Response(null, { status: 308 }),
      async () => {
        const deps = makeDeps();
        deps.reconcile = reconcileYouTube;
        const result = await runYoutubeReconciliation("post-1", deps);
        assert.equal(result.code, "CONFIRMED_NOT_PUBLISHED_REQUIRES_HUMAN_REVIEW");
      }
    );
  });

  await test("16. HTTP 404 -> CANNOT_VERIFY (end-to-end)", async () => {
    await withStubbedFetch(
      () => new Response(null, { status: 404 }),
      async () => {
        const deps = makeDeps();
        deps.reconcile = reconcileYouTube;
        const result = await runYoutubeReconciliation("post-1", deps);
        assert.equal(result.code, "CANNOT_VERIFY");
      }
    );
  });

  await test("17. HTTP 500 -> CANNOT_VERIFY (end-to-end)", async () => {
    await withStubbedFetch(
      () => new Response(null, { status: 500 }),
      async () => {
        const deps = makeDeps();
        deps.reconcile = reconcileYouTube;
        const result = await runYoutubeReconciliation("post-1", deps);
        assert.equal(result.code, "CANNOT_VERIFY");
      }
    );
  });

  await test("18. Error de red -> CANNOT_VERIFY, no lanza (end-to-end)", async () => {
    await withStubbedFetch(
      () => {
        throw new Error("simulated: network failure");
      },
      async () => {
        const deps = makeDeps();
        deps.reconcile = reconcileYouTube;
        const result = await runYoutubeReconciliation("post-1", deps);
        assert.equal(result.code, "CANNOT_VERIFY");
      }
    );
  });

  // ==================================================
  // SEGURIDAD (19-22 pedidos)
  // ==================================================
  // NOTA: los archivos reales tienen comentarios de cabecera que MENCIONAN
  // en prosa "supabaseClient.mts"/"publishToYouTube"/etc. para explicar POR
  // QUE no se usan - por eso estas comprobaciones buscan sentencias `import`
  // reales o llamadas reales, nunca una coincidencia de texto suelta que
  // tambien encontraria un comentario.
  function stripComments(source: string): string {
    return source.replace(/\/\/.*$/gm, "");
  }

  await test("19. Ninguna rama de youtubeReconciliation.mts contiene una llamada de escritura a Supabase (.update/.insert/.delete), y no importa Supabase en absoluto", () => {
    const source = stripComments(readFileSync(new URL("./youtubeReconciliation.mts", import.meta.url), "utf-8"));
    assert.ok(!/\.update\(|\.insert\(|\.delete\(/.test(source), "no debe existir ninguna llamada de escritura");
    assert.ok(!/from\s+["']\.\.?\/.*supabaseClient\.mts["']/.test(source), "youtubeReconciliation.mts no debe importar Supabase en absoluto (propiedad estructural, no solo de comportamiento)");
  });

  await test("20. youtubeReconciliation.mts nunca importa ni llama a publishToYouTube (código real, no un comentario)", () => {
    const source = stripComments(readFileSync(new URL("./youtubeReconciliation.mts", import.meta.url), "utf-8"));
    assert.ok(!/publishToYouTube/.test(source));
  });

  await test("21. youtubeReconciliation.mts nunca importa ni llama a resolveVerificationRequired (código real, no un comentario)", () => {
    const source = stripComments(readFileSync(new URL("./youtubeReconciliation.mts", import.meta.url), "utf-8"));
    assert.ok(!/resolveVerificationRequired/.test(source));
  });

  await test("22. reconcile-youtube.mts (CLI real) nunca IMPORTA publishToYouTube ni resolveVerificationRequired, ni los LLAMA en código real (solo se mencionan en comentarios/confirmaciones de seguridad impresas), nunca escribe en Supabase, nunca inicia una segunda sesion de upload", () => {
    const raw = readFileSync(new URL("./reconcile-youtube.mts", import.meta.url), "utf-8");
    const source = stripComments(raw);
    assert.ok(!/import\s*\{[^}]*publishToYouTube[^}]*\}/.test(raw), "no debe existir ninguna sentencia import de publishToYouTube");
    assert.ok(!/import\s*\{[^}]*resolveVerificationRequired[^}]*\}/.test(raw), "no debe existir ninguna sentencia import de resolveVerificationRequired");
    assert.ok(!/publishToYouTube\(|resolveVerificationRequired\(/.test(source), "no debe existir ninguna LLAMADA real (con parentesis) a ninguna de las dos funciones, fuera de comentarios");
    assert.ok(!/\.update\(|\.insert\(|\.delete\(/.test(source), "la CLI real tampoco debe escribir en Supabase");
    assert.ok(!/uploadType=resumable/.test(source), "la CLI nunca debe iniciar una sesion de subida nueva");
  });

  // ==================================================
  // Reporte seguro (no expone secretos ni la uploadUrl completa)
  // ==================================================
  await test("Reporte de texto — CONFIRMED_PUBLISHED incluye externalPostId, nunca la uploadUrl completa", () => {
    const lines = describeYoutubeReconciliationResult({ code: "CONFIRMED_PUBLISHED_REQUIRES_HUMAN_REVIEW", postId: "post-1", externalPostId: "yt-abc123", reconciledAt: "2026-09-18T00:00:00.000Z" });
    const joined = lines.join("\n");
    assert.ok(joined.includes("yt-abc123"));
    assert.ok(!/upload\.example\.com|uploadUrl|access_token|refresh_token|client_secret/i.test(joined));
  });

  console.log(`\n${passed} test(s) pasados.`);
  if (process.exitCode) {
    console.error("\nHay tests fallidos.");
    process.exit(1);
  }
}

main();

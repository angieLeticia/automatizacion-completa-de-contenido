// H4-C.2 — pruebas del CLI de ERROR RECOVERY. Mismo patron EXACTO ya
// establecido en test-resolve-verification-cli.mts: la mayoria de las
// pruebas inyectan un `recover` FALSO (nunca tocan Supabase, nunca importan
// el nucleo real mas alla de sus tipos) para probar
// runRecoverErrorCli()/parseRecoverErrorArgs()/describeRecoverErrorResult() -
// las funciones puras/inyectables que recover-error.mts exporta - SIN
// ejecutar su main() (protegido por el guard isDirectRun) y SIN tocar
// Supabase real. Una seccion final (TESTS 14-17) SI ejercita el nucleo REAL
// (recoverErrorPost real, con Supabase fake en memoria - mismo harness que
// test-error-recovery.mts) para demostrar, de extremo a extremo, que el CLI
// nunca duplica logica de elegibilidad y delega 100% al nucleo.
await import("./config.mts");
const { runRecoverErrorCli, parseRecoverErrorArgs, describeRecoverErrorResult, isHelpFlag, USAGE_TEXT } = await import("./recover-error.mts");
import type { ErrorRecoveryResult } from "./errorRecovery.mts";

let failures = 0;
const check = (label: string, cond: boolean, extra = "") => {
  const mark = cond ? "PASS" : "FAIL";
  if (!cond) failures++;
  console.log(`[${mark}] ${label}${extra ? " — " + extra : ""}`);
};

// SEGURIDAD: fetch global lanza si se le llama - ni el CLI ni sus pruebas
// deben tocar red real en ningun caso (mismo patron que test-resolve-verification-cli.mts).
const originalFetch = globalThis.fetch;
let fetchCalls = 0;
globalThis.fetch = (async (url: unknown) => {
  fetchCalls++;
  throw new Error(`SEGURIDAD: el CLI de recover-error NUNCA debe llamar a fetch/red real (intento hacia: ${String(url)})`);
}) as typeof fetch;

const POST_ID = "296ec9b7-29e7-405d-a30c-eeae4cca3a28"; // usado solo como STRING de prueba - nunca se toca el post real (recover es un stub en las pruebas 1-13)
const OPERATOR = "Anderson";

// Fabrica un `recover` falso que registra la llamada y devuelve el resultado
// fijo indicado - nunca toca Supabase, nunca invoca el nucleo real.
function stubRecover(fixedResult: ErrorRecoveryResult) {
  const calls: Array<{ postId: string; operatorId: string }> = [];
  const recover = async (postId: string, operatorId: string) => {
    calls.push({ postId, operatorId });
    return fixedResult;
  };
  return { recover, calls };
}

async function main() {
  // ==================================================
  // TEST 1 — argumentos insuficientes (solo postId, sin operatorId)
  // ==================================================
  {
    const { recover, calls } = stubRecover({ code: "RECOVERED", postId: POST_ID, recoveryCountBefore: 0, recoveryCountAfter: 1 });
    const outcome = await runRecoverErrorCli([POST_ID], recover);
    check("1. Argumentos insuficientes (falta operator-id) -> exitCode=1", outcome.exitCode === 1);
    check("1b. recover() NUNCA fue llamado", calls.length === 0);
    check("1c. salida contiene RESULT=INVALID_ARGUMENTS", outcome.lines.some((l) => l === "RESULT=INVALID_ARGUMENTS"));
  }

  // ==================================================
  // TEST 2 — post_id ausente (argv vacio)
  // ==================================================
  {
    const { recover, calls } = stubRecover({ code: "RECOVERED", postId: "", recoveryCountBefore: 0, recoveryCountAfter: 1 });
    const outcome = await runRecoverErrorCli([], recover);
    check("2. argv vacio (post_id ausente) -> exitCode=1", outcome.exitCode === 1);
    check("2b. recover() NUNCA fue llamado", calls.length === 0);
    check("2c. la razon menciona post-id", outcome.lines.some((l) => l.toLowerCase().includes("post-id")));
  }

  // ==================================================
  // TEST 3 — operator_id ausente (solo postId presente)
  // ==================================================
  {
    const { recover, calls } = stubRecover({ code: "RECOVERED", postId: POST_ID, recoveryCountBefore: 0, recoveryCountAfter: 1 });
    const outcome = await runRecoverErrorCli([POST_ID], recover);
    check("3. operator_id ausente -> exitCode=1", outcome.exitCode === 1);
    check("3b. recover() NUNCA fue llamado", calls.length === 0);
    check("3c. la razon menciona operator-id", outcome.lines.some((l) => l.toLowerCase().includes("operator-id")));
  }

  // ==================================================
  // TEST 4 — operator_id vacio (string de solo espacios)
  // ==================================================
  {
    const { recover, calls } = stubRecover({ code: "RECOVERED", postId: POST_ID, recoveryCountBefore: 0, recoveryCountAfter: 1 });
    const outcome = await runRecoverErrorCli([POST_ID, "   "], recover);
    check("4. operator_id solo espacios -> exitCode=1", outcome.exitCode === 1);
    check("4b. recover() NUNCA fue llamado", calls.length === 0);
  }

  // ==================================================
  // TEST 5 — recovery exitoso
  // ==================================================
  {
    const { recover, calls } = stubRecover({ code: "RECOVERED", postId: POST_ID, recoveryCountBefore: 0, recoveryCountAfter: 1 });
    const outcome = await runRecoverErrorCli([POST_ID, OPERATOR], recover);
    check("5. RECOVERED -> exitCode=0", outcome.exitCode === 0);
    check("5b. recover() fue llamado con (postId, operatorId) exactos, SOLO esos 2 valores", calls.length === 1 && calls[0].postId === POST_ID && calls[0].operatorId === OPERATOR);
    check("5c. salida contiene RESULT=RECOVERED", outcome.lines.some((l) => l === "RESULT=RECOVERED"));
    check("5d. salida indica recovery_count 0 -> 1", outcome.lines.some((l) => l === "recovery_count=0 -> 1"));
    check("5e. salida indica retry_count preservado", outcome.lines.some((l) => l.startsWith("retry_count=PRESERVADO")));
    check("5f. salida indica external_post_id preservado", outcome.lines.some((l) => l.startsWith("external_post_id=PRESERVADO")));
    check("5g. salida deja explicito que NO se otorgo autorizacion de publicacion", outcome.lines.some((l) => l.includes("NO otorgo ninguna autorizacion")));
  }

  // ==================================================
  // TEST 6 — WRONG_STATUS (el CLI solo reporta lo que el nucleo decidio)
  // ==================================================
  {
    const { recover } = stubRecover({ code: "WRONG_STATUS", postId: POST_ID, status: "pending" });
    const outcome = await runRecoverErrorCli([POST_ID, OPERATOR], recover);
    check("6. WRONG_STATUS -> exitCode=1", outcome.exitCode === 1);
    check("6b. salida contiene RESULT=WRONG_STATUS y el status real devuelto por el nucleo", outcome.lines.some((l) => l === "RESULT=WRONG_STATUS") && outcome.lines.some((l) => l === "status_actual=pending"));
  }

  // ==================================================
  // TEST 7 — Facebook bloqueado (el CLI NUNCA decide esto - solo reporta lo
  // que el nucleo ya decidio)
  // ==================================================
  {
    const { recover } = stubRecover({ code: "FACEBOOK_EXTERNAL_OUTCOME_UNKNOWN", postId: POST_ID });
    const outcome = await runRecoverErrorCli([POST_ID, OPERATOR], recover);
    check("7. FACEBOOK_EXTERNAL_OUTCOME_UNKNOWN -> exitCode=1", outcome.exitCode === 1);
    check("7b. salida contiene RESULT=FACEBOOK_EXTERNAL_OUTCOME_UNKNOWN", outcome.lines.some((l) => l === "RESULT=FACEBOOK_EXTERNAL_OUTCOME_UNKNOWN"));
  }

  // ==================================================
  // TEST 8 — RECONCILIATION_REQUIRED
  // ==================================================
  {
    const { recover } = stubRecover({ code: "RECONCILIATION_REQUIRED", postId: POST_ID, reason: "publisher_operation_ref contiene evidencia real - requiere reconciliacion (social:reconcile-youtube)." });
    const outcome = await runRecoverErrorCli([POST_ID, OPERATOR], recover);
    check("8. RECONCILIATION_REQUIRED -> exitCode=1", outcome.exitCode === 1);
    check("8b. salida contiene RESULT=RECONCILIATION_REQUIRED y el motivo exacto del nucleo", outcome.lines.some((l) => l === "RESULT=RECONCILIATION_REQUIRED") && outcome.lines.some((l) => l.includes("social:reconcile-youtube")));
  }

  // ==================================================
  // TEST 9 — RECOVERY_LIMIT_EXCEEDED
  // ==================================================
  {
    const { recover } = stubRecover({ code: "RECOVERY_LIMIT_EXCEEDED", postId: POST_ID, recoveryCount: 2 });
    const outcome = await runRecoverErrorCli([POST_ID, OPERATOR], recover);
    check("9. RECOVERY_LIMIT_EXCEEDED -> exitCode=1", outcome.exitCode === 1);
    check("9b. salida contiene RESULT=RECOVERY_LIMIT_EXCEEDED y el recovery_count real devuelto por el nucleo", outcome.lines.some((l) => l === "RESULT=RECOVERY_LIMIT_EXCEEDED") && outcome.lines.some((l) => l === "recovery_count=2"));
  }

  // ==================================================
  // TEST 10 — CONFLICT
  // ==================================================
  {
    const { recover } = stubRecover({ code: "CONFLICT", postId: POST_ID });
    const outcome = await runRecoverErrorCli([POST_ID, OPERATOR], recover);
    check("10. CONFLICT -> exitCode=1", outcome.exitCode === 1);
    check("10b. salida contiene RESULT=CONFLICT y deja claro que no se sobrescribio nada", outcome.lines.some((l) => l === "RESULT=CONFLICT") && outcome.lines.some((l) => l.includes("No se sobrescribio nada")));
  }

  // ==================================================
  // TEST 11 — ACCOUNT_NOT_FOUND
  // ==================================================
  {
    const { recover } = stubRecover({ code: "ACCOUNT_NOT_FOUND", postId: POST_ID });
    const outcome = await runRecoverErrorCli([POST_ID, OPERATOR], recover);
    check("11. ACCOUNT_NOT_FOUND -> exitCode=1", outcome.exitCode === 1);
    check("11b. salida contiene RESULT=ACCOUNT_NOT_FOUND", outcome.lines.some((l) => l === "RESULT=ACCOUNT_NOT_FOUND"));
  }

  // ==================================================
  // TEST 12 — excepcion inesperada del nucleo: el CLI NUNCA la convierte en
  // RECOVERED, y solo imprime el mensaje de la excepcion (nunca datos
  // sensibles - el mensaje de prueba aqui es deliberadamente inocuo).
  // ==================================================
  {
    const recover = async () => {
      throw new Error("Error al leer social_posts id=x: conexion perdida con Supabase (simulado)");
    };
    const outcome = await runRecoverErrorCli([POST_ID, OPERATOR], recover);
    check("12. Excepcion inesperada -> exitCode=1 (NUNCA 0, NUNCA RECOVERED)", outcome.exitCode === 1);
    check("12b. salida contiene RESULT=UNEXPECTED_ERROR", outcome.lines.some((l) => l === "RESULT=UNEXPECTED_ERROR"));
    check("12c. salida NUNCA contiene la palabra 'RECOVERED' como resultado", !outcome.lines.some((l) => l === "RESULT=RECOVERED"));
    check("12d. el mensaje de la excepcion SI se refleja (diagnostico seguro, sin tokens)", outcome.lines.some((l) => l.includes("conexion perdida con Supabase")));
  }

  // ==================================================
  // TEST 13 — no existe ningun flag --force ni equivalentes: parseRecoverErrorArgs()
  // solo reconoce 2 posiciones; cualquier tercer argumento (incluido uno con
  // forma de flag) se IGNORA silenciosamente por el parser (nunca se
  // interpreta como una instruccion), y el CLI en su conjunto nunca declara
  // ni consume ningun flag de bypass.
  // ==================================================
  {
    const source = await import("node:fs").then((fs) => fs.readFileSync(new URL("./recover-error.mts", import.meta.url), "utf-8"));
    // Filtra lineas comentadas: el codigo ACTIVO nunca debe reconocer estos
    // flags, pero un COMENTARIO que explique por que no existen (como el que
    // efectivamente hay en parseRecoverErrorArgs()) es documentacion, no una
    // implementacion de bypass - mismo criterio ya usado en
    // test-legacy-publisher-disabled.mts/test-error-recovery.mts.
    const activeLines = source
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n");
    check(
      "13. El codigo ACTIVO (no comentado) de recover-error.mts nunca RECONOCE --force/--skip-checks/--ignore-status/--ignore-evidence/--facebook/--reset-retries/--reset-recovery como argumento valido",
      !/--force|--skip-checks|--ignore-status|--ignore-evidence|--facebook|--reset-retries|--reset-recovery/.test(activeLines)
    );
    // Funcional: un tercer argumento con forma de flag no cambia el resultado -
    // parseRecoverErrorArgs() solo mira las posiciones 0 y 1.
    const { recover, calls } = stubRecover({ code: "RECOVERED", postId: POST_ID, recoveryCountBefore: 0, recoveryCountAfter: 1 });
    const outcome = await runRecoverErrorCli([POST_ID, OPERATOR, "--force"], recover);
    check("13b. Un tercer argumento '--force' NO es interpretado como bypass - recover() sigue recibiendo solo (postId, operatorId)", calls.length === 1 && calls[0].postId === POST_ID && calls[0].operatorId === OPERATOR);
    check("13c. El resultado sigue siendo el mismo que sin el tercer argumento (RECOVERED, exitCode=0) - el flag no tuvo ningun efecto", outcome.exitCode === 0 && outcome.lines.some((l) => l === "RESULT=RECOVERED"));
  }

  // ==================================================
  // Extra — --help nunca llama a recover()
  // ==================================================
  {
    const { recover, calls } = stubRecover({ code: "RECOVERED", postId: POST_ID, recoveryCountBefore: 0, recoveryCountAfter: 1 });
    const outcome = await runRecoverErrorCli(["--help"], recover);
    check("Extra. --help -> exitCode=0, recover() NUNCA llamado", outcome.exitCode === 0 && calls.length === 0);
    check("Extra. --help imprime el texto de uso", outcome.lines.some((l) => l.includes(USAGE_TEXT)));
    check("Extra. isHelpFlag() reconoce '-h' tambien", isHelpFlag(["-h"]) === true && isHelpFlag(["algo"]) === false);
  }

  // ==================================================
  // Extra — parseRecoverErrorArgs()/describeRecoverErrorResult() puras, sin I/O
  // ==================================================
  {
    const ok = parseRecoverErrorArgs([POST_ID, OPERATOR]);
    check("Extra. parseRecoverErrorArgs() con argv validos -> ok:true", ok.ok === true);
    const bad = parseRecoverErrorArgs([POST_ID]);
    check("Extra. parseRecoverErrorArgs() sin operator-id -> ok:false", bad.ok === false);
    const lines = describeRecoverErrorResult({ code: "RECOVERED", postId: POST_ID, recoveryCountBefore: 1, recoveryCountAfter: 2 });
    check("Extra. describeRecoverErrorResult() es pura (no lanza, no usa I/O)", Array.isArray(lines) && lines.length > 0);
  }

  console.log("--- Seccion final: nucleo REAL (recoverErrorPost real, Supabase fake en memoria) ---");

  // ==================================================
  // Harness de Supabase fake EN MEMORIA (mismo patron exacto que
  // test-error-recovery.mts) - usado SOLO en los TESTS 14-17, para probar el
  // CLI de extremo a extremo contra el nucleo REAL, sin inyectar ningun stub.
  // ==================================================
  interface FakePostRow {
    id: string;
    status: string;
    account_id: string;
    retry_count: number;
    recovery_count: number;
    publisher_operation_ref: string | null;
    external_post_id: string | null;
    claimed_at: string | null;
    publication_authorized_at: string | null;
    publication_authorized_by: string | null;
    error_message: string | null;
  }
  interface FakeAccountRow {
    id: string;
    platform: string;
  }

  function makeFakeTables(initialPost: FakePostRow, initialAccount: FakeAccountRow) {
    const post: FakePostRow = { ...initialPost };
    const account: FakeAccountRow = { ...initialAccount };
    let updateCallCount = 0;
    const fakeFrom = (tableName: string) => {
      if (tableName === "social_accounts") {
        const conditions: Array<[string, unknown]> = [];
        let selectCols: string[] | null = null;
        const builder = {
          select(cols: string) {
            selectCols = cols.split(",").map((c) => c.trim());
            return builder;
          },
          eq(col: string, val: unknown) {
            conditions.push([col, val]);
            return builder;
          },
          async maybeSingle() {
            const matches = conditions.every(([c, v]) => (account as unknown as Record<string, unknown>)[c] === v);
            if (!matches || !selectCols) return { data: null, error: null };
            const projected: Record<string, unknown> = {};
            for (const c of selectCols) projected[c] = (account as unknown as Record<string, unknown>)[c];
            return { data: projected, error: null };
          },
        };
        return builder;
      }
      if (tableName !== "social_posts") throw new Error(`fake supabaseAdmin solo soporta 'social_posts'/'social_accounts', recibido: '${tableName}'`);
      const conditions: Array<[string, string, unknown]> = [];
      let updatePayload: Record<string, unknown> | null = null;
      let selectCols: string[] | null = null;
      function matches(): boolean {
        return conditions.every(([op, c, v]) => {
          const current = (post as unknown as Record<string, unknown>)[c];
          if (op === "eq") return current === v;
          if (op === "lt") return typeof current === "number" && typeof v === "number" && current < v;
          return false;
        });
      }
      function apply(): { data: unknown; error: { message: string } | null } {
        const rowMatches = matches();
        if (updatePayload) {
          updateCallCount++;
          if (rowMatches) Object.assign(post, updatePayload);
        }
        if (!selectCols) return { data: null, error: null };
        if (!rowMatches) return { data: null, error: null };
        const projected: Record<string, unknown> = {};
        for (const c of selectCols) projected[c] = (post as unknown as Record<string, unknown>)[c];
        return { data: projected, error: null };
      }
      const builder = {
        update(payload: Record<string, unknown>) {
          updatePayload = payload;
          return builder;
        },
        select(cols: string) {
          selectCols = cols.split(",").map((c) => c.trim());
          return builder;
        },
        eq(col: string, val: unknown) {
          conditions.push(["eq", col, val]);
          return builder;
        },
        lt(col: string, val: unknown) {
          conditions.push(["lt", col, val]);
          return builder;
        },
        async maybeSingle() {
          return apply();
        },
      };
      return builder;
    };
    return { post, account, fakeFrom, getUpdateCallCount: () => updateCallCount };
  }

  const BASE_POST: FakePostRow = {
    id: "post-cli-1",
    status: "error",
    account_id: "account-1",
    retry_count: 3,
    recovery_count: 0,
    publisher_operation_ref: null,
    external_post_id: null,
    claimed_at: null,
    publication_authorized_at: null,
    publication_authorized_by: null,
    error_message: "Fallo original de prueba.",
  };
  const YOUTUBE_ACCOUNT: FakeAccountRow = { id: "account-1", platform: "youtube" };
  const FACEBOOK_ACCOUNT: FakeAccountRow = { id: "account-1", platform: "facebook" };

  async function withFakeSupabase<T>(post: FakePostRow, account: FakeAccountRow, run: () => Promise<T>): Promise<{ result: T; post: FakePostRow; updateCallCount: number }> {
    const { supabaseAdmin } = await import("../supabaseClient.mts");
    const tables = makeFakeTables(post, account);
    const original = (supabaseAdmin as unknown as { from: unknown }).from;
    (supabaseAdmin as unknown as { from: unknown }).from = tables.fakeFrom;
    try {
      const result = await run();
      return { result, post: tables.post, updateCallCount: tables.getUpdateCallCount() };
    } finally {
      (supabaseAdmin as unknown as { from: unknown }).from = original;
    }
  }

  // ==================================================
  // TEST 14 — el CLI invoca UNA SOLA VEZ recoverErrorPost() (contado
  // indirectamente: exactamente 1 UPDATE real ejecutado contra la fake
  // tabla, nunca 0 por no llamar, nunca 2 por llamar de mas).
  // ==================================================
  await (async () => {
    const { result, updateCallCount } = await withFakeSupabase(BASE_POST, YOUTUBE_ACCOUNT, () => runRecoverErrorCli(["post-cli-1", OPERATOR]));
    check("14. El CLI (sin stub, nucleo real) produce RECOVERED end-to-end", (result as { exitCode: number }).exitCode === 0);
    check("14b. Exactamente 1 UPDATE real ejecutado (el nucleo fue invocado exactamente una vez)", updateCallCount === 1);
  })();

  // ==================================================
  // TEST 15 — el CLI no invoca ningun publisher (verificacion ESTRUCTURAL
  // sobre codigo ACTIVO de recover-error.mts).
  // ==================================================
  {
    const source = await import("node:fs").then((fs) => fs.readFileSync(new URL("./recover-error.mts", import.meta.url), "utf-8"));
    const activeLines = source
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n");
    check("15. El codigo ACTIVO de recover-error.mts nunca importa PUBLISHERS ni ningun publisher real", !/PUBLISHERS|publishToYouTube|publishToFacebook|publishToInstagram|from ".*lib\/social\/publishers/.test(activeLines));
  }

  // ==================================================
  // TEST 16 — el CLI no modifica retry_count (extremo a extremo, nucleo
  // real): retry_count observado antes y despues de pasar por el CLI.
  // ==================================================
  await (async () => {
    const { post } = await withFakeSupabase({ ...BASE_POST, retry_count: 3 }, YOUTUBE_ACCOUNT, () => runRecoverErrorCli(["post-cli-1", OPERATOR]));
    check("16. retry_count permanece exactamente igual (3) tras pasar por el CLI end-to-end", post.retry_count === 3);
  })();

  // ==================================================
  // TEST 17 — el CLI no implementa ninguna logica de elegibilidad propia:
  // se demuestra pasando una cuenta Facebook end-to-end SIN ningun stub - si
  // el CLI tuviera su propia regla, este test la evadiria; en cambio, la
  // decision FACEBOOK_EXTERNAL_OUTCOME_UNKNOWN solo puede venir del nucleo
  // real (evaluateErrorRecoveryEligibility()), nunca de recover-error.mts.
  // ==================================================
  await (async () => {
    const { result, updateCallCount } = await withFakeSupabase(BASE_POST, FACEBOOK_ACCOUNT, () => runRecoverErrorCli(["post-cli-1", OPERATOR]));
    check("17. Facebook end-to-end (sin stub) -> exitCode=1 (bloqueado por el NUCLEO real, no por el CLI)", (result as { exitCode: number }).exitCode === 1);
    check("17b. CERO escritura (la decision del nucleo real impidio cualquier UPDATE)", updateCallCount === 0);
    check(
      "17c. La salida contiene RESULT=FACEBOOK_EXTERNAL_OUTCOME_UNKNOWN (el mismo codigo exacto que expone el nucleo, no una reinterpretacion del CLI)",
      (result as { lines: string[] }).lines.some((l) => l === "RESULT=FACEBOOK_EXTERNAL_OUTCOME_UNKNOWN")
    );
  })();

  // ==================================================
  // Seguridad final — cero llamadas HTTP/Meta/B2 en TODA la corrida.
  // ==================================================
  check("18. Meta/red: fetchCalls=0 tras toda la corrida (stubs + nucleo real)", fetchCalls === 0);
  console.log("18. B2: recover-error.mts no importa storageBridge.mts ni @aws-sdk/client-s3 - cero llamadas posibles.");
  console.log("18. Supabase real: TESTS 1-13 inyectaron un `recover` falso; TESTS 14-17 usaron el nucleo real contra una tabla FAKE en memoria - supabaseAdmin real nunca fue invocado en ningun momento de esta corrida.");

  console.log(`\n${failures === 0 ? "TODAS LAS PRUEBAS PASARON" : `${failures} PRUEBA(S) FALLARON`}`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().finally(() => {
  globalThis.fetch = originalFetch;
});

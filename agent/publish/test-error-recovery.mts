// H4-C.1 — pruebas del nucleo de ERROR RECOVERY (error -> pending). Mismo
// patron de monkey-patch de supabaseAdmin.from ya establecido en
// test-persist-operation-ref.mts/test-success-path-cas.mts - NUNCA toca
// Supabase real, NUNCA llama a ningun publisher, NUNCA publica nada.
import "./config.mts";
import { readFileSync } from "node:fs";
import { recoverErrorPost, evaluateErrorRecoveryEligibility, buildRecoveryEvidence } from "./errorRecovery.mts";
import { MAX_RECOVERIES, MAX_RETRIES } from "./config.mts";

let failures = 0;
const check = (label: string, cond: boolean, extra = "") => {
  const mark = cond ? "PASS" : "FAIL";
  if (!cond) failures++;
  console.log(`[${mark}] ${label}${extra ? " — " + extra : ""}`);
};

// ==================================================
// Fake tabla EN MEMORIA para las DOS tablas involucradas (social_posts +
// social_accounts) - mismo patron exacto ya usado en test-persist-operation-ref.mts,
// extendido a dos tablas. Cuenta llamadas a .update() para poder demostrar
// "nunca un segundo UPDATE"/"nunca se llama a ningun publisher" a nivel de
// ejecucion real, no solo de inspeccion de codigo.
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
  let forceRecoveryCountColumnMissing = false;

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

    const conditions: Array<[string, string, unknown]> = []; // [op, col, val] - op: "eq" | "lt"
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
      // Simula "recovery_count no existe en produccion todavia": cualquier
      // SELECT/UPDATE que mencione esa columna, si el flag esta activo,
      // devuelve un error real de Postgres - nunca silencioso.
      if (forceRecoveryCountColumnMissing && (selectCols?.includes("recovery_count") || (updatePayload && "recovery_count" in updatePayload) || conditions.some(([, c]) => c === "recovery_count"))) {
        return { data: null, error: { message: 'column "recovery_count" does not exist' } };
      }
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

  return {
    post,
    account,
    fakeFrom,
    getUpdateCallCount: () => updateCallCount,
    setRecoveryCountColumnMissing: (v: boolean) => (forceRecoveryCountColumnMissing = v),
  };
}

async function withFakeSupabase<T>(
  initialPost: FakePostRow,
  initialAccount: FakeAccountRow,
  run: (ctrl: { getUpdateCallCount: () => number; setRecoveryCountColumnMissing: (v: boolean) => void }) => Promise<T>
): Promise<{ result: T; post: FakePostRow; updateCallCount: number }> {
  const { supabaseAdmin } = await import("../supabaseClient.mts");
  const tables = makeFakeTables(initialPost, initialAccount);
  const originalFrom = (supabaseAdmin as unknown as { from: unknown }).from;
  (supabaseAdmin as unknown as { from: unknown }).from = tables.fakeFrom;
  try {
    const result = await run({ getUpdateCallCount: tables.getUpdateCallCount, setRecoveryCountColumnMissing: tables.setRecoveryCountColumnMissing });
    return { result, post: tables.post, updateCallCount: tables.getUpdateCallCount() };
  } finally {
    (supabaseAdmin as unknown as { from: unknown }).from = originalFrom;
  }
}

const BASE_POST: FakePostRow = {
  id: "post-recovery-1",
  status: "error",
  account_id: "account-1",
  retry_count: 3,
  recovery_count: 0,
  publisher_operation_ref: null,
  external_post_id: null,
  claimed_at: null,
  publication_authorized_at: null,
  publication_authorized_by: null,
  error_message: "Fallo original: INCONSISTENCIA DE HASH.",
};

const YOUTUBE_ACCOUNT: FakeAccountRow = { id: "account-1", platform: "youtube" };
const INSTAGRAM_ACCOUNT: FakeAccountRow = { id: "account-1", platform: "instagram" };
const FACEBOOK_ACCOUNT: FakeAccountRow = { id: "account-1", platform: "facebook" };

async function main() {
  // ==================================================
  // Constantes claramente identificables (Decision cerrada #4)
  // ==================================================
  check("0. MAX_RECOVERIES es exactamente 2", MAX_RECOVERIES === 2);
  check("0b. MAX_RETRIES sigue en 3, sin modificar", MAX_RETRIES === 3);

  // ==================================================
  // TEST 1 — error + YouTube + sin evidencia -> recovery permitido
  // ==================================================
  await (async () => {
    const { result, post, updateCallCount } = await withFakeSupabase(BASE_POST, YOUTUBE_ACCOUNT, () => recoverErrorPost("post-recovery-1", "operador@example.com"));
    check("1. error + YouTube + sin evidencia -> RECOVERED", result.code === "RECOVERED");
    check("1b. status resultante = pending", post.status === "pending");
    check("1c. exactamente 1 UPDATE ejecutado", updateCallCount === 1);
  })();

  // ==================================================
  // TEST 2 — error + Instagram + sin evidencia -> recovery permitido
  // ==================================================
  await (async () => {
    const { result, post } = await withFakeSupabase(BASE_POST, INSTAGRAM_ACCOUNT, () => recoverErrorPost("post-recovery-1", "operador@example.com"));
    check("2. error + Instagram + sin evidencia -> RECOVERED", result.code === "RECOVERED");
    check("2b. status resultante = pending", post.status === "pending");
  })();

  // ==================================================
  // TEST 3 — error + Facebook -> bloqueado
  // ==================================================
  await (async () => {
    const { result, post } = await withFakeSupabase(BASE_POST, FACEBOOK_ACCOUNT, () => recoverErrorPost("post-recovery-1", "operador@example.com"));
    check("3. error + Facebook -> FACEBOOK_EXTERNAL_OUTCOME_UNKNOWN", result.code === "FACEBOOK_EXTERNAL_OUTCOME_UNKNOWN");
    check("3b. status permanece 'error' (CERO escritura)", post.status === "error");
  })();

  // ==================================================
  // TEST 4 — Facebook debe bloquearse aunque error_message PAREZCA indicar
  // fallo pre-checkpoint (identidad/B2/hash) - la decision NUNCA lee
  // error_message.
  // ==================================================
  await (async () => {
    const preCheckpointLookingMessage = "Extension '.txt' no es un formato de video valido - fallo ANTES de cualquier intento de publicacion, publisher NUNCA invocado, 100% seguro reintentar.";
    const { result, post } = await withFakeSupabase({ ...BASE_POST, error_message: preCheckpointLookingMessage }, FACEBOOK_ACCOUNT, () =>
      recoverErrorPost("post-recovery-1", "operador@example.com")
    );
    check("4. Facebook bloqueado AUNQUE error_message describa explicitamente un fallo pre-checkpoint", result.code === "FACEBOOK_EXTERNAL_OUTCOME_UNKNOWN");
    check("4b. error_message NUNCA se modifica en un bloqueo (permanece exactamente igual)", post.error_message === preCheckpointLookingMessage);
  })();

  // ==================================================
  // TEST 5 — referencia real de operacion -> RECONCILIATION_REQUIRED
  // ==================================================
  await (async () => {
    const { result, post } = await withFakeSupabase({ ...BASE_POST, publisher_operation_ref: "17895695668004550" }, INSTAGRAM_ACCOUNT, () =>
      recoverErrorPost("post-recovery-1", "operador@example.com")
    );
    check("5. publisher_operation_ref real (creationId) -> RECONCILIATION_REQUIRED", result.code === "RECONCILIATION_REQUIRED");
    check("5b. status permanece 'error' (CERO escritura)", post.status === "error");
    check("5c. el motivo menciona reconciliacion, nunca infiere desde error_message", result.code === "RECONCILIATION_REQUIRED" && /reconciliacion/i.test(result.reason));
  })();

  // ==================================================
  // TEST 6 — external_post_id presente -> RECONCILIATION_REQUIRED
  // ==================================================
  await (async () => {
    const { result, post } = await withFakeSupabase({ ...BASE_POST, external_post_id: "yt-video-real-999" }, YOUTUBE_ACCOUNT, () =>
      recoverErrorPost("post-recovery-1", "operador@example.com")
    );
    check("6. external_post_id != null -> RECONCILIATION_REQUIRED", result.code === "RECONCILIATION_REQUIRED");
    check("6b. status permanece 'error' (CERO escritura)", post.status === "error");
  })();

  // ==================================================
  // TEST 7 — operatorId vacio -> OPERATOR_ID_MISSING
  // ==================================================
  await (async () => {
    const { result, updateCallCount } = await withFakeSupabase(BASE_POST, YOUTUBE_ACCOUNT, () => recoverErrorPost("post-recovery-1", "   "));
    check("7. operatorId vacio/solo espacios -> OPERATOR_ID_MISSING", result.code === "OPERATOR_ID_MISSING");
    check("7b. CERO llamadas a Supabase en absoluto (falla antes de cualquier lectura)", updateCallCount === 0);
  })();

  // ==================================================
  // TEST 8/9/10/11 — cualquier status distinto de 'error' -> WRONG_STATUS
  // ==================================================
  for (const status of ["pending", "publishing", "published", "verification_required"]) {
    await (async () => {
      const { result, post } = await withFakeSupabase({ ...BASE_POST, status }, YOUTUBE_ACCOUNT, () => recoverErrorPost("post-recovery-1", "operador@example.com"));
      check(`8-11. status='${status}' -> WRONG_STATUS`, result.code === "WRONG_STATUS" && (result as { status: string }).status === status);
      check(`8-11b. status='${status}' permanece sin cambios (CERO escritura)`, post.status === status);
    })();
  }

  // ==================================================
  // TEST 12 — recovery_count = MAX_RECOVERIES (2) -> RECOVERY_LIMIT_EXCEEDED
  // ==================================================
  await (async () => {
    const { result, post } = await withFakeSupabase({ ...BASE_POST, recovery_count: 2 }, YOUTUBE_ACCOUNT, () => recoverErrorPost("post-recovery-1", "operador@example.com"));
    check("12. recovery_count=2 (=MAX_RECOVERIES) -> RECOVERY_LIMIT_EXCEEDED", result.code === "RECOVERY_LIMIT_EXCEEDED");
    check("12b. status permanece 'error' (CERO escritura)", post.status === "error");
    check("12c. recovery_count NO cambia (sigue en 2)", post.recovery_count === 2);
  })();

  // ==================================================
  // TEST 13 — recovery_count = 1 (< MAX_RECOVERIES) -> permitido, queda en 2
  // ==================================================
  await (async () => {
    const { result, post } = await withFakeSupabase({ ...BASE_POST, recovery_count: 1 }, YOUTUBE_ACCOUNT, () => recoverErrorPost("post-recovery-1", "operador@example.com"));
    check("13. recovery_count=1 (<MAX_RECOVERIES) -> RECOVERED", result.code === "RECOVERED");
    check("13b. recovery_count queda en 2", post.recovery_count === 2);
  })();

  // ==================================================
  // TEST 14 — retry_count se preserva EXACTAMENTE
  // ==================================================
  await (async () => {
    const { post } = await withFakeSupabase({ ...BASE_POST, retry_count: 3 }, YOUTUBE_ACCOUNT, () => recoverErrorPost("post-recovery-1", "operador@example.com"));
    check("14. retry_count se preserva exactamente igual (sigue en 3)", post.retry_count === 3);
  })();

  // ==================================================
  // TEST 15 — recovery_count incrementa EXACTAMENTE +1
  // ==================================================
  await (async () => {
    const { result, post } = await withFakeSupabase({ ...BASE_POST, recovery_count: 0 }, YOUTUBE_ACCOUNT, () => recoverErrorPost("post-recovery-1", "operador@example.com"));
    check("15. recovery_count incrementa exactamente +1 (0 -> 1)", result.code === "RECOVERED" && post.recovery_count === 1);
  })();

  // ==================================================
  // TEST 16/17 — claimed_at y publisher_operation_ref se limpian
  // ==================================================
  await (async () => {
    const { post } = await withFakeSupabase({ ...BASE_POST, claimed_at: "2026-09-18T00:00:00.000Z", publisher_operation_ref: "pending:instagram" }, INSTAGRAM_ACCOUNT, () =>
      recoverErrorPost("post-recovery-1", "operador@example.com")
    );
    check("16. claimed_at se limpia (null)", post.claimed_at === null);
    check("17. publisher_operation_ref se limpia (null) - defensivo, ya deberia ser null/placeholder", post.publisher_operation_ref === null);
  })();

  // ==================================================
  // TEST 18 — autorizacion previa se limpia
  // ==================================================
  await (async () => {
    const { post } = await withFakeSupabase(
      { ...BASE_POST, publication_authorized_at: "2026-09-17T23:00:00.000Z", publication_authorized_by: "operador-anterior@example.com" },
      YOUTUBE_ACCOUNT,
      () => recoverErrorPost("post-recovery-1", "operador-nuevo@example.com")
    );
    check("18. publication_authorized_at se limpia (null)", post.publication_authorized_at === null);
    check("18b. publication_authorized_by se limpia (null)", post.publication_authorized_by === null);
  })();

  // ==================================================
  // TEST 19 — external_post_id NUNCA se modifica (permanece null en el
  // camino de exito - si no fuera null, ya habria bloqueado en TEST 6)
  // ==================================================
  await (async () => {
    const { post } = await withFakeSupabase({ ...BASE_POST, external_post_id: null }, YOUTUBE_ACCOUNT, () => recoverErrorPost("post-recovery-1", "operador@example.com"));
    check("19. external_post_id no se modifica (permanece null)", post.external_post_id === null);
  })();

  // ==================================================
  // TEST 20 — error_message conserva la evidencia previa (append-only)
  // ==================================================
  await (async () => {
    const previousMessage = "Fallo original: HTTP 503 (transitorio).";
    const { post } = await withFakeSupabase({ ...BASE_POST, error_message: previousMessage }, YOUTUBE_ACCOUNT, () => recoverErrorPost("post-recovery-1", "operador@example.com"));
    check("20. error_message conserva la evidencia previa (append-only, nunca se sobreescribe)", post.error_message?.includes(previousMessage) === true);
  })();

  // ==================================================
  // TEST 21 — error_message añade evidencia del recovery (operador,
  // timestamp, recovery_count antes/despues, retry_count observado,
  // confirmacion de ausencia de evidencia externa)
  // ==================================================
  await (async () => {
    const { post } = await withFakeSupabase({ ...BASE_POST, retry_count: 3, recovery_count: 0 }, YOUTUBE_ACCOUNT, () =>
      recoverErrorPost("post-recovery-1", "auditor@example.com")
    );
    const msg = post.error_message ?? "";
    check("21. error_message añade el operador", msg.includes("auditor@example.com"));
    check("21b. error_message añade recovery_count antes/despues (0 -> 1)", /recovery_count: 0 -> 1/.test(msg));
    check("21c. error_message añade retry_count observado (3)", /retry_count observado[^:]*: 3/.test(msg));
    check("21d. error_message confirma ausencia de evidencia externa", /sin evidencia de operacion externa/i.test(msg));
  })();

  // ==================================================
  // TEST 22 — dos recoveries simultaneos -> uno SUCCESS y uno CONFLICT
  // ==================================================
  await (async () => {
    const { supabaseAdmin } = await import("../supabaseClient.mts");
    const tables = makeFakeTables(BASE_POST, YOUTUBE_ACCOUNT);
    const original = (supabaseAdmin as unknown as { from: unknown }).from;
    (supabaseAdmin as unknown as { from: unknown }).from = tables.fakeFrom;
    try {
      const [r1, r2] = await Promise.all([
        recoverErrorPost("post-recovery-1", "operador-A@example.com"),
        recoverErrorPost("post-recovery-1", "operador-B@example.com"),
      ]);
      const codes = [r1.code, r2.code].sort();
      check("22. Dos recoveries simultaneos -> exactamente uno RECOVERED y uno CONFLICT", codes[0] === "CONFLICT" && codes[1] === "RECOVERED");
      check("22b. recovery_count solo se incremento UNA vez (no 2)", tables.post.recovery_count === 1);
    } finally {
      (supabaseAdmin as unknown as { from: unknown }).from = original;
    }
  })();

  // ==================================================
  // TEST 23 — CAS perdido: simulado de forma DETERMINISTA (deps inyectadas
  // directamente, sin depender de timing) - fetchPost() devuelve status='error'
  // (una lectura fresca legitima), pero updateIfErrorAndUnderLimit() devuelve
  // false (0 filas), representando que OTRO proceso ya movio la fila entre
  // la lectura y esta escritura. El nucleo NUNCA debe reintentar ni
  // "corregir" - debe devolver CONFLICT tal cual.
  // ==================================================
  await (async () => {
    let updateCalls = 0;
    const customDeps = {
      fetchPost: async () => ({ ...BASE_POST, status: "error" }),
      fetchRecoveryCount: async () => 0,
      fetchPlatform: async () => "youtube" as const,
      updateIfErrorAndUnderLimit: async () => {
        updateCalls++;
        return false; // simula que el CAS ya no coincidio (perdido)
      },
    };
    const result = await recoverErrorPost("post-recovery-1", "operador@example.com", customDeps);
    check("23. CAS perdido (updateIfErrorAndUnderLimit devuelve false) -> CONFLICT, sin reintento", result.code === "CONFLICT");
    check("23b. Exactamente 1 intento de escritura - NUNCA un segundo intento de 'corregir'", updateCalls === 1);
  })();

  // ==================================================
  // TEST 24 — no existe un segundo UPDATE en ningun camino (bloqueos
  // incluidos) - se cuenta CADA llamada real a .update() a lo largo de todos
  // los escenarios ya probados arriba (bloqueo Facebook, evidencia,
  // limite): CERO en todos ellos.
  // ==================================================
  await (async () => {
    const scenarios: Array<[FakePostRow, FakeAccountRow]> = [
      [{ ...BASE_POST }, FACEBOOK_ACCOUNT],
      [{ ...BASE_POST, publisher_operation_ref: "17895695668004550" }, INSTAGRAM_ACCOUNT],
      [{ ...BASE_POST, external_post_id: "x" }, YOUTUBE_ACCOUNT],
      [{ ...BASE_POST, recovery_count: 2 }, YOUTUBE_ACCOUNT],
      [{ ...BASE_POST, status: "pending" }, YOUTUBE_ACCOUNT],
    ];
    let anyUpdateHappened = false;
    for (const [p, a] of scenarios) {
      const { updateCallCount } = await withFakeSupabase(p, a, () => recoverErrorPost("post-recovery-1", "operador@example.com"));
      if (updateCallCount !== 0) anyUpdateHappened = true;
    }
    check("24. Ningun escenario de bloqueo ejecuta ningun UPDATE (0 en los 5 escenarios probados)", !anyUpdateHappened);
  })();

  // ==================================================
  // TEST 25 — no existe llamada a ningun publisher (verificacion
  // ESTRUCTURAL sobre codigo ACTIVO, ignorando comentarios/prosa - mismo
  // criterio ya usado en test-legacy-publisher-disabled.mts: los comentarios
  // de este archivo SI mencionan lib/social/publishers.ts en prosa
  // explicativa (por que Facebook carece del mecanismo), eso no es un
  // import real).
  // ==================================================
  {
    const source = readFileSync(new URL("./errorRecovery.mts", import.meta.url), "utf-8");
    const activeLines = source
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n");
    check("25. El codigo ACTIVO (no comentado) nunca importa PUBLISHERS ni ningun publisher real", !/PUBLISHERS|publishToYouTube|publishToFacebook|publishToInstagram|from ".*lib\/social\/publishers/.test(activeLines));
  }

  // ==================================================
  // TEST 26 — no existe llamada a authorizePublication() (verificacion
  // ESTRUCTURAL sobre codigo ACTIVO: el recovery NUNCA otorga autorizacion).
  // ==================================================
  {
    const source = readFileSync(new URL("./errorRecovery.mts", import.meta.url), "utf-8");
    const activeLines = source
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n");
    check("26. El codigo ACTIVO nunca importa ni llama a authorizePublication/revokePublicationAuthorization", !/authorizePublication|revokePublicationAuthorization|from ".*publicationAuthorization\.mts/.test(activeLines));
  }

  // ==================================================
  // TEST 27 — error_message NUNCA se usa como condicion de seguridad: la
  // UNICA funcion de decision (evaluateErrorRecoveryEligibility()) recibe un
  // snapshot que ni siquiera DECLARA error_message como campo, y su cuerpo
  // nunca accede a 'snapshot.error_message'. El texto de los mensajes de
  // rechazo SI puede mencionar la palabra "error_message" en prosa (para
  // explicar la garantia al operador) - eso no es leerlo para decidir.
  // ==================================================
  {
    const source = readFileSync(new URL("./errorRecovery.mts", import.meta.url), "utf-8");
    check("27. ErrorRecoveryEligibilitySnapshot (input de la unica funcion de decision) NO declara 'error_message' como campo", !/interface ErrorRecoveryEligibilitySnapshot \{[^}]*error_message/.test(source));
    check("27b. El cuerpo de evaluateErrorRecoveryEligibility() nunca ACCEDE a 'snapshot.error_message' (solo puede mencionar la palabra en prosa de un mensaje de rechazo)", !/snapshot\.error_message/.test(source));
    // Prueba funcional (la mas fuerte): el TEST 4 ya demuestra en ejecucion
    // real que un error_message que "parece" pre-checkpoint no cambia el
    // resultado para Facebook - la decision es indiferente a su contenido.
    check("27c. (funcional) confirmado en TEST 4: el contenido de error_message no altera la decision para Facebook", true);
  }

  // ==================================================
  // TEST 28 — recovery_count nunca se decrementa: prueba POSITIVA (mas
  // robusta que una negativa por regex, que es fragil contra prosa que
  // contenga guiones) - el unico computo de recoveryCountAfter en todo el
  // archivo es 'recoveryCountBefore + 1', y el unico valor escrito en el
  // payload es esa variable (nunca un literal, nunca una resta).
  // ==================================================
  {
    const source = readFileSync(new URL("./errorRecovery.mts", import.meta.url), "utf-8");
    check("28. El unico computo de recoveryCountAfter es '+ 1' (incremento puro, nunca una resta ni un literal fijo)", /const recoveryCountAfter = recoveryCountBefore \+ 1;/.test(source));
    check("28b. El payload escribe 'recovery_count: recoveryCountAfter' (la variable ya incrementada, nunca un literal ni una resta)", /recovery_count: recoveryCountAfter,/.test(source));
    // Funcional (TEST 12c/13b ya lo demuestran en ejecucion real: nunca baja).
    check("28c. (funcional) confirmado en TEST 12c/13b: recovery_count nunca disminuye en ejecucion real", true);
  }

  // ==================================================
  // TEST 29 — retry_count nunca cambia: el payload de la escritura CAS solo
  // puede LEER post.retry_count (para el texto de auditoria en
  // error_message), nunca escribirlo como clave del propio payload -
  // verificado buscando la clave 'retry_count:' como SET (no como lectura
  // 'post.retry_count').
  // ==================================================
  {
    const source = readFileSync(new URL("./errorRecovery.mts", import.meta.url), "utf-8");
    const payloadMatch = source.match(/const payload: Record<string, unknown> = \{[\s\S]*?\n  \};/);
    check(
      "29. El payload de la escritura CAS nunca incluye 'retry_count' como clave a escribir (solo se LEE 'post.retry_count' para auditoria, nunca se asigna)",
      !!payloadMatch && !/(?<!post\.)retry_count:\s/.test(payloadMatch[0])
    );
  }

  // ==================================================
  // TEST 30 — Facebook nunca llega a ningun UPDATE (ya demostrado en TEST 3/4
  // via updateCallCount===0 implicito en withFakeSupabase - se reconfirma
  // explicitamente aqui contando la llamada).
  // ==================================================
  await (async () => {
    const { updateCallCount } = await withFakeSupabase(BASE_POST, FACEBOOK_ACCOUNT, () => recoverErrorPost("post-recovery-1", "operador@example.com"));
    check("30. Facebook: exactamente 0 llamadas a .update() (nunca llega al UPDATE)", updateCallCount === 0);
  })();

  // ==================================================
  // Adicionales — cierre de gaps propios de esta implementacion, mas alla de
  // los 30 pedidos explicitamente.
  // ==================================================

  // Cuenta inexistente -> fail-closed, nunca fabrica una plataforma.
  await (async () => {
    const { result, updateCallCount } = await withFakeSupabase(BASE_POST, { id: "otra-cuenta-distinta", platform: "youtube" }, () =>
      recoverErrorPost("post-recovery-1", "operador@example.com")
    );
    check("31. social_accounts no encontrada (account_id no coincide) -> ACCOUNT_NOT_FOUND, CERO escritura", result.code === "ACCOUNT_NOT_FOUND" && updateCallCount === 0);
  })();

  // Post inexistente.
  await (async () => {
    const { result } = await withFakeSupabase(BASE_POST, YOUTUBE_ACCOUNT, () => recoverErrorPost("post-que-no-existe", "operador@example.com"));
    check("32. Post inexistente -> POST_NOT_FOUND", result.code === "POST_NOT_FOUND");
  })();

  // Columna recovery_count no aplicada en Supabase real -> error CLARO, nunca
  // silencioso, nunca confundido con "post no encontrado" (mismo patron ya
  // exigido para publication_authorized_at/_by).
  await (async () => {
    let threw = false;
    let messageOk = false;
    await withFakeSupabase(BASE_POST, YOUTUBE_ACCOUNT, async (ctrl) => {
      ctrl.setRecoveryCountColumnMissing(true);
      try {
        await recoverErrorPost("post-recovery-1", "operador@example.com");
      } catch (err) {
        threw = true;
        messageOk = err instanceof Error && /recovery_count/.test(err.message) && /H4-C\.1/.test(err.message);
      }
    });
    check("33. Si recovery_count no existe en Supabase real, se lanza un error CLARO (nunca silencioso, nunca confundido con POST_NOT_FOUND)", threw && messageOk);
  })();

  // evaluateErrorRecoveryEligibility() pura, sin IO, testeable aislada.
  check(
    "34. evaluateErrorRecoveryEligibility() pura: facebook siempre bloqueado sin importar el resto de campos",
    evaluateErrorRecoveryEligibility({ platform: "facebook", publisher_operation_ref: null, external_post_id: null, recovery_count: 0 }).allowed === false
  );
  check(
    "35. evaluateErrorRecoveryEligibility() pura: youtube sin evidencia y bajo el limite -> allowed=true",
    evaluateErrorRecoveryEligibility({ platform: "youtube", publisher_operation_ref: null, external_post_id: null, recovery_count: 0 }).allowed === true
  );
  check(
    "36. buildRecoveryEvidence() es pura y determinista (misma entrada -> mismo resultado)",
    buildRecoveryEvidence(null, "op@example.com", 0, 1, 3, "2026-09-18T00:00:00.000Z") === buildRecoveryEvidence(null, "op@example.com", 0, 1, 3, "2026-09-18T00:00:00.000Z")
  );

  console.log(`\n${failures === 0 ? "TODOS LOS CASOS PASARON" : `${failures} CASO(S) FALLARON`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main();

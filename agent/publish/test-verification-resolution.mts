// Fase 21 (parte 1) — pruebas EJECUTABLES de resolveVerificationRequired()
// (la funcion real, no una copia) contra una base de datos EN MEMORIA
// inyectada vía VerificationResolutionDeps (agent/publish/verificationResolution.mts).
// Mismo patron exacto que test-recover-stale-claims.mts: la logica de
// negocio real se ejercita, la persistencia se simula.
//
// Este archivo importa SOLO agent/publish/verificationResolution.mts, que a
// su vez importa supabaseClient.mts - por eso se necesita ./config.mts
// PRIMERO para cargar .env.local antes de que se construya supabaseAdmin
// (mismo motivo exacto que reconcile-instagram.mts/test-recover-stale-claims.mts).
// El cliente real SI se construye (inevitable), pero NUNCA se invoca: las
// dos unicas dependencias que la funcion usa se inyectan aqui apuntando
// EXCLUSIVAMENTE a una tabla en memoria.
await import("./config.mts");
const { resolveVerificationRequired, buildPublishedEvidence } = await import("./verificationResolution.mts");

let failures = 0;
const check = (label: string, cond: boolean, extra = "") => {
  const mark = cond ? "PASS" : "FAIL";
  if (!cond) failures++;
  console.log(`[${mark}] ${label}${extra ? " — " + extra : ""}`);
};

// SEGURIDAD: fetch global lanza si se le llama - resolveVerificationRequired()
// no debería tocar fetch en absoluto (no importa nada de lib/social/*, no
// llama a Meta, no llama a B2).
const originalFetch = globalThis.fetch;
let fetchCalls = 0;
globalThis.fetch = (async (url: unknown) => {
  fetchCalls++;
  throw new Error(`SEGURIDAD: resolveVerificationRequired() NUNCA debe llamar a fetch/red real (intento hacia: ${String(url)})`);
}) as typeof fetch;

interface FakeRow {
  id: string;
  status: string;
  publisher_operation_ref: string | null;
  external_post_id: string | null;
  error_message: string | null;
  claimed_at: string | null;
  published_at: string | null;
  retry_count: number;
  account_id: string;
  content_file_id: string;
  channel_id: string;
  publication_authorized_at: string | null;
  publication_authorized_by: string | null;
}

// Misma semantica que en test-recover-stale-claims.mts: updateIfVerificationRequired()
// solo aplica el cambio si la fila SIGUE en 'verification_required' - replica
// fielmente el UPDATE ... WHERE status='verification_required' real.
function makeFakeDb(rows: FakeRow[]) {
  const table = rows.map((r) => ({ ...r }));
  const updateCalls: Array<{ postId: string; payload: Record<string, unknown> }> = [];
  const fetchCallsLog: string[] = [];
  return {
    table,
    updateCalls,
    fetchCallsLog,
    async fetchPost(postId: string) {
      fetchCallsLog.push(postId);
      const row = table.find((r) => r.id === postId);
      if (!row) return null;
      return {
        id: row.id,
        status: row.status,
        publisher_operation_ref: row.publisher_operation_ref,
        error_message: row.error_message,
        publication_authorized_at: row.publication_authorized_at,
        publication_authorized_by: row.publication_authorized_by,
      };
    },
    async updateIfVerificationRequired(postId: string, payload: Record<string, unknown>) {
      updateCalls.push({ postId, payload });
      const row = table.find((r) => r.id === postId);
      if (!row || row.status !== "verification_required") return false; // WHERE ya no coincide
      Object.assign(row, payload);
      return true;
    },
    getRow(id: string) {
      return table.find((r) => r.id === id);
    },
  };
}

function baseRow(overrides: Partial<FakeRow> = {}): FakeRow {
  return {
    id: "post-1",
    status: "verification_required",
    publisher_operation_ref: "creation-123",
    external_post_id: null,
    error_message: null,
    claimed_at: null,
    published_at: null,
    retry_count: 0,
    account_id: "account-fixed-1",
    content_file_id: "content-file-fixed-1",
    channel_id: "channel-fixed-1",
    publication_authorized_at: null,
    publication_authorized_by: null,
    ...overrides,
  };
}

const FIXED_NOW = () => new Date("2026-09-16T12:00:00.000Z");

async function main() {
  // ==================================================
  // Caso 1 — published
  // ==================================================
  {
    const db = makeFakeDb([baseRow({ claimed_at: "2026-09-16T10:00:00.000Z" })]);
    const result = await resolveVerificationRequired("post-1", "published", "operador-1", { ...db, now: FIXED_NOW });
    const row = db.getRow("post-1")!;

    check("1. resultado RESOLVED_PUBLISHED", result.code === "RESOLVED_PUBLISHED");
    check("1. status='published'", row.status === "published");
    check("1. published_at != null", row.published_at !== null);
    check("1. external_post_id sigue siendo null (nunca se inventa)", row.external_post_id === null);
    check("1. publisher_operation_ref conserva EXACTAMENTE 'creation-123' (nunca se limpia en esta rama)", row.publisher_operation_ref === "creation-123");
    check("1. error_message contiene 'CONFIRMED_PUBLISHED'", typeof row.error_message === "string" && row.error_message.includes("CONFIRMED_PUBLISHED"));
    check("1. error_message contiene 'creation-123'", typeof row.error_message === "string" && row.error_message.includes("creation-123"));
    check("1. error_message contiene el operador", typeof row.error_message === "string" && row.error_message.includes("operador-1"));
  }

  // ==================================================
  // Caso 2 — published preservando external_post_id preexistente
  // ==================================================
  {
    const db = makeFakeDb([baseRow({ external_post_id: "existing-value" })]);
    await resolveVerificationRequired("post-1", "published", "operador-1", db);
    const row = db.getRow("post-1")!;
    check("2. external_post_id sigue siendo EXACTAMENTE 'existing-value' (no sobrescrito)", row.external_post_id === "existing-value");
  }

  // ==================================================
  // Caso 2b — published conserva evidencia previa en error_message (no la borra)
  // ==================================================
  {
    const db = makeFakeDb([baseRow({ error_message: "Evidencia previa de CANNOT_VERIFY del ciclo anterior." })]);
    await resolveVerificationRequired("post-1", "published", "operador-1", { ...db, now: FIXED_NOW });
    const row = db.getRow("post-1")!;
    check("2b. error_message conserva el texto anterior", row.error_message!.includes("Evidencia previa de CANNOT_VERIFY"));
    check("2b. error_message TAMBIEN incluye la nueva evidencia", row.error_message!.includes("CONFIRMED_PUBLISHED"));
  }

  // ==================================================
  // Caso 3 — retry: debe LIMPIAR publication_authorized_at/by (fix de la
  // auditoria "HUMAN REVIEW FOR RETRY-AFTER-CONFIRMED_NOT_PUBLISHED") ademas
  // de claimed_at/publisher_operation_ref, todo en el MISMO UPDATE atomico.
  // La fila arranca con TODOS los campos "reales" poblados (autorizacion
  // previa incluida) para demostrar que retry limpia exactamente lo que debe
  // y preserva exactamente lo que no debe tocar.
  // ==================================================
  {
    const db = makeFakeDb([
      baseRow({
        publisher_operation_ref: "creation-123",
        claimed_at: "2026-09-16T10:00:00.000Z",
        external_post_id: "should-not-change",
        retry_count: 2,
        account_id: "account-XYZ",
        content_file_id: "content-file-XYZ",
        channel_id: "channel-XYZ",
        publication_authorized_at: "2026-09-15T08:00:00.000Z",
        publication_authorized_by: "operador-previo@example.com",
      }),
    ]);
    const result = await resolveVerificationRequired("post-1", "retry", "operador-1", db);
    const row = db.getRow("post-1")!;

    check("3. resultado RESOLVED_RETRY", result.code === "RESOLVED_RETRY");
    check("3. status='pending'", row.status === "pending");
    check("3. claimed_at=null", row.claimed_at === null);
    check("3. publisher_operation_ref=null", row.publisher_operation_ref === null);
    check("3. publication_authorized_at=null (autorizacion anterior REVOCADA)", row.publication_authorized_at === null);
    check("3. publication_authorized_by=null (autorizacion anterior REVOCADA)", row.publication_authorized_by === null);
    check("3. external_post_id permanece intacto", row.external_post_id === "should-not-change");
    check("3. retry_count permanece intacto", row.retry_count === 2);
    check("3. account_id permanece intacto", row.account_id === "account-XYZ");
    check("3. content_file_id permanece intacto", row.content_file_id === "content-file-XYZ");
    check("3. channel_id permanece intacto", row.channel_id === "channel-XYZ");
    check("3. la limpieza de autorizacion ocurrio en el MISMO UPDATE que el resto (una sola llamada a updateIfVerificationRequired)", db.updateCalls.length === 1);
    check(
      "3. el payload de ese UNICO UPDATE incluye las 4 limpiezas + el nuevo status, sin un segundo UPDATE separado",
      db.updateCalls[0].payload.status === "pending" &&
        db.updateCalls[0].payload.claimed_at === null &&
        db.updateCalls[0].payload.publisher_operation_ref === null &&
        db.updateCalls[0].payload.publication_authorized_at === null &&
        db.updateCalls[0].payload.publication_authorized_by === null
    );
  }

  // ==================================================
  // Caso 3b — retry cuando YA no habia autorizacion (null desde el inicio):
  // debe seguir funcionando exactamente igual, sin lanzar ni comportarse
  // distinto solo porque no habia nada que limpiar.
  // ==================================================
  {
    const db = makeFakeDb([baseRow({ publication_authorized_at: null, publication_authorized_by: null })]);
    const result = await resolveVerificationRequired("post-1", "retry", "operador-1", db);
    const row = db.getRow("post-1")!;
    check("3b. retry sin autorizacion previa -> sigue siendo RESOLVED_RETRY", result.code === "RESOLVED_RETRY");
    check("3b. status='pending'", row.status === "pending");
    check("3b. publication_authorized_at sigue null (nada que romper)", row.publication_authorized_at === null);
    check("3b. publication_authorized_by sigue null (nada que romper)", row.publication_authorized_by === null);
  }

  // ==================================================
  // Caso 4 — keep-blocked: ningun campo relevante cambia, no se ejecuta UPDATE
  // ==================================================
  {
    const snapshot = baseRow({
      claimed_at: "2026-09-16T10:00:00.000Z",
      external_post_id: "unchanged-value",
      publication_authorized_at: "2026-09-15T08:00:00.000Z",
      publication_authorized_by: "operador-previo@example.com",
    });
    const db = makeFakeDb([snapshot]);
    const result = await resolveVerificationRequired("post-1", "keep-blocked", "operador-1", db);
    const row = db.getRow("post-1")!;

    check("4. resultado RESOLVED_KEEP_BLOCKED", result.code === "RESOLVED_KEEP_BLOCKED");
    check("4. NO se ejecuto ningun UPDATE", db.updateCalls.length === 0);
    check("4. status sigue 'verification_required'", row.status === "verification_required");
    check("4. publisher_operation_ref intacto", row.publisher_operation_ref === snapshot.publisher_operation_ref);
    check("4. external_post_id intacto", row.external_post_id === "unchanged-value");
    check("4. claimed_at intacto", row.claimed_at === "2026-09-16T10:00:00.000Z");
    check("4. retry_count intacto", row.retry_count === snapshot.retry_count);
    check("4. publication_authorized_at intacto (keep-blocked NUNCA limpia autorizacion)", row.publication_authorized_at === "2026-09-15T08:00:00.000Z");
    check("4. publication_authorized_by intacto", row.publication_authorized_by === "operador-previo@example.com");
  }

  // ==================================================
  // GAP #2 (auditoria E2E) — evidencia de retry en error_message.
  // buildRetryEvidence() debe: acumular (nunca borrar) evidencia previa;
  // registrar operatorId, timestamp ISO y decision=RETRY; conservar el
  // creationId ORIGINAL como texto (nunca en publisher_operation_ref, que
  // sigue limpiandose a null); declarar honestamente si habia autorizacion
  // previa; y jamas afirmar un resultado de reconciliacion que no se le paso.
  // ==================================================

  // --- Retry Caso 1 — con error_message previo + TODOS los campos poblados ---
  {
    const db = makeFakeDb([
      baseRow({
        error_message: "Evidencia previa: CANNOT_VERIFY en el ciclo anterior.",
        publisher_operation_ref: "creation-777",
        claimed_at: "2026-09-16T09:00:00.000Z",
        publication_authorized_at: "2026-09-15T08:00:00.000Z",
        publication_authorized_by: "operador-previo@example.com",
        retry_count: 2,
        external_post_id: "ext-should-not-change",
      }),
    ]);
    const result = await resolveVerificationRequired("post-1", "retry", "operador-retry@example.com", { ...db, now: FIXED_NOW });
    const row = db.getRow("post-1")!;

    check("RETRY-1. resultado RESOLVED_RETRY", result.code === "RESOLVED_RETRY");
    check("RETRY-1. el texto anterior de error_message PERMANECE", row.error_message!.includes("Evidencia previa: CANNOT_VERIFY"));
    check("RETRY-1. la evidencia nueva declara decision=RETRY", row.error_message!.includes("RETRY"));
    check("RETRY-1. operatorId queda registrado en la evidencia", row.error_message!.includes("operador-retry@example.com"));
    check("RETRY-1. timestamp ISO queda registrado en la evidencia", row.error_message!.includes(FIXED_NOW().toISOString()));
    check("RETRY-1. publication_authorized_at -> null", row.publication_authorized_at === null);
    check("RETRY-1. publication_authorized_by -> null", row.publication_authorized_by === null);
    check("RETRY-1. publisher_operation_ref -> null en el CAMPO", row.publisher_operation_ref === null);
    check("RETRY-1. status='pending'", row.status === "pending");
    check("RETRY-1. retry_count permanece igual (2)", row.retry_count === 2);
    check("RETRY-1. external_post_id permanece igual", row.external_post_id === "ext-should-not-change");
  }

  // --- Retry Caso 2 — sin error_message previo: debe crear evidencia valida ---
  {
    const db = makeFakeDb([baseRow({ error_message: null })]);
    const result = await resolveVerificationRequired("post-1", "retry", "operador-2@example.com", { ...db, now: FIXED_NOW });
    const row = db.getRow("post-1")!;
    check("RETRY-2. resultado RESOLVED_RETRY", result.code === "RESOLVED_RETRY");
    check("RETRY-2. se crea evidencia valida (no null, no vacia)", typeof row.error_message === "string" && row.error_message.length > 0);
    check("RETRY-2. la evidencia menciona RETRY y el operador", row.error_message!.includes("RETRY") && row.error_message!.includes("operador-2@example.com"));
  }

  // --- Retry Caso 3 — operation ref real: se conserva EN LA EVIDENCIA antes de limpiarlo del campo ---
  {
    const REAL_REF = "123456789012345:creation";
    const db = makeFakeDb([baseRow({ publisher_operation_ref: REAL_REF })]);
    await resolveVerificationRequired("post-1", "retry", "operador-3@example.com", { ...db, now: FIXED_NOW });
    const row = db.getRow("post-1")!;
    check("RETRY-3. publisher_operation_ref limpiado a null en el CAMPO", row.publisher_operation_ref === null);
    check("RETRY-3. el creationId ORIGINAL quedó conservado EN LA EVIDENCIA (error_message)", row.error_message!.includes(REAL_REF));
  }

  // --- Retry Caso 4 — con autorización previa: limpieza + evidencia simultáneas ---
  {
    const db = makeFakeDb([baseRow({ publication_authorized_at: "2026-09-15T08:00:00.000Z", publication_authorized_by: "operador-previo@example.com" })]);
    await resolveVerificationRequired("post-1", "retry", "operador-4@example.com", db);
    const row = db.getRow("post-1")!;
    check("RETRY-4. publication_authorized_at -> null", row.publication_authorized_at === null);
    check("RETRY-4. publication_authorized_by -> null", row.publication_authorized_by === null);
    check("RETRY-4. la evidencia declara EXPLÍCITAMENTE que sí existía autorización y fue limpiada", /SI existia.*limpiada/i.test(row.error_message ?? ""));
  }
  // Control — sin autorización previa, la evidencia lo declara honestamente (nunca inventa que existía).
  {
    const db = makeFakeDb([baseRow({ publication_authorized_at: null, publication_authorized_by: null })]);
    await resolveVerificationRequired("post-1", "retry", "operador-4b@example.com", db);
    const row = db.getRow("post-1")!;
    check("RETRY-4b. sin autorización previa, la evidencia dice 'no existía' (nunca finge que sí)", /no existia/i.test(row.error_message ?? ""));
  }

  // --- Retry Caso 5 — keep-blocked NUNCA toca error_message ni crea evidencia de retry ---
  {
    const db = makeFakeDb([baseRow({ error_message: "Evidencia preexistente sin tocar." })]);
    const result = await resolveVerificationRequired("post-1", "keep-blocked", "operador-5@example.com", db);
    const row = db.getRow("post-1")!;
    check("RETRY-5 (keep-blocked). resultado RESOLVED_KEEP_BLOCKED", result.code === "RESOLVED_KEEP_BLOCKED");
    check("RETRY-5 (keep-blocked). error_message NO fue modificado", row.error_message === "Evidencia preexistente sin tocar.");
    check("RETRY-5 (keep-blocked). NO se generó ninguna evidencia de RETRY", !(row.error_message ?? "").includes("RETRY"));
    check("RETRY-5 (keep-blocked). CERO llamadas a updateIfVerificationRequired", db.updateCalls.length === 0);
  }

  // Retry Caso 6 (published sin regresión) y Caso 7 (concurrencia) ya están
  // cubiertos por los Casos 1/2/2b (published sigue acumulando evidencia
  // exactamente igual) y 6/6b (concurrencia) de esta misma suite - no se
  // duplican aquí; ver además la aserción añadida a Caso 6b más abajo.

  // ==================================================
  // Caso 5 — estado incorrecto: rechazo ANTES del UPDATE, para cada decision
  // ==================================================
  for (const wrongStatus of ["pending", "publishing", "published", "error"]) {
    for (const decision of ["published", "retry", "keep-blocked"] as const) {
      const db = makeFakeDb([baseRow({ status: wrongStatus })]);
      const result = await resolveVerificationRequired("post-1", decision, "operador-1", db);
      check(
        `5. status='${wrongStatus}' + decision='${decision}' -> WRONG_STATUS, CERO updates`,
        result.code === "WRONG_STATUS" && (result as any).status === wrongStatus && db.updateCalls.length === 0
      );
    }
  }

  // ==================================================
  // Caso 6 — concurrencia: dos resoluciones simultaneas sobre la MISMA fila,
  // ambas con la MISMA decision ('published') - el escenario mas realista de
  // "dos operadores cerraron el mismo caso a la vez". Solo una puede ganar
  // el UPDATE condicional; la otra debe recibir CONFLICT limpio, sin
  // sobrescribir ni duplicar el resultado.
  // ==================================================
  {
    const db = makeFakeDb([baseRow()]);
    const [resultA, resultB] = await Promise.all([
      resolveVerificationRequired("post-1", "published", "operador-A", { ...db, now: FIXED_NOW }),
      resolveVerificationRequired("post-1", "published", "operador-B", { ...db, now: FIXED_NOW }),
    ]);
    const row = db.getRow("post-1")!;

    const codes = [resultA.code, resultB.code].sort();
    check("6. exactamente un resultado es RESOLVED_PUBLISHED y el otro es CONFLICT (nunca ambos ganan, nunca ambos fallan)", codes[0] === "CONFLICT" && codes[1] === "RESOLVED_PUBLISHED");
    check("6. ambas llamadas intentaron el UPDATE (2 intentos registrados)", db.updateCalls.length === 2);
    check("6. el estado final es 'published' (consistente, un solo ganador, sin corrupcion)", row.status === "published");
    check("6. la evidencia en error_message identifica a UN SOLO operador (el que gano), no a ambos mezclados", (row.error_message?.match(/Reconciliacion cerrada manualmente/g) ?? []).length === 1);
  }

  // ==================================================
  // Caso 6b — misma carrera, ambas resoluciones piden 'retry' - mismo
  // resultado esperado: un solo ganador, un CONFLICT limpio. La fila arranca
  // CON autorizacion previa para confirmar que, tras la carrera, esa
  // autorizacion queda limpia (el ganador la limpio) y que el perdedor
  // (CONFLICT) NUNCA sobrescribe el estado ya resuelto por el ganador.
  // ==================================================
  {
    const db = makeFakeDb([baseRow({ publication_authorized_at: "2026-09-15T08:00:00.000Z", publication_authorized_by: "operador-previo@example.com" })]);
    const [resultA, resultB] = await Promise.all([
      resolveVerificationRequired("post-1", "retry", "operador-A", db),
      resolveVerificationRequired("post-1", "retry", "operador-B", db),
    ]);
    const row = db.getRow("post-1")!;
    const codes = [resultA.code, resultB.code].sort();
    check("6b. exactamente un resultado es RESOLVED_RETRY y el otro es CONFLICT", codes[0] === "CONFLICT" && codes[1] === "RESOLVED_RETRY");
    check("6b. el estado final es 'pending' (un solo ganador, el perdedor no sobrescribe nada)", row.status === "pending");
    check("6b. la autorizacion previa quedo limpia tras la carrera (la aplico el unico ganador)", row.publication_authorized_at === null && row.publication_authorized_by === null);
    check("6b. ambas llamadas intentaron el UPDATE (2 intentos registrados, uno solo tuvo efecto)", db.updateCalls.length === 2);
    check(
      "6b. la evidencia de retry en error_message aparece UNA sola vez (del unico ganador, nunca duplicada/mezclada con el perdedor)",
      (row.error_message?.match(/Resolucion manual RETRY/g) ?? []).length === 1
    );
  }

  // ==================================================
  // Caso 7 — campos que NO deben tocarse (verificacion explicita adicional)
  // ==================================================
  {
    const fixedFields = {
      retry_count: 2,
      account_id: "account-XYZ",
      content_file_id: "content-file-XYZ",
      channel_id: "channel-XYZ",
      external_post_id: "ext-should-stay",
    };

    const db = makeFakeDb([baseRow({ ...fixedFields, publication_authorized_at: "2026-09-15T08:00:00.000Z", publication_authorized_by: "operador-previo@example.com" })]);
    await resolveVerificationRequired("post-1", "published", "operador-1", { ...db, now: FIXED_NOW });
    const rowAfterPublished = db.getRow("post-1")!;
    check("7a. (published) account_id intacto", rowAfterPublished.account_id === "account-XYZ");
    check("7a. (published) content_file_id intacto", rowAfterPublished.content_file_id === "content-file-XYZ");
    check("7a. (published) channel_id intacto", rowAfterPublished.channel_id === "channel-XYZ");
    check("7a. (published) retry_count intacto", rowAfterPublished.retry_count === 2);
    check("7a. (published) external_post_id intacto", rowAfterPublished.external_post_id === "ext-should-stay");
    check(
      "7a. (published) autorizacion existente se PRESERVA (published nunca la limpia - contrato congelado, distinto de retry)",
      rowAfterPublished.publication_authorized_at === "2026-09-15T08:00:00.000Z" && rowAfterPublished.publication_authorized_by === "operador-previo@example.com"
    );

    const db2 = makeFakeDb([baseRow({ ...fixedFields, publication_authorized_at: "2026-09-15T08:00:00.000Z", publication_authorized_by: "operador-previo@example.com" })]);
    await resolveVerificationRequired("post-1", "retry", "operador-1", db2);
    const rowAfterRetry = db2.getRow("post-1")!;
    check("7b. (retry) account_id intacto", rowAfterRetry.account_id === "account-XYZ");
    check("7b. (retry) content_file_id intacto", rowAfterRetry.content_file_id === "content-file-XYZ");
    check("7b. (retry) channel_id intacto", rowAfterRetry.channel_id === "channel-XYZ");
    check("7b. (retry) retry_count intacto (esta funcion no es el mecanismo de reintentos por fallo)", rowAfterRetry.retry_count === 2);
    check("7b. (retry) external_post_id intacto", rowAfterRetry.external_post_id === "ext-should-stay");
    check("7b. (retry) autorizacion existente SI se limpia (este es el fix de esta fase)", rowAfterRetry.publication_authorized_at === null && rowAfterRetry.publication_authorized_by === null);
  }

  // ==================================================
  // Validaciones de entrada adicionales
  // ==================================================
  {
    const db = makeFakeDb([baseRow()]);
    const result = await resolveVerificationRequired("post-1", "published", "", db);
    check("Extra. operatorId vacio -> OPERATOR_ID_MISSING, CERO lecturas/escrituras", result.code === "OPERATOR_ID_MISSING" && db.fetchCallsLog.length === 0 && db.updateCalls.length === 0);
  }
  {
    const db = makeFakeDb([]);
    const result = await resolveVerificationRequired("post-inexistente", "retry", "operador-1", db);
    check("Extra. post inexistente -> POST_NOT_FOUND, CERO updates", result.code === "POST_NOT_FOUND" && db.updateCalls.length === 0);
  }
  {
    // buildPublishedEvidence() pura, sin post previo con error_message
    const evidence = buildPublishedEvidence(null, "creation-999", "operador-x", "2026-09-16T00:00:00.000Z");
    check("Extra. buildPublishedEvidence() sin evidencia previa produce una sola linea con los datos requeridos", evidence.includes("CONFIRMED_PUBLISHED") && evidence.includes("creation-999") && evidence.includes("operador-x"));
    const evidenceNoRef = buildPublishedEvidence(null, null, "operador-x", "2026-09-16T00:00:00.000Z");
    check("Extra. buildPublishedEvidence() sin publisher_operation_ref indica 'ninguno' explicitamente", evidenceNoRef.includes("ninguno"));
  }

  // ==================================================
  // Caso 8 — seguridad
  // ==================================================
  check("8. Meta calls = 0 (fetch nunca invocado)", fetchCalls === 0);
  console.log("8. Supabase real writes = 0 (todas las deps de esta corrida son fakes en memoria, supabaseAdmin nunca fue invocado)");
  console.log("8. B2 calls = 0 (este archivo no importa storageBridge.mts ni @aws-sdk/client-s3)");

  console.log(`\n${failures === 0 ? "TODAS LAS PRUEBAS PASARON" : `${failures} PRUEBA(S) FALLARON`}`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().finally(() => {
  globalThis.fetch = originalFetch;
});

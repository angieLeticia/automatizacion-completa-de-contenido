// Auditoria de cierre de brecha — prueba EJECUTABLE de recoverStaleClaims()
// (la funcion real, no una copia) contra una base de datos EN MEMORIA
// inyectada vía RecoverStaleClaimsDeps (agent/publish/claimPost.mts). Hasta
// esta prueba, solo la logica de clasificacion pura (classifyStaleClaim, en
// test-claim-recovery.mts) tenia cobertura ejecutable — recoverStaleClaims()
// en si (el SELECT + UPDATE atomico condicional) solo estaba verificado por
// lectura de codigo.
//
// CLAIMED_AT_MIGRATION_APPLIED=true se fija ANTES de importar config.mts/
// claimPost.mts (es una constante de modulo, evaluada una sola vez al
// importar) - sin esto, recoverStaleClaims() retorna {0,0,0} de inmediato
// (guard de la linea 213) y no ejercitaria nada. ./config.mts se importa
// primero (mismo patron que run.mts) para cargar .env.local ANTES de que
// claimPost.mts construya supabaseAdmin - de lo contrario, claimPost.mts
// lanzaria "supabaseUrl is required" solo por importarlo (mismo bug ya
// corregido en reconcile-instagram.mts). El cliente Supabase real SI se
// construye (no se puede evitar, vive en supabaseClient.mts), pero NUNCA se
// invoca: los dos unicos metodos que recoverStaleClaims() usa
// (findStaleClaims/updateIfPublishing) se inyectan aqui apuntando EXCLUSIVAMENTE
// a una tabla en memoria - cero llamadas de red a Supabase real, cero POST a
// Meta, cero acceso a B2.
process.env.CLAIMED_AT_MIGRATION_APPLIED = "true";
await import("./config.mts");
const { recoverStaleClaims } = await import("./claimPost.mts");
const { MAX_RETRIES, STALE_CLAIM_MINUTES } = await import("./config.mts");

let failures = 0;
const check = (label: string, cond: boolean, extra = "") => {
  const mark = cond ? "PASS" : "FAIL";
  if (!cond) failures++;
  console.log(`[${mark}] ${label}${extra ? " — " + extra : ""}`);
};

// SEGURIDAD (Objetivo "no llamadas HTTP a Meta"): fetch global se stubbea
// para lanzar SIEMPRE que se le llame - recoverStaleClaims() no deberia
// tocar fetch en absoluto (no importa nada de lib/social/*), asi que esta
// prueba tambien sirve como red de seguridad estructural: si algun cambio
// futuro introdujera una llamada real, esta prueba fallaria ruidosamente en
// vez de silenciosamente.
const originalFetch = globalThis.fetch;
let fetchCalls = 0;
globalThis.fetch = (async (url: unknown) => {
  fetchCalls++;
  throw new Error(`SEGURIDAD: recoverStaleClaims() NUNCA debe llamar a fetch/red real (intento hacia: ${String(url)})`);
}) as typeof fetch;

interface FakeRow {
  id: string;
  status: string;
  claimed_at: string | null;
  retry_count: number;
  publisher_operation_ref: string | null;
  external_post_id: string | null;
  error_message: string | null;
}

// Simula fielmente la semantica de Postgres UPDATE ... WHERE status='publishing':
// updateIfPublishing() solo aplica el cambio si la fila SIGUE en 'publishing'
// en el momento de la llamada - exactamente la misma condicion atomica que
// la implementacion real usa contra Supabase (ver defaultRecoverStaleClaimsDeps
// en claimPost.mts). El acceso es sincrono (sin gap de red real), pero eso
// hace la garantia MAS estricta, no menos: si dos llamadas a
// recoverStaleClaims() comparten esta misma tabla, solo la primera que
// ejecute updateIfPublishing() para una fila dada puede ganarla.
function makeFakeDb(rows: FakeRow[]) {
  const table = rows.map((r) => ({ ...r }));
  const updateCalls: Array<{ postId: string; payload: Record<string, unknown> }> = [];
  const findCalls: string[] = [];
  return {
    table,
    updateCalls,
    findCalls,
    async findStaleClaims(cutoffIso: string) {
      findCalls.push(cutoffIso);
      return table
        .filter((r) => r.status === "publishing" && r.claimed_at !== null && r.claimed_at < cutoffIso)
        .map((r) => ({ id: r.id, retry_count: r.retry_count, publisher_operation_ref: r.publisher_operation_ref }));
    },
    async updateIfPublishing(postId: string, payload: Record<string, unknown>) {
      updateCalls.push({ postId, payload });
      const row = table.find((r) => r.id === postId);
      if (!row || row.status !== "publishing") return false; // WHERE status='publishing' ya no coincide
      Object.assign(row, payload);
      return true;
    },
    getRow(id: string) {
      return table.find((r) => r.id === id);
    },
  };
}

function isoMinutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

async function main() {
  const staleTimestamp = isoMinutesAgo(STALE_CLAIM_MINUTES + 5); // claramente mas viejo que el cutoff
  const freshTimestamp = isoMinutesAgo(1); // claramente reciente, no debe recuperarse

  // ==================================================
  // Caso A — publisher_operation_ref=null -> retry (pending o error segun retry_count)
  // ==================================================
  {
    const db = makeFakeDb([
      { id: "post-A1", status: "publishing", claimed_at: staleTimestamp, retry_count: 0, publisher_operation_ref: null, external_post_id: null, error_message: null },
      { id: "post-A2", status: "publishing", claimed_at: staleTimestamp, retry_count: MAX_RETRIES - 1, publisher_operation_ref: null, external_post_id: "ext-existing-A2", error_message: null },
    ]);
    const result = await recoverStaleClaims(db);
    const rowA1 = db.getRow("post-A1")!;
    const rowA2 = db.getRow("post-A2")!;

    check("A1. retry_count=0 -> nextRetryCount=1 (<MAX_RETRIES) -> status=pending", rowA1.status === "pending");
    check("A1. retry_count incrementado a 1", rowA1.retry_count === 1);
    check("A1. claimed_at=null", rowA1.claimed_at === null);
    check("A1. publisher_operation_ref=null (rama retry SI lo limpia)", rowA1.publisher_operation_ref === null);
    check("A1. error_message fue escrito", typeof rowA1.error_message === "string" && rowA1.error_message.length > 0);

    check(`A2. retry_count=${MAX_RETRIES - 1} -> nextRetryCount=${MAX_RETRIES} (>=MAX_RETRIES) -> status=error`, rowA2.status === "error");
    check(`A2. retry_count incrementado a ${MAX_RETRIES}`, rowA2.retry_count === MAX_RETRIES);
    check("A2. claimed_at=null", rowA2.claimed_at === null);
    check("A2. publisher_operation_ref=null", rowA2.publisher_operation_ref === null);
    check("A2. external_post_id NUNCA se toca (sigue igual)", rowA2.external_post_id === "ext-existing-A2");

    check("A. contador recoveredToPending incluye A1", result.recoveredToPending === 1);
    check("A. contador movedToError incluye A2", result.movedToError === 1);
    check("A. contador movedToVerification=0", result.movedToVerification === 0);
  }

  // ==================================================
  // Caso B — publisher_operation_ref='pending:instagram' -> verification_required, ref preservado
  // ==================================================
  {
    const db = makeFakeDb([
      { id: "post-B1", status: "publishing", claimed_at: staleTimestamp, retry_count: 0, publisher_operation_ref: "pending:instagram", external_post_id: null, error_message: null },
    ]);
    const result = await recoverStaleClaims(db);
    const row = db.getRow("post-B1")!;

    check("B. status='verification_required'", row.status === "verification_required");
    check("B. publisher_operation_ref sigue siendo 'pending:instagram' (preservado, NO limpiado)", row.publisher_operation_ref === "pending:instagram");
    check("B. claimed_at=null", row.claimed_at === null);
    check("B. retry_count NO se toca en esta rama (sigue en 0)", row.retry_count === 0);
    check("B. external_post_id sigue null", row.external_post_id === null);
    check("B. contador movedToVerification=1", result.movedToVerification === 1);
  }

  // ==================================================
  // Caso C — publisher_operation_ref='<creationId real>' -> verification_required, ref intacta
  // ==================================================
  {
    const REAL_CREATION_ID = "123456789012345:creation";
    const db = makeFakeDb([
      { id: "post-C1", status: "publishing", claimed_at: staleTimestamp, retry_count: 0, publisher_operation_ref: REAL_CREATION_ID, external_post_id: null, error_message: null },
    ]);
    const result = await recoverStaleClaims(db);
    const row = db.getRow("post-C1")!;

    check("C. status='verification_required'", row.status === "verification_required");
    check("C. publisher_operation_ref conserva EXACTAMENTE el creationId real", row.publisher_operation_ref === REAL_CREATION_ID);
    check("C. claimed_at=null", row.claimed_at === null);
    check("C. contador movedToVerification=1", result.movedToVerification === 1);
  }

  // ==================================================
  // Caso D — referencia de otra plataforma (ej. YouTube) -> verification_required, ref intacta
  // ==================================================
  {
    const OTHER_PLATFORM_REF = "youtube:123456789";
    const db = makeFakeDb([
      { id: "post-D1", status: "publishing", claimed_at: staleTimestamp, retry_count: 0, publisher_operation_ref: OTHER_PLATFORM_REF, external_post_id: null, error_message: null },
    ]);
    const result = await recoverStaleClaims(db);
    const row = db.getRow("post-D1")!;

    check("D. status='verification_required' (clasificacion NO distingue plataforma, solo null/no-null)", row.status === "verification_required");
    check("D. referencia de otra plataforma conservada EXACTAMENTE igual", row.publisher_operation_ref === OTHER_PLATFORM_REF);
    check("D. claimed_at=null", row.claimed_at === null);
  }

  // ==================================================
  // Caso E — fila NO stale (claimed_at reciente) -> ni seleccionada ni actualizada
  // ==================================================
  {
    const db = makeFakeDb([
      { id: "post-E1", status: "publishing", claimed_at: freshTimestamp, retry_count: 0, publisher_operation_ref: null, external_post_id: null, error_message: null },
    ]);
    const result = await recoverStaleClaims(db);
    const row = db.getRow("post-E1")!;

    check("E. fila reciente NUNCA aparece en el resultado de findStaleClaims (verificado indirectamente: 0 updates)", db.updateCalls.length === 0);
    check("E. la fila permanece exactamente igual (status sigue 'publishing')", row.status === "publishing" && row.claimed_at === freshTimestamp);
    check("E. contadores todos en 0", result.recoveredToPending === 0 && result.movedToVerification === 0 && result.movedToError === 0);
  }

  // ==================================================
  // Caso F — concurrencia: dos llamadas a recoverStaleClaims() contra la MISMA
  // tabla en memoria compartida. Solo una debe poder ganar el UPDATE
  // condicional para la fila compartida; la otra debe perder limpiamente sin
  // sobrescribir ni duplicar el resultado.
  // ==================================================
  {
    const db = makeFakeDb([
      { id: "post-F1", status: "publishing", claimed_at: staleTimestamp, retry_count: 0, publisher_operation_ref: "555555555555555:creation", external_post_id: null, error_message: null },
    ]);

    const [resultA, resultB] = await Promise.all([recoverStaleClaims(db), recoverStaleClaims(db)]);
    const row = db.getRow("post-F1")!;

    const totalMoved = resultA.movedToVerification + resultB.movedToVerification;
    check("F. la fila SOLO se cuenta como recuperada UNA vez entre ambas llamadas (nunca 2)", totalMoved === 1);
    check("F. ambas llamadas intentaron el UPDATE para la misma fila (2 intentos registrados)", db.updateCalls.filter((c) => c.postId === "post-F1").length === 2);
    check("F. la fila terminó en verification_required (un solo ganador, resultado consistente)", row.status === "verification_required");
    check("F. publisher_operation_ref conservado intacto pese a la carrera", row.publisher_operation_ref === "555555555555555:creation");
  }

  // ==================================================
  // Caso G — external_post_id preexistente permanece EXACTAMENTE igual tras la recuperacion
  // ==================================================
  {
    const db = makeFakeDb([
      { id: "post-G1", status: "publishing", claimed_at: staleTimestamp, retry_count: 0, publisher_operation_ref: "999999999999999:creation", external_post_id: "ig-external-post-id-should-not-change", error_message: null },
    ]);
    await recoverStaleClaims(db);
    const row = db.getRow("post-G1")!;
    check("G. external_post_id permanece EXACTAMENTE igual (rama verification_required nunca lo toca)", row.external_post_id === "ig-external-post-id-should-not-change");
  }

  // ==================================================
  // Seguridad — ninguna de las pruebas anteriores debe haber llamado a fetch
  // (POST a Meta, media_publish, uploads/downloads de B2 - todos pasarian por
  // fetch en este proyecto).
  // ==================================================
  check("SEGURIDAD. Cero llamadas a fetch/red real en todo el archivo (recoverStaleClaims() no toca Meta ni B2)", fetchCalls === 0);

  console.log(`\n${failures === 0 ? "TODAS LAS PRUEBAS PASARON" : `${failures} PRUEBA(S) FALLARON`}`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().finally(() => {
  globalThis.fetch = originalFetch;
});

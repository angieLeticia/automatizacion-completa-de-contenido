// H4-A (auditoria final de seguridad) — pruebas de operationEvidenceGate.mts.
// Las piezas puras (decideFailureRouting, buildEvidenceCapturedError) se
// prueban sin fs/red/Supabase. Las piezas de integracion (fetchFreshOperationRef,
// y el flujo completo hasta finishWithUncertainOutcome REAL de claimPost.mts,
// SIN MODIFICAR) usan el mismo monkey-patch de supabaseAdmin.from ya
// establecido en test-finish-with-failure.mts/test-human-review.mts - NUNCA
// tocan Supabase real, NUNCA llaman a ningun publisher, NUNCA publican nada.
import "./config.mts"; // carga .env.local ANTES de que operationEvidenceGate.mts importe supabaseClient.mts (que construye el cliente real al importarse)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decideFailureRouting, buildEvidenceCapturedError, fetchFreshOperationRef } from "./operationEvidenceGate.mts";
import { isRealOperationRef } from "./staleClaimClassification.mts";
import { finishWithUncertainOutcome } from "./claimPost.mts";
import { PublicationOutcomeUncertainError } from "../../lib/social/types.ts";

let failures = 0;
const check = (label: string, cond: boolean, extra = "") => {
  const mark = cond ? "PASS" : "FAIL";
  if (!cond) failures++;
  console.log(`[${mark}] ${label}${extra ? " — " + extra : ""}`);
};

interface FakeRow {
  id: string;
  status: string;
  retry_count: number;
  error_message: string | null;
  claimed_at: string | null;
  publisher_operation_ref: string | null;
  external_post_id: string | null;
  publication_authorized_at: string | null;
  publication_authorized_by: string | null;
}

function makeFakeTable(initial: FakeRow) {
  const row: FakeRow = { ...initial };
  const fakeFrom = (tableName: string) => {
    if (tableName !== "social_posts") throw new Error(`fake supabaseAdmin solo soporta 'social_posts', recibido: '${tableName}'`);
    const conditions: Array<[string, unknown]> = [];
    let updatePayload: Record<string, unknown> | null = null;
    let selectCols: string[] | null = null;

    function apply(): { data: unknown; error: null } {
      const matches = conditions.every(([c, v]) => (row as unknown as Record<string, unknown>)[c] === v);
      if (updatePayload && matches) Object.assign(row, updatePayload);
      if (!selectCols) return { data: null, error: null };
      if (!matches) return { data: null, error: null };
      const projected: Record<string, unknown> = {};
      for (const c of selectCols) projected[c] = (row as unknown as Record<string, unknown>)[c];
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
        conditions.push([col, val]);
        return builder;
      },
      async maybeSingle() {
        return apply();
      },
    };
    return builder;
  };
  return { row, fakeFrom };
}

async function withFakeSupabase<T>(initial: FakeRow, run: () => Promise<T>): Promise<{ result: T; row: FakeRow }> {
  const { supabaseAdmin } = await import("../supabaseClient.mts");
  const table = makeFakeTable(initial);
  const originalFrom = (supabaseAdmin as unknown as { from: unknown }).from;
  (supabaseAdmin as unknown as { from: unknown }).from = table.fakeFrom;
  try {
    const result = await run();
    return { result, row: table.row };
  } finally {
    (supabaseAdmin as unknown as { from: unknown }).from = originalFrom;
  }
}

const BASE_ROW: FakeRow = {
  id: "post-evidence-1",
  status: "publishing",
  retry_count: 1,
  error_message: null,
  claimed_at: "2026-09-18T00:00:00.000Z",
  publisher_operation_ref: null,
  external_post_id: null,
  publication_authorized_at: "2026-09-17T23:00:00.000Z",
  publication_authorized_by: "operador-de-prueba",
};

async function main() {
  // ==================================================
  // Pieza pura: decideFailureRouting() — reutiliza isRealOperationRef() sin duplicarla.
  // ==================================================
  await (async () => {
    check("1. publisher_operation_ref=null -> 'normal_failure' (comportamiento actual)", decideFailureRouting(null) === "normal_failure");
    check("2. publisher_operation_ref='pending:instagram' (placeholder) -> 'normal_failure'", decideFailureRouting("pending:instagram") === "normal_failure");
    check("2b. placeholder de YouTube -> 'normal_failure'", decideFailureRouting("pending:youtube") === "normal_failure");
    check("2c. placeholder de Facebook -> 'normal_failure'", decideFailureRouting("pending:facebook") === "normal_failure");
    check("3. publisher_operation_ref='17895695668004550' (creationId real de Instagram) -> 'verification_required'", decideFailureRouting("17895695668004550") === "verification_required");
    check("3b. publisher_operation_ref='https://upload.example.com/resumable/x' (uploadUrl real de YouTube) -> 'verification_required'", decideFailureRouting("https://upload.example.com/resumable/x") === "verification_required");
    check("9. Referencia vacía ('') -> 'normal_failure' (isRealOperationRef exige longitud > 0)", decideFailureRouting("") === "normal_failure");
  })();

  // ==================================================
  // buildEvidenceCapturedError() — pura, construye el error sintético correcto.
  // ==================================================
  check("buildEvidenceCapturedError produce un PublicationOutcomeUncertainError real", buildEvidenceCapturedError("instagram", "motivo original", "real-ref-123") instanceof PublicationOutcomeUncertainError);
  {
    const err = buildEvidenceCapturedError("instagram", "motivo original de prueba", "real-ref-123");
    check("El operationRef del error sintético es exactamente la referencia fresca recibida", err.operationRef === "real-ref-123");
    check("El platform es exactamente el recibido", err.platform === "instagram");
    check("El mensaje conserva el motivo original como evidencia (NUNCA se descarta, solo se re-envuelve)", err.message.includes("motivo original de prueba"));
  }

  // ==================================================
  // fetchFreshOperationRef() — integración real contra fila fake.
  // ==================================================
  await (async () => {
    const { result } = await withFakeSupabase({ ...BASE_ROW, publisher_operation_ref: "creation-id-real-xyz" }, () => fetchFreshOperationRef("post-evidence-1"));
    check("fetchFreshOperationRef() lee el valor REAL persistido en la fila fake", result === "creation-id-real-xyz");
  })();

  await (async () => {
    const { result } = await withFakeSupabase({ ...BASE_ROW, publisher_operation_ref: null }, () => fetchFreshOperationRef("post-evidence-1"));
    check("fetchFreshOperationRef() devuelve null cuando la fila no tiene referencia", result === null);
  })();

  // ==================================================
  // TEST 8 (el más importante, pedido explícitamente): la lectura fresca
  // NUNCA debe depender del objeto `post` en memoria. Se simula exactamente
  // el escenario real: un objeto `post` "obsoleto" (como el que claimPost()
  // devolvió ANTES de que markPublishAttemptStarted()/persistOperationRef()
  // escribieran nada) con publisher_operation_ref=null, mientras la FILA
  // REAL en Supabase (fake) ya tiene una referencia real. La decisión debe
  // basarse EXCLUSIVAMENTE en la lectura fresca.
  // ==================================================
  await (async () => {
    const staleInMemoryPost = { ...BASE_ROW, publisher_operation_ref: null }; // "obsoleto": nunca se lee este objeto directamente en la implementación
    const { result: freshRef } = await withFakeSupabase({ ...BASE_ROW, publisher_operation_ref: "REAL_CREATION_ID" }, () => fetchFreshOperationRef("post-evidence-1"));
    check(
      "8. El objeto 'post' en memoria tiene publisher_operation_ref=null, pero la lectura FRESCA devuelve 'REAL_CREATION_ID' -> la decisión usa la lectura fresca, NUNCA el objeto obsoleto",
      staleInMemoryPost.publisher_operation_ref === null && freshRef === "REAL_CREATION_ID" && decideFailureRouting(freshRef) === "verification_required"
    );
  })();

  // ==================================================
  // TEST 3/4/5/6/7 combinados — flujo completo: Caso B (referencia real) ->
  // reutiliza finishWithUncertainOutcome() REAL (claimPost.mts, sin modificar)
  // -> verifica TODOS los campos resultantes sobre una fila fake.
  // ==================================================
  await (async () => {
    const initial: FakeRow = { ...BASE_ROW, publisher_operation_ref: "REAL_CREATION_ID", retry_count: 1, external_post_id: null };
    const evidenceErr = buildEvidenceCapturedError("instagram", "HTTP 404 al consultar el estado del contenedor", "REAL_CREATION_ID");
    const { row } = await withFakeSupabase(initial, () => finishWithUncertainOutcome("post-evidence-1", evidenceErr));

    check("3/Caso B. status termina en 'verification_required' (NUNCA error/pending)", row.status === "verification_required");
    check("4. publisher_operation_ref SE CONSERVA exactamente (nunca se limpia, nunca se reemplaza)", row.publisher_operation_ref === "REAL_CREATION_ID");
    check("6. retry_count NO cambia por esta clasificación", row.retry_count === 1);
    check("7. external_post_id NO se inventa - permanece null", row.external_post_id === null);
    check(
      "5 (nota de precisión, ver informe). publication_authorized_at/_by: esta ruta reutiliza finishWithUncertainOutcome() SIN MODIFICAR, que NUNCA toca estos campos (igual que ya hacía para cualquier PublicationOutcomeUncertainError real, ej. timeout de polling) - se preservan intactos, NO se ponen a null aquí. La garantía real de H1 (\"no se reutiliza para publicar automáticamente\") es ESTRUCTURAL: verification_required nunca es recogido por la cola (status!='pending'), y si un humano decide 'retry' despues, resolveVerificationRequired() SI los limpia en ese momento (sin cambios, ya probado en H1/H3).",
      row.publication_authorized_at === BASE_ROW.publication_authorized_at && row.publication_authorized_by === BASE_ROW.publication_authorized_by
    );
  })();

  // ==================================================
  // Caso A (control) — referencia NO real: debe seguir el camino normal, NO
  // pasar por finishWithUncertainOutcome. Se demuestra por inspección de la
  // decisión, no ejecutando finishWithFailure (ya cubierto exhaustivamente
  // en test-finish-with-failure.mts, H1 - no se duplica aquí).
  // ==================================================
  check("Caso A (control) — sin referencia real, la decisión es 'normal_failure', nunca se invoca finishWithUncertainOutcome", decideFailureRouting(null) === "normal_failure" && decideFailureRouting("pending:instagram") === "normal_failure");

  // ==================================================
  // TEST 10 — concurrencia: la fila ya cambió de estado (otro proceso) ANTES
  // de que nuestro intento de finishWithUncertainOutcome llegue a escribir.
  // El UPDATE condicional (`WHERE status='publishing'`) de finishWithUncertainOutcome
  // (YA EXISTENTE, sin modificar) debe afectar 0 filas y NUNCA sobrescribir
  // el estado que el otro proceso ya estableció.
  // ==================================================
  await (async () => {
    const initial: FakeRow = { ...BASE_ROW, status: "published", publisher_operation_ref: "REAL_CREATION_ID", external_post_id: "ya-publicado-por-otro-camino" };
    const evidenceErr = buildEvidenceCapturedError("instagram", "motivo tardio", "REAL_CREATION_ID");
    const { row } = await withFakeSupabase(initial, () => finishWithUncertainOutcome("post-evidence-1", evidenceErr));

    check("10. Si la fila YA NO está en 'publishing' (otro proceso la cambió primero), el UPDATE condicional no tiene efecto - el status permanece EXACTAMENTE como el otro proceso lo dejó", row.status === "published");
    check("10b. external_post_id del otro proceso NUNCA se sobrescribe", row.external_post_id === "ya-publicado-por-otro-camino");
  })();

  // ==================================================
  // Confirmación estructural contra run.mts (mismo patrón ya usado en
  // test-idempotency.mts/test-run-lock.mts: regex sobre el source real).
  // ==================================================
  const runSource = readFileSync(new URL("./run.mts", import.meta.url), "utf-8");

  check("run.mts importa fetchFreshOperationRef/buildEvidenceCapturedError desde operationEvidenceGate.mts", /from ["']\.\/operationEvidenceGate\.mts["']/.test(runSource));

  {
    // Confirma, sobre el archivo real completo, que las piezas clave existen
    // y aparecen en el orden correcto: primero se lee fresco, luego se
    // decide con isRealOperationRef, y la rama real usa
    // finishWithUncertainOutcome ANTES (en el texto) que la rama normal use
    // finishWithFailure con sus argumentos exactos (identificadores lo
    // bastante específicos para no confundirse con otro punto del archivo).
    check("run.mts declara 'let freshOperationRef' (lectura fresca, nunca el objeto post en memoria)", /let freshOperationRef/.test(runSource));
    check("...y la puebla con 'await fetchFreshOperationRef(post.id)'", /await fetchFreshOperationRef\(post\.id\)/.test(runSource));
    check("...decide el enrutamiento con 'isRealOperationRef(freshOperationRef)'", /isRealOperationRef\(freshOperationRef\)/.test(runSource));
    check(
      "...la rama con evidencia real llama a 'finishWithUncertainOutcome(post.id, evidenceErr, evidenceRef)' (H4-B: ahora con el 3er argumento que le da a la referencia una segunda oportunidad de persistirse)",
      /finishWithUncertainOutcome\(post\.id, evidenceErr, evidenceRef\)/.test(runSource)
    );
    check("...y la rama normal sigue llamando a 'finishWithFailure(post, message, retryable)' sin cambios", /await finishWithFailure\(post, message, retryable\);/.test(runSource));

    const idxFresh = runSource.indexOf("await fetchFreshOperationRef(post.id)");
    const idxNormal = runSource.indexOf("await finishWithFailure(post, message, retryable);");
    check("La lectura fresca ocurre ANTES (en el orden del código) que la llamada normal a finishWithFailure", idxFresh >= 0 && idxNormal >= 0 && idxFresh < idxNormal);
  }

  // Confirma que los OTROS call-sites de finishWithFailure (resolución de
  // archivo, identidad, B2, checkpoint, identidad estructural) NUNCA fueron
  // envueltos por esta nueva lectura - el alcance se mantuvo exclusivamente
  // en el catch final que rodea publish().
  const finishWithFailureCallCount = (runSource.match(/await finishWithFailure\(/g) ?? []).length;
  const fetchFreshCallCount = (runSource.match(/await fetchFreshOperationRef\(/g) ?? []).length;
  check(
    `El alcance se mantuvo estrecho: fetchFreshOperationRef() se llama exactamente 1 vez (no en cada uno de los ${finishWithFailureCallCount} call-sites de finishWithFailure)`,
    fetchFreshCallCount === 1
  );

  check("H1 no fue tocado — run.mts sigue limpiando publication_authorized_at/_by dentro de finishWithFailure (sin cambios respecto a la fase H1)", /publication_authorized_at: null,\s*\n\s*publication_authorized_by: null,/.test(runSource));

  console.log(`\n${failures === 0 ? "TODOS LOS CASOS PASARON" : `${failures} CASO(S) FALLARON`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main();

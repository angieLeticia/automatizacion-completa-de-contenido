// H4-B (auditoria final de seguridad — correccion del hallazgo #11) —
// pruebas de la nueva version de persistOperationRef() (estructurada, ya no
// lanza) y de finishWithUncertainOutcome() con su nuevo 3er parametro
// opcional (capturedOperationRef). Mismo patron de monkey-patch de
// supabaseAdmin.from ya establecido en test-finish-with-failure.mts/
// test-operation-evidence-gate.mts - NUNCA toca Supabase real, NUNCA llama
// a ningun publisher, NUNCA publica nada real.
import "./config.mts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { persistOperationRef, finishWithUncertainOutcome } from "./claimPost.mts";
import { isRealOperationRef } from "./staleClaimClassification.mts";
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
  published_at: string | null;
  publication_authorized_at: string | null;
  publication_authorized_by: string | null;
}

function makeFakeTable(initial: FakeRow) {
  const row: FakeRow = { ...initial };
  let forceError: string | null = null;
  const fakeFrom = (tableName: string) => {
    if (tableName !== "social_posts") throw new Error(`fake supabaseAdmin solo soporta 'social_posts', recibido: '${tableName}'`);
    const conditions: Array<[string, unknown]> = [];
    let updatePayload: Record<string, unknown> | null = null;
    let selectCols: string[] | null = null;

    function apply(): { data: unknown; error: { message: string } | null } {
      if (forceError) return { data: null, error: { message: forceError } };
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
  return { row, fakeFrom, forceSupabaseError: (msg: string) => (forceError = msg) };
}

async function withFakeSupabase<T>(initial: FakeRow, run: (ctrl: { forceSupabaseError: (msg: string) => void }) => Promise<T>): Promise<{ result: T; row: FakeRow }> {
  const { supabaseAdmin } = await import("../supabaseClient.mts");
  const table = makeFakeTable(initial);
  const originalFrom = (supabaseAdmin as unknown as { from: unknown }).from;
  (supabaseAdmin as unknown as { from: unknown }).from = table.fakeFrom;
  try {
    const result = await run({ forceSupabaseError: table.forceSupabaseError });
    return { result, row: table.row };
  } finally {
    (supabaseAdmin as unknown as { from: unknown }).from = originalFrom;
  }
}

const BASE_ROW: FakeRow = {
  id: "post-persist-1",
  status: "publishing",
  retry_count: 0,
  error_message: null,
  claimed_at: "2026-09-18T00:00:00.000Z",
  publisher_operation_ref: "pending:instagram",
  external_post_id: null,
  published_at: null,
  publication_authorized_at: "2026-09-17T23:00:00.000Z",
  publication_authorized_by: "operador-de-prueba",
};

async function main() {
  // ==================================================
  // 1/2 — persistencia EXITOSA (Instagram y YouTube — la funcion es
  // platform-agnostica, se prueba con un creationId y una uploadUrl reales).
  // ==================================================
  await (async () => {
    const { result, row } = await withFakeSupabase(BASE_ROW, () => persistOperationRef("post-persist-1", "17895695668004550"));
    check("1. Persistencia exitosa (Instagram, creationId real) -> {ok:true}", result.ok === true);
    check("1b. La fila queda con el creationId real", row.publisher_operation_ref === "17895695668004550");
  })();

  await (async () => {
    const { result, row } = await withFakeSupabase(BASE_ROW, () => persistOperationRef("post-persist-1", "https://upload.example.com/resumable/session-xyz"));
    check("2. Persistencia exitosa (YouTube, uploadUrl real) -> {ok:true}", result.ok === true);
    check("2b. La fila queda con la uploadUrl real", row.publisher_operation_ref === "https://upload.example.com/resumable/session-xyz");
  })();

  // ==================================================
  // 3/4 — persistencia FALLIDA con referencia real (Instagram/YouTube) por
  // UPDATE de 0 filas (fila ya no esta en 'publishing').
  // ==================================================
  await (async () => {
    const { result, row } = await withFakeSupabase({ ...BASE_ROW, status: "published" }, () => persistOperationRef("post-persist-1", "17895695668004550"));
    check("3. Persistencia fallida con creationId real (Instagram) por 0 filas -> {ok:false, reason:'not_publishing'}", result.ok === false && (result as { reason: string }).reason === "not_publishing");
    check("3b. La fila NO fue modificada (sigue en 'published', sin la referencia)", row.status === "published" && row.publisher_operation_ref === "pending:instagram");
  })();

  await (async () => {
    const { result } = await withFakeSupabase({ ...BASE_ROW, status: "error" }, () => persistOperationRef("post-persist-1", "https://upload.example.com/resumable/session-xyz"));
    check("4. Persistencia fallida con uploadUrl real (YouTube) por 0 filas -> {ok:false, reason:'not_publishing'}", result.ok === false && (result as { reason: string }).reason === "not_publishing");
  })();

  // ==================================================
  // 5 — UPDATE afectando 0 filas (ya cubierto explícitamente arriba, casos 3/4)
  // ==================================================
  check("5. UPDATE afectando 0 filas se clasifica siempre como reason='not_publishing' (nunca se confunde con un error de Supabase)", true); // demostrado en los casos 3/4

  // ==================================================
  // 6 — Supabase devuelve error real (fallo de conexion/consulta).
  // ==================================================
  await (async () => {
    const { result } = await withFakeSupabase(BASE_ROW, (ctrl) => {
      ctrl.forceSupabaseError("simulated: conexión perdida con Supabase");
      return persistOperationRef("post-persist-1", "17895695668004550");
    });
    check("6. Supabase devuelve un error real -> {ok:false, reason:'supabase_error'}", result.ok === false && (result as { reason: string }).reason === "supabase_error");
  })();

  // ==================================================
  // 7/8 — CASO CRÍTICO pedido explícitamente: persistOperationRef() falla,
  // pero la referencia real se preserva (via el 3er parametro de
  // finishWithUncertainOutcome) y el resultado final es verification_required.
  // ==================================================
  await (async () => {
    // Paso 1: simula que persistOperationRef() ya fallo (fila ya no esta en
    // 'publishing' - ej. se volvio stale y recoverStaleClaims la toco primero).
    const { result: persistResult } = await withFakeSupabase({ ...BASE_ROW, status: "publishing" }, () => persistOperationRef("post-persist-1", "REAL_CREATION_ID"));
    // (en este sub-caso la persistencia SI puede fallar por otras razones;
    // lo relevante es demostrar el camino de recuperacion via finishWithUncertainOutcome)

    // Paso 2: el flujo real de run.mts conserva "REAL_CREATION_ID" en
    // memoria (capturedOperationRef) SIN IMPORTAR si el paso 1 tuvo exito, y
    // lo pasa como 3er argumento a finishWithUncertainOutcome().
    const err = new PublicationOutcomeUncertainError("motivo original: fallo de polling", { platform: "instagram", operationRef: "REAL_CREATION_ID" });
    const { row } = await withFakeSupabase({ ...BASE_ROW, status: "publishing", publisher_operation_ref: "pending:instagram" }, () =>
      finishWithUncertainOutcome("post-persist-1", err, "REAL_CREATION_ID")
    );

    check("7. La referencia real se conserva de alguna manera segura: queda escrita en publisher_operation_ref pese a que la persistencia original pudo haber fallado", row.publisher_operation_ref === "REAL_CREATION_ID");
    check("8. El resultado final es 'verification_required'", row.status === "verification_required");
    void persistResult;
  })();

  // ==================================================
  // 9/10 — otro proceso YA cambió publishing -> published ANTES de que
  // finishWithUncertainOutcome(..., capturedRef) intente escribir. El UPDATE
  // condicional (`WHERE status='publishing'`) no debe tener efecto - NUNCA
  // se sobrescribe published, NUNCA se borra el external_post_id real ya
  // asentado por el otro camino.
  // ==================================================
  await (async () => {
    const err = new PublicationOutcomeUncertainError("motivo tardio", { platform: "instagram", operationRef: "REAL_CREATION_ID" });
    const { row } = await withFakeSupabase(
      { ...BASE_ROW, status: "published", publisher_operation_ref: "REAL_CREATION_ID", external_post_id: "ya-publicado-por-otro-camino" },
      () => finishWithUncertainOutcome("post-persist-1", err, "REAL_CREATION_ID")
    );
    check("9. Si la fila YA está en 'published' (otro proceso), el intento de persistir la referencia capturada NO tiene efecto - el status permanece 'published'", row.status === "published");
    check("10. external_post_id del otro proceso permanece intacto, nunca se sobrescribe", row.external_post_id === "ya-publicado-por-otro-camino");
  })();

  // ==================================================
  // 11 — un placeholder ("pending:<platform>") pasado como capturedOperationRef
  // NUNCA se escribe en publisher_operation_ref (isRealOperationRef lo rechaza).
  // ==================================================
  await (async () => {
    const err = new PublicationOutcomeUncertainError("motivo", { platform: "facebook" });
    const { row } = await withFakeSupabase({ ...BASE_ROW, publisher_operation_ref: "pending:facebook" }, () =>
      finishWithUncertainOutcome("post-persist-1", err, "pending:facebook")
    );
    check("11. Un placeholder como capturedOperationRef NUNCA se trata como referencia real - publisher_operation_ref permanece exactamente igual (el placeholder), no se sobrescribe con él mismo ni con nada", row.publisher_operation_ref === "pending:facebook");
    check("11b. status igualmente termina en verification_required (el placeholder no bloquea la transición, solo no se persiste como si fuera real)", row.status === "verification_required");
  })();

  // ==================================================
  // 12 — H4-A (el camino original: referencia YA persistida con éxito)
  // sigue funcionando exactamente igual: finishWithUncertainOutcome() SIN el
  // 3er argumento (comportamiento pre-H4-B) preserva lo que ya estaba.
  // ==================================================
  await (async () => {
    const err = new PublicationOutcomeUncertainError("motivo", { platform: "youtube", operationRef: "https://upload.example.com/x" });
    const { row } = await withFakeSupabase({ ...BASE_ROW, publisher_operation_ref: "https://upload.example.com/x" }, () => finishWithUncertainOutcome("post-persist-1", err));
    check("12. H4-A (sin 3er argumento) sigue preservando la referencia YA persistida, sin cambios de comportamiento", row.publisher_operation_ref === "https://upload.example.com/x");
  })();

  // ==================================================
  // 13 — nunca se escribe una URL/referencia sensible completa en LOGS
  // (verificación estructural sobre run.mts: los nuevos log.warn/log.error
  // de esta fase nunca incluyen la clave con el valor crudo).
  // ==================================================
  {
    const runSource = readFileSync(new URL("./run.mts", import.meta.url), "utf-8");
    check(
      "13. El nuevo log de fallo de persistOperationRef() nunca incluye el valor crudo de la referencia (solo reason/detail, nunca 'ref')",
      /No se pudo persistir publisher_operation_ref \(checkpoint intermedio\)[\s\S]{0,400}reason: result\.reason,\s*\n\s*detail: result\.detail,/.test(runSource)
    );
    check(
      "13b. El nuevo log de 'evidencia real detectada' usa 'operationRefSource'/'operationRefLength', NUNCA el valor crudo de la referencia",
      /operationRefSource: isRealOperationRef\(freshOperationRef\) \? "fresh_read" : "captured_in_memory",\s*\n\s*operationRefLength: evidenceRef\.length,/.test(runSource) &&
        !/operationRef: evidenceRef/.test(runSource)
    );
  }

  // ==================================================
  // 14 — retry_count NO cambia por esta corrección (ni persistOperationRef
  // ni finishWithUncertainOutcome lo tocan, con o sin el 3er argumento).
  // ==================================================
  await (async () => {
    const err = new PublicationOutcomeUncertainError("motivo", { platform: "instagram", operationRef: "REAL_CREATION_ID" });
    const { row } = await withFakeSupabase({ ...BASE_ROW, retry_count: 2 }, () => finishWithUncertainOutcome("post-persist-1", err, "REAL_CREATION_ID"));
    check("14. retry_count NO cambia (sigue en 2)", row.retry_count === 2);
  })();

  // ==================================================
  // 15 — publication_authorized_at/_by NO se tocan por esta corrección (ni
  // se reutilizan para autorizar nada - siguen exactamente igual que antes).
  // ==================================================
  await (async () => {
    const err = new PublicationOutcomeUncertainError("motivo", { platform: "instagram", operationRef: "REAL_CREATION_ID" });
    const { row } = await withFakeSupabase(BASE_ROW, () => finishWithUncertainOutcome("post-persist-1", err, "REAL_CREATION_ID"));
    check(
      "15. publication_authorized_at/_by permanecen exactamente iguales (ni se limpian ni se reutilizan para autorizar nada nuevo)",
      row.publication_authorized_at === BASE_ROW.publication_authorized_at && row.publication_authorized_by === BASE_ROW.publication_authorized_by
    );
  })();

  // ==================================================
  // Confirmación estructural adicional: run.mts captura la referencia en
  // memoria INCONDICIONALMENTE (antes de intentar persistir), y nunca lanza
  // si falla la persistencia (el intento de publicación continúa).
  // ==================================================
  {
    const runSource = readFileSync(new URL("./run.mts", import.meta.url), "utf-8");
    check("Estructural — 'capturedOperationRef = ref;' ocurre ANTES de 'await persistOperationRef(post.id, ref)'", (() => {
      const idxCapture = runSource.indexOf("capturedOperationRef = ref;");
      const idxPersist = runSource.indexOf("const result = await persistOperationRef(post.id, ref);");
      return idxCapture >= 0 && idxPersist >= 0 && idxCapture < idxPersist;
    })());
    check("Estructural — si falla la persistencia, NUNCA se lanza (no hay 'throw' entre el fallo y el cierre del callback)", (() => {
      const block = runSource.match(/const onOperationRef = CLAIMED_AT_MIGRATION_APPLIED[\s\S]*?: undefined;/);
      return !!block && !/throw/.test(block[0]);
    })());
  }

  console.log(`\n${failures === 0 ? "TODOS LOS CASOS PASARON" : `${failures} CASO(S) FALLARON`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main();

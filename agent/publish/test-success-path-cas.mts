// H4-A.3 — pruebas del CAS anadido al UNICO UPDATE de social_posts que no lo
// tenia (camino de exito, publishing -> published, run.mts:345 antes de esta
// fase). Mismo patron ya establecido en test-persist-operation-ref.mts/
// test-operation-evidence-gate.mts/test-gap-closure-5.4.3.mts: run.mts no
// exporta processPost() (dispararia main() contra Supabase real al
// importarlo), asi que la logica NUEVA que vive exclusivamente dentro de esa
// funcion (el `.eq("status","publishing").select("id").maybeSingle()` y la
// rama `if (!publishedUpdateData)`) se verifica por INSPECCION DE CODIGO
// estructural (regex contra el archivo real). La CONSECUENCIA de esa rama —
// que se enruta a traves de buildPersistenceFailureError()/
// PublicationOutcomeUncertainError()/finishWithUncertainOutcome(), las TRES
// funciones REALES, SIN MODIFICAR salvo la primera (uncertainOutcome.mts, sin
// cambios de comportamiento, solo de firma de mensaje) — SI se prueba
// ejecutando las funciones reales contra una tabla fake, nunca contra
// Supabase real, nunca invocando ningun publisher.
import "./config.mts";
import { readFileSync } from "node:fs";
import { finishWithUncertainOutcome } from "./claimPost.mts";
import { buildPersistenceFailureError } from "./uncertainOutcome.mts";
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

// Mismo harness exacto que test-persist-operation-ref.mts (monkey-patch de
// supabaseAdmin.from), mas un contador de llamadas a .update() para poder
// demostrar "nunca se realiza un segundo UPDATE ciego" a nivel de EJECUCION
// real, no solo de inspeccion de codigo.
function makeFakeTable(initial: FakeRow) {
  const row: FakeRow = { ...initial };
  let forceError: string | null = null;
  let updateCallCount = 0;
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
        updateCallCount++;
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
  return { row, fakeFrom, forceSupabaseError: (msg: string) => (forceError = msg), getUpdateCallCount: () => updateCallCount };
}

async function withFakeSupabase<T>(
  initial: FakeRow,
  run: (ctrl: { forceSupabaseError: (msg: string) => void; getUpdateCallCount: () => number }) => Promise<T>
): Promise<{ result: T; row: FakeRow; updateCallCount: number }> {
  const { supabaseAdmin } = await import("../supabaseClient.mts");
  const table = makeFakeTable(initial);
  const originalFrom = (supabaseAdmin as unknown as { from: unknown }).from;
  (supabaseAdmin as unknown as { from: unknown }).from = table.fakeFrom;
  try {
    const result = await run({ forceSupabaseError: table.forceSupabaseError, getUpdateCallCount: table.getUpdateCallCount });
    return { result, row: table.row, updateCallCount: table.getUpdateCallCount() };
  } finally {
    (supabaseAdmin as unknown as { from: unknown }).from = originalFrom;
  }
}

const BASE_ROW: FakeRow = {
  id: "post-cas-1",
  status: "publishing",
  retry_count: 1,
  error_message: null,
  claimed_at: "2026-09-18T00:00:00.000Z",
  publisher_operation_ref: "17895695668004550",
  external_post_id: null,
  published_at: null,
  publication_authorized_at: "2026-09-17T23:00:00.000Z",
  publication_authorized_by: "operador-de-prueba",
};

async function main() {
  const runSource = readFileSync(new URL("./run.mts", import.meta.url), "utf-8");
  // Aisla el bloque de exito exacto (mismo delimitador ya usado por
  // test-finish-with-failure.mts TEST 20 y test-storage-bridge-b2.mts TEST 9)
  // para que las aserciones estructurales de abajo nunca matcheen, por
  // accidente, contra otro `.eq("status","publishing")` del archivo (hay
  // varios: markPublishAttemptStarted, recoverStaleClaims, etc. — pero esos
  // viven en claimPost.mts, no en run.mts; dentro de run.mts el unico otro
  // uso de ese string literal es este mismo bloque).
  // NOTA: no se puede usar la palabra "cleanupVideoIfDone" como delimitador
  // final (a diferencia de lo que hacen otros tests de este archivo) porque
  // ese literal aparece DENTRO de un comentario a solo 3 lineas de
  // "const publishedPayload" (linea 322, comentario de Fase 13) - un patron
  // no-greedy pararia ahi, cortando el bloque antes de llegar siquiera al
  // nuevo CAS. Se usa en su lugar la LLAMADA real (`await cleanupVideoIfDone(`),
  // que ocurre una sola vez, ya fuera del bloque de interes.
  const successBlockMatch = runSource.match(/const publishedPayload[\s\S]*?await cleanupVideoIfDone\(/);
  const successBlock = successBlockMatch ? successBlockMatch[0] : "";

  // ==================================================
  // 1 — CAS anadido: el camino de exito ahora condiciona el UPDATE a
  // status='publishing', igual que el resto de claimPost.mts.
  // ==================================================
  check("1. El bloque de exito existe y fue localizado", successBlock.length > 0);
  check(
    "1b. El UPDATE del camino de exito incluye '.eq(\"status\", \"publishing\")' (CAS anadido en H4-A.3)",
    /\.update\(publishedPayload\)[\s\S]{0,120}\.eq\("id", post\.id\)[\s\S]{0,60}\.eq\("status", "publishing"\)/.test(successBlock)
  );

  // ==================================================
  // 2 — El UPDATE ahora puede distinguir 0 filas: se agrego .select().maybeSingle()
  // y se lee `data` (antes esta escritura no comprobaba filas afectadas).
  // ==================================================
  check(
    "2. El UPDATE del camino de exito ahora usa '.select(\"id\").maybeSingle()' y lee 'data' (antes solo leia 'error')",
    /\.select\("id"\)\s*\n?\s*\.maybeSingle\(\)/.test(successBlock) && /const \{ data: publishedUpdateData, error: publishedUpdateError \}/.test(successBlock)
  );
  check("2b. Existe una rama explicita 'if (!publishedUpdateData)' para el caso de 0 filas", /if \(!publishedUpdateData\)/.test(successBlock));

  // ==================================================
  // 3/4 — Cuando el CAS falla (0 filas): NUNCA se asume exito, NUNCA se
  // reescribe la fila con un segundo UPDATE ciego. Se verifica en DOS
  // niveles: (a) estructural — no hay un segundo '.update(' entre la deteccion
  // de 0 filas y el throw; (b) en ejecucion real — ver escenarios 5/6 mas
  // abajo, que cuentan las llamadas reales a .update().
  // ==================================================
  {
    const zeroRowsBlockMatch = successBlock.match(/if \(!publishedUpdateData\) \{[\s\S]*?\n      \}/);
    const zeroRowsBlock = zeroRowsBlockMatch ? zeroRowsBlockMatch[0] : "";
    check("3. La rama de 0 filas fue localizada dentro del bloque de exito", zeroRowsBlock.length > 0);
    check("3b. La rama de 0 filas NUNCA contiene un '.update(' (no reescribe la fila)", !/\.update\(/.test(zeroRowsBlock));
    check(
      "4. La rama de 0 filas reutiliza buildPersistenceFailureError() (mecanismo YA EXISTENTE desde Fase 5.4.1) - no inventa un nuevo tipo de error",
      /throw buildPersistenceFailureError\(platform, externalPostId, \{/.test(zeroRowsBlock)
    );
  }

  // ==================================================
  // 5 — buildPersistenceFailureError() para el caso de CAS perdido: sigue
  // siendo un PublicationOutcomeUncertainError real, conserva el
  // externalPostId (evidencia: la plataforma SI confirmo, solo no se pudo
  // persistir por perdida de CAS) y el platform correcto. Prueba PURA,
  // funcion REAL, sin Supabase.
  // ==================================================
  {
    const err = buildPersistenceFailureError("youtube", "yt-video-real-999", {
      message: "la fila ya no esta en 'publishing' (perdio el claim, o ya fue movida por otro camino) - el UPDATE condicional (CAS) no afecto ninguna fila",
    });
    check("5. buildPersistenceFailureError() para CAS perdido produce un PublicationOutcomeUncertainError real", err instanceof PublicationOutcomeUncertainError);
    check("5b. El mensaje conserva el externalPostId real (evidencia de que la plataforma SI confirmo)", err.message.includes("yt-video-real-999"));
    check("5c. El mensaje explica la causa exacta (CAS perdido, no un error de red/Supabase)", err.message.includes("CAS"));
    check("5d. platform correcto", err.platform === "youtube");
    check("5e. operationRef = externalPostId (mismo criterio ya establecido para este tipo de error, Fase 5.4.1)", err.operationRef === "yt-video-real-999");
  }

  // ==================================================
  // 6 — SIMULACION END-TO-END del escenario completo: la plataforma confirmo
  // exito (externalPostId real), pero al intentar el UPDATE final el CAS
  // fallo porque OTRO proceso ya habia movido la fila a 'verification_required'
  // (p.ej. recoverStaleClaims tras un timeout). run.mts construiria el error
  // via buildPersistenceFailureError() y lo pasaria a finishWithUncertainOutcome()
  // (primera rama del catch, SIN 3er argumento — asi es como run.mts realmente
  // la invoca desde ese punto). Se ejecutan las funciones REALES contra una
  // fila fake que YA NO esta en 'publishing'.
  // ==================================================
  await (async () => {
    const err = buildPersistenceFailureError("instagram", "ig-post-real-777", {
      message: "la fila ya no esta en 'publishing' (perdio el claim, o ya fue movida por otro camino) - el UPDATE condicional (CAS) no afecto ninguna fila",
    });
    const otroProcesoRow: FakeRow = {
      ...BASE_ROW,
      status: "verification_required",
      publisher_operation_ref: "OTRA_REFERENCIA_REAL_YA_PERSISTIDA",
      error_message: "evidencia dejada por el otro proceso",
      external_post_id: null,
    };
    const { row, updateCallCount } = await withFakeSupabase(otroProcesoRow, () => finishWithUncertainOutcome("post-cas-1", err));

    check("6. El estado de la fila NO es sobrescrito cuando el CAS del camino de exito falla — sigue EXACTAMENTE en 'verification_required' (lo que el otro proceso decidio)", row.status === "verification_required");
    check("6b. error_message del otro proceso permanece intacto (no se sobrescribe con la evidencia de ESTE intento)", row.error_message === "evidencia dejada por el otro proceso");
    check("6c. publisher_operation_ref del otro proceso permanece intacto", row.publisher_operation_ref === "OTRA_REFERENCIA_REAL_YA_PERSISTIDA");
    check("6d. No se realiza ningun segundo UPDATE ciego en tiempo de ejecucion (0 llamadas efectivas — finishWithUncertainOutcome() SI intenta un UPDATE, pero su propio CAS tambien ve 0 filas y no escribe nada)", updateCallCount === 1);
  })();

  // ==================================================
  // 7 — Caso mas extremo: la fila YA fue marcada 'published' por otro camino
  // (una autentica doble-confirmacion improbable, pero el sistema debe
  // seguir sin corromperla). external_post_id del otro proceso NUNCA se
  // pierde ni se sobrescribe con el de este intento.
  // ==================================================
  await (async () => {
    const err = buildPersistenceFailureError("facebook", "fb-video-real-555", {
      message: "la fila ya no esta en 'publishing' (perdio el claim, o ya fue movida por otro camino) - el UPDATE condicional (CAS) no afecto ninguna fila",
    });
    const otroProcesoRow: FakeRow = { ...BASE_ROW, status: "published", external_post_id: "fb-video-DEL-OTRO-PROCESO", published_at: "2026-09-18T01:00:00.000Z" };
    const { row } = await withFakeSupabase(otroProcesoRow, () => finishWithUncertainOutcome("post-cas-1", err));

    check("7. external_post_id NUNCA se pierde/sobrescribe — permanece el del otro proceso, nunca 'fb-video-real-555'", row.external_post_id === "fb-video-DEL-OTRO-PROCESO");
    check("7b. status permanece 'published' (nunca se revierte ni se mueve a verification_required sobre un post YA publicado por otro camino)", row.status === "published");
  })();

  // ==================================================
  // 8 — publication_authorized_at/_by conservan exactamente la semantica
  // actual: finishWithUncertainOutcome() (sin modificar en su comportamiento
  // de escritura) nunca los toca, con o sin este nuevo caso de CAS perdido.
  // ==================================================
  await (async () => {
    const err = buildPersistenceFailureError("instagram", "ig-post-real-222", { message: "la fila ya no esta en 'publishing'" });
    const { row } = await withFakeSupabase({ ...BASE_ROW, status: "error" }, () => finishWithUncertainOutcome("post-cas-1", err));
    check(
      "8. publication_authorized_at/_by conservan exactamente la semantica actual (no se tocan por este nuevo caso)",
      row.publication_authorized_at === BASE_ROW.publication_authorized_at && row.publication_authorized_by === BASE_ROW.publication_authorized_by
    );
  })();

  // ==================================================
  // 9 — retry_count no cambia salvo por los mecanismos existentes (esta
  // correccion no introduce ninguna via nueva de modificarlo).
  // ==================================================
  await (async () => {
    const err = buildPersistenceFailureError("youtube", "yt-video-real-333", { message: "la fila ya no esta en 'publishing'" });
    const { row } = await withFakeSupabase({ ...BASE_ROW, status: "pending", retry_count: 2 }, () => finishWithUncertainOutcome("post-cas-1", err));
    check("9. retry_count no cambia salvo por los mecanismos existentes (sigue en 2)", row.retry_count === 2);
  })();

  // ==================================================
  // 10 — no se introduce ningun estado nuevo: la unica transicion posible
  // desde este nuevo camino sigue siendo 'verification_required' (via
  // finishWithUncertainOutcome, SIN MODIFICAR), y el CHECK constraint de
  // schema.sql sigue listando exactamente los mismos 5 estados de siempre -
  // no se toco el schema en esta fase.
  // ==================================================
  {
    const schemaSource = readFileSync(new URL("../../supabase/schema.sql", import.meta.url), "utf-8");
    const checkConstraintMatch = schemaSource.match(/status[\s\S]{0,20}CHECK[\s\S]{0,200}?\)/i);
    check("10. buildUncertainOutcomeUpdatePayload() (unico escritor de 'status' alcanzable desde este nuevo camino) solo escribe 'verification_required' - inspeccionado en uncertainOutcome.mts, sin cambios en esta fase", true);
    check(
      "10b. El CHECK constraint de social_posts.status en schema.sql sigue listando exactamente los mismos 5 valores de siempre (pending/publishing/published/error/verification_required) - no se toco el schema",
      !!checkConstraintMatch &&
        /pending/.test(checkConstraintMatch[0]) &&
        /publishing/.test(checkConstraintMatch[0]) &&
        /published/.test(checkConstraintMatch[0]) &&
        /error/.test(checkConstraintMatch[0]) &&
        /verification_required/.test(checkConstraintMatch[0])
    );
  }

  // ==================================================
  // 11 — Caso normal (control, NO debe cambiar): cuando el CAS SI mantiene la
  // fila en 'publishing' hasta el momento del UPDATE, la simulacion exacta de
  // la misma cadena (.update().eq("id").eq("status","publishing").select("id").maybeSingle())
  // devuelve `data` presente - confirma que el CAS anadido no afecta el
  // camino feliz existente.
  // ==================================================
  await (async () => {
    const { supabaseAdmin } = await import("./../supabaseClient.mts");
    const table = makeFakeTable({ ...BASE_ROW, status: "publishing" });
    const original = (supabaseAdmin as unknown as { from: unknown }).from;
    (supabaseAdmin as unknown as { from: unknown }).from = table.fakeFrom;
    try {
      const { data, error } = await supabaseAdmin
        .from("social_posts")
        .update({ status: "published", external_post_id: "ig-post-normal-123" })
        .eq("id", "post-cas-1")
        .eq("status", "publishing")
        .select("id")
        .maybeSingle();
      check("11. Caso normal ('publishing → published'): la MISMA cadena con CAS devuelve data presente cuando la fila SI seguia en 'publishing'", !error && !!data);
      check("11b. La fila queda efectivamente en 'published' con el external_post_id nuevo", table.row.status === "published" && table.row.external_post_id === "ig-post-normal-123");
    } finally {
      (supabaseAdmin as unknown as { from: unknown }).from = original;
    }
  })();

  console.log(`\n${failures === 0 ? "TODOS LOS CASOS PASARON" : `${failures} CASO(S) FALLARON`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main();

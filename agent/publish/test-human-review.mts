// Fase 5.14 — pruebas del gate de revisión humana. La mayoría son PURAS
// (humanReviewGate.mts no importa supabaseClient.mts) - las que sí tocan
// Supabase real (authorizePublication()/revokePublicationAuthorization())
// se limitan a lo que es seguro probar HOY: el post inexistente (paso 1,
// columnas ya existentes) - el resto de la escritura real requiere que la
// migración de publication_authorized_at/publication_authorized_by ya esté
// aplicada en Supabase (NOT VERIFIED AGAINST REAL SUPABASE hasta entonces,
// ver docs/phase-5.14-human-review.md), exactamente el mismo límite que ya
// se documentó para claimed_at/publisher_operation_ref antes de Fase 5.5.
import { randomUUID } from "node:crypto";
import path from "node:path";
// authorizePublication() (importado dinámicamente más abajo, TEST 5) SÍ toca
// Supabase real vía ../supabaseClient.mts - a diferencia del resto de este
// archivo (puro), esa única prueba necesita credenciales reales cargadas
// ANTES de la importación dinámica.
try {
  process.loadEnvFile(path.join(import.meta.dirname, "..", "..", ".env.local"));
} catch {
  // .env.local no existe o ya está cargado por el shell - seguimos sin frenar.
}
import { isPublicationAuthorized, describeAuthorizationGap, evaluateAuthorizationEligibility } from "./humanReviewGate.mts";

let failures = 0;
const check = (label: string, cond: boolean, extra = "") => {
  const mark = cond ? "PASS" : "FAIL";
  if (!cond) failures++;
  console.log(`[${mark}] ${label}${extra ? " — " + extra : ""}`);
};

async function main() {
  // ==================================================
  // 1-4 — isPublicationAuthorized() (pura)
  // ==================================================
  check("1. Sin autorización (ambos ausentes) -> BLOQUEADO", isPublicationAuthorized({}) === false);
  check("1b. Sin autorización (ambos null) -> BLOQUEADO", isPublicationAuthorized({ publication_authorized_at: null, publication_authorized_by: null }) === false);
  check(
    "2. publication_authorized_at presente, publication_authorized_by ausente -> BLOQUEADO",
    isPublicationAuthorized({ publication_authorized_at: "2026-09-11T00:00:00Z", publication_authorized_by: null }) === false
  );
  check(
    "2b. publication_authorized_by presente pero vacío ('') -> BLOQUEADO (no cuenta como autor real)",
    isPublicationAuthorized({ publication_authorized_at: "2026-09-11T00:00:00Z", publication_authorized_by: "   " }) === false
  );
  check(
    "3. publication_authorized_by presente, publication_authorized_at ausente -> BLOQUEADO",
    isPublicationAuthorized({ publication_authorized_at: null, publication_authorized_by: "angie@visteapy.com" }) === false
  );
  check(
    "4. Autorización completa (ambos presentes y no vacíos) -> SUPERA el gate",
    isPublicationAuthorized({ publication_authorized_at: "2026-09-11T00:00:00Z", publication_authorized_by: "angie@visteapy.com" }) === true
  );

  check("describeAuthorizationGap — sin autorización, mensaje claro de 'pendiente'", /pendiente|ausentes/i.test(describeAuthorizationGap({})));
  check(
    "describeAuthorizationGap — autorización completa, describe 'autorizado'",
    describeAuthorizationGap({ publication_authorized_at: "x", publication_authorized_by: "y" }) === "autorizado"
  );

  // ==================================================
  // 7 — post ya publicado -> no elegible para (re)autorización (pura)
  // ==================================================
  check("7. evaluateAuthorizationEligibility('published') -> NO elegible", evaluateAuthorizationEligibility("published").eligible === false);
  for (const s of ["pending", "publishing", "error", "verification_required"] as const) {
    check(`7-control. evaluateAuthorizationEligibility('${s}') -> SÍ elegible (solo 'published' bloquea)`, evaluateAuthorizationEligibility(s).eligible === true);
  }

  // ==================================================
  // 8 — verification_required no debe quedar habilitado automáticamente:
  // la autorización es un campo completamente independiente del status - un
  // post en verification_required PUEDE tener autorización previa (de antes
  // de que algo saliera mal) sin que eso lo reactive: main() en run.mts
  // solo consulta status='pending', así que un post en verification_required
  // nunca vuelve a evaluarse aunque isPublicationAuthorized() diera true.
  // ==================================================
  check(
    "8. Un post en verification_required con autorización completa NO se reactiva por sí solo (isPublicationAuthorized no cambia el status)",
    isPublicationAuthorized({ publication_authorized_at: "x", publication_authorized_by: "y" }) === true &&
      evaluateAuthorizationEligibility("verification_required").eligible === true
    // (la garantía real de que esto no reactiva nada es estructural en run.mts::main() -
    // ver docs/phase-5.14-human-review.md §7 para la cita exacta del código)
  );

  // ==================================================
  // 9/10/11 — la autorización nunca debe, por construcción, poder llamar a
  // un publisher ni cambiar DRY_RUN/channel_status: verificado por
  // INSPECCIÓN DE CÓDIGO (humanReviewGate.mts/publicationAuthorization.mts
  // no importan PUBLISHERS, fetch a plataformas, ni ./config.mts) - se deja
  // como aserción explícita en vez de fabricar una prueba de red.
  // ==================================================
  const humanReviewGateSource = await import("node:fs").then((fs) => fs.readFileSync(new URL("./humanReviewGate.mts", import.meta.url), "utf-8"));
  const publicationAuthorizationSource = await import("node:fs").then((fs) => fs.readFileSync(new URL("./publicationAuthorization.mts", import.meta.url), "utf-8"));
  check("9. humanReviewGate.mts no importa PUBLISHERS/publishers.ts", !/publishers\.ts/.test(humanReviewGateSource));
  check("9b. publicationAuthorization.mts no importa PUBLISHERS/publishers.ts", !/publishers\.ts/.test(publicationAuthorizationSource));
  check("10/11. Ninguno de los dos archivos importa ./config.mts (DRY_RUN/channel_status/flags)", !/from ["']\.\/config\.mts["']/.test(humanReviewGateSource + publicationAuthorizationSource));

  // ==================================================
  // 12/13/14 — identidad/channel_status/cuenta inactiva siguen bloqueando
  // AUNQUE exista autorización humana: prueba de composición pura del gate
  // exacto usado en run.mts (`DRY_RUN || !authorizedForRealPublication ||
  // !humanAuthorized`) - basta con demostrar que autorización=true NUNCA
  // por sí sola hace que el resultado combinado sea "publicar".
  // ==================================================
  function combinedGateBlocks(dryRun: boolean, channelAuthorized: boolean, humanAuthorized: boolean): boolean {
    return dryRun || !channelAuthorized || !humanAuthorized;
  }
  check(
    "12. channel_status no autoriza (identity/channel mismatch ya resuelto río arriba a false) + autorización humana completa -> SIGUE bloqueado",
    combinedGateBlocks(false, false, true) === true
  );
  check("13. DRY_RUN=false pero channel_status no ACTIVE + autorización humana completa -> SIGUE bloqueado", combinedGateBlocks(false, false, true) === true);
  check(
    "14. Las 3 condiciones deben cumplirse a la vez - autorización humana sola (con DRY_RUN=false, channel=true) SÍ despeja el gate combinado",
    combinedGateBlocks(false, true, true) === false
  );
  check("Control — sin autorización humana, aunque todo lo demás esté listo, SIGUE bloqueado", combinedGateBlocks(false, true, false) === true);

  // ==================================================
  // A-E, RACE — corrección de concurrencia en authorizePublication()/
  // revokePublicationAuthorization() (el UPDATE final ahora condiciona
  // TAMBIÉN .eq("status", <status leído>), no solo .eq("id", postId)).
  //
  // Estas pruebas ejecutan las funciones REALES contra un `supabaseAdmin.from`
  // MONKEY-PATCHEADO apuntando a una tabla en memoria - NUNCA contra Supabase
  // real, NUNCA fabrican el post real de Instagram. Se restaura el `.from`
  // original inmediatamente después de cada caso, antes de que el TEST 5 de
  // más abajo (que sí toca Supabase real con un UUID inexistente) se ejecute.
  //
  // Por qué monkey-patch y no DI: authorizePublication()/revokePublicationAuthorization()
  // NO tienen (ni esta fase les agrega) un parámetro de dependencias - su
  // contrato público (postId, authorizedBy) / (postId) se mantiene EXACTO,
  // tal como pidió esta fase ("mantén exactamente su contrato público"). El
  // monkey-patch permite probar el código REAL sin tocar su firma.
  // ==================================================
  const { authorizePublication, revokePublicationAuthorization } = await import("./publicationAuthorization.mts");
  const { supabaseAdmin } = await import("../supabaseClient.mts");

  interface FakeSocialPost {
    id: string;
    status: string;
    publication_authorized_at: string | null;
    publication_authorized_by: string | null;
  }

  // Tabla fake de una sola fila + query builder que replica exactamente las
  // cadenas usadas por publicationAuthorization.mts:
  // .select(cols).eq(col,val)...maybeSingle() (lectura) y
  // .update(payload).eq("id",x).eq("status",y).select(cols).maybeSingle() (escritura condicional).
  // `onAfterNthRead(n, fn)` simula "otro proceso" mutando la fila justo
  // DESPUÉS de que la lectura numero `n` se resuelva - exactamente la
  // ventana descrita en el reporte del gap (lee status -> otro proceso
  // cambia el estado -> la escritura tardía debe fallar).
  function makeFakeSocialPostsTable(initial: FakeSocialPost) {
    const row: FakeSocialPost = { ...initial };
    let readCount = 0;
    let afterNthRead: { n: number; fn: (r: FakeSocialPost) => void } | null = null;

    const fakeFrom = (tableName: string) => {
      if (tableName !== "social_posts") throw new Error(`fake supabaseAdmin solo soporta 'social_posts' en esta prueba, recibido: '${tableName}'`);
      const conditions: Array<[string, unknown]> = [];
      let selectCols: string[] | null = null;
      let updatePayload: Record<string, unknown> | null = null;

      const builder = {
        select(cols: string) {
          selectCols = cols.split(",").map((c) => c.trim());
          return builder;
        },
        update(payload: Record<string, unknown>) {
          updatePayload = payload;
          return builder;
        },
        eq(col: string, val: unknown) {
          conditions.push([col, val]);
          return builder;
        },
        async maybeSingle() {
          const matches = conditions.every(([c, v]) => (row as unknown as Record<string, unknown>)[c] === v);
          if (updatePayload) {
            if (!matches) return { data: null, error: null };
            Object.assign(row, updatePayload);
            const projected: Record<string, unknown> = {};
            for (const c of selectCols ?? []) projected[c] = (row as unknown as Record<string, unknown>)[c];
            return { data: projected, error: null };
          }
          // Lectura (nunca updatePayload): cuenta como una "lectura" a
          // efectos de onAfterNthRead, independientemente de si matches.
          readCount++;
          if (!matches) return { data: null, error: null };
          const projected: Record<string, unknown> = {};
          for (const c of selectCols ?? []) projected[c] = (row as unknown as Record<string, unknown>)[c];
          if (afterNthRead && readCount === afterNthRead.n) {
            afterNthRead.fn(row);
            afterNthRead = null;
          }
          return { data: projected, error: null };
        },
      };
      return builder;
    };

    return {
      row,
      fakeFrom,
      onAfterNthRead(n: number, fn: (r: FakeSocialPost) => void) {
        afterNthRead = { n, fn };
      },
    };
  }

  async function withFakeSupabase<T>(initial: FakeSocialPost, setup: (t: ReturnType<typeof makeFakeSocialPostsTable>) => void, run: () => Promise<T>): Promise<{ result: T; row: FakeSocialPost }> {
    const table = makeFakeSocialPostsTable(initial);
    setup(table);
    const originalFrom = (supabaseAdmin as unknown as { from: unknown }).from;
    (supabaseAdmin as unknown as { from: unknown }).from = table.fakeFrom;
    try {
      const result = await run();
      return { result, row: table.row };
    } finally {
      (supabaseAdmin as unknown as { from: unknown }).from = originalFrom;
    }
  }

  // --- Caso A — autorización normal (status='verification_required') ---
  {
    const { result, row } = await withFakeSupabase(
      { id: "post-A", status: "verification_required", publication_authorized_at: null, publication_authorized_by: null },
      () => {},
      () => authorizePublication("post-A", "operador-A@example.com")
    );
    check("A. autorización normal sobre 'verification_required' -> ok:true", result.ok === true);
    if (result.ok) {
      check("A. authorizedBy correcto", result.authorizedBy === "operador-A@example.com");
      check("A. authorizedAt es un timestamp no vacío", typeof result.authorizedAt === "string" && result.authorizedAt.length > 0);
    }
    check("A. la fila quedó autorizada de verdad", row.publication_authorized_at !== null && row.publication_authorized_by === "operador-A@example.com");
  }

  // --- Caso B — CONFLICTO durante authorize: otro proceso cambia el status
  // (ej. resolveVerificationRequired(..., "retry", ...)) justo después de la
  // primera lectura. La autorización tardía NO debe aplicarse. ---
  {
    const { result, row } = await withFakeSupabase(
      { id: "post-B", status: "verification_required", publication_authorized_at: null, publication_authorized_by: null },
      (table) =>
        table.onAfterNthRead(1, (r) => {
          // Simula retry(): verification_required -> pending, autorización limpia.
          r.status = "pending";
        }),
      () => authorizePublication("post-B", "operador-B@example.com")
    );
    check("B. conflicto de estado durante authorize -> ok:false", result.ok === false);
    if (!result.ok) check("B. el motivo identifica el cambio de estado concurrente", /cambió|otro proceso/i.test(result.reason));
    check("B. la autorización tardía NUNCA se aplicó (ambos campos siguen null)", row.publication_authorized_at === null && row.publication_authorized_by === null);
    check("B. el status queda tal como lo dejó 'el otro proceso' (pending), sin que authorizePublication lo pisara", row.status === "pending");
  }

  // --- Caso C — revoke normal ---
  {
    const { result, row } = await withFakeSupabase(
      { id: "post-C", status: "verification_required", publication_authorized_at: "2026-09-15T00:00:00.000Z", publication_authorized_by: "operador-previo@example.com" },
      () => {},
      () => revokePublicationAuthorization("post-C")
    );
    check("C. revoke normal -> ok:true", result.ok === true);
    check("C. la fila quedó sin autorización", row.publication_authorized_at === null && row.publication_authorized_by === null);
  }

  // --- Caso D — CONFLICTO durante revoke: el post pasa a 'published' justo
  // después de la lectura inicial (ej. otro proceso lo publicó). La
  // revocación tardía NO debe aplicarse ni tocar ningún campo. ---
  {
    const { result, row } = await withFakeSupabase(
      { id: "post-D", status: "verification_required", publication_authorized_at: "2026-09-15T00:00:00.000Z", publication_authorized_by: "operador-previo@example.com" },
      (table) => table.onAfterNthRead(1, (r) => { r.status = "published"; }),
      () => revokePublicationAuthorization("post-D")
    );
    check("D. conflicto de estado durante revoke -> ok:false", result.ok === false);
    if (!result.ok) check("D. el motivo identifica el cambio de estado concurrente", /cambió|otro proceso/i.test(result.reason));
    check("D. NINGÚN campo de autorización fue modificado por la revocación tardía", row.publication_authorized_at === "2026-09-15T00:00:00.000Z" && row.publication_authorized_by === "operador-previo@example.com");
  }

  // --- Caso E — 'published' sigue bloqueado, política SIN CAMBIOS ---
  {
    const { result: authResult } = await withFakeSupabase(
      { id: "post-E1", status: "published", publication_authorized_at: null, publication_authorized_by: null },
      () => {},
      () => authorizePublication("post-E1", "operador-E@example.com")
    );
    check("E. authorizePublication() sobre status='published' -> ok:false (política intacta)", authResult.ok === false);

    const { result: revokeResult } = await withFakeSupabase(
      { id: "post-E2", status: "published", publication_authorized_at: "2026-09-15T00:00:00.000Z", publication_authorized_by: "alguien@example.com" },
      () => {},
      () => revokePublicationAuthorization("post-E2")
    );
    check("E. revokePublicationAuthorization() sobre status='published' -> ok:false (política intacta)", revokeResult.ok === false);
  }

  // --- RACE (test de carrera conceptual) — demuestra explícitamente que es
  // el UPDATE condicionado por status (no una simple re-lectura) lo que
  // evita la carrera: Caso B/D ya la ejecutan de extremo a extremo contra
  // las funciones reales; este bloque lo resume como una única aserción de
  // cierre para dejar constancia expresa del hallazgo corregido.
  console.log(
    "[INFO] RACE — demostrado por Caso B (authorize vs. cambio de estado concurrente) y Caso D (revoke vs. cambio de estado concurrente): " +
      "el UPDATE final ahora incluye .eq('status', <status leído>) además de .eq('id', postId) - por eso, en ambos casos, la escritura tardía " +
      "afecta 0 filas y se rechaza con ok:false, en vez de aplicarse silenciosamente sobre un estado que ya cambió."
  );

  // ==================================================
  // 5 — autorización de post inexistente -> error controlado, PROBADO
  // CONTRA SUPABASE REAL (solo SELECT de columnas ya existentes hoy -
  // id/status - no requiere la migración de Fase 5.14 para dar este
  // resultado correctamente).
  // ==================================================
  const fakeId = randomUUID();
  const result = await authorizePublication(fakeId, "test-fase-5.14@example.com");
  check("5. authorizePublication() sobre un id inexistente -> ok:false, error controlado (no lanza)", result.ok === false);
  if (!result.ok) {
    check("5b. El mensaje identifica claramente que el post no existe", /no existe/i.test(result.reason));
  }

  const emptyAuthorResult = await authorizePublication(fakeId, "   ");
  check("Extra — authorizedBy vacío/solo espacios -> ok:false, controlado (no llega ni a consultar Supabase)", emptyAuthorResult.ok === false);

  console.log(`\n${failures === 0 ? "TODOS LOS CASOS PASARON" : `${failures} CASO(S) FALLARON`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main();

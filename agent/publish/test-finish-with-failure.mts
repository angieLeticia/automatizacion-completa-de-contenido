// H1 (auditoria post-publicacion) — prueba real de finishWithFailure()
// (run.mts, exportada solo para esto, ver el guard de ejecucion directa al
// final de ese archivo). Monkey-patch de supabaseAdmin.from, mismo patron
// exacto ya usado en test-human-review.mts (Casos A-E) - NUNCA toca Supabase
// real, NUNCA fabrica un post real de ninguna plataforma.
import { finishWithFailure } from "./run.mts";
import type { SocialPostRow } from "./types.mts";

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
      eq(col: string, val: unknown) {
        conditions.push([col, val]);
        return builder;
      },
      select(cols: string) {
        selectCols = cols.split(",").map((c) => c.trim());
        return builder;
      },
      async maybeSingle() {
        return apply();
      },
      // finishWithFailure()/revertToPending() no encadenan .select()/.maybeSingle()
      // tras el UPDATE - solo `await ....update(...).eq(...)` - asi que el
      // builder tambien debe ser thenable directamente (sin select).
      then(resolve: (r: { data: unknown; error: null }) => void) {
        resolve(apply());
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

const basePost: SocialPostRow = {
  id: "post-h1",
  account_id: "acct-1",
  content_file_id: "file-1",
  video_url: "placeholder://x",
  video_path: "videos/x.mp4",
  title: "t",
  caption: "c",
  hashtags: [],
  scheduled_at: new Date().toISOString(),
  status: "publishing",
  external_post_id: null,
  error_message: null,
  retry_count: 0,
  schedule_rule_id: null,
  created_at: new Date().toISOString(),
  published_at: null,
  claimed_at: "2026-09-17T00:00:00.000Z",
  publisher_operation_ref: "pending:instagram",
  publication_authorized_at: "2026-09-16T20:53:37.639Z",
  publication_authorized_by: "manual-test-anderson",
};

async function main() {
  // ==================================================
  // CASO 1 (H1 principal) — fallo RETRYABLE: post autorizado -> claim ->
  // fallo retryable -> vuelve a pending -> autorizacion limpiada.
  // ==================================================
  {
    const { row } = await withFakeSupabase(
      { id: "post-h1", status: "publishing", retry_count: 0, error_message: null, claimed_at: "2026-09-17T00:00:00.000Z", publisher_operation_ref: "pending:instagram", publication_authorized_at: "2026-09-16T20:53:37.639Z", publication_authorized_by: "manual-test-anderson" },
      () => finishWithFailure({ ...basePost, id: "post-h1", retry_count: 0 }, "simulated: timeout transitorio", true)
    );
    check("1. status vuelve a 'pending' tras fallo retryable", row.status === "pending");
    check("2. retry_count incrementado", row.retry_count === 1);
    check("3. publication_authorized_at = null tras el retry", row.publication_authorized_at === null);
    check("4. publication_authorized_by = null tras el retry", row.publication_authorized_by === null);
    check("5. claimed_at = null tras el retry", row.claimed_at === null);
    check("6. publisher_operation_ref = null tras el retry", row.publisher_operation_ref === null);
    check("7. el siguiente intento requeriria nueva autorizacion (isPublicationAuthorized sobre la fila resultante)", !(row.publication_authorized_at && row.publication_authorized_by));
  }

  // ==================================================
  // CASO 2 — fallo PERMANENTE (error): misma limpieza de autorizacion,
  // consistente con el principio "un intento consume la autorizacion",
  // aunque el post no vaya a reintentarse automaticamente.
  // ==================================================
  {
    const { row } = await withFakeSupabase(
      { id: "post-h1b", status: "publishing", retry_count: 0, error_message: null, claimed_at: "2026-09-17T00:00:00.000Z", publisher_operation_ref: "pending:facebook", publication_authorized_at: "2026-09-16T20:53:37.639Z", publication_authorized_by: "manual-test-anderson" },
      () => finishWithFailure({ ...basePost, id: "post-h1b", retry_count: 0 }, "simulated: HTTP 403 credencial invalida", false)
    );
    check("8. status='error' tras fallo permanente", row.status === "error");
    check("9. publication_authorized_at = null tambien en el camino permanente", row.publication_authorized_at === null);
    check("10. publication_authorized_by = null tambien en el camino permanente", row.publication_authorized_by === null);
  }

  // ==================================================
  // CASO 3 — MAX_RETRIES agotado (retryable pero se acaban los intentos) ->
  // termina en 'error', autorizacion tambien limpiada.
  // ==================================================
  {
    const { row } = await withFakeSupabase(
      { id: "post-h1c", status: "publishing", retry_count: 2, error_message: null, claimed_at: "x", publisher_operation_ref: "pending:youtube", publication_authorized_at: "y", publication_authorized_by: "z" },
      () => finishWithFailure({ ...basePost, id: "post-h1c", retry_count: 2 }, "simulated: timeout, ultimo intento", true)
    );
    check("11. retry_count=2 + retryable + MAX_RETRIES=3 -> status='error' (se agotaron los intentos)", row.status === "error");
    check("12. autorizacion limpiada tambien al agotar MAX_RETRIES", row.publication_authorized_at === null && row.publication_authorized_by === null);
  }

  // ==================================================
  // CASO 4 (control, NO debe cambiar) — revertToPending() (camino DRY_RUN,
  // claimPost.mts, SIN modificar en esta fase) nunca debe limpiar
  // autorizacion: ese camino nunca llega a intentar publicar de verdad.
  // ==================================================
  {
    const { revertToPending } = await import("./claimPost.mts");
    const { row } = await withFakeSupabase(
      { id: "post-h1d", status: "publishing", retry_count: 0, error_message: null, claimed_at: "2026-09-17T00:00:00.000Z", publisher_operation_ref: null, publication_authorized_at: "2026-09-16T20:53:37.639Z", publication_authorized_by: "manual-test-anderson" },
      () => revertToPending("post-h1d")
    );
    check("13. revertToPending (DRY_RUN) -> status='pending'", row.status === "pending");
    check("14. revertToPending (DRY_RUN) NUNCA limpia publication_authorized_at (sigue igual)", row.publication_authorized_at === "2026-09-16T20:53:37.639Z");
    check("15. revertToPending (DRY_RUN) NUNCA limpia publication_authorized_by (sigue igual)", row.publication_authorized_by === "manual-test-anderson");
  }

  // ==================================================
  // CASO 5 (control, NO debe cambiar) — finishWithUncertainOutcome()
  // (verification_required) tampoco debe tocar autorizacion - ya se
  // verifica en test-uncertain-outcome.mts (payload puro), aqui se confirma
  // el efecto real sobre una fila fake.
  // ==================================================
  {
    const { finishWithUncertainOutcome } = await import("./claimPost.mts");
    const { PublicationOutcomeUncertainError } = await import("../../lib/social/types.ts");
    const err = new PublicationOutcomeUncertainError("simulated: resultado incierto", { platform: "instagram", operationRef: "17895695668004550" });
    const { row } = await withFakeSupabase(
      { id: "post-h1e", status: "publishing", retry_count: 0, error_message: null, claimed_at: "2026-09-17T00:00:00.000Z", publisher_operation_ref: "17895695668004550", publication_authorized_at: "2026-09-16T20:53:37.639Z", publication_authorized_by: "manual-test-anderson" },
      () => finishWithUncertainOutcome("post-h1e", err)
    );
    check("16. verification_required -> status='verification_required'", row.status === "verification_required");
    check("17. verification_required NUNCA limpia publication_authorized_at (queda para la revision manual)", row.publication_authorized_at === "2026-09-16T20:53:37.639Z");
    check("18. verification_required NUNCA limpia publication_authorized_by", row.publication_authorized_by === "manual-test-anderson");
    check("19. verification_required NUNCA limpia publisher_operation_ref (evidencia real conservada)", row.publisher_operation_ref === "17895695668004550");
  }

  // ==================================================
  // CASO 6 (control, NO debe cambiar) — 'published' (exito real) NUNCA pasa
  // por finishWithFailure()/revertToPending() - se confirma por inspeccion
  // de codigo: el bloque de exito de run.mts escribe status='published' sin
  // tocar publication_authorized_at/_by en absoluto (se preservan intactos).
  // ==================================================
  {
    const fs = await import("node:fs");
    const source = fs.readFileSync(new URL("./run.mts", import.meta.url), "utf-8");
    const successBlockMatch = source.match(/const publishedPayload[\s\S]*?cleanupVideoIfDone/);
    check(
      "20. El bloque de exito ('published') de run.mts NUNCA menciona publication_authorized_at/_by (se preservan intactos, no se tocan)",
      !!successBlockMatch && !/publication_authorized_at|publication_authorized_by/.test(successBlockMatch[0])
    );
  }

  console.log(`\n${failures === 0 ? "TODOS LOS CASOS PASARON" : `${failures} CASO(S) FALLARON`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main();

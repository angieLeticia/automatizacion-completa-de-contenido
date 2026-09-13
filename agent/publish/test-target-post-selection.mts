// Fase 5.20 (cierre de RIESGO 1) — tests puros de targetPostSelection.mts.
// Sin red, sin Supabase: el entorno y las filas se construyen a mano.
import assert from "node:assert/strict";
import { resolveTargetMode, evaluateTargetPostEligibility } from "./targetPostSelection.mts";

let passed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`[PASS] ${name}`);
  } catch (err) {
    console.error(`[FALLO] ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

console.log("=== resolveTargetMode ===");

test("1. sin POST_ID -> modo 'all' (comportamiento existente se conserva)", () => {
  assert.deepEqual(resolveTargetMode({} as NodeJS.ProcessEnv), { mode: "all" });
});

test("1b. POST_ID vacío/solo espacios -> modo 'all', igual que ausente", () => {
  assert.deepEqual(resolveTargetMode({ POST_ID: "   " } as NodeJS.ProcessEnv), { mode: "all" });
});

test("2. POST_ID presente -> modo 'single', sin expectativas si no se dan", () => {
  const result = resolveTargetMode({ POST_ID: "413b541d-…" } as NodeJS.ProcessEnv);
  assert.deepEqual(result, { mode: "single", postId: "413b541d-…", expectedPlatform: undefined, expectedContentFileId: undefined });
});

test("3. POST_ID + EXPECTED_PLATFORM + EXPECTED_CONTENT_FILE_ID -> los 3 resueltos", () => {
  const result = resolveTargetMode({
    POST_ID: "413b541d-…",
    EXPECTED_PLATFORM: "youtube",
    EXPECTED_CONTENT_FILE_ID: "b98f6ecd-…",
  } as NodeJS.ProcessEnv);
  assert.deepEqual(result, { mode: "single", postId: "413b541d-…", expectedPlatform: "youtube", expectedContentFileId: "b98f6ecd-…" });
});

console.log("\n=== evaluateTargetPostEligibility ===");

const TARGET = { postId: "413b541d-…", expectedPlatform: "youtube", expectedContentFileId: "b98f6ecd-…" };
const PAST = "2020-01-01T00:00:00Z"; // siempre elegible por scheduling, para los tests que no son sobre scheduled_at

test("4. POST_ID inexistente (row=null) -> BLOCKED", () => {
  const result = evaluateTargetPostEligibility(null, null, TARGET);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /no existe/);
});

test("5. post existe pero NO está pending -> BLOCKED", () => {
  const result = evaluateTargetPostEligibility({ id: TARGET.postId, status: "published", content_file_id: "b98f6ecd-…" }, "youtube", TARGET);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /status='pending'/);
});

test("6. post pending pero de OTRO content_file (EXPECTED_CONTENT_FILE_ID no coincide) -> BLOCKED", () => {
  const result = evaluateTargetPostEligibility({ id: TARGET.postId, status: "pending", content_file_id: "OTRO-content-file" }, "youtube", TARGET);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /content_file_id/);
});

test("7. post pending, content_file correcto, pero de OTRA plataforma (EXPECTED_PLATFORM no coincide) -> BLOCKED", () => {
  const result = evaluateTargetPostEligibility({ id: TARGET.postId, status: "pending", content_file_id: "b98f6ecd-…" }, "facebook", TARGET);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /plataforma/);
});

test("8. todo coincide (pending + content_file + plataforma + scheduled_at pasado) -> ok:true", () => {
  const result = evaluateTargetPostEligibility({ id: TARGET.postId, status: "pending", content_file_id: "b98f6ecd-…", scheduled_at: PAST }, "youtube", TARGET);
  assert.deepEqual(result, { ok: true });
});

test("9. sin EXPECTED_PLATFORM/EXPECTED_CONTENT_FILE_ID (ambos undefined) -> solo se exige pending + scheduled_at elegible", () => {
  const target = { postId: "cualquier-id" };
  const result = evaluateTargetPostEligibility({ id: "cualquier-id", status: "pending", content_file_id: "lo-que-sea", scheduled_at: PAST }, "instagram", target);
  assert.deepEqual(result, { ok: true });
});

test("10. NUNCA hay ok:true si status no es EXACTAMENTE 'pending' (barrido)", () => {
  for (const status of ["publishing", "published", "error", "verification_required"]) {
    const result = evaluateTargetPostEligibility({ id: TARGET.postId, status, content_file_id: "b98f6ecd-…" }, "youtube", TARGET);
    assert.equal(result.ok, false, `status='${status}' no debería ser elegible`);
  }
});

console.log("\n=== scheduled_at (Fase 5.20, Phase A5 — cierre de RIESGO 1 del preflight: el modo dirigido no debe saltarse scheduling) ===");

const NOW = new Date("2026-09-12T12:00:00Z");
const TARGET_NO_EXPECTATIONS = { postId: "413b541d-…" };

test("11. scheduled_at en el PASADO -> elegible (igual que el modo general trataría un post vencido)", () => {
  const result = evaluateTargetPostEligibility(
    { id: TARGET_NO_EXPECTATIONS.postId, status: "pending", content_file_id: "x", scheduled_at: "2026-09-01T00:00:00Z" },
    "youtube",
    TARGET_NO_EXPECTATIONS,
    NOW
  );
  assert.deepEqual(result, { ok: true });
});

test("12. scheduled_at EXACTAMENTE ahora -> elegible (límite inclusivo, mismo criterio que .lte() del modo general)", () => {
  const result = evaluateTargetPostEligibility(
    { id: TARGET_NO_EXPECTATIONS.postId, status: "pending", content_file_id: "x", scheduled_at: NOW.toISOString() },
    "youtube",
    TARGET_NO_EXPECTATIONS,
    NOW
  );
  assert.deepEqual(result, { ok: true });
});

test("13. scheduled_at en el FUTURO -> BLOQUEADO, sin bypass — es el hallazgo exacto que esta corrección cierra", () => {
  const result = evaluateTargetPostEligibility(
    { id: TARGET_NO_EXPECTATIONS.postId, status: "pending", content_file_id: "x", scheduled_at: "2026-12-25T00:00:00Z" },
    "youtube",
    TARGET_NO_EXPECTATIONS,
    NOW
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /futuro/);
});

test("14. scheduled_at NULL — contractualmente imposible hoy (supabase/schema.sql: NOT NULL), pero el comportamiento definido es BLOQUEAR, nunca asumir 'sin restricción' (consistente con .lte() de Postgres, que tampoco selecciona NULL)", () => {
  const result = evaluateTargetPostEligibility(
    { id: TARGET_NO_EXPECTATIONS.postId, status: "pending", content_file_id: "x", scheduled_at: null },
    "youtube",
    TARGET_NO_EXPECTATIONS,
    NOW
  );
  assert.equal(result.ok, false);
});

test("14b. scheduled_at con formato inválido -> BLOQUEADO, nunca asumido elegible", () => {
  const result = evaluateTargetPostEligibility(
    { id: TARGET_NO_EXPECTATIONS.postId, status: "pending", content_file_id: "x", scheduled_at: "no-es-una-fecha" },
    "youtube",
    TARGET_NO_EXPECTATIONS,
    NOW
  );
  assert.equal(result.ok, false);
});

test("15. `now` por defecto usa el reloj real (sin inyectarlo) — un scheduled_at muy en el pasado sigue siendo elegible", () => {
  const result = evaluateTargetPostEligibility(
    { id: TARGET_NO_EXPECTATIONS.postId, status: "pending", content_file_id: "x", scheduled_at: "2020-01-01T00:00:00Z" },
    "youtube",
    TARGET_NO_EXPECTATIONS
  );
  assert.deepEqual(result, { ok: true });
});

console.log(`\n${passed} test(s) pasados.`);
if (process.exitCode) {
  console.error("\nHay tests fallidos.");
  process.exit(1);
}

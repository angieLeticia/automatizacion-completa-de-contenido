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

test("8. todo coincide (pending + content_file + plataforma) -> ok:true", () => {
  const result = evaluateTargetPostEligibility({ id: TARGET.postId, status: "pending", content_file_id: "b98f6ecd-…" }, "youtube", TARGET);
  assert.deepEqual(result, { ok: true });
});

test("9. sin EXPECTED_PLATFORM/EXPECTED_CONTENT_FILE_ID (ambos undefined) -> solo se exige pending", () => {
  const target = { postId: "cualquier-id" };
  const result = evaluateTargetPostEligibility({ id: "cualquier-id", status: "pending", content_file_id: "lo-que-sea" }, "instagram", target);
  assert.deepEqual(result, { ok: true });
});

test("10. NUNCA hay ok:true si status no es EXACTAMENTE 'pending' (barrido)", () => {
  for (const status of ["publishing", "published", "error", "verification_required"]) {
    const result = evaluateTargetPostEligibility({ id: TARGET.postId, status, content_file_id: "b98f6ecd-…" }, "youtube", TARGET);
    assert.equal(result.ok, false, `status='${status}' no debería ser elegible`);
  }
});

console.log(`\n${passed} test(s) pasados.`);
if (process.exitCode) {
  console.error("\nHay tests fallidos.");
  process.exit(1);
}

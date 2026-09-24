// Fase 1.7 — tests puros de targetSelection.mts (aislamiento dirigido de
// Agent 2 via CONTENT_METADATA_ID). Sin red, sin Supabase: el entorno y las
// filas se construyen a mano, mismo patron que
// agent/publish/test-target-post-selection.mts.
import assert from "node:assert/strict";
import { resolveScheduleMode, evaluateTargetEligibility, computeSelection } from "./targetSelection.mts";

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

console.log("=== resolveScheduleMode ===");

test("TEST 1 (modo global) — CONTENT_METADATA_ID ausente -> mode='global'", () => {
  assert.deepEqual(resolveScheduleMode({} as NodeJS.ProcessEnv), { mode: "global" });
});

test("TEST 2 (modo dirigido) — CONTENT_METADATA_ID='uuid-X' -> mode='directed', targetId='uuid-X'", () => {
  const result = resolveScheduleMode({ CONTENT_METADATA_ID: "uuid-X" } as NodeJS.ProcessEnv);
  assert.deepEqual(result, { mode: "directed", targetId: "uuid-X" });
});

test("TEST 3 (variable vacía) — CONTENT_METADATA_ID='' -> se comporta EXACTAMENTE como ausente (mode='global')", () => {
  assert.deepEqual(resolveScheduleMode({ CONTENT_METADATA_ID: "" } as NodeJS.ProcessEnv), { mode: "global" });
});

test("TEST 3b (variable solo espacios) — CONTENT_METADATA_ID='   ' -> mode='global', mismo criterio que ''", () => {
  assert.deepEqual(resolveScheduleMode({ CONTENT_METADATA_ID: "   " } as NodeJS.ProcessEnv), { mode: "global" });
});

test("TEST 3c — CONTENT_METADATA_ID con espacios alrededor de un id real -> se recorta (trim), sigue siendo 'directed'", () => {
  const result = resolveScheduleMode({ CONTENT_METADATA_ID: "  uuid-X  " } as NodeJS.ProcessEnv);
  assert.deepEqual(result, { mode: "directed", targetId: "uuid-X" });
});

console.log("\n=== evaluateTargetEligibility ===");

test("TEST 4 (ID inexistente) — row=null -> ok:false, NUNCA procesar, razon menciona 'no existe'", () => {
  const result = evaluateTargetEligibility(null, "uuid-inexistente");
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /no existe/);
});

test("TEST 5 (target no-ready) — status='analyzing' -> ok:false, razon menciona el status real", () => {
  const result = evaluateTargetEligibility({ id: "uuid-X", status: "analyzing" }, "uuid-X");
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /status='ready'/);
  if (!result.ok) assert.match(result.reason, /analyzing/);
});

test("TEST 5b — barrido de todos los status != 'ready' conocidos -> NUNCA ok:true", () => {
  for (const status of ["pending", "transcribing", "sampling_frames", "generating_metadata", "error"]) {
    const result = evaluateTargetEligibility({ id: "uuid-X", status }, "uuid-X");
    assert.equal(result.ok, false, `status='${status}' no deberia ser elegible`);
  }
});

test("TEST 6 (target ready) — status='ready' -> ok:true", () => {
  const result = evaluateTargetEligibility({ id: "uuid-X", status: "ready" }, "uuid-X");
  assert.deepEqual(result, { ok: true });
});

console.log("\n=== computeSelection (composición completa: que se procesa realmente) ===");

test("TEST 7 (aislamiento) — READY A,B,C + CONTENT_METADATA_ID=B -> ids=['B'], NUNCA ['A','B','C']", () => {
  const mode = resolveScheduleMode({ CONTENT_METADATA_ID: "B" } as NodeJS.ProcessEnv);
  const result = computeSelection({ mode, directedRow: { id: "B", status: "ready" } });
  assert.deepEqual(result, { ids: ["B"], skippedGlobalQueue: true });
});

test("TEST 8 (regresión del modo global) — sin CONTENT_METADATA_ID + READY A,B,C -> ids=['A','B','C'], comportamiento existente intacto", () => {
  const mode = resolveScheduleMode({} as NodeJS.ProcessEnv);
  const result = computeSelection({ mode, globalReadyIds: ["A", "B", "C"] });
  assert.deepEqual(result, { ids: ["A", "B", "C"], skippedGlobalQueue: false });
});

test("TEST 9 — modo dirigido con target inexistente -> ids=[] (CERO fallback a la cola global, aunque globalReadyIds se pasara por error)", () => {
  const mode = resolveScheduleMode({ CONTENT_METADATA_ID: "uuid-fantasma" } as NodeJS.ProcessEnv);
  const result = computeSelection({ mode, directedRow: null, globalReadyIds: ["A", "B", "C"] });
  assert.equal(result.ids.length, 0);
  assert.equal(result.skippedGlobalQueue, true);
  if (result.skippedGlobalQueue) assert.match(result.blockedReason ?? "", /no existe/);
});

test("TEST 10 — modo dirigido con target no-ready -> ids=[] (CERO fallback a la cola global)", () => {
  const mode = resolveScheduleMode({ CONTENT_METADATA_ID: "B" } as NodeJS.ProcessEnv);
  const result = computeSelection({ mode, directedRow: { id: "B", status: "analyzing" }, globalReadyIds: ["A", "B", "C"] });
  assert.equal(result.ids.length, 0);
  assert.equal(result.skippedGlobalQueue, true);
});

test("TEST 11 — modo dirigido NUNCA produce mas de 1 id, aunque directedRow coincida con uno de globalReadyIds", () => {
  const mode = resolveScheduleMode({ CONTENT_METADATA_ID: "B" } as NodeJS.ProcessEnv);
  const result = computeSelection({ mode, directedRow: { id: "B", status: "ready" }, globalReadyIds: ["A", "B", "C"] });
  assert.deepEqual(result.ids, ["B"]);
});

console.log(`\n${passed} test(s) pasados.`);
if (process.exitCode) {
  console.error("\nHay tests fallidos.");
  process.exit(1);
}

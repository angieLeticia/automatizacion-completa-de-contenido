// Fase 3.3 — tests puros de targetSelection.mts (aislamiento dirigido del
// analyzer de Agent 1, CONTENT_FILE_ID). Sin Supabase, sin red.
import assert from "node:assert/strict";
import { resolveAnalyzeMode, evaluateAnalyzeEligibility, computeAnalyzeSelection } from "./targetSelection.mts";

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

const MAX_RETRIES = 3;

console.log("=== resolveAnalyzeMode ===");

test("11. CONTENT_FILE_ID ausente -> mode='global'", () => {
  assert.deepEqual(resolveAnalyzeMode({} as NodeJS.ProcessEnv), { mode: "global" });
});

test("11b. CONTENT_FILE_ID vacío/solo espacios -> mode='global', igual que ausente", () => {
  assert.deepEqual(resolveAnalyzeMode({ CONTENT_FILE_ID: "  " } as NodeJS.ProcessEnv), { mode: "global" });
});

test("CONTENT_FILE_ID presente -> mode='directed', targetId resuelto (trim)", () => {
  assert.deepEqual(resolveAnalyzeMode({ CONTENT_FILE_ID: "  uuid-B  " } as NodeJS.ProcessEnv), { mode: "directed", targetId: "uuid-B" });
});

console.log("\n=== evaluateAnalyzeEligibility ===");

test("12. ID inexistente (fileRow=null) -> bloqueado", () => {
  const result = evaluateAnalyzeEligibility(null, null, "uuid-X", MAX_RETRIES);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /no existe/);
});

test("13. status='analyzing' + sin content_metadata -> elegible como NUEVO", () => {
  const result = evaluateAnalyzeEligibility({ id: "uuid-X", status: "analyzing" }, null, "uuid-X", MAX_RETRIES);
  assert.deepEqual(result, { ok: true, claimKind: "new" });
});

test("14. status='ready' (ya analizado) -> bloqueado", () => {
  const result = evaluateAnalyzeEligibility({ id: "uuid-X", status: "ready" }, null, "uuid-X", MAX_RETRIES);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /status='analyzing'/);
});

test("15. status no elegible (account_conflict) -> bloqueado", () => {
  const result = evaluateAnalyzeEligibility({ id: "uuid-X", status: "account_conflict" }, null, "uuid-X", MAX_RETRIES);
  assert.equal(result.ok, false);
});

test("15b. status no elegible (invalid) -> bloqueado", () => {
  const result = evaluateAnalyzeEligibility({ id: "uuid-X", status: "invalid" }, null, "uuid-X", MAX_RETRIES);
  assert.equal(result.ok, false);
});

test("16. content_metadata.status='error' + retry_count < MAX_RETRIES -> elegible como REINTENTO", () => {
  const result = evaluateAnalyzeEligibility(
    { id: "uuid-X", status: "analyzing" },
    { id: "meta-1", status: "error", retry_count: 1 },
    "uuid-X",
    MAX_RETRIES
  );
  assert.deepEqual(result, { ok: true, claimKind: "retry", metadataId: "meta-1", retryCountAtClaim: 1 });
});

test("17. content_metadata.status='error' + retry_count agotado (>=MAX_RETRIES) -> bloqueado", () => {
  const result = evaluateAnalyzeEligibility(
    { id: "uuid-X", status: "analyzing" },
    { id: "meta-1", status: "error", retry_count: MAX_RETRIES },
    "uuid-X",
    MAX_RETRIES
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /no reclamable/);
});

test("content_metadata ya 'ready' (aunque content_files siga en 'analyzing') -> bloqueado, nunca se re-analiza", () => {
  const result = evaluateAnalyzeEligibility(
    { id: "uuid-X", status: "analyzing" },
    { id: "meta-1", status: "ready", retry_count: 0 },
    "uuid-X",
    MAX_RETRIES
  );
  assert.equal(result.ok, false);
});

test("content_metadata en progreso ('transcribing', otra corrida) -> bloqueado, nunca se reclama dos veces", () => {
  const result = evaluateAnalyzeEligibility(
    { id: "uuid-X", status: "analyzing" },
    { id: "meta-1", status: "transcribing", retry_count: 0 },
    "uuid-X",
    MAX_RETRIES
  );
  assert.equal(result.ok, false);
});

console.log("\n=== computeAnalyzeSelection (composición completa: que se procesa realmente) ===");

test("18. ANALYZING A,B,C (globalIds) + CONTENT_FILE_ID=B elegible -> ids=['B'], NUNCA ['A','B','C']", () => {
  const mode = resolveAnalyzeMode({ CONTENT_FILE_ID: "B" } as NodeJS.ProcessEnv);
  const eligibility = evaluateAnalyzeEligibility({ id: "B", status: "analyzing" }, null, "B", MAX_RETRIES);
  const result = computeAnalyzeSelection({ mode, eligibility, globalIds: ["A", "B", "C"] });
  assert.deepEqual(result, { ids: ["B"], skippedGlobalQuery: true });
});

test("sin CONTENT_FILE_ID + ANALYZING A,B,C -> ids=['A','B','C'] (modo global preservado, regresión)", () => {
  const mode = resolveAnalyzeMode({} as NodeJS.ProcessEnv);
  const result = computeAnalyzeSelection({ mode, globalIds: ["A", "B", "C"] });
  assert.deepEqual(result, { ids: ["A", "B", "C"], skippedGlobalQuery: false });
});

test("19. CONTENT_FILE_ID inexistente + otros ANALYZING (A,B,C) -> ids=[] (los otros NUNCA se tocan)", () => {
  const mode = resolveAnalyzeMode({ CONTENT_FILE_ID: "uuid-fantasma" } as NodeJS.ProcessEnv);
  const eligibility = evaluateAnalyzeEligibility(null, null, "uuid-fantasma", MAX_RETRIES);
  const result = computeAnalyzeSelection({ mode, eligibility, globalIds: ["A", "B", "C"] });
  assert.equal(result.ids.length, 0);
  assert.equal(result.skippedGlobalQuery, true);
});

test("CONTENT_FILE_ID no elegible (ready) + otros ANALYZING -> ids=[] (cero fallback, cero procesamiento de los otros)", () => {
  const mode = resolveAnalyzeMode({ CONTENT_FILE_ID: "B" } as NodeJS.ProcessEnv);
  const eligibility = evaluateAnalyzeEligibility({ id: "B", status: "ready" }, null, "B", MAX_RETRIES);
  const result = computeAnalyzeSelection({ mode, eligibility, globalIds: ["A", "B", "C"] });
  assert.deepEqual(result.ids, []);
});

test("modo dirigido NUNCA produce mas de 1 id, aunque el target coincida con uno de globalIds", () => {
  const mode = resolveAnalyzeMode({ CONTENT_FILE_ID: "B" } as NodeJS.ProcessEnv);
  const eligibility = evaluateAnalyzeEligibility({ id: "B", status: "analyzing" }, null, "B", MAX_RETRIES);
  const result = computeAnalyzeSelection({ mode, eligibility, globalIds: ["A", "B", "C"] });
  assert.equal(result.ids.length, 1);
});

console.log(
  "\n=== NOTA: casos 20/21 (modo dirigido NUNCA llama findPendingWork(); termina tras un unico procesamiento, sin while(true)/sleep) ===\n" +
    "No son testeables como unidades puras (dependen de la estructura de control de main(), que importa supabaseClient.mts) -\n" +
    "se verifican por LECTURA DE CODIGO de agent/analyze/run.mts (mismo criterio ya usado en Fase 1.7 para Agent 2):\n" +
    "  20. la rama 'if (mode.mode === \"directed\") { ...; return; }' esta posicionada ANTES del 'while(true)' que\n" +
    "      contiene la unica llamada a findPendingWork() - inalcanzable en este modo.\n" +
    "  21. esa misma rama termina con 'return' inmediatamente despues de UN UNICO 'await processOne(item)',\n" +
    "      sin ningun bucle ni 'await sleep(POLL_INTERVAL_MS)'."
);

console.log(`\n${passed} test(s) pasados.`);
if (process.exitCode) {
  console.error("\nHay tests fallidos.");
  process.exit(1);
}

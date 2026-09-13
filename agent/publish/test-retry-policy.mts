// Fase 5.20 (Phase A4) — tests de la clasificacion explicita de retryPolicy.mts.
// Sin red, sin Supabase.
import assert from "node:assert/strict";
import { classifyError, extractHttpStatus, decideRetry } from "./retryPolicy.mts";

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

console.log("=== extractHttpStatus ===");
test("extrae el status embebido en un mensaje real del proyecto", () => {
  assert.equal(extractHttpStatus("Falló la subida del vídeo a YouTube: 403 forbidden"), 403);
});
test("sin ningun status reconocido -> null", () => {
  assert.equal(extractHttpStatus("ECONNRESET - conexion cerrada por el peer"), null);
});
test("un numero de 3 digitos que NO es un status conocido no se confunde con uno", () => {
  assert.equal(extractHttpStatus("procesando 999 elementos"), null);
});

console.log("\n=== classifyError — NO retryable ===");
test("400 -> permanent", () => assert.equal(classifyError("Bad request: 400 invalid params"), "permanent"));
test("401 -> permanent", () => assert.equal(classifyError("Unauthorized: 401"), "permanent"));
test("403 -> permanent", () => assert.equal(classifyError("Forbidden: 403"), "permanent"));
test("404 -> permanent", () => assert.equal(classifyError("Not found: 404"), "permanent"));

console.log("\n=== classifyError — retryable ===");
test("408 -> retryable", () => assert.equal(classifyError("Request timeout: 408"), "retryable"));
test("429 -> retryable", () => assert.equal(classifyError("Too many requests: 429"), "retryable"));
test("500 -> retryable", () => assert.equal(classifyError("Internal server error: 500"), "retryable"));
test("502 -> retryable", () => assert.equal(classifyError("Bad gateway: 502"), "retryable"));
test("503 -> retryable", () => assert.equal(classifyError("Service unavailable: 503"), "retryable"));
test("504 -> retryable", () => assert.equal(classifyError("Gateway timeout: 504"), "retryable"));

console.log("\n=== classifyError — red / desconocido ===");
test("network-before-operation (sin status HTTP reconocible) -> retryable por default seguro", () => {
  assert.equal(classifyError("fetch failed: ECONNRESET"), "retryable");
});
test(
  "network-after-operation-started: en la arquitectura real esto NUNCA llega a classifyError() - " +
    "run.mts intercepta `instanceof PublicationOutcomeUncertainError` ANTES de clasificar (ver " +
    "lib/social/test-youtube-upload.mts test 1, test-instagram-upload.mts test 2, test-facebook-upload.mts test 1, " +
    "que prueban exactamente ese camino). Esta prueba solo documenta que, SI un mensaje asi llegara aqui de " +
    "forma aislada, el default seguro (retryable) seguiria aplicando - nunca se asumiria 'permanent' sin evidencia.",
  () => {
    assert.equal(classifyError("Fallo de red durante la subida a YouTube (PUT) sin respuesta HTTP recibida - no se puede confirmar si el video fue aceptado: ECONNRESET"), "retryable");
  }
);
test("mensaje vacio -> retryable (default seguro)", () => assert.equal(classifyError(""), "retryable"));

console.log("\n=== decideRetry — regresion (sin cambios de comportamiento) ===");
test("permanent siempre -> error, sin incrementar retry_count", () => {
  assert.deepEqual(decideRetry("permanent", 0), { nextStatus: "error", nextRetryCount: 0 });
  assert.deepEqual(decideRetry("permanent", 2), { nextStatus: "error", nextRetryCount: 2 });
});
test("retryable bajo MAX_RETRIES -> pending, incrementa", () => {
  assert.deepEqual(decideRetry("retryable", 0), { nextStatus: "pending", nextRetryCount: 1 });
});
test("retryable al llegar a MAX_RETRIES -> error", () => {
  assert.deepEqual(decideRetry("retryable", 2), { nextStatus: "error", nextRetryCount: 3 });
});

console.log(`\n${passed} test(s) pasados.`);
if (process.exitCode) {
  console.error("\nHay tests fallidos.");
  process.exit(1);
}

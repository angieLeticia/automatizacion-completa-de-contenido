// Tests puros (sin red) de planUploadChunks()/validateUploadPlan() —
// scripts/social/tiktok-upload-draft.mts. Requiere que .env.local exista
// (mismo requisito que cualquier otro script de este repo que importa
// lib/social/supabaseAdmin.ts, aunque este test nunca llega a usarlo:
// isDirectRun en tiktok-upload-draft.mts evita que su main() corra al
// importarlo, pero el cliente de Supabase igual se construye al evaluar el
// módulo — no se hace ninguna llamada de red real).
import assert from "node:assert/strict";
import { planUploadChunks, validateUploadPlan, type UploadPlan } from "./tiktok-upload-draft.mts";

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

function assertNoGapsOrOverlaps(plan: UploadPlan) {
  let expectedStart = 0;
  for (const c of plan.chunks) {
    assert.equal(c.start, expectedStart, `chunk[${c.index}].start debe ser ${expectedStart}`);
    assert.equal(c.end, c.start + c.length - 1, `chunk[${c.index}] end/start/length inconsistentes`);
    expectedStart = c.end + 1;
  }
  assert.equal(expectedStart, plan.videoSize, "el ultimo end+1 debe ser exactamente videoSize");
}

function sumLengths(plan: UploadPlan): number {
  return plan.chunks.reduce((sum, c) => sum + c.length, 0);
}

test("1. archivo menor al maximo de un chunk (2 MB) -> un solo chunk, chunk_size=video_size", () => {
  const plan = planUploadChunks(2_000_000);
  assert.equal(plan.totalChunkCount, 1);
  assert.equal(plan.chunkSize, 2_000_000);
  assert.equal(plan.chunks.length, 1);
  assert.deepEqual(plan.chunks[0], { index: 0, start: 0, end: 1_999_999, length: 2_000_000 });
  assert.deepEqual(validateUploadPlan(plan), { ok: true });
});

test("2. exactamente el limite de un chunk (64,000,000 bytes) -> sigue siendo un solo chunk", () => {
  const plan = planUploadChunks(64_000_000);
  assert.equal(plan.totalChunkCount, 1);
  assert.equal(plan.chunkSize, 64_000_000);
  assert.equal(plan.chunks[0].length, 64_000_000);
  assert.deepEqual(validateUploadPlan(plan), { ok: true });
});

test("2b. un byte MAS que el limite (64,000,001) -> ya pasa a multi-chunk", () => {
  const plan = planUploadChunks(64_000_001);
  assert.ok(plan.totalChunkCount > 1, "debe requerir mas de 1 chunk apenas se supera el techo de un chunk unico");
  assert.deepEqual(validateUploadPlan(plan), { ok: true });
});

test("3. nuestro archivo real (172649788 bytes) -> 17 chunks, chunk_size=10000000, ultimo=12649788", () => {
  const plan = planUploadChunks(172_649_788);
  assert.equal(plan.chunkSize, 10_000_000);
  assert.equal(plan.totalChunkCount, 17);
  assert.equal(plan.chunks.length, 17);
  for (let i = 0; i < 16; i++) {
    assert.equal(plan.chunks[i].length, 10_000_000, `chunk ${i} debe medir exactamente 10MB`);
  }
  const last = plan.chunks[16];
  assert.deepEqual(last, { index: 16, start: 160_000_000, end: 172_649_787, length: 12_649_788 });
  assert.equal(sumLengths(plan), 172_649_788);
  assertNoGapsOrOverlaps(plan);
  assert.deepEqual(validateUploadPlan(plan), { ok: true });
});

test("4. archivo generico que requiere multiples chunks (75,000,000 bytes, > 64MB)", () => {
  // >64,000,000 es obligatorio para forzar multi-chunk: por debajo de eso
  // planUploadChunks() manda todo en un chunk unico (ver test 2/2b).
  const plan = planUploadChunks(75_000_000);
  assert.equal(plan.chunkSize, 10_000_000);
  assert.equal(plan.totalChunkCount, 7);
  for (let i = 0; i < 6; i++) assert.deepEqual(plan.chunks[i], { index: i, start: i * 10_000_000, end: i * 10_000_000 + 9_999_999, length: 10_000_000 });
  assert.deepEqual(plan.chunks[6], { index: 6, start: 60_000_000, end: 74_999_999, length: 15_000_000 });
  assert.equal(sumLengths(plan), 75_000_000);
  assertNoGapsOrOverlaps(plan);
  assert.deepEqual(validateUploadPlan(plan), { ok: true });
});

test("5. ultimo chunk de tamaño DISTINTO al estandar (nunca mas chico, ver nota)", () => {
  // NOTA: con este diseño el ultimo chunk absorbe el resto de la division
  // entera, asi que SIEMPRE es >= chunkSize (nunca mas chico) - nunca queda
  // un resto diminuto como chunk propio, que podria caer bajo el minimo de
  // 5MB. Esto coincide con el propio texto oficial ("the final chunk...
  // can be greater than chunk_size, up to 128MB") - esa frase solo tiene
  // sentido si el comportamiento esperado del ultimo chunk es ser MAS
  // GRANDE que el estandar, no mas chico. Este test verifica exactamente
  // eso: el ultimo difiere del estandar, y lo hace siendo mas grande.
  const plan = planUploadChunks(70_000_001); // >64MB (obliga multi-chunk) + 1 byte de resto sobre 7 chunks de 10MB
  assert.equal(plan.totalChunkCount, 7);
  for (let i = 0; i < 6; i++) assert.equal(plan.chunks[i].length, 10_000_000);
  const last = plan.chunks[6];
  assert.equal(last.length, 10_000_001);
  assert.ok(last.length > plan.chunkSize, "el ultimo chunk debe ser mas grande que chunkSize, nunca mas chico");
  assert.ok(last.length <= 128_000_000, "el ultimo chunk nunca debe superar el techo oficial de 128MB");
  assert.deepEqual(validateUploadPlan(plan), { ok: true });
});

test("6. limites invalidos -> planUploadChunks lanza, nunca produce un plan silenciosamente incorrecto", () => {
  assert.throws(() => planUploadChunks(0), /inválido/);
  assert.throws(() => planUploadChunks(-5), /inválido/);
  assert.throws(() => planUploadChunks(1.5), /inválido/);
  assert.throws(() => planUploadChunks(1000, 0), /inválido/);
  assert.throws(() => planUploadChunks(1000, -1), /inválido/);
});

test("7. suma exacta de bytes en un caso grande (900,000,000 bytes, muchos chunks)", () => {
  const plan = planUploadChunks(900_000_000);
  assert.equal(sumLengths(plan), 900_000_000);
  assert.ok(plan.totalChunkCount <= 1000, "no debe superar el maximo oficial de 1000 chunks");
});

test("8. ranges sin gaps ni overlaps (verificacion generica sobre varios tamaños)", () => {
  for (const size of [1, 4_999_999, 5_000_000, 63_999_999, 64_000_001, 100_000_003, 999_999_999]) {
    const plan = planUploadChunks(size);
    assertNoGapsOrOverlaps(plan);
    assert.deepEqual(validateUploadPlan(plan), { ok: true }, `size=${size} debe producir un plan valido`);
  }
});

test("9. validateUploadPlan es FAIL-CLOSED: detecta un plan corrupto a mano (hueco), no confia ciegamente", () => {
  // 75,000,000 (>64MB, multi-chunk con indice 1 como chunk "estandar" del
  // medio, no el ultimo) - a diferencia de un plan de un solo chunk, donde
  // no existiria indice 1 que corromper.
  const good = planUploadChunks(75_000_000);
  const corrupted: UploadPlan = {
    ...good,
    chunks: good.chunks.map((c, i) => (i === 1 ? { ...c, start: c.start + 1 } : c)), // crea un hueco de 1 byte
  };
  const result = validateUploadPlan(corrupted);
  assert.equal(result.ok, false, "un plan con un hueco debe ser rechazado, no aceptado");
});

test("9b. validateUploadPlan detecta un overlap a mano", () => {
  const good = planUploadChunks(75_000_000);
  const corrupted: UploadPlan = {
    ...good,
    chunks: good.chunks.map((c, i) => (i === 1 ? { ...c, start: c.start - 1 } : c)), // overlap de 1 byte con el anterior
  };
  const result = validateUploadPlan(corrupted);
  assert.equal(result.ok, false, "un plan con overlap debe ser rechazado, no aceptado");
});

test("9c. validateUploadPlan detecta que la suma de lengths no coincide con videoSize", () => {
  const good = planUploadChunks(75_000_000);
  const corrupted: UploadPlan = {
    ...good,
    chunks: good.chunks.map((c, i) => (i === good.chunks.length - 1 ? { ...c, length: c.length - 1 } : c)),
  };
  const result = validateUploadPlan(corrupted);
  assert.equal(result.ok, false, "una suma de lengths distinta a videoSize debe ser rechazada");
});

test("9d. validateUploadPlan rechaza totalChunkCount fuera de [1,1000]", () => {
  const good = planUploadChunks(75_000_000);
  assert.equal(validateUploadPlan({ ...good, totalChunkCount: 0 }).ok, false);
  assert.equal(validateUploadPlan({ ...good, totalChunkCount: 1001 }).ok, false);
});

console.log(`\n${passed} test(s) pasados.`);
if (process.exitCode) {
  console.error("\nHay tests fallidos.");
  process.exit(1);
}

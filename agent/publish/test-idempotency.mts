// Fase 5.20 (Phase B2) — cierra el "NO DEMOSTRADO" de la auditoría
// post-piloto: idempotencia frente a un post ya `published`. Sin llamadas
// reales a ninguna plataforma, sin Supabase real - se prueba la PROPIEDAD
// del mecanismo (un UPDATE condicional `WHERE status='pending'` nunca
// afecta una fila que ya no está en 'pending') con una simulación en
// memoria de la MISMA semántica de filtrado que usa claimPost.mts, y se
// confirma por lectura de código que el mecanismo real usa exactamente esa
// condición (no una aproximada).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

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

// Simulación mínima de una tabla en memoria con la MISMA semántica que un
// UPDATE condicional de Postgres: solo afecta filas que cumplen el WHERE, y
// devuelve la fila afectada (o null si ninguna coincidió) - exactamente el
// contrato que claimPost.mts explota para garantizar exclusión mutua real.
interface FakeRow {
  id: string;
  status: string;
  external_post_id: string | null;
}

function fakeConditionalUpdate(table: FakeRow[], id: string, whereStatus: string, newStatus: string): FakeRow | null {
  const row = table.find((r) => r.id === id && r.status === whereStatus);
  if (!row) return null;
  row.status = newStatus;
  return { ...row };
}

console.log("=== Simulación de la propiedad de exclusión mutua (misma semántica que claimPost.mts) ===");

test("1. Un post en 'pending' SÍ puede reclamarse (transiciona a 'publishing')", () => {
  const table: FakeRow[] = [{ id: "post-1", status: "pending", external_post_id: null }];
  const claimed = fakeConditionalUpdate(table, "post-1", "pending", "publishing");
  assert.notEqual(claimed, null);
  assert.equal(table[0].status, "publishing");
});

test("2. Un post en 'published' NUNCA puede reclamarse de nuevo (el WHERE status='pending' no coincide)", () => {
  const table: FakeRow[] = [{ id: "post-1", status: "published", external_post_id: "yt-real-123" }];
  const claimed = fakeConditionalUpdate(table, "post-1", "pending", "publishing");
  assert.equal(claimed, null, "reclamar un post ya published debe devolver null, sin modificar la fila");
  assert.equal(table[0].status, "published", "el status NUNCA cambia cuando el claim falla");
  assert.equal(table[0].external_post_id, "yt-real-123", "el external_post_id existente se conserva intacto");
});

test("3. external_post_id ya presente + status=published -> ningún camino de este mecanismo genera una segunda publicación", () => {
  // La ÚNICA forma de llegar al publisher real (lib/social/*) es a través de
  // un claim exitoso (test 1/2) seguido de markPublishAttemptStarted() y
  // publish() - un post que ya tiene external_post_id y status='published'
  // nunca vuelve a pasar por claimPost() con éxito (test 2), así que jamás
  // llega a invocar publish() una segunda vez. No hay ninguna rama de código
  // que lea external_post_id para "saltarse" el claim - la protección es
  // puramente el status, no el external_post_id en sí.
  const table: FakeRow[] = [{ id: "post-1", status: "published", external_post_id: "yt-real-123" }];
  let publishCallCount = 0;
  const claimed = fakeConditionalUpdate(table, "post-1", "pending", "publishing");
  if (claimed) publishCallCount++; // esta rama nunca se ejecuta - lo confirma el assert de abajo
  assert.equal(publishCallCount, 0);
});

test("4. Un post 'publishing' (claim de otro proceso en curso) tampoco puede ser reclamado por un segundo proceso", () => {
  const table: FakeRow[] = [{ id: "post-1", status: "publishing", external_post_id: null }];
  const claimed = fakeConditionalUpdate(table, "post-1", "pending", "publishing");
  assert.equal(claimed, null, "dos procesos compitiendo por el mismo post - el segundo siempre pierde");
});

console.log("\n=== Confirmación contra el código real (claimPost.mts) ===");

test("5. claimPost() real usa exactamente `.eq('status', 'pending')` en el UPDATE de claim - misma condición simulada arriba", () => {
  const source = readFileSync(new URL("./claimPost.mts", import.meta.url), "utf-8");
  assert.match(source, /\.update\(updatePayload\)\s*\n\s*\.eq\("id", postId\)\s*\n\s*\.eq\("status", "pending"\)/);
});

test("6. main() (run.mts) solo consulta posts con status='pending' como 'debidos' - un post published nunca vuelve a entrar al ciclo automático", () => {
  const source = readFileSync(new URL("./run.mts", import.meta.url), "utf-8");
  assert.match(source, /\.eq\("status", "pending"\)\s*\n\s*\.lte\("scheduled_at"/);
});

console.log(`\n${passed} test(s) pasados.`);
if (process.exitCode) {
  console.error("\nHay tests fallidos.");
  process.exit(1);
}

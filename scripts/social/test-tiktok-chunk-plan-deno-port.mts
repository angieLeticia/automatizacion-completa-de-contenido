// Verifica que supabase/functions/tiktok-upload/chunkPlan.ts (la copia que
// corre en la Edge Function) produce EXACTAMENTE el mismo plan que
// scripts/social/tiktok-upload-draft.mts::planUploadChunks() (CLI, ya
// probado). Mismo objetivo que test-tiktok-chunking-browser-port.mts, para
// la OTRA copia (backend en vez de browser). Corre con Node/tsx - no hay
// `deno` instalado en esta máquina para correr esto con `deno test`
// directo, así que esta comparación cruzada es la única verificación
// automatizada real de chunkPlan.ts antes del deploy (ver el commit).
import assert from "node:assert/strict";
import { planUploadChunks as cliPlan, validateUploadPlan as cliValidate } from "./tiktok-upload-draft.mts";
import { planUploadChunks as denoPlan, validateUploadPlan as denoValidate } from "../../supabase/functions/tiktok-upload/chunkPlan.ts";

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

const SIZES = [1, 2_000_000, 5_000_000, 63_999_999, 64_000_000, 64_000_001, 70_000_001, 75_000_000, 172_649_788, 900_000_000];

for (const size of SIZES) {
  test(`plan identico CLI vs Edge Function para videoSize=${size}`, () => {
    const cli = cliPlan(size);
    const deno = denoPlan(size);
    assert.deepEqual(deno, cli, `chunkPlan.ts debe ser byte-a-byte identico al CLI para ${size}`);
    assert.deepEqual(denoValidate(deno), { ok: true });
    assert.deepEqual(cliValidate(cli), { ok: true });
  });
}

test("archivo real (172,649,788 bytes): chunk_size=10000000, total_chunk_count=17, ultimo chunk=12649788", () => {
  const plan = denoPlan(172_649_788);
  assert.equal(plan.chunkSize, 10_000_000);
  assert.equal(plan.totalChunkCount, 17);
  assert.deepEqual(plan.chunks[16], { index: 16, start: 160_000_000, end: 172_649_787, length: 12_649_788 });
});

console.log(`\n${passed} test(s) pasados.`);
if (process.exitCode) {
  console.error("\nHay tests fallidos.");
  process.exit(1);
}

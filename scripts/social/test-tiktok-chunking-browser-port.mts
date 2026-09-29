// Verifica que website/tiktok-chunking.js (la copia que corre en el
// browser) produce EXACTAMENTE el mismo plan que
// scripts/social/tiktok-upload-draft.mts::planUploadChunks() (la version ya
// probada del CLI, 13/13 tests + una subida real exitosa de 172,649,788
// bytes). Mismos casos que test-tiktok-upload-chunking.mts, a proposito -
// esto es una comparacion cruzada, no una reimplementacion de esos tests.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { planUploadChunks as cliPlan, validateUploadPlan as cliValidate } from "./tiktok-upload-draft.mts";

const require = createRequire(import.meta.url);
// website/tiktok-chunking.js es CommonJS-compatible (UMD) a proposito, para
// poder cargarlo acá sin ningún paso de build.
const browserChunking = require("../../website/tiktok-chunking.js") as {
  planUploadChunks: (videoSize: number, chunkSize?: number) => ReturnType<typeof cliPlan>;
  validateUploadPlan: (plan: ReturnType<typeof cliPlan>) => ReturnType<typeof cliValidate>;
};

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
  test(`plan identico CLI vs browser para videoSize=${size}`, () => {
    const cli = cliPlan(size);
    const browser = browserChunking.planUploadChunks(size);
    assert.deepEqual(browser, cli, `el plan de website/tiktok-chunking.js debe ser byte-a-byte identico al del CLI para ${size}`);
    assert.deepEqual(browserChunking.validateUploadPlan(browser), { ok: true });
    assert.deepEqual(cliValidate(cli), { ok: true });
  });
}

test("archivo real (172,649,788 bytes): ambos copian chunk_size=10000000, total_chunk_count=17, ultimo chunk=12649788", () => {
  const plan = browserChunking.planUploadChunks(172_649_788);
  assert.equal(plan.chunkSize, 10_000_000);
  assert.equal(plan.totalChunkCount, 17);
  assert.deepEqual(plan.chunks[16], { index: 16, start: 160_000_000, end: 172_649_787, length: 12_649_788 });
});

console.log(`\n${passed} test(s) pasados.`);
if (process.exitCode) {
  console.error("\nHay tests fallidos.");
  process.exit(1);
}

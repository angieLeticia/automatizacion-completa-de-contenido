// Tests de supabase/functions/tiktok-upload/sessionToken.ts. Corre en Node
// (via tsx) aunque el archivo esta pensado para Deno - usa solo Web Crypto
// estandar (SubtleCrypto), sin ningun Deno.*, exactamente para que esto sea
// posible: no hay `deno` instalado en esta maquina para correr
// `deno test` directo, asi que esta es la unica verificacion automatizada
// real de la logica de cifrado antes del deploy - ver el commit para el
// detalle completo de esta limitacion.
import assert from "node:assert/strict";
import { encryptSession, decryptSession, type UploadSessionPayload } from "../../supabase/functions/tiktok-upload/sessionToken.ts";

let passed = 0;
async function test(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    passed++;
    console.log(`[PASS] ${name}`);
  } catch (err) {
    console.error(`[FALLO] ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

// Clave de prueba, generada solo para este test - NUNCA la clave real de
// Supabase (que no existe en este repo, se crea como secret aparte).
const TEST_KEY = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64");

function samplePayload(overrides: Partial<UploadSessionPayload> = {}): UploadSessionPayload {
  return {
    publishId: "v_inbox_file~v2.test",
    uploadUrl: "https://upload.us.tiktokapis.com/video/?upload_id=test&upload_token=secret",
    videoSize: 172_649_788,
    chunkSize: 10_000_000,
    totalChunkCount: 17,
    accountId: "fe6a2f52-acee-4680-8002-a92c208ff838",
    channelName: "SIN EXPLICACIÓN",
    exp: Date.now() + 60 * 60 * 1000,
    ...overrides,
  };
}

await test("1. round-trip: encrypt -> decrypt devuelve el payload exacto", async () => {
  const payload = samplePayload();
  const token = await encryptSession(payload, TEST_KEY);
  const result = await decryptSession(token, TEST_KEY);
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.payload, payload);
});

await test("2. el token es opaco: nunca contiene el texto plano de uploadUrl", async () => {
  const payload = samplePayload();
  const token = await encryptSession(payload, TEST_KEY);
  assert.ok(!token.includes("upload_token=secret"), "el token cifrado NUNCA debe contener el uploadUrl en texto plano");
  assert.ok(!token.includes("tiktokapis"), "ni siquiera el hostname debe quedar legible en el token");
});

await test("3. una clave distinta no puede descifrar el token de otra", async () => {
  const payload = samplePayload();
  const token = await encryptSession(payload, TEST_KEY);
  const otherKey = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64");
  const result = await decryptSession(token, otherKey);
  assert.equal(result.ok, false, "descifrar con la clave equivocada debe fallar, nunca dar datos parciales");
});

await test("4. un token corrompido (1 byte alterado) es rechazado (autenticacion AES-GCM)", async () => {
  const payload = samplePayload();
  const token = await encryptSession(payload, TEST_KEY);
  const bytes = Buffer.from(token, "base64");
  bytes[bytes.length - 1] ^= 0xff; // corrompe el ultimo byte del ciphertext/tag
  const corrupted = bytes.toString("base64");
  const result = await decryptSession(corrupted, TEST_KEY);
  assert.equal(result.ok, false);
});

await test("5. un token expirado es rechazado aunque el cifrado sea valido", async () => {
  const payload = samplePayload({ exp: Date.now() - 1000 }); // vencido hace 1s
  const token = await encryptSession(payload, TEST_KEY);
  const result = await decryptSession(token, TEST_KEY);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /expir/);
});

await test("6. basura arbitraria como session_id nunca lanza, siempre {ok:false}", async () => {
  for (const junk of ["", "no-es-base64!!!", "QQ==", "a".repeat(500)]) {
    const result = await decryptSession(junk, TEST_KEY);
    assert.equal(result.ok, false, `debe rechazar limpiamente: ${JSON.stringify(junk)}`);
  }
});

console.log(`\n${passed} test(s) pasados.`);
if (process.exitCode) {
  console.error("\nHay tests fallidos.");
  process.exit(1);
}

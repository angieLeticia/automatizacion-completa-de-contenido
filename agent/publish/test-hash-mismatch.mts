// Fase 5.20 (Phase B1) — cierra el "NO DEMOSTRADO" de la auditoría
// post-piloto: el camino de mismatch de hash real nunca tenía test propio.
// Usa un archivo fixture TEMPORAL (os.tmpdir()), nunca D:\MATERIAL VIDEOS
// real - se crea y se borra dentro de este mismo test. Sin red, sin
// Supabase (verifyFileHash.mts es puro fs+crypto, sin ninguna dependencia
// de Supabase - por eso es justo lo que permite probar este camino de forma
// segura y determinista).
import assert from "node:assert/strict";
import { writeFileSync, rmSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { computeSha256, verifyFileHash } from "./verifyFileHash.mts";

let passed = 0;
function test(name: string, fn: () => Promise<void> | void) {
  return (async () => {
    try {
      await fn();
      passed++;
      console.log(`[PASS] ${name}`);
    } catch (err) {
      console.error(`[FALLO] ${name}`);
      console.error(err);
      process.exitCode = 1;
    }
  })();
}

async function main() {
  const dir = mkdtempSync(path.join(tmpdir(), "agent3-hash-mismatch-test-"));
  const filePath = path.join(dir, "fixture.mp4");

  try {
    // 1. Archivo esperado - contenido conocido, hash calculado del archivo real.
    writeFileSync(filePath, "contenido original del fixture de prueba");
    const expectedHash = await computeSha256(filePath);

    await test("1. Archivo esperado (sin modificar) -> el hash coincide -> ok:true", async () => {
      const result = await verifyFileHash(filePath, expectedHash);
      assert.deepEqual(result, { ok: true });
    });

    // 2. Archivo modificado DESPUÉS - mismo path, contenido distinto (simula
    // "el archivo fue reemplazado/corrompido entre que se detectó y se publicó").
    writeFileSync(filePath, "contenido MODIFICADO - ya no es el archivo original");

    await test("2. Archivo modificado -> el hash real ya NO coincide con el esperado", async () => {
      const result = await verifyFileHash(filePath, expectedHash);
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.notEqual(result.actualHash, expectedHash);
        assert.equal(result.actualHash.length, 64, "un SHA-256 real siempre son 64 caracteres hex");
      }
    });

    await test("3. El hash SÍ es determinista - recalcularlo dos veces sobre el mismo archivo modificado da el mismo resultado", async () => {
      const first = await computeSha256(filePath);
      const second = await computeSha256(filePath);
      assert.equal(first, second);
    });

    // 4. Documenta el contrato real que consume esto (agent/publish/resolveContentFile.mts):
    // un mismatch se traduce EXACTAMENTE en { ok:false, retryable:false, reason: "INCONSISTENCIA DE HASH..." }
    // - retryable:false es la pieza que impide cualquier reintento automático
    // de subir el archivo tal cual está; el publisher real (lib/social/*)
    // NUNCA llega a invocarse para este content_file mientras el mismatch
    // persista, porque processPost() (run.mts) hace `if (!fileOutcome.ok) { await finishWithFailure(...); return; }`
    // ANTES de resolver identidad/DRY_RUN/publisher - ver run.mts líneas ~40-44.
    await test("4. Contrato: un mismatch de hash SIEMPRE se clasifica retryable:false en resolveContentFile.mts (no se reintenta subir el archivo corrupto tal cual)", () => {
      // No se importa resolveContentFile.mts aquí a propósito (requiere
      // supabaseClient.mts real, con credenciales) - se verifica el
      // contrato leyendo su propio código fuente publicado, para no
      // depender de una fila real de content_files ni de Supabase en este
      // test puro.
      const source = readFileSync(new URL("./resolveContentFile.mts", import.meta.url), "utf-8");
      assert.match(source, /INCONSISTENCIA DE HASH/);
      assert.match(source, /retryable:\s*false,\s*\n\s*reason:\s*`INCONSISTENCIA DE HASH/);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  console.log(`\n${passed} test(s) pasados.`);
  if (process.exitCode) {
    console.error("\nHay tests fallidos.");
    process.exit(1);
  }
}

main();

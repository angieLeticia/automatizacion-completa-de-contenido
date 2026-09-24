// Fase 3.3 — tests puros de fileTarget.mts + parseLocation (processFile.mts).
// Sin Supabase, sin red. Los unicos accesos a disco son existsSync() contra
// rutas que garantizadamente NO existen (nunca se crea ni se modifica nada).
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { resolveWatchMode, checkContainment, isStable } from "./fileTarget.mts";
import { parseLocation } from "./processFile.mts";
import { MATERIAL_ROOT, OUTPUT_FOLDERS } from "./config.mts";

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

console.log("=== resolveWatchMode ===");

test("1. AGENT1_FILE_PATH ausente -> mode='global'", () => {
  assert.deepEqual(resolveWatchMode({} as NodeJS.ProcessEnv), { mode: "global" });
});

test("1b. AGENT1_FILE_PATH vacío/solo espacios -> mode='global', igual que ausente", () => {
  assert.deepEqual(resolveWatchMode({ AGENT1_FILE_PATH: "   " } as NodeJS.ProcessEnv), { mode: "global" });
});

test("2. AGENT1_FILE_PATH presente -> mode='directed', filePath resuelto (trim)", () => {
  const p = path.join(MATERIAL_ROOT, "ENCIENDE EL CAOS", "Clips", "video_prueba.mp4");
  const result = resolveWatchMode({ AGENT1_FILE_PATH: `  ${p}  ` } as NodeJS.ProcessEnv);
  assert.deepEqual(result, { mode: "directed", filePath: p });
});

console.log("\n=== checkContainment ===");

test("4. ruta fuera de MATERIAL_ROOT -> bloqueado", () => {
  const result = checkContainment("D:\\OTRA CARPETA\\video.mp4", MATERIAL_ROOT);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /fuera de MATERIAL_ROOT/);
});

test("4b. ruta relativa (no absoluta) -> bloqueado", () => {
  const result = checkContainment("ENCIENDE EL CAOS\\Clips\\video.mp4", MATERIAL_ROOT);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /absoluta/);
});

test("5. MATERIAL_ROOT mismo -> bloqueado", () => {
  const result = checkContainment(MATERIAL_ROOT, MATERIAL_ROOT);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /MATERIAL_ROOT mismo/);
});

test("ruta valida DENTRO de MATERIAL_ROOT -> ok:true", () => {
  const p = path.join(MATERIAL_ROOT, "ENCIENDE EL CAOS", "Clips", "video_prueba.mp4");
  assert.deepEqual(checkContainment(p, MATERIAL_ROOT), { ok: true });
});

console.log("\n=== parseLocation (reexportada de processFile.mts, sin cambios de logica) ===");

test("6. estructura invalida (mas de 3 segmentos) -> null (bloqueado)", () => {
  const p = path.join(MATERIAL_ROOT, "ENCIENDE EL CAOS", "Clips", "subcarpeta", "video.mp4");
  assert.equal(parseLocation(p), null);
});

test("6b. estructura invalida (carpeta de salida desconocida) -> null (bloqueado)", () => {
  const p = path.join(MATERIAL_ROOT, "ENCIENDE EL CAOS", "CarpetaNoReconocida", "video.mp4");
  assert.equal(parseLocation(p), null);
});

test("7. extension no permitida -> null (bloqueado)", () => {
  const p = path.join(MATERIAL_ROOT, "ENCIENDE EL CAOS", "Clips", "video.txt");
  assert.equal(parseLocation(p), null);
});

test("estructura y extension validas -> {folderName, folderType} correctos", () => {
  const p = path.join(MATERIAL_ROOT, "ENCIENDE EL CAOS", "Clips", "video_prueba.mp4");
  assert.deepEqual(parseLocation(p), { folderName: "ENCIENDE EL CAOS", folderType: "clip" });
});

test("folder_type 'completo' se resuelve correctamente (Videos YouTube Completos)", () => {
  const p = path.join(MATERIAL_ROOT, "ENCIENDE EL CAOS", OUTPUT_FOLDERS.completo, "video.mp4");
  assert.deepEqual(parseLocation(p), { folderName: "ENCIENDE EL CAOS", folderType: "completo" });
});

console.log("\n=== isStable (comparacion pura de snapshots, sin IO) ===");

test("E. dos lecturas identicas (size+mtime) -> estable", () => {
  assert.equal(isStable({ size: 14068460, mtimeMs: 1000 }, { size: 14068460, mtimeMs: 1000 }), true);
});

test("E2. size distinto -> inestable (archivo todavia copiandose)", () => {
  assert.equal(isStable({ size: 1000, mtimeMs: 1000 }, { size: 2000, mtimeMs: 1000 }), false);
});

test("E3. mtime distinto -> inestable", () => {
  assert.equal(isStable({ size: 1000, mtimeMs: 1000 }, { size: 1000, mtimeMs: 2000 }), false);
});

console.log("\n=== 3. ruta inexistente (existsSync real, read-only, ninguna ruta creada) ===");

test("3. archivo inexistente -> existsSync=false (bloqueado en la orquestacion de run.mts)", () => {
  const p = path.join(MATERIAL_ROOT, "ENCIENDE EL CAOS", "Clips", "archivo-que-nunca-existe-fase-3.3.mp4");
  assert.equal(existsSync(p), false);
});

console.log(
  "\n=== NOTA: casos 8/9/10 (cuenta no reconocida, hash duplicado, chokidar.watch() inalcanzable) ===\n" +
    "No son testeables como unidades puras sin mockear Supabase o instrumentar main() -\n" +
    "se verifican por LECTURA DE CODIGO (mismo criterio ya usado en Fase 1.7 para Agent 2):\n" +
    "  8. processFile() ya maneja 'cuenta no reconocida' sin cambios (linea 51-54) - el wrapper\n" +
    "     dirigido lo detecta post-hoc (ausencia de fila nueva tras processFile()), sin duplicar\n" +
    "     la resolucion de cuenta.\n" +
    "  9. registerFile() ya maneja duplicate/conflict sin cambios (UNIQUE de file_hash) -\n" +
    "     el modo dirigido reutiliza processFile()/registerFile() sin tocarlos.\n" +
    " 10. en agent/run.mts, la rama 'if (mode.mode === \"directed\") { ...; return; }' esta\n" +
    "     posicionada textualmente ANTES de 'chokidar.watch(...)' - inalcanzable en ese modo."
);

console.log(`\n${passed} test(s) pasados.`);
if (process.exitCode) {
  console.error("\nHay tests fallidos.");
  process.exit(1);
}

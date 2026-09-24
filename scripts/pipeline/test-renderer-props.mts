// FASE 6.5 (PASO 7) — pruebas del soporte de `--props` en renderer.mts.
// Dos capas, ambas reales (nunca mocks de child_process):
//   (1) unitarias de renderProps.mts en aislamiento (rápidas, sin subproceso)
//   (2) invocaciones REALES de renderer.mts::renderComposition() contra un
//       compositionId deliberadamente inválido — falla rápido (Remotion
//       rechaza el id antes de decodificar ningún frame) pero SÍ ejercita el
//       proceso hijo real (`npx remotion render`) end-to-end, incluida la
//       escritura del archivo temporal de props y su limpieza en el finally
//       — exactamente el mismo tipo de bug de limpieza real que apareció en
//       Fase 6 (try/finally faltante), ahora cubierto con un caso de error
//       real y determinista.
import "./env.mts";
import { readdirSync, existsSync, mkdtempSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { renderComposition } from "./renderer.mts";
import { writePropsTempFile, assertPropsHaveNoObviousSecrets, PropsSecretDetectedError } from "./renderProps.mts";

let failures = 0;
const check = (label: string, cond: boolean, extra = "") => {
  const mark = cond ? "PASS" : "FAIL";
  if (!cond) failures++;
  console.log(`[${mark}] ${label}${extra ? " — " + extra : ""}`);
};

const listPropsTempDirs = (): string[] => readdirSync(tmpdir()).filter((n) => n.startsWith("remotion-props-"));

// ============================================================
// (1) renderProps.mts en aislamiento — sin subproceso
// ============================================================
function testRenderPropsModule() {
  console.log("=== (1) renderProps.mts — pruebas unitarias ===");

  // --- assertPropsHaveNoObviousSecrets: objeto limpio no lanza ---
  let cleanThrew = false;
  try {
    assertPropsHaveNoObviousSecrets({ episodeId: "x", value: 123, nested: { foo: "bar", hook: { text: "titular" } } });
  } catch {
    cleanThrew = true;
  }
  check("assertPropsHaveNoObviousSecrets — objeto sin campos sospechosos NO lanza", !cleanThrew);

  // --- detecta campos sospechosos por nombre, a distintas profundidades ---
  const suspiciousCases: Array<[string, unknown]> = [
    ["token en la raíz", { token: "x" }],
    ["apiKey camelCase", { apiKey: "x" }],
    ["api_key snake_case", { api_key: "x" }],
    ["password", { password: "x" }],
    ["passwd abreviado", { passwd: "x" }],
    ["authorization header", { headers: { authorization: "Bearer x" } }],
    ["cookie anidado", { session: { cookie: "x" } }],
    ["refreshToken anidado dos niveles", { a: { b: { refreshToken: "x" } } }],
    ["clientSecret", { clientSecret: "x" }],
  ];
  for (const [label, obj] of suspiciousCases) {
    let threw = false;
    let isRightError = false;
    try {
      assertPropsHaveNoObviousSecrets(obj);
    } catch (err) {
      threw = true;
      isRightError = err instanceof PropsSecretDetectedError;
    }
    check(`assertPropsHaveNoObviousSecrets — detecta y rechaza "${label}"`, threw && isRightError);
  }

  // --- writePropsTempFile: escribe JSON válido, path fuera del repo/material, cleanup real ---
  const before = listPropsTempDirs();
  const sample = { testMarker: "CHAOS_PROPS_TEST", episodeId: "fase65Synthetic", value: 123 };
  const { propsFilePath, cleanup } = writePropsTempFile(sample);
  check("writePropsTempFile — el archivo temporal existe de verdad", existsSync(propsFilePath));
  check("writePropsTempFile — la ruta vive bajo os.tmpdir(), no en el repo", propsFilePath.startsWith(tmpdir()));
  check('writePropsTempFile — la ruta NO contiene "MATERIAL VIDEOS"', !/MATERIAL VIDEOS/i.test(propsFilePath));
  const written = JSON.parse(readFileSync(propsFilePath, "utf-8"));
  check("writePropsTempFile — el contenido es EXACTAMENTE el objeto serializado (JSON válido)", JSON.stringify(written) === JSON.stringify(sample));
  const afterWrite = listPropsTempDirs();
  check("writePropsTempFile — crea exactamente UN directorio nuevo bajo el prefijo remotion-props-", afterWrite.length === before.length + 1);
  cleanup();
  const afterCleanup = listPropsTempDirs();
  check("writePropsTempFile.cleanup() — elimina el directorio, no quedan residuos", afterCleanup.length === before.length);

  // --- writePropsTempFile con secretos: rechaza ANTES de tocar disco ---
  const beforeSecret = listPropsTempDirs();
  let secretThrew = false;
  try {
    writePropsTempFile({ episodeId: "x", elevenLabsApiKey: "sk-real-no-deberia-escribirse" });
  } catch (err) {
    secretThrew = err instanceof PropsSecretDetectedError;
  }
  check("writePropsTempFile — con un campo sospechoso, lanza y NO escribe nada a disco", secretThrew && listPropsTempDirs().length === beforeSecret.length);
}

// ============================================================
// (2) Caso A (sin props) — verificación ESTRUCTURAL contra el código fuente
// real de renderer.mts, no una segunda invocación real de Remotion. Motivo
// (hallazgo real de esta fase, ver informe final §14): un `npx remotion
// render` completo (bundling desde cero) tarda varios minutos en esta
// máquina, y encima Node/Windows deja procesos huérfanos cuando
// execFileSync corta por timeout (child_process.timeout documentado: "will
// only kill the immediate child process... possibly leaving orphaned
// processes" — confirmado en vivo durante el desarrollo de esta prueba).
// Repetir un render real completo SOLO para confirmar "no se agregó
// --props" es caro y frágil; el código es trivial de verificar por texto
// (una sola rama `if (propsFile)` controla el único push del argumento) y
// la prueba de que Remotion SÍ recibe el archivo cuando se pasa está cubierta,
// con un render real y exitoso, por test-chaos-news-props-e2e.mts (PASO 8/9).
// ============================================================
function testNoPropsPathIsStructurallyUntouched() {
  console.log("\n=== (2) renderer.mts — Caso A (sin props), verificación de código fuente ===");
  const src = readFileSync(new URL("./renderer.mts", import.meta.url), "utf-8");
  check(
    'renderer.mts — "--props=" solo se agrega dentro de "if (propsFile)" (nunca incondicional)',
    /if \(propsFile\) argsRaw\.push\(`--props=\$\{propsFile\.propsFilePath\}`\);/.test(src)
  );
  check(
    "renderer.mts — writePropsTempFile() solo se invoca cuando opts?.props !== undefined (nunca por defecto)",
    /opts\?\.props !== undefined \? writePropsTempFile\(opts\.props\) : null/.test(src)
  );
  check("renderer.mts — el cleanup del archivo temporal corre en un finally real (siempre, con o sin error)", /finally \{\s*propsFile\?\.cleanup\(\);/.test(src));
}

// ============================================================
// (3) Caso B (con props) — UNA sola invocación REAL de renderer.mts contra
// un compositionId inválido, con timeout corto (Remotion falla en cuanto
// termina de bundlear y no encuentra el id — no necesita renderizar ningún
// frame). Prueba el caso crítico: que el archivo temporal de props se limpia
// incluso cuando el proceso hijo real termina en error (el bug de limpieza
// de Fase 6 fue justo un try/finally faltante — este es el mismo tipo de
// caso, ahora cubierto).
// ============================================================
function testCleanupOnRealError() {
  console.log("\n=== (3) renderer.mts — Caso B (con props), error real + limpieza ===");
  const testRoot = mkdtempSync(path.join(tmpdir(), "fase65-renderer-out-"));
  // Directorio de "public" PROPIO y VACÍO, mismo patrón exacto que
  // buildSandboxRoot() (Fase 6) — nunca reutilizar el propio directorio de
  // salida como base de publicAssetsRoot: `path.dirname(outRoot)` terminaría
  // apuntando al TEMP raíz del SO (contiene TODO lo demás en tmpdir(), no
  // solo esta prueba), y Remotion intentaría copiar esa carpeta entera como
  // "public dir" — hallazgo real de esta fase (primera corrida copió cientos
  // de MB innecesarios antes de que el timeout cortara el intento).
  const publicAssetsRoot = path.join(testRoot, "public", "assets");
  const outputRoot = path.join(testRoot, "out");
  mkdirSync(publicAssetsRoot, { recursive: true });
  mkdirSync(outputRoot, { recursive: true });
  const INVALID_COMPOSITION_ID = "Fase65NoExisteComposicionDePrueba";
  try {
    const syntheticProps = { testMarker: "CHAOS_PROPS_TEST", episodeId: "fase65Synthetic", value: 123 };
    const before = listPropsTempDirs();
    let threw = false;
    try {
      renderComposition(INVALID_COMPOSITION_ID, "fase65-b.mp4", {
        timeoutMs: 30_000, // corto a propósito — ver nota de cabecera sobre huérfanos en Windows
        context: { episodesFile: "", dataRoot: "", publicAssetsRoot, outputRoot },
        props: syntheticProps,
      });
    } catch {
      threw = true;
    }
    check("Caso B (con props) — el compositionId inválido produce un error REAL (Remotion lo rechaza, o el timeout corto corta el intento — cualquiera de los dos es un error genuino, no fabricado)", threw);
    check(
      "Caso B (con props) — tras el error REAL, el archivo temporal de props se limpió (finally se ejecutó incluso con excepción)",
      listPropsTempDirs().length === before.length
    );
    check("Caso B (con props) — no se produjo ningún archivo de salida", !existsSync(path.join(outputRoot, "fase65-b.mp4")));
  } finally {
    rmSync(testRoot, { recursive: true, force: true });
  }
}

// ============================================================
// (4) Caso C — props con un campo sospechoso: rechazado ANTES de intentar
// ningún subproceso (rápido, determinista, sin depender de Remotion).
// ============================================================
function testSecretPropsRejectedBeforeSubprocess() {
  console.log("\n=== (4) renderer.mts — Caso C (props con credencial) ===");
  const scratchOut = mkdtempSync(path.join(tmpdir(), "fase65-renderer-out-"));
  try {
    const before = listPropsTempDirs();
    let threwRight = false;
    try {
      renderComposition("Fase65NoExisteComposicionDePrueba", "fase65-c.mp4", {
        context: { episodesFile: "", dataRoot: "", publicAssetsRoot: scratchOut, outputRoot: scratchOut },
        props: { episodeId: "x", refreshToken: "no-deberia-nunca-llegar-a-un-archivo" },
      });
    } catch (err) {
      threwRight = err instanceof PropsSecretDetectedError;
    }
    check("Caso C (props con credencial) — se rechaza con PropsSecretDetectedError, ANTES de invocar Remotion", threwRight);
    check("Caso C (props con credencial) — no queda ningún directorio remotion-props-* (nunca se escribió)", listPropsTempDirs().length === before.length);
  } finally {
    rmSync(scratchOut, { recursive: true, force: true });
  }
}

testRenderPropsModule();
testNoPropsPathIsStructurallyUntouched();
testCleanupOnRealError();
testSecretPropsRejectedBeforeSubprocess();

console.log(`\n${failures === 0 ? "TODOS LOS CASOS PASARON" : `${failures} CASO(S) FALLARON`}`);
process.exit(failures === 0 ? 0 : 1);

// Pruebas reales del MachineBridge — mismo patrón ad-hoc que
// agent/ingestion/test-manifest-validation.mts: archivos/temp reales,
// asserts explícitos, sin mocks. Cubre filesystem + health (Fase 4.4) y
// media + render (Fase 4.5). localAI sigue sin implementación — no se
// fabrican pruebas de algo que no existe.
import { mkdtempSync, mkdirSync, rmSync, existsSync, writeFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import { filesystemBridge, healthBridge, PathViolationError } from "./machineBridge.mts";
import { mediaBridge } from "./mediaBridge.mts";
import { renderBridge, UnknownCompositionError } from "./renderBridge.mts";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
// Dentro de public/assets/ (una de las raíces permitidas de MediaBridge, ver
// mediaBridge.mts::ALLOWED_MEDIA_ROOTS) para poder probar rutas "permitidas"
// reales sin depender de que exista D:\MATERIAL VIDEOS en esta máquina.
const MEDIA_TEST_DIR = path.join(REPO_ROOT, "public", "assets", "__machinebridge-test__");

let failures = 0;
const check = (label: string, cond: boolean, extra = "") => {
  const mark = cond ? "PASS" : "FAIL";
  if (!cond) failures++;
  console.log(`[${mark}] ${label}${extra ? " — " + extra : ""}`);
};

async function main() {
  const root = mkdtempSync(path.join(tmpdir(), "machinebridge-test-"));

  // ---- Operación permitida ----
  await filesystemBridge.writeFile(root, "sub/archivo.txt", "contenido real");
  const exists = await filesystemBridge.exists(root, "sub/archivo.txt");
  check("Operación permitida — writeFile+exists dentro de la raíz", exists);

  const read = await filesystemBridge.readFile(root, "sub/archivo.txt");
  check("Ruta permitida — readFile devuelve el contenido real", read.toString() === "contenido real");

  const hash = await filesystemBridge.hashFile(root, "sub/archivo.txt");
  check("Ruta permitida — hashFile calcula un SHA-256 real", /^[a-f0-9]{64}$/.test(hash));

  // ---- Operación no permitida: path traversal ----
  let traversalRejected = false;
  try {
    await filesystemBridge.readFile(root, "../../fuera-de-la-raiz.txt");
  } catch (err) {
    traversalRejected = err instanceof PathViolationError;
  }
  check("Path traversal (../) — rechazado", traversalRejected);

  // ---- Ruta absoluta ----
  let absoluteRejected = false;
  try {
    await filesystemBridge.readFile(root, path.join(root, "sub/archivo.txt")); // absoluta, aunque "correcta"
  } catch (err) {
    absoluteRejected = err instanceof PathViolationError;
  }
  check("Ruta absoluta — rechazada (debe ser siempre relativa)", absoluteRejected);

  // ---- exists() no lanza para rutas fuera de la raíz, solo responde false ----
  const outsideExists = await filesystemBridge.exists(root, "..\\evil.txt");
  check("exists() con traversal responde false, no lanza", outsideExists === false);

  // ---- Idempotencia mínima (filesystem): escribir dos veces el mismo contenido no falla ----
  await filesystemBridge.writeFile(root, "sub/archivo.txt", "contenido real");
  const stillExists = await filesystemBridge.exists(root, "sub/archivo.txt");
  check("Escritura repetida del mismo contenido — sin error (idempotente a nivel de archivo)", stillExists);

  // ---- Proceso inexistente ----
  // @ts-expect-error — "herramienta-que-no-existe" no es un valor válido del union
  // type; se fuerza a propósito para probar la rama "no encontrado" sin inventar
  // un tercer binario real.
  const fakeToolAvailable = await healthBridge.checkToolAvailable("herramienta-que-no-existe-xyz");
  check("Proceso inexistente — checkToolAvailable devuelve false", fakeToolAvailable === false);

  // ---- Proceso existente (real, instalado en esta máquina — verificado antes de escribir este test) ----
  const ffmpegOk = await healthBridge.checkToolAvailable("ffmpeg");
  const ffprobeOk = await healthBridge.checkToolAvailable("ffprobe");
  const whisperOk = await healthBridge.checkToolAvailable("whisper");
  check("Proceso exitoso — ffmpeg detectado en PATH", ffmpegOk);
  check("Proceso exitoso — ffprobe detectado en PATH", ffprobeOk);
  check("Proceso exitoso — whisper detectado en PATH", whisperOk);

  // ---- Timeout / no reachable: puerto localhost que casi seguro no tiene
  // Ollama escuchando — debe resolver a false en <=3s, nunca colgarse. ----
  const startedAt = Date.now();
  const ollamaReachable = await healthBridge.checkOllamaReachable("http://localhost:1");
  const elapsedMs = Date.now() - startedAt;
  check("Timeout — checkOllamaReachable no cuelga (resolvió en <4s)", elapsedMs < 4000, `${elapsedMs}ms`);
  check("Timeout — puerto sin servicio responde false, no lanza", ollamaReachable === false);

  // ---- Seguridad: checkOllamaReachable rechaza un host que no sea localhost ----
  let nonLocalRejected = false;
  try {
    await healthBridge.checkOllamaReachable("http://example.com:11434");
  } catch {
    nonLocalRejected = true;
  }
  check("Seguridad — checkOllamaReachable rechaza host no-localhost", nonLocalRejected);

  console.log("NOTA: credenciales no expuestas — filesystem/health no leen ninguna variable de entorno ni secreto (verificado por inspección, cero process.env en machineBridge.mts).");

  // ==========================================================================
  // MediaBridge (Fase 4.5) — fixtures reales generados con el ffmpeg ya
  // instalado (lavfi: fuentes sintéticas reales, no archivos fabricados a
  // mano ni mocks) dentro de public/assets/__machinebridge-test__/, una raíz
  // realmente permitida por mediaBridge.mts.
  // ==========================================================================
  mkdirSync(MEDIA_TEST_DIR, { recursive: true });
  const silentWav = path.join(MEDIA_TEST_DIR, "silence-1s.wav");
  const chunkA = path.join(MEDIA_TEST_DIR, "chunk-a.wav");
  const chunkB = path.join(MEDIA_TEST_DIR, "chunk-b.wav");
  const concatOut = path.join(MEDIA_TEST_DIR, "concat-out.wav");
  const silentVideo = path.join(MEDIA_TEST_DIR, "silence-1s.mp4");
  spawnSync("ffmpeg", ["-y", "-f", "lavfi", "-i", "anullsrc=r=16000:cl=mono", "-t", "1", silentWav]);
  spawnSync("ffmpeg", ["-y", "-f", "lavfi", "-i", "anullsrc=r=16000:cl=mono", "-t", "1", chunkA]);
  spawnSync("ffmpeg", ["-y", "-f", "lavfi", "-i", "anullsrc=r=16000:cl=mono", "-t", "2", chunkB]);
  const videoGen = spawnSync("ffmpeg", [
    "-y", "-f", "lavfi", "-i", "color=c=black:s=64x64:d=1",
    "-f", "lavfi", "-i", "anullsrc=r=16000:cl=mono", "-t", "1",
    "-c:v", "libx264", "-c:a", "aac", "-shortest", silentVideo,
  ]);
  const haveSilentWav = existsSync(silentWav) && statSync(silentWav).size > 0;
  const haveSilentVideo = videoGen.status === 0 && existsSync(silentVideo) && statSync(silentVideo).size > 0;
  check("Fixture — ffmpeg (lavfi) generó un WAV de silencio real", haveSilentWav);

  if (haveSilentWav) {
    const info = await mediaBridge.probe(silentWav);
    check(
      "MediaBridge.probe — archivo válido devuelve MediaInfo real (ffprobe)",
      info.durationSeconds > 0 && info.durationSeconds < 3,
      `duración=${info.durationSeconds}s`
    );

    let probeMissingFailed = false;
    try {
      await mediaBridge.probe(path.join(MEDIA_TEST_DIR, "no-existe.wav"));
    } catch {
      probeMissingFailed = true;
    }
    check("MediaBridge.probe — archivo inexistente lanza error (ffprobe_failed)", probeMissingFailed);

    let probeOutsideRejected = false;
    try {
      await mediaBridge.probe(path.join(tmpdir(), "fuera-de-toda-raiz.wav"));
    } catch (err) {
      probeOutsideRejected = err instanceof PathViolationError;
    }
    check("MediaBridge.probe — ruta fuera de toda raíz permitida (PathViolationError)", probeOutsideRejected);

    let probeTraversalRejected = false;
    try {
      await mediaBridge.probe(path.join(MEDIA_TEST_DIR, "..", "..", "..", "..", "evil.wav"));
    } catch (err) {
      probeTraversalRejected = err instanceof PathViolationError;
    }
    check("MediaBridge.probe — path traversal (../) fuera de toda raíz (PathViolationError)", probeTraversalRejected);

    const silences = await mediaBridge.detectSilences(silentWav);
    check(
      "MediaBridge.detectSilences — 1s de silencio real produce al menos un intervalo",
      silences.length >= 1,
      JSON.stringify(silences)
    );

    await mediaBridge.concatAudio([chunkA, chunkB], concatOut);
    const concatInfo = await mediaBridge.probe(concatOut);
    check(
      "MediaBridge.concatAudio — concatena 2 chunks reales (1s+2s ≈ 3s)",
      concatInfo.durationSeconds > 2.5 && concatInfo.durationSeconds < 3.5,
      `duración resultante=${concatInfo.durationSeconds}s`
    );

    let concatOutsideRejected = false;
    try {
      await mediaBridge.concatAudio([chunkA], path.join(tmpdir(), "salida-fuera-de-raiz.wav"));
    } catch (err) {
      concatOutsideRejected = err instanceof PathViolationError;
    }
    check("MediaBridge.concatAudio — output path fuera de toda raíz (PathViolationError)", concatOutsideRejected);

    console.log("  transcribiendo silencio real con whisper (modelo ya cacheado en esta máquina, puede tardar por la carga del modelo)...");
    const segmentsWithTimestamps = await mediaBridge.transcribe(silentWav, true);
    check(
      "MediaBridge.transcribe(withTimestamps=true) — whisper real corre y devuelve un arreglo de segmentos",
      Array.isArray(segmentsWithTimestamps)
    );
    const segmentsCollapsed = await mediaBridge.transcribe(silentWav, false);
    check(
      "MediaBridge.transcribe(withTimestamps=false) — devuelve un solo segmento con start=0 y end≈duración",
      segmentsCollapsed.length === 1 && segmentsCollapsed[0].start === 0 && segmentsCollapsed[0].end > 0
    );
  } else {
    console.log("NOTA: no se pudo generar el WAV de prueba con ffmpeg (lavfi) — se omiten probe/detectSilences/concatAudio/transcribe. No se fabrica una prueba de algo que no se pudo generar realmente.");
  }

  if (haveSilentVideo) {
    const extractOutDir = mkdtempSync(path.join(tmpdir(), "mediabridge-extract-"));
    const wavPath = await mediaBridge.extractAudioToWav(silentVideo, extractOutDir);
    check("MediaBridge.extractAudioToWav — extrae audio real de un video real (ffmpeg)", existsSync(wavPath) && statSync(wavPath).size > 0);
    rmSync(extractOutDir, { recursive: true, force: true });

    let extractInvalidFailed = false;
    try {
      await mediaBridge.extractAudioToWav(path.join(MEDIA_TEST_DIR, "no-existe.mp4"), mkdtempSync(path.join(tmpdir(), "mediabridge-extract-invalid-")));
    } catch {
      extractInvalidFailed = true;
    }
    check("MediaBridge.extractAudioToWav — video inexistente lanza error (ffmpeg_failed)", extractInvalidFailed);
  } else {
    console.log("NOTA: no se pudo generar el video de prueba con ffmpeg/libx264 en esta máquina — se omite extractAudioToWav. No se fabrica una prueba de algo que no se pudo generar realmente.");
  }

  console.log(
    "NOTA: 'tool inexistente' para media no se fuerza desapareciendo ffmpeg/ffprobe/whisper reales de esta " +
      "máquina (son binarios de producción, no se desinstalan para una prueba) — ese comportamiento (ENOENT / " +
      "*_missing) ya está probado en la capa de detección vía healthBridge.checkToolAvailable (arriba, con una " +
      "herramienta inexistente real) y las funciones envueltas de agent/analyze/* ya traducen ENOENT a un código " +
      "de error propio (ver ffmpeg_missing/whisper_not_installed), sin cambios de MediaBridge."
  );
  rmSync(MEDIA_TEST_DIR, { recursive: true, force: true });

  // ==========================================================================
  // RenderBridge (Fase 4.5) — validación real contra remotion/lib/episodes.ts
  // (los episodios reales ya registrados, sin lista inventada aparte) y
  // seguridad de outputPath. El render real (`npx remotion render`) SÍ se
  // intenta contra un episodio real — en esta máquina no hay material
  // binario real bajo public/assets/ todavía (ver docs/machine-access.md),
  // así que ese intento real falla por assets faltantes: eso mismo prueba,
  // honestamente, la rama "render fallido" sin fabricar un fallo artificial.
  // ==========================================================================
  const outDirForTests = path.join(REPO_ROOT, "out");
  mkdirSync(outDirForTests, { recursive: true });

  let unknownPatternRejected = false;
  try {
    await renderBridge.renderComposition("Intro", "machinebridge-test-intro.mp4");
  } catch (err) {
    unknownPatternRejected = err instanceof UnknownCompositionError;
  }
  check("RenderBridge.renderComposition — compositionId que no sigue MainDocumentary-/Short-N (rechazado)", unknownPatternRejected);

  let unknownEpisodeRejected = false;
  try {
    await renderBridge.renderComposition("MainDocumentary-no-existe-999", "machinebridge-test-x.mp4");
  } catch (err) {
    unknownEpisodeRejected = err instanceof UnknownCompositionError;
  }
  check("RenderBridge.renderComposition — episodio inexistente en episodes.ts (rechazado)", unknownEpisodeRejected);

  let unsafeOutputRejected = false;
  try {
    await renderBridge.renderComposition("MainDocumentary-011", "../../fuera-del-root-de-salida.mp4");
  } catch (err) {
    unsafeOutputRejected = err instanceof PathViolationError;
  }
  check("RenderBridge.renderComposition — output path fuera de out/ (PathViolationError)", unsafeOutputRejected);

  // reuseIfExists: se fabrica un archivo real (no vacío) directamente en el
  // output esperado y se pide render con reuseIfExists — debe detectarlo y
  // NUNCA invocar `npx remotion render` (si lo invocara, tardaría minutos).
  const reuseRelPath = "machinebridge-test-reuse.mp4";
  const reuseAbsPath = path.join(outDirForTests, reuseRelPath);
  writeFileSync(reuseAbsPath, "contenido-de-render-preexistente-real");
  const reuseStart = Date.now();
  const reuseResult = await renderBridge.renderComposition("MainDocumentary-011", reuseRelPath, { reuseIfExists: true });
  const reuseElapsedMs = Date.now() - reuseStart;
  check(
    "RenderBridge.renderComposition — reuseIfExists detecta un render existente y NO vuelve a renderizar",
    reuseResult.reused === true && /^[a-f0-9]{64}$/.test(reuseResult.hash) && reuseElapsedMs < 2000,
    `${reuseElapsedMs}ms, hash=${reuseResult.hash.slice(0, 12)}…`
  );
  rmSync(reuseAbsPath, { force: true });

  // timeout: timeoutMs deliberadamente imposible de cumplir (1ms) contra un
  // compositionId válido (un Short, no un documental completo, para acotar
  // el peor caso si el kill no fuera instantáneo) — debe matar el proceso
  // `npx` y devolver el control rápido, nunca colgarse.
  const timeoutStart = Date.now();
  let timeoutThrew = false;
  try {
    await renderBridge.renderComposition("Short-011-0", "machinebridge-test-timeout.mp4", { timeoutMs: 1 });
  } catch {
    timeoutThrew = true;
  }
  const timeoutElapsedMs = Date.now() - timeoutStart;
  check(
    "RenderBridge.renderComposition — timeoutMs=1 corta el proceso rápido, no cuelga",
    timeoutThrew && timeoutElapsedMs < 15_000,
    `${timeoutElapsedMs}ms`
  );
  rmSync(path.join(outDirForTests, "machinebridge-test-timeout.mp4"), { force: true });

  // "render fallido" real: composición real (Short, pocos frames — acota el
  // peor caso) pero sin los assets binarios reales en esta máquina (ver nota
  // arriba) — el `npx remotion render` real debe fallar de verdad, o como
  // mucho, cortar por el timeout acotado de abajo (nunca colgarse minutos).
  console.log("  intentando un render real contra un clip real (se espera que falle por falta de material binario en esta máquina, o corte por timeout — ver NOTA)...");
  let realRenderFailed = false;
  let realRenderError = "";
  try {
    await renderBridge.renderComposition("Short-011-0", "machinebridge-test-real-attempt.mp4", { timeoutMs: 60_000 });
  } catch (err) {
    realRenderFailed = true;
    realRenderError = err instanceof Error ? err.message.slice(0, 200) : String(err);
  }
  check("RenderBridge.renderComposition — render real intentado contra clip real (falla o corta por timeout, no se fabrica)", realRenderFailed, realRenderError);
  rmSync(path.join(outDirForTests, "machinebridge-test-real-attempt.mp4"), { force: true });
  console.log(
    "NOTA: 'render exitoso' de punta a punta no se pudo demostrar en ESTA máquina porque no existen los " +
      "assets binarios reales bajo public/assets/ para ningún episodio registrado (confirmado: la carpeta " +
      "public/assets/ ni siquiera existe en este worktree — el material real vive en la máquina de producción, " +
      "no se fabrica ni se copia contenido falso para forzar un PASS). El intento real de arriba SÍ prueba la " +
      "ruta de fallo/timeout genuina de la misma invocación de `npx remotion render` que usaría un render exitoso; " +
      "la validación de compositionId/outputPath (que es la parte que MachineBridge.render agrega) ya está probada " +
      "arriba de forma independiente del render en sí."
  );

  console.log(`\n${failures === 0 ? "TODOS LOS CASOS PASARON" : `${failures} CASO(S) FALLARON`}`);
  rmSync(root, { recursive: true, force: true });
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Fallo fatal en tests de MachineBridge:", err);
  process.exit(1);
});

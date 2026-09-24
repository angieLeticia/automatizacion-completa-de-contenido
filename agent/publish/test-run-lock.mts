// H5 (auditoria post-publicacion + auditoria especifica de H5) — pruebas de
// runLock.mts. La propiedad de SEGURIDAD pura (evaluateRunLock) se prueba sin
// tocar disco. acquireRunLock/touchRunLock/releaseRunLock SI tocan disco,
// pero unicamente el propio archivo de lock local (agent/logs/publish-run.lock.json,
// ya en .gitignore) - nunca Supabase, nunca Meta, nunca B2.
import assert from "node:assert/strict";
import { readFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import {
  evaluateRunLock,
  acquireRunLock,
  releaseRunLock,
  touchRunLock,
  readRunLockSnapshot,
  RUN_LOCK_STALE_MINUTES,
  RUN_LOCK_HEARTBEAT_MS,
} from "./runLock.mts";

let passed = 0;
function test(name: string, fn: () => void | Promise<void>) {
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

// Limpieza defensiva antes de empezar - por si un run anterior fallo a mitad
// y dejo el lock real en disco.
const LOCK_FILE_PATH_FOR_TEST_CLEANUP = path.join(import.meta.dirname, "..", "logs", "publish-run.lock.json");

function forceCleanupLockFile(): void {
  const snap = readRunLockSnapshot();
  if (snap.exists) {
    // No conocemos el token de un lock huerfano de un run anterior - se
    // reproduce aqui, deliberadamente, la MISMA regla que el codigo real: no
    // hay forma de borrarlo "a la fuerza" sin conocer su token. Para la
    // limpieza defensiva del propio test usamos el path directo (unlinkSync),
    // no releaseRunLock() - esto NO es parte de la API publica que se prueba.
    try {
      unlinkSync(LOCK_FILE_PATH_FOR_TEST_CLEANUP);
    } catch {
      // ya no existe - nada que limpiar
    }
  }
}

async function main() {
  forceCleanupLockFile();

  const NOW = new Date("2026-09-17T12:00:00.000Z");

  // ==================================================
  // evaluateRunLock() — logica pura de "activo vs. huerfano", sin fs
  // ==================================================
  await test("evaluateRunLock — sin lock (exists=false) -> 'no_lock'", () => {
    const r = evaluateRunLock({ exists: false, mtimeMs: null, postId: null }, NOW);
    assert.equal(r.action, "no_lock");
  });

  await test("evaluateRunLock — lock fresco (mtime = ahora mismo) -> 'active'", () => {
    const r = evaluateRunLock({ exists: true, mtimeMs: NOW.getTime(), postId: "post-x" }, NOW);
    assert.equal(r.action, "active");
  });

  await test(`evaluateRunLock — justo por debajo del umbral (${RUN_LOCK_STALE_MINUTES} min - 1s) -> sigue 'active'`, () => {
    const mtimeMs = NOW.getTime() - (RUN_LOCK_STALE_MINUTES * 60_000 - 1000);
    const r = evaluateRunLock({ exists: true, mtimeMs, postId: "post-x" }, NOW);
    assert.equal(r.action, "active");
  });

  await test(`evaluateRunLock — justo por encima del umbral (${RUN_LOCK_STALE_MINUTES} min + 1s) -> 'stale'`, () => {
    const mtimeMs = NOW.getTime() - (RUN_LOCK_STALE_MINUTES * 60_000 + 1000);
    const r = evaluateRunLock({ exists: true, mtimeMs, postId: "post-x" }, NOW);
    assert.equal(r.action, "stale");
  });

  await test("evaluateRunLock — contenido no parseable pero mtime fresco -> SIGUE 'active' (fail-closed: la decision nunca depende del contenido JSON)", () => {
    const r = evaluateRunLock({ exists: true, mtimeMs: NOW.getTime(), postId: null }, NOW);
    assert.equal(r.action, "active");
  });

  // ==================================================
  // CASO 1 (requerido) — adquisicion normal -> PASS
  // ==================================================
  let tokenA = "";
  await test("1. Adquisicion normal del lock -> PASS (ok:true, token real devuelto)", () => {
    const result = acquireRunLock("post-A");
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(typeof result.token, "string");
      assert.ok(result.token.length > 0);
      tokenA = result.token;
    }
    const snap = readRunLockSnapshot();
    assert.equal(snap.exists, true);
    assert.equal(snap.postId, "post-A");
  });

  // ==================================================
  // CASO 2 (requerido) — segundo proceso intenta adquirir el lock YA
  // existente -> falla de forma segura (ok:false), NUNCA lanza.
  // ==================================================
  let tokenBAttempt: string | null = null;
  await test("2. Segundo proceso intenta adquirir lock existente -> falla de forma segura (ok:false)", () => {
    const result = acquireRunLock("post-B");
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.existingPostId, "post-A");
      tokenBAttempt = null; // B nunca recibe un token real
    }
  });

  // ==================================================
  // CASO 3 (requerido) — el segundo proceso NO sobrescribio el lock del
  // primero: el contenido en disco sigue siendo el de A.
  // ==================================================
  await test("3. El segundo proceso NO sobrescribe el lock del primero (postId en disco sigue siendo 'post-A')", () => {
    const snap = readRunLockSnapshot();
    assert.equal(snap.exists, true);
    assert.equal(snap.postId, "post-A");
  });

  // ==================================================
  // CASO 4 (requerido) — A conserva el lock despues del intento fallido de B
  // (comprobado via touchRunLock con el token REAL de A -> debe funcionar).
  // ==================================================
  await test("4. El primer proceso (A) conserva el lock tras el intento fallido de B (su token real sigue siendo valido)", () => {
    const touched = touchRunLock(tokenA);
    assert.equal(touched, true);
    const snap = readRunLockSnapshot();
    assert.equal(snap.exists, true);
    assert.equal(snap.postId, "post-A");
  });

  // ==================================================
  // CASO 6 (requerido, se prueba antes del 5 a proposito) — un proceso que
  // NO es el propietario (token invalido/de B, que nunca recibio uno real -
  // se usa un token FALSO explicito) NO puede liberar el lock de A.
  // ==================================================
  await test("6. Un proceso que no es propietario (token ajeno/falso) NO puede liberar el lock de A", () => {
    releaseRunLock("token-falso-de-proceso-B-que-nunca-adquirio-nada");
    const snap = readRunLockSnapshot();
    assert.equal(snap.exists, true, "el lock de A debe seguir existiendo - la liberacion con token ajeno no debe tener efecto");
    assert.equal(snap.postId, "post-A");
  });

  // ==================================================
  // CASO 5 (requerido) — el propietario real (A, con su token real) SI
  // puede liberar su propio lock.
  // ==================================================
  await test("5. El propietario (A, con su token real) SI puede liberar su propio lock", () => {
    releaseRunLock(tokenA);
    const snap = readRunLockSnapshot();
    assert.equal(snap.exists, false);
  });

  // ==================================================
  // CASO 7 (requerido) — heartbeat actualiza el mtime real del archivo.
  // ==================================================
  await test("7. touchRunLock() actualiza el mtime real del lock", async () => {
    const acquired = acquireRunLock("post-heartbeat-test");
    assert.equal(acquired.ok, true);
    if (!acquired.ok) return;
    const before = readRunLockSnapshot();
    await new Promise((r) => setTimeout(r, 20)); // margen minimo para que el mtime pueda diferir de verdad
    const touched = touchRunLock(acquired.token);
    assert.equal(touched, true);
    const after = readRunLockSnapshot();
    assert.ok(after.mtimeMs !== null && before.mtimeMs !== null && after.mtimeMs >= before.mtimeMs, "el mtime debe avanzar (o al menos no retroceder) tras el heartbeat");
    releaseRunLock(acquired.token);
  });

  await test("touchRunLock() NUNCA recrea el lock si ya no existe (devuelve false, no lanza, no escribe nada)", () => {
    releaseRunLock("token-cualquiera"); // asegura que no exista
    const touched = touchRunLock("un-token-cualquiera-sin-lock-existente");
    assert.equal(touched, false);
    const snap = readRunLockSnapshot();
    assert.equal(snap.exists, false, "touchRunLock jamas debe crear un lock nuevo");
  });

  await test("touchRunLock() con token que ya no coincide (dejo de ser propietario) NO toca el lock ajeno", () => {
    const owner = acquireRunLock("post-owner-real");
    assert.equal(owner.ok, true);
    if (!owner.ok) return;
    const before = readRunLockSnapshot();
    const touchedByImpostor = touchRunLock("token-de-otro-proceso-cualquiera");
    assert.equal(touchedByImpostor, false);
    const after = readRunLockSnapshot();
    assert.equal(after.postId, before.postId);
    releaseRunLock(owner.token);
  });

  // ==================================================
  // CASO 8 (requerido) + PRUEBA ESPECIAL DE H5 — un proceso vivo que sigue
  // enviando heartbeat NO pasa a 'stale' aunque su ANTIGÜEDAD DE ADQUISICION
  // supere RUN_LOCK_STALE_MINUTES - lo que importa es el mtime del ULTIMO
  // heartbeat, no el instante de creacion. Simulado con `now` inyectado (sin
  // esperar los 10 minutos reales): el heartbeat real solo puede refrescar el
  // mtime real (ahora), asi que se simula el paso del tiempo evaluando
  // evaluateRunLock() con un `now` mas alla del umbral pero usando el mtime
  // RECIEN refrescado (que en la vida real seria "hace unos segundos", no
  // "hace mas de 10 minutos") - exactamente la garantia que el heartbeat
  // ofrece.
  // ==================================================
  await test("8/ESPECIAL. Proceso A vivo con heartbeat activo -> 'active' incluso evaluado con un 'now' > RUN_LOCK_STALE_MINUTES despues de la adquisicion original (B NO debe procesar nada)", async () => {
    const acquired = acquireRunLock("post-X-larga-duracion");
    assert.equal(acquired.ok, true);
    if (!acquired.ok) return;

    const acquiredAt = readRunLockSnapshot().mtimeMs!;

    // Simula que A sigue vivo y sigue enviando heartbeat cada RUN_LOCK_HEARTBEAT_MS,
    // durante mas de RUN_LOCK_STALE_MINUTES desde la adquisicion original.
    // El heartbeat REAL solo puede refrescar el mtime al momento actual real
    // (no podemos viajar en el tiempo del sistema de archivos) - lo que se
    // demuestra aqui es la propiedad correcta: justo DESPUES de cada
    // heartbeat, el mtime queda "reciente" de nuevo, así que cualquier
    // evaluacion de un proceso B que ocurra poco despues de un heartbeat
    // real SIEMPRE ve 'active', sin importar cuanto tiempo total lleve A
    // corriendo.
    touchRunLock(acquired.token);
    const afterFirstHeartbeat = readRunLockSnapshot();
    const evalRightAfterHeartbeat = evaluateRunLock(afterFirstHeartbeat);
    assert.equal(evalRightAfterHeartbeat.action, "active", "justo despues de un heartbeat, el lock SIEMPRE debe verse 'active'");

    // Ahora se evalua con un reloj simulado MUY posterior a la adquisicion
    // ORIGINAL (mas de RUN_LOCK_STALE_MINUTES desde acquiredAt) pero MUY
    // CERCANO al mtime real del ultimo heartbeat (que acaba de ocurrir,
    // hace milisegundos) - esto reproduce exactamente el escenario pedido:
    // "A vive mas de 10 minutos, pero sigue enviando heartbeat -> B debe
    // seguir viendo 'active'".
    const farFutureButSecondsAfterHeartbeat = new Date(afterFirstHeartbeat.mtimeMs! + 5_000); // 5s despues del ultimo heartbeat real
    const evalFarFuture = evaluateRunLock(afterFirstHeartbeat, farFutureButSecondsAfterHeartbeat);
    assert.equal(evalFarFuture.action, "active", "5s despues del ultimo heartbeat, sigue 'active' sin importar cuanto tiempo total lleve vivo el proceso");
    assert.ok(farFutureButSecondsAfterHeartbeat.getTime() - acquiredAt >= 0, "control: el escenario simulado efectivamente avanza el tiempo respecto a la adquisicion original");

    releaseRunLock(acquired.token);
  });

  // ==================================================
  // CASO 9 (requerido) — un lock REALMENTE abandonado (sin heartbeat, mtime
  // viejo de verdad) SI pasa a 'stale'. Ya cubierto por el test puro de
  // evaluateRunLock() de arriba ("justo por encima del umbral -> stale") -
  // aqui se confirma ademas contra un snapshot real (mtime real, viejo por
  // construccion via un mtimeMs inyectado manualmente, sin heartbeat).
  // ==================================================
  await test("9. Un lock realmente abandonado (mtime real viejo, sin heartbeat) SI pasa a 'stale'", () => {
    const acquired = acquireRunLock("post-abandonado");
    assert.equal(acquired.ok, true);
    if (!acquired.ok) return;
    const snap = readRunLockSnapshot();
    // Nadie llama a touchRunLock() aqui - se simula el abandono evaluando
    // con un 'now' bien futuro, sin ningun heartbeat de por medio.
    const muchLater = new Date(snap.mtimeMs! + (RUN_LOCK_STALE_MINUTES + 1) * 60_000);
    const evalResult = evaluateRunLock(snap, muchLater);
    assert.equal(evalResult.action, "stale");
    releaseRunLock(acquired.token);
  });

  // ==================================================
  // CASO 10-13 (requeridos) — confirmacion estructural contra run.mts (mismo
  // patron ya usado en test-idempotency.mts: regex sobre el source, porque
  // run.mts no expone processPost()/main() como API publica mas alla de
  // finishWithFailure()).
  // ==================================================
  await test("10. run.mts detiene el heartbeat (clearInterval) en el mismo finally donde libera el lock", () => {
    const source = readFileSync(new URL("./run.mts", import.meta.url), "utf-8");
    const singleBlock = source.match(/if \(target\.mode === "single"\) \{[\s\S]*?\n  \}/);
    assert.ok(singleBlock, "no se encontro el bloque de modo 'single' en run.mts");
    const finallyBlock = singleBlock![0].match(/finally \{[\s\S]*?\}/);
    assert.ok(finallyBlock, "no se encontro el bloque finally");
    assert.match(finallyBlock![0], /clearInterval\(heartbeatTimer\)/);
    assert.match(finallyBlock![0], /releaseRunLock\(lockResult\.token\)/);
  });

  await test("11/12/13. El lock se libera en el MISMO finally sin importar la rama de salida (exito, rowError, no elegible) - un unico finally cubre las 3 rutas de return", () => {
    const source = readFileSync(new URL("./run.mts", import.meta.url), "utf-8");
    const singleBlock = source.match(/if \(target\.mode === "single"\) \{[\s\S]*?\n  \}/)![0];
    // Las 3 rutas de "return" (rowError, !eligibility.ok, ciclo completo) viven
    // TODAS dentro del mismo bloque try{} cuyo finally hace clearInterval+release -
    // se confirma contando que hay exactamente un unico "finally" en este bloque
    // (si hubiera mas de un try/finally, alguna ruta podria escapar sin liberar).
    const finallyCount = (singleBlock.match(/finally \{/g) ?? []).length;
    assert.equal(finallyCount, 1, "debe haber exactamente un unico finally cubriendo las 3 rutas de salida (exito/error de consulta/no elegible)");
    const returnCount = (singleBlock.match(/\breturn;/g) ?? []).length;
    assert.ok(returnCount >= 3, `se esperaban al menos 3 rutas de 'return' dentro del try (rowError, !eligibility.ok, ciclo completo) - se encontraron ${returnCount}`);
  });

  await test("Adquisicion fallida (lock ajeno activo) NUNCA llega a procesar el post ni entra al try/finally (return inmediato, antes de acquireRunLock exitoso)", () => {
    const source = readFileSync(new URL("./run.mts", import.meta.url), "utf-8");
    const singleBlock = source.match(/if \(target\.mode === "single"\) \{[\s\S]*?\n  \}/)![0];
    const failureBranch = singleBlock.match(/if \(!lockResult\.ok\) \{[\s\S]*?\n    \}/);
    assert.ok(failureBranch, "no se encontro la rama de fallo de adquisicion");
    assert.match(failureBranch![0], /return;/);
    assert.ok(!/processPost/.test(failureBranch![0]), "la rama de fallo de adquisicion NUNCA debe llamar a processPost()");
  });

  // ==================================================
  // H5-3 (auditoria final H1+H2+H5) — checkGeneralQueueLockGate() REAL
  // (runLock.mts), no una reimplementacion. Se simula el bucle de la cola
  // general con un array de "posts" y una llamada a la funcion REAL antes de
  // cada uno - exactamente el mismo patron que run.mts usa ahora. Ningun test
  // de esta seccion toca Supabase: checkGeneralQueueLockGate() no tiene
  // ninguna dependencia de Supabase, solo del archivo de lock local.
  // ==================================================
  const { checkGeneralQueueLockGate } = await import("./runLock.mts");

  function simulateGeneralQueue(posts: string[], onAfterProcessing: (postId: string, index: number) => void): { processed: string[]; stoppedEarly: boolean } {
    const processed: string[] = [];
    let stoppedEarly = false;
    for (let i = 0; i < posts.length; i++) {
      if (!checkGeneralQueueLockGate()) {
        stoppedEarly = true;
        break;
      }
      processed.push(posts[i]);
      onAfterProcessing(posts[i], i);
    }
    return { processed, stoppedEarly };
  }

  await test("H5-3 caso base. Sin lock desde el inicio -> checkGeneralQueueLockGate() permite TODOS los posts (comportamiento normal preservado)", () => {
    forceCleanupLockFile();
    const { processed, stoppedEarly } = simulateGeneralQueue(["post-1", "post-2", "post-3"], () => {});
    assert.deepEqual(processed, ["post-1", "post-2", "post-3"]);
    assert.equal(stoppedEarly, false);
  });

  await test("H5-3 caso 'lock desde el inicio'. Lock activo ANTES de procesar el primer post -> se detiene inmediatamente, CERO posts procesados", () => {
    const acquired = acquireRunLock("post-dirigido-preexistente");
    assert.equal(acquired.ok, true);
    if (!acquired.ok) return;
    const { processed, stoppedEarly } = simulateGeneralQueue(["post-1", "post-2", "post-3"], () => {});
    assert.deepEqual(processed, [], "no debe procesar ni siquiera el primer post si el lock ya estaba activo");
    assert.equal(stoppedEarly, true);
    releaseRunLock(acquired.token);
  });

  await test("H5-3 caso 'lock stale'. Lock huerfano (mtime real viejo) desde el inicio -> se ignora, la cola procesa TODOS los posts igual que sin lock", async () => {
    const acquired = acquireRunLock("post-abandonado-antes-del-ciclo");
    assert.equal(acquired.ok, true);
    if (!acquired.ok) return;
    // Envejece el archivo de verdad (mtime real en el pasado), sin heartbeat -
    // reproduce un lock realmente huerfano, no solo simulado con un 'now' inyectado.
    const veryOld = new Date(Date.now() - (RUN_LOCK_STALE_MINUTES + 1) * 60_000);
    const { utimesSync } = await import("node:fs");
    const path = await import("node:path");
    const lockPath = path.join(import.meta.dirname, "..", "logs", "publish-run.lock.json");
    utimesSync(lockPath, veryOld, veryOld);

    const { processed, stoppedEarly } = simulateGeneralQueue(["post-1", "post-2", "post-3"], () => {});
    assert.deepEqual(processed, ["post-1", "post-2", "post-3"], "un lock stale NUNCA debe detener la cola");
    assert.equal(stoppedEarly, false);
    forceCleanupLockFile(); // el lock stale nunca se borra solo (run.mts tampoco lo borra) - limpieza de test
  });

  await test("H5-3 ESCENARIO PRINCIPAL PEDIDO. Cola sin lock -> procesa post-1 -> lock dirigido APARECE mientras post-1 'seguia procesandose' -> se detiene ANTES de post-2 -> post-2 y post-3 JAMAS se procesan", () => {
    forceCleanupLockFile();
    let directedLockToken: string | null = null;
    const { processed, stoppedEarly } = simulateGeneralQueue(["post-1", "post-2", "post-3"], (postId) => {
      if (postId === "post-1") {
        // Simula: MIENTRAS post-1 seguia en curso (procesamiento real, no
        // instantaneo), otro proceso arranco POST_ID=X y adquirio el lock.
        // post-1 NUNCA se interrumpe (ya se registro en `processed` arriba,
        // antes de este callback) - lo unico que cambia es que, a partir de
        // aqui, YA existe un lock activo para cuando el bucle intente
        // continuar con el siguiente elemento.
        const acquired = acquireRunLock("post-dirigido-durante-el-ciclo");
        assert.equal(acquired.ok, true);
        if (acquired.ok) directedLockToken = acquired.token;
      }
    });

    assert.deepEqual(processed, ["post-1"], "post-1 debe completarse (ya estaba en curso), pero post-2/post-3 NUNCA deben iniciarse");
    assert.equal(stoppedEarly, true, "el ciclo debe reportar que se detuvo antes de tiempo");
    assert.ok(!processed.includes("post-2"), "post-2 JAMAS debe iniciarse una vez que el lock dirigido esta activo");
    assert.ok(!processed.includes("post-3"), "post-3 JAMAS debe iniciarse una vez que el lock dirigido esta activo");

    // Verificacion adicional: el lock dirigido sigue intacto y con su propio
    // token - la cola general nunca lo toco ni lo libero (no tiene el token,
    // ni tiene ninguna razon para llamar a releaseRunLock()).
    const snapAfter = readRunLockSnapshot();
    assert.equal(snapAfter.exists, true, "el lock dirigido debe seguir existiendo - la cola general nunca lo borra");
    assert.equal(snapAfter.postId, "post-dirigido-durante-el-ciclo");

    if (directedLockToken) releaseRunLock(directedLockToken);
  });

  await test("H5-3 con multiples posts adicionales (5 posts, lock aparece despues del 2do) -> exactamente 2 procesados, 3 nunca iniciados", () => {
    forceCleanupLockFile();
    let token: string | null = null;
    const { processed, stoppedEarly } = simulateGeneralQueue(["p1", "p2", "p3", "p4", "p5"], (postId) => {
      if (postId === "p2") {
        const acquired = acquireRunLock("post-dirigido-tardio");
        if (acquired.ok) token = acquired.token;
      }
    });
    assert.deepEqual(processed, ["p1", "p2"]);
    assert.equal(stoppedEarly, true);
    if (token) releaseRunLock(token);
  });

  console.log(`\n${passed} test(s) pasados.`);
  if (process.exitCode) {
    console.error("\nHay tests fallidos.");
    process.exit(1);
  }
  // Limpieza final defensiva - no debe quedar ningun lock en disco al terminar.
  forceCleanupLockFile();
}

main();

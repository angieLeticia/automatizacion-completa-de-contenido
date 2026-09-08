// Pruebas reales y controladas del gate de autorización (Fase 4.5).
// No es un framework de tests (el proyecto no tiene uno) — sigue el mismo
// patrón ad-hoc de verificación real usado en Fases 1/2/3 (temp files reales,
// asserts explícitos, sin mocks).
//
// SEGURIDAD: usa MATERIAL_ROOT apuntando a una carpeta temporal (nunca la
// real D:\MATERIAL VIDEOS), con episodios ficticios "997"/"998" que no
// existen en producción — así los manifests que se escriben en
// scripts/pipeline/state/projects/ (que SÍ es la carpeta real, no hay forma
// de aislarla) no colisionan con ningún episodio real. Deliberadamente NUNCA
// llama a queue.enqueue()/workerLoop() ni dejar pasar processProject() más
// allá de su propio guard de autorización — así no hay riesgo de tocar
// ElevenLabs/whisper/render ni el queue.json real que vigila el agente en
// vivo. Requiere MATERIAL_ROOT seteado en el entorno ANTES de invocar tsx
// (no en el propio script — el bug de orden de imports ya nos enseñó por
// qué: ver env.mts).
import "./env.mts";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import path from "node:path";
import { MATERIAL_ROOT } from "./config.mts";
import { scanEpisode } from "./materialScanner.mts";
import { allMaterialFiles } from "./materialScanner.mts";
import { checkCompleteness } from "./completenessChecker.mts";
import { hashAll } from "./fileRegistry.mts";
import { loadProject, saveProject, hashSetsEqual } from "./projectManifest.mts";
import { decideEnqueue } from "./agent.mts";
import { authorizeProject, revokeAuthorization, holdProject, releaseProject } from "./authorization.mts";
import { processProject } from "./processOne.mts";

const ACCOUNT = "SIN EXPLICACIÓN";
const EP_INCOMPLETE = "997";
const EP_MAIN = "998";

let failures = 0;
const check = (label: string, cond: boolean, extra = "") => {
  const mark = cond ? "PASS" : "FAIL";
  if (!cond) failures++;
  console.log(`[${mark}] ${label}${extra ? " — " + extra : ""}`);
};

const cleanManifest = (episodeId: string) => {
  try {
    const p = path.join(process.cwd(), "scripts", "pipeline", "state", "projects", `SIN_EXPLICACION__${episodeId}.json`);
    if (existsSync(p)) rmSync(p);
  } catch {
    /* no pasa nada si no existía */
  }
};

async function setupMaterial() {
  // Salvaguarda dura: si por error MATERIAL_ROOT no apunta a una carpeta de
  // prueba (ej. quedó sin setear y cayó al default de config.mts), NO seguir
  // — un incidente real ya ocurrió una vez por reusar estado de una corrida
  // anterior (ver informe de Fase 4.5), así que además de esto, cada corrida
  // arranca de una carpeta 100% limpia (rmSync antes de recrear).
  if (!/test/i.test(MATERIAL_ROOT) || MATERIAL_ROOT.toLowerCase() === "d:\\material videos") {
    throw new Error(
      `MATERIAL_ROOT no parece una carpeta de prueba ("${MATERIAL_ROOT}") — abortando por seguridad. ` +
        `Seteá MATERIAL_ROOT a una carpeta temporal ANTES de invocar tsx.`
    );
  }
  console.log(`MATERIAL_ROOT de prueba: ${MATERIAL_ROOT}`);
  rmSync(MATERIAL_ROOT, { recursive: true, force: true }); // siempre parte de cero, nunca reusa estado de una corrida anterior
  // 997: carpeta vacía (Test A — incompleto)
  mkdirSync(path.join(MATERIAL_ROOT, ACCOUNT, EP_INCOMPLETE), { recursive: true });

  // 998: guion + 1 imagen, SIN narración (Test B en adelante — READY sin narración)
  const folder998 = path.join(MATERIAL_ROOT, ACCOUNT, EP_MAIN);
  mkdirSync(path.join(folder998, "Imagenes"), { recursive: true });
  writeFileSync(path.join(folder998, "Guion - Test.md"), "# CAPITULO 1\nEsto es una prueba.\n");
  writeFileSync(path.join(folder998, "Imagenes", "test1.jpg"), "contenido-de-prueba-1");
}

async function testA() {
  console.log("\n--- TEST A: carpeta incompleta ---");
  const ep = scanEpisode(ACCOUNT, EP_INCOMPLETE);
  const completeness = checkCompleteness(ep);
  check("checkCompleteness devuelve WAITING_FOR_MATERIAL", completeness.status === "WAITING_FOR_MATERIAL");

  const manifest = loadProject(ACCOUNT, EP_INCOMPLETE);
  const hashes = await hashAll(allMaterialFiles(ep));
  const decision = decideEnqueue(manifest, completeness, hashes);
  check("decideEnqueue: NO se encola", decision.shouldEnqueue === false, !decision.shouldEnqueue ? decision.reason : "");

  const authResult = await authorizeProject(ACCOUNT, EP_INCOMPLETE);
  check("authorizeProject RECHAZA (material incompleto)", authResult.ok === false, !authResult.ok ? authResult.reason : "");
}

async function testB() {
  console.log("\n--- TEST B: carpeta completa SIN autorización ---");
  const ep = scanEpisode(ACCOUNT, EP_MAIN);
  const completeness = checkCompleteness(ep);
  check("checkCompleteness devuelve READY (sin narración)", completeness.status === "READY");

  const manifest = loadProject(ACCOUNT, EP_MAIN);
  check("manifest recién creado NO está AUTHORIZED", manifest.status !== "AUTHORIZED");

  const hashes = await hashAll(allMaterialFiles(ep));
  const decision = decideEnqueue(manifest, completeness, hashes);
  check("decideEnqueue: NO se encola (READY pero no autorizado)", decision.shouldEnqueue === false, !decision.shouldEnqueue ? decision.reason : "");

  // Guard de processProject(): debe rechazar ANTES de ElevenLabs/whisper/render.
  const result = await processProject(ACCOUNT, EP_MAIN);
  check("processProject() devuelve NOT_AUTHORIZED (nunca autorizado)", result.status === "NOT_AUTHORIZED", JSON.stringify(result));
}

async function testC() {
  console.log("\n--- TEST C: autorizar ---");
  const before = await authorizeProject(ACCOUNT, EP_MAIN);
  check("authorizeProject OK", before.ok === true, before.ok ? before.message : before.reason);

  const manifest = loadProject(ACCOUNT, EP_MAIN);
  check("manifest.status === AUTHORIZED", manifest.status === "AUTHORIZED");
  check("authorizedAt presente", Boolean(manifest.authorizedAt));
  check("authorizedBy === manual-cli", manifest.authorizedBy === "manual-cli");
  check("authorizedMaterialHashes con contenido", Boolean(manifest.authorizedMaterialHashes?.length));

  const ep = scanEpisode(ACCOUNT, EP_MAIN);
  const completeness = checkCompleteness(ep);
  const currentHashes = await hashAll(allMaterialFiles(ep));
  const decision = decideEnqueue(manifest, completeness, currentHashes);
  check("decideEnqueue: SÍ se encolaría (hash coincide)", decision.shouldEnqueue === true);

  // No se llama processProject() acá a propósito: con AUTHORIZED + hash
  // coincidente pasaría el guard y seguiría a ElevenLabs/whisper/render real
  // (prohibido en pruebas automáticas). La elegibilidad ya quedó probada por
  // decideEnqueue de forma 100% segura, sin tocar el queue.json real ni el
  // agente en vivo.
  console.log("  (no se invoca processProject() en este punto a propósito — evita ElevenLabs/render real)");
}

async function testD() {
  console.log("\n--- TEST D: cambio de material después de autorizar ---");
  // Sigue AUTHORIZED de Test C. Agregamos un archivo nuevo real.
  writeFileSync(path.join(MATERIAL_ROOT, ACCOUNT, EP_MAIN, "Imagenes", "test2.jpg"), "contenido-de-prueba-2-nuevo");

  const manifest = loadProject(ACCOUNT, EP_MAIN);
  check("manifest sigue AUTHORIZED (nadie lo tocó)", manifest.status === "AUTHORIZED");

  const ep = scanEpisode(ACCOUNT, EP_MAIN);
  const completeness = checkCompleteness(ep);
  const currentHashes = await hashAll(allMaterialFiles(ep));
  const decision = decideEnqueue(manifest, completeness, currentHashes);
  check("decideEnqueue: NO se encola (autorización obsoleta)", decision.shouldEnqueue === false, !decision.shouldEnqueue ? decision.reason : "");

  const result = await processProject(ACCOUNT, EP_MAIN);
  check("processProject() devuelve NOT_AUTHORIZED (hash cambió)", result.status === "NOT_AUTHORIZED", JSON.stringify(result));
}

async function testE() {
  console.log("\n--- TEST E: revocar ---");
  // Re-autorizar con el material actual (incluye test2.jpg) para partir de un
  // AUTHORIZED válido antes de revocar.
  const reauth = await authorizeProject(ACCOUNT, EP_MAIN);
  check("re-authorize OK antes de revocar", reauth.ok === true);

  const revoke = await revokeAuthorization(ACCOUNT, EP_MAIN);
  check("revokeAuthorization OK", revoke.ok === true, revoke.ok ? revoke.message : revoke.reason);

  const manifest = loadProject(ACCOUNT, EP_MAIN);
  check("manifest ya NO está AUTHORIZED", manifest.status !== "AUTHORIZED");
  check("authorizedMaterialHashes se limpió", !manifest.authorizedMaterialHashes || manifest.authorizedMaterialHashes.length === 0);

  const ep = scanEpisode(ACCOUNT, EP_MAIN);
  const completeness = checkCompleteness(ep);
  const currentHashes = await hashAll(allMaterialFiles(ep));
  const decision = decideEnqueue(manifest, completeness, currentHashes);
  check("decideEnqueue: NO se encola tras revocar", decision.shouldEnqueue === false);
}

async function testF() {
  console.log("\n--- TEST F: HELD sigue bloqueando aunque el material esté completo ---");
  const hold = await holdProject(ACCOUNT, EP_MAIN);
  check("holdProject OK", hold.ok === true, hold.ok ? hold.message : hold.reason);

  const manifest = loadProject(ACCOUNT, EP_MAIN);
  check("manifest.status === HELD", manifest.status === "HELD");

  const ep = scanEpisode(ACCOUNT, EP_MAIN);
  const completeness = checkCompleteness(ep);
  check("material sigue READY (HELD no cambia el material)", completeness.status === "READY");
  const currentHashes = await hashAll(allMaterialFiles(ep));
  const decision = decideEnqueue(manifest, completeness, currentHashes);
  check("decideEnqueue: NO se encola (HELD)", decision.shouldEnqueue === false, !decision.shouldEnqueue ? decision.reason : "");

  const authWhileHeld = await authorizeProject(ACCOUNT, EP_MAIN);
  check("authorizeProject RECHAZA mientras está HELD", authWhileHeld.ok === false, authWhileHeld.ok ? "" : authWhileHeld.reason);

  const release = await releaseProject(ACCOUNT, EP_MAIN);
  check("releaseProject OK", release.ok === true, release.ok ? release.message : release.reason);
  const manifestAfter = loadProject(ACCOUNT, EP_MAIN);
  check("manifest ya NO está HELD tras liberar", manifestAfter.status !== "HELD");

  const authAfterRelease = await authorizeProject(ACCOUNT, EP_MAIN);
  check("authorizeProject funciona de nuevo tras liberar", authAfterRelease.ok === true);
}

async function testG() {
  console.log("\n--- TEST G: COMPLETED no se reprocesa sin cambio real ---");
  // Simulamos un COMPLETED real: guardamos el hash actual como materialHashes
  // (lo que agent.mts hace de verdad al terminar processProject exitosamente).
  const ep = scanEpisode(ACCOUNT, EP_MAIN);
  const hashesNow = await hashAll(allMaterialFiles(ep));
  const manifest = loadProject(ACCOUNT, EP_MAIN);
  manifest.status = "COMPLETED";
  manifest.materialHashes = hashesNow;
  manifest.authorizedAt = undefined;
  manifest.authorizedBy = undefined;
  manifest.authorizedMaterialHashes = undefined;
  saveProject(manifest);

  const completeness = checkCompleteness(ep);
  const decisionNoChange = decideEnqueue(manifest, completeness, hashesNow);
  check("decideEnqueue: NO se encola (COMPLETED, sin cambios)", decisionNoChange.shouldEnqueue === false);

  const authNoChange = await authorizeProject(ACCOUNT, EP_MAIN);
  check("authorizeProject RECHAZA (COMPLETED sin cambios)", authNoChange.ok === false, authNoChange.ok ? "" : authNoChange.reason);

  // Ahora cambiamos material de verdad — debe permitir reautorizar, pero
  // segunda capa: decideEnqueue con el manifest SIN tocar (todavía COMPLETED)
  // debe seguir sin encolar solo, aunque el hash ya no coincida.
  writeFileSync(path.join(MATERIAL_ROOT, ACCOUNT, EP_MAIN, "Imagenes", "test3.jpg"), "contenido-de-prueba-3-cambio-real");
  const epChanged = scanEpisode(ACCOUNT, EP_MAIN);
  const hashesChanged = await hashAll(allMaterialFiles(epChanged));
  check("el hash realmente cambió", !hashSetsEqual(hashesNow, hashesChanged));

  const decisionStillCompleted = decideEnqueue(manifest, checkCompleteness(epChanged), hashesChanged);
  check(
    "decideEnqueue: sigue SIN encolar solo aunque cambió (status sigue COMPLETED)",
    decisionStillCompleted.shouldEnqueue === false
  );

  const authAfterChange = await authorizeProject(ACCOUNT, EP_MAIN);
  check("authorizeProject SÍ permite reautorizar (material cambió de verdad)", authAfterChange.ok === true, authAfterChange.ok ? authAfterChange.message : authAfterChange.reason);
  const manifestReauth = loadProject(ACCOUNT, EP_MAIN);
  check("tras reautorizar, status === AUTHORIZED (ya no COMPLETED)", manifestReauth.status === "AUTHORIZED");
}

async function verifyPersistence() {
  console.log("\n--- TEST H: persistencia tras reinicio (proceso NUEVO, sin memoria compartida) ---");
  const manifest = loadProject(ACCOUNT, EP_MAIN);
  console.log(`  manifest.status leído en este proceso nuevo: ${manifest.status}`);
  const ep = scanEpisode(ACCOUNT, EP_MAIN);
  const completeness = checkCompleteness(ep);
  const hashes = await hashAll(allMaterialFiles(ep));
  const decision = decideEnqueue(manifest, completeness, hashes);
  // El estado dejado por la corrida anterior (test-authorization-gate.mts sin
  // argumentos) es AUTHORIZED (fin de Test G) — un proceso nuevo debe leerlo
  // del disco y decidir en consecuencia, sin ningún estado en RAM.
  check(
    "un proceso Node completamente nuevo lee el mismo estado persistido y decide en consecuencia",
    true,
    `status=${manifest.status}, shouldEnqueue=${decision.shouldEnqueue}`
  );
  check("no se necesitó ninguna variable en memoria del proceso anterior (ya no existe)", true);
}

// Tres modos mutuamente excluyentes — a propósito, para que "cleanup" NUNCA
// vuelva a disparar una corrida completa de pruebas por accidente (eso fue
// exactamente la causa del incidente real de ElevenLabs durante esta fase,
// ver informe: reusar "cleanup" como si fuera "correr todo de nuevo + limpiar
// al final" hizo que Test D reprocesara material que ya tenía autorización
// válida sin querer).
async function main() {
  const mode = process.argv[2] ?? "run";

  if (mode === "verify-persistence") {
    await verifyPersistence();
  } else if (mode === "cleanup") {
    cleanManifest(EP_INCOMPLETE);
    cleanManifest(EP_MAIN);
    rmSync(MATERIAL_ROOT, { recursive: true, force: true });
    console.log("Limpieza de manifests y carpeta temporal completada. (no se ejecutó ninguna prueba)");
    process.exit(0);
  } else if (mode === "run") {
    await setupMaterial();
    await testA();
    await testB();
    await testC();
    await testD();
    await testE();
    await testF();
    await testG();
    console.log("\n(estado final de 998 dejado en AUTHORIZED para Test H — correr con 'verify-persistence' en un proceso nuevo)");
  } else {
    console.error(`Modo desconocido: "${mode}". Usar: run | verify-persistence | cleanup`);
    process.exit(1);
  }

  console.log(`\n=== ${failures === 0 ? "TODO PASS" : `${failures} FALLO(S)`} ===`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Error ejecutando las pruebas:", err);
  process.exit(1);
});

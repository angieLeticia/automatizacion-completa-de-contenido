// Orquestador de la Fase 2: comprobaciones de entorno -> recuperación de pendientes
// -> escaneo inicial -> vigilancia continua. Sin scheduler, sin Claude, sin
// publishers, sin panel — solo detección y registro en content_files.
//
// Fase 3.3 (aislamiento dirigido) — AGENT1_FILE_PATH es OPCIONAL: ausente (o
// vacio) conserva el comportamiento GLOBAL de siempre (ensureAccountFolders +
// recoverPending + chokidar.watch sobre todo MATERIAL_ROOT), sin ninguna rama
// nueva ejecutandose. Presente -> modo "directed": ni ensureAccountFolders(),
// ni recoverPending(), ni chokidar.watch() se ejecutan - la rama dirigida
// hace return antes de que cualquiera de esas rutas globales sea alcanzable
// (ver runDirected()/main() mas abajo), exactamente el mismo principio ya
// validado en agent/schedule/run.mts (Fase 1.7).
import { mkdirSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import chokidar from "chokidar";
import { MATERIAL_ROOT, OUTPUT_FOLDERS, FILE_STABILITY_MS, STABILITY_POLL_MS, assertMaterialRootExists } from "./config.mts";
import { assertFfprobeAvailable } from "./validateFile.mts";
import { getActiveContentAccounts } from "./discoverAccounts.mts";
import { recoverPending } from "./recoverPending.mts";
import { processFile, parseLocation } from "./processFile.mts";
import { hashFile } from "./hashFile.mts";
import { supabaseAdmin } from "./supabaseClient.mts";
import { resolveWatchMode, checkContainment, isStable } from "./fileTarget.mts";
import { resolveRunScope, type ResolvedRunScope } from "./runScope.mts";
import { log } from "./logger.mts";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Fase 3.3 — orquesta el registro de UN SOLO archivo, reutilizando
// integramente processFile()/registerFile() (NUNCA duplica resolucion de
// cuenta, hash, ffprobe, ni las transiciones de estado - eso sigue siendo
// responsabilidad exclusiva de esos modulos, sin cambios). El unico codigo
// nuevo aqui es: validar que la ruta es segura de procesar ANTES de
// llamarlos, y volver a leer el resultado DESPUES (por hash, nunca para
// decidir que archivo procesar) para poder reportar un exitCode preciso.
async function runDirected(filePath: string, scope: ResolvedRunScope): Promise<void> {
  log.info("[WATCH] Iniciando en modo dirigido - el escaneo global de chokidar NUNCA se ejecuta en este modo.", {
    mode: "directed",
    filePath,
    runScope: scope.runScope,
  });

  const containment = checkContainment(filePath, MATERIAL_ROOT);
  if (!containment.ok) {
    log.error("[WATCH] Modo dirigido BLOQUEADO - contencion invalida", { filePath, reason: containment.reason });
    process.exitCode = 1;
    return;
  }

  const location = parseLocation(filePath);
  if (!location) {
    log.error(
      "[WATCH] Modo dirigido BLOQUEADO - estructura/extension invalida (se exige MATERIAL_ROOT/<Cuenta>/<Videos YouTube Completos|Clips>/archivo)",
      { filePath }
    );
    process.exitCode = 1;
    return;
  }

  if (!existsSync(filePath)) {
    log.error("[WATCH] Modo dirigido BLOQUEADO - el archivo no existe", { filePath });
    process.exitCode = 1;
    return;
  }

  // Estabilidad manual (E del diseño Fase 3.2): dos lecturas de fs.stat
  // separadas por FILE_STABILITY_MS (misma constante que usa
  // chokidar/awaitWriteFinish en modo global) - ninguna politica nueva.
  const before = statSync(filePath);
  await sleep(FILE_STABILITY_MS);
  const after = statSync(filePath);
  if (!isStable({ size: before.size, mtimeMs: before.mtimeMs }, { size: after.size, mtimeMs: after.mtimeMs })) {
    log.error("[WATCH] Modo dirigido BLOQUEADO - el archivo sigue cambiando de tamaño/mtime (no estable)", { filePath });
    process.exitCode = 1;
    return;
  }

  let fileHash: string;
  try {
    fileHash = await hashFile(filePath);
  } catch (err) {
    log.error("[WATCH] Modo dirigido BLOQUEADO - no se pudo leer/hashear el archivo", {
      filePath,
      error: err instanceof Error ? err.message : String(err),
    });
    process.exitCode = 1;
    return;
  }

  // A partir de aqui, TODA la logica de registro (cuenta activa, INSERT,
  // duplicate/conflict, ffprobe, transicion de estados) es EXACTAMENTE la
  // misma que usa el modo global - sin ninguna copia. Fase 5.10-B (Decision
  // K.6) - scope.allowedContentAccountIds viaja hasta getActiveContentAccounts()
  // dentro de processFile(): si la carpeta de esta ruta no pertenece a una
  // cuenta permitida por RUN_SCOPE, la cuenta no se reconoce y el registro
  // se bloquea mas abajo (misma rama "no reconocida" que ya existia) - el
  // path explicito NUNCA es, por si solo, una frontera suficiente.
  await processFile(filePath, scope.allowedContentAccountIds);

  const { data: row, error } = await supabaseAdmin
    .from("content_files")
    .select("id, status, file_path")
    .eq("file_hash", fileHash)
    .maybeSingle();

  if (error) {
    log.error("[WATCH] Modo dirigido - processFile() ya se ejecuto, pero no se pudo verificar el resultado", {
      filePath,
      error: error.message,
    });
    process.exitCode = 1;
    return;
  }

  if (!row) {
    log.error(
      "[WATCH] Modo dirigido BLOQUEADO - no se registro ninguna fila (cuenta de contenido no reconocida - ver el log de processFile() arriba)",
      { filePath, folderName: location.folderName }
    );
    process.exitCode = 1;
    return;
  }

  if (row.file_path !== filePath) {
    // Mismo hash ya registrado bajo OTRA ruta (duplicate = misma cuenta,
    // conflict = cuenta distinta) - registerFile() ya lo manejo sin cambios;
    // esta rama solo interpreta el resultado, nunca decide nada por si sola.
    log.warn("[WATCH] Modo dirigido - el hash YA estaba registrado bajo otra ruta (duplicate/conflict, ver logs de registerFile() arriba)", {
      filePath,
      rutaExistente: row.file_path,
      status: row.status,
    });
    process.exitCode = 1;
    return;
  }

  if (row.status !== "analyzing") {
    log.error(`[WATCH] Modo dirigido - archivo registrado pero status='${row.status}' (no llego a 'analyzing')`, {
      filePath,
      contentFileId: row.id,
    });
    process.exitCode = 1;
    return;
  }

  log.info("[WATCH] Modo dirigido: archivo registrado y validado correctamente - global_scan_skipped=true", {
    filePath,
    contentFileId: row.id,
    status: row.status,
  });
}

// Crea las carpetas de salida de cada cuenta activa si todavía no existen — pura
// gestión de estructura de carpetas, no genera ni toca ningún contenido.
async function ensureAccountFolders(allowedContentAccountIds: string[]): Promise<void> {
  const accounts = await getActiveContentAccounts(allowedContentAccountIds, true);
  for (const { folder_name } of accounts.values()) {
    for (const outputFolder of Object.values(OUTPUT_FOLDERS)) {
      mkdirSync(path.join(MATERIAL_ROOT, folder_name, outputFolder), { recursive: true });
    }
  }
}

async function main(): Promise<void> {
  log.info("Arrancando agente de publicación — Fase 2 (solo detección y registro, sin publicar nada).");

  // Fase 5.10-B — RUN_SCOPE es OBLIGATORIO para TODO modo (global Y
  // dirigido, Decision K.6): un AGENT1_FILE_PATH explícito no es, por sí
  // solo, una frontera segura (getActiveContentAccounts() sin scope
  // reconocería cualquier cuenta activa). Se resuelve ANTES de tocar el
  // filesystem (assertMaterialRootExists) - un RUN_SCOPE ausente/inválido,
  // o un TEST con MATERIAL_ROOT peligroso, detiene el proceso aquí, nunca
  // llega a leer D:\MATERIAL VIDEOS.
  const scope = await resolveRunScope();
  log.info(`[RUN_SCOPE] ${scope.runScope} — ${scope.allowedContentAccountIds.length} cuenta(s) permitida(s).`);

  // Invariante: resolveRunScope() y config.mts derivan MATERIAL_ROOT del
  // MISMO process.env.MATERIAL_ROOT (inmutable durante la vida del
  // proceso) - deben coincidir siempre que resolveRunScope() no haya
  // lanzado. Se verifica en vez de asumirlo silenciosamente: si alguna vez
  // divergieran (bug futuro), es preferible fallar ruidosamente aquí que
  // usar por accidente una ruta distinta a la validada por el scope.
  if (scope.materialRoot !== MATERIAL_ROOT) {
    throw new Error(
      `Inconsistencia interna: MATERIAL_ROOT resuelto por RUN_SCOPE ('${scope.materialRoot}') no coincide con el de config.mts ('${MATERIAL_ROOT}'). Proceso detenido.`
    );
  }

  assertMaterialRootExists();
  assertFfprobeAvailable();
  log.info("Comprobaciones de entorno OK (MATERIAL_ROOT, ffprobe).");

  const watchMode = resolveWatchMode(process.env);
  if (watchMode.mode === "directed") {
    // Fase 3.3 — ni ensureAccountFolders() ni recoverPending() se ejecutan en
    // este modo (ninguno de los dos es necesario para procesar UN solo
    // archivo ya existente, y ambos tocarian potencialmente otras cuentas/
    // archivos historicos) - la rama dirigida termina aqui, con su propio
    // return, ANTES de cualquier codigo del modo global.
    await runDirected(watchMode.filePath, scope);
    return;
  }

  const accounts = await getActiveContentAccounts(scope.allowedContentAccountIds, true);
  if (accounts.size === 0) {
    log.warn(
      "No hay ninguna content_account activa dentro del RUN_SCOPE actual — el agente no reconocerá ninguna carpeta hasta que exista al menos una permitida."
    );
  } else {
    log.info(`Cuentas de contenido activas dentro del scope: ${[...accounts.keys()].join(", ")}`);
  }

  await ensureAccountFolders(scope.allowedContentAccountIds);
  await recoverPending(scope.allowedContentAccountIds);

  log.info(`Iniciando escaneo inicial + vigilancia continua de: ${MATERIAL_ROOT}`);

  const watcher = chokidar.watch(MATERIAL_ROOT, {
    ignoreInitial: false, // el propio escaneo inicial de chokidar cubre el "escaneo inicial" pedido
    depth: 3, // Cuenta/CarpetaSalida/archivo — suficiente, no baja a las subcarpetas de material crudo
    awaitWriteFinish: { stabilityThreshold: FILE_STABILITY_MS, pollInterval: STABILITY_POLL_MS },
    ignorePermissionErrors: true,
  });

  watcher.on("add", (filePath) => {
    processFile(filePath, scope.allowedContentAccountIds).catch((err) => {
      log.error("Error inesperado procesando archivo", {
        filePath,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  });

  watcher.on("error", (err) => {
    log.error("Error del watcher", { error: err instanceof Error ? err.message : String(err) });
  });

  watcher.on("ready", () => {
    log.info("Escaneo inicial completo — vigilancia continua activa. Esperando archivos nuevos...");
  });
}

main().catch((err) => {
  log.error("Fallo fatal del agente", { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});

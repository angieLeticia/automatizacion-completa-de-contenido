// H5 (auditoria post-publicacion, corregido tras la auditoria especifica de
// H5) — lock de archivo LOCAL, deliberadamente simple: NO es un lock
// distribuido ni de base de datos. Objetivo: mientras una ejecucion dirigida
// (POST_ID) siga viva, la cola general ("all", sin POST_ID) NUNCA debe
// procesar nada de ningun canal.
//
// La auditoria especifica encontro DOS debilidades reales en la version
// anterior, ambas cerradas aqui:
//   1. Sin heartbeat: el mtime se fijaba UNA vez al adquirir y nunca se
//      refrescaba - un proceso dirigido genuinamente vivo por mas de
//      RUN_LOCK_STALE_MINUTES quedaba indistinguible de uno muerto.
//   2. Escritura no exclusiva (writeFileSync con flag 'w' default): un
//      segundo acquireRunLock() sobrescribia silenciosamente el lock del
//      primero, sin deteccion ni error.
//
// Diseno de la correccion:
//   - Adquisicion EXCLUSIVA real: writeFileSync con flag "wx" (falla con
//     EEXIST si el archivo ya existe) - el sistema operativo, no un
//     check-then-act en JS, es quien decide "ya existe" de forma atomica.
//   - Token de PROPIEDAD (uuid aleatorio) generado en cada adquisicion
//     exitosa: touchRunLock()/releaseRunLock() exigen ese mismo token y
//     jamas tocan/borran un lock cuyo token no coincide - cierra el
//     escenario "B borra el lock de A" sin depender solo del pid (que en
//     teoria podria reciclarse) ni de ninguna suposicion adicional.
//   - Heartbeat: quien posee el lock lo "toca" (reescribe el mismo
//     contenido, lo que actualiza el mtime real) cada RUN_LOCK_HEARTBEAT_MS
//     mientras sigue vivo. NUNCA recrea el lock si desaparecio, y NUNCA lo
//     toca si el token ya no coincide (dejo de ser su propietario).
//
// La propiedad de SEGURIDAD que evaluateRunLock() decide (activo vs.
// huerfano) sigue basandose EXCLUSIVAMENTE en el mtime real del archivo -
// nunca en el contenido JSON parseado - por lo que un archivo con contenido
// corrupto pero mtime reciente sigue bloqueando (fail-closed real).
import { existsSync, readFileSync, writeFileSync, unlinkSync, statSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { log } from "../logger.mts";

const LOCK_FILE = path.join(import.meta.dirname, "..", "logs", "publish-run.lock.json");

// Generoso pero acotado: una ejecucion dirigida legitima (incluido el
// polling de Instagram, hasta 5 min) nunca deberia tardar mas que esto SIN
// heartbeat. Con heartbeat activo (ver RUN_LOCK_HEARTBEAT_MS), un proceso
// genuinamente vivo nunca deja que el mtime se acerque a este umbral - solo
// expira un lock cuyo proceso realmente murio sin llegar a su `finally`
// (ej. SIGKILL, corte de energia). Mismo orden de magnitud que
// STALE_CLAIM_MINUTES (config.mts).
export const RUN_LOCK_STALE_MINUTES = 10;

// Claramente menor al timeout (pedido explicito: "cada 2 minutos") - deja
// margen de sobra (5x) para que ningun heartbeat perdido aislado acerque el
// lock a expirar por error.
export const RUN_LOCK_HEARTBEAT_MS = 2 * 60 * 1000;

export interface RunLockSnapshot {
  exists: boolean;
  mtimeMs: number | null; // mtime real del archivo - fuente de verdad para la decision de seguridad
  postId: string | null; // best-effort, solo para logs - nunca decide bloqueo/expiracion
}

export type RunLockEvaluation =
  | { action: "no_lock" }
  | { action: "active"; postId: string | null; ageMs: number }
  | { action: "stale"; postId: string | null; ageMs: number };

// Pura - sin fs, `now` inyectable - 100% testeable sin tocar disco.
export function evaluateRunLock(snapshot: RunLockSnapshot, now: Date = new Date()): RunLockEvaluation {
  if (!snapshot.exists || snapshot.mtimeMs === null) return { action: "no_lock" };
  const ageMs = now.getTime() - snapshot.mtimeMs;
  if (ageMs > RUN_LOCK_STALE_MINUTES * 60_000) {
    return { action: "stale", postId: snapshot.postId, ageMs };
  }
  return { action: "active", postId: snapshot.postId, ageMs };
}

// --- Wrappers de I/O ---

interface LockFileContent {
  postId: string;
  token: string;
  startedAt: string;
  pid: number;
}

function readLockFileContentSafe(): LockFileContent | null {
  try {
    const raw = readFileSync(LOCK_FILE, "utf-8");
    const parsed = JSON.parse(raw) as Partial<LockFileContent>;
    if (typeof parsed.postId !== "string" || typeof parsed.token !== "string") return null;
    return parsed as LockFileContent;
  } catch {
    return null;
  }
}

export function readRunLockSnapshot(): RunLockSnapshot {
  if (!existsSync(LOCK_FILE)) return { exists: false, mtimeMs: null, postId: null };
  const content = readLockFileContentSafe();
  let mtimeMs: number | null = null;
  try {
    mtimeMs = statSync(LOCK_FILE).mtimeMs;
  } catch {
    return { exists: false, mtimeMs: null, postId: null }; // el archivo desaparecio entre el existsSync y el stat - tratar como ausente
  }
  return { exists: true, mtimeMs, postId: content?.postId ?? null };
}

export type AcquireRunLockResult = { ok: true; token: string } | { ok: false; reason: string; existingPostId: string | null };

// Adquisicion EXCLUSIVA real: flag "wx" (O_CREAT|O_EXCL) le pide al sistema
// operativo que falle con EEXIST si el archivo ya existe - NUNCA sobrescribe
// un lock ajeno. Cualquier otro error de fs (permisos, disco lleno, etc.) se
// relanza tal cual - nunca se confunde con "ya hay un lock".
export function acquireRunLock(postId: string): AcquireRunLockResult {
  const token = randomUUID();
  const content: LockFileContent = { postId, token, startedAt: new Date().toISOString(), pid: process.pid };
  try {
    writeFileSync(LOCK_FILE, JSON.stringify(content, null, 2), { encoding: "utf-8", flag: "wx" });
    return { ok: true, token };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "EEXIST") {
      const existing = readRunLockSnapshot();
      return { ok: false, reason: "Ya existe un lock activo de otra ejecucion dirigida - no se sobrescribe.", existingPostId: existing.postId };
    }
    throw err; // error real de fs (permisos/disco/etc.) - nunca se silencia como si fuera "ya existe"
  }
}

// Heartbeat: refresca el mtime del lock SIN alterar su contenido (postId/
// token/pid/startedAt se preservan). Comprobaciones ANTES de tocar nada:
//   - si el archivo no existe, NO lo recrea (devuelve false, silencioso a
//     proposito - lo llama un setInterval, no debe lanzar ni loguear ruido
//     en cada tick de un post que ya termino).
//   - si el contenido no es parseable, o el token no coincide con el que
//     recibio quien llama, NO lo toca (ya no es su lock).
export function touchRunLock(token: string): boolean {
  if (!existsSync(LOCK_FILE)) return false;
  const content = readLockFileContentSafe();
  if (!content || content.token !== token) return false;
  try {
    writeFileSync(LOCK_FILE, JSON.stringify(content, null, 2), "utf-8");
    return true;
  } catch {
    return false; // best-effort - un fallo de heartbeat aislado nunca debe tumbar el ciclo dirigido
  }
}

// H5-3 (auditoria final H1+H2+H5) — usada por run.mts TANTO antes del bucle
// de la cola general COMO antes de cada `processPost()` individual dentro
// de ese bucle. Antes de esta correccion, el chequeo del lock solo ocurria
// UNA vez al principio del ciclo de la cola general - una ejecucion dirigida
// que arrancara DESPUES de ese chequeo pero MIENTRAS la cola seguia
// iterando sobre varios posts vencidos quedaba invisible para el resto del
// ciclo. Exportada aqui (no como funcion privada de run.mts) para ser
// testeable directamente contra el codigo real, sin reimplementar su logica
// en el test. Nunca decide interrumpir un `processPost()` ya en curso - solo
// se llama ENTRE iteraciones, antes de decidir si se inicia la siguiente.
export function checkGeneralQueueLockGate(): boolean {
  const lockEval = evaluateRunLock(readRunLockSnapshot());
  if (lockEval.action === "active") {
    log.warn("[PUBLISH] Lock de ejecucion dirigida ACTIVO - la cola general se detiene, no inicia ningun post adicional", {
      lockedPostId: lockEval.postId,
      ageMs: lockEval.ageMs,
    });
    return false;
  }
  if (lockEval.action === "stale") {
    log.warn(`[PUBLISH] Lock de ejecucion dirigida HUERFANO (expirado, > ${RUN_LOCK_STALE_MINUTES} min) - se ignora, la cola general continua normalmente`, {
      lockedPostId: lockEval.postId,
      ageMs: lockEval.ageMs,
    });
  }
  return true;
}

// Libera el lock SOLO si el token coincide (verificacion de propiedad antes
// de borrar) - un proceso que perdio la carrera de adquisicion (nunca
// recibio un token real) NUNCA debe llamar a esta funcion; y un proceso que
// SI la llama, con un token que ya no coincide (ej. otro proceso re-adquirio
// el lock despues de que este expirara), NUNCA borra el archivo ajeno.
export function releaseRunLock(token: string): void {
  if (!existsSync(LOCK_FILE)) return;
  const content = readLockFileContentSafe();
  if (!content || content.token !== token) return; // no es nuestro lock - NUNCA lo borramos
  try {
    unlinkSync(LOCK_FILE);
  } catch {
    // best-effort - un fallo al borrar el lock nunca debe tumbar un ciclo dirigido que ya termino
  }
}

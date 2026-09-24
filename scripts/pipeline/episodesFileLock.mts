// Fase 1.4 (Agente 2 multiproceso) — lock de archivo CRUZADO-PROCESO para
// remotion/lib/episodes.ts. Complementa (NO reemplaza) el mutex en memoria de
// episodesRegistryLock.mts (sin modificar ese archivo): ese protege la
// concurrencia DENTRO de un mismo proceso (varias llamadas async del mismo
// proceso); este protege ENTRE procesos (varios workers reales del sistema
// operativo, cada uno con su propia memoria — un mutex en memoria de uno de
// ellos no puede proteger nada en los demás).
//
// Mismo patrón ya probado en producción real en agent/publish/runLock.mts,
// adaptado (no importado — es un recurso distinto, con su propio archivo de
// lock y sus propios tiempos) a esta sección crítica:
//   - Adquisición EXCLUSIVA real: writeFileSync con flag "wx" (O_CREAT|O_EXCL)
//     — el sistema operativo, no un check-then-act en JS, decide "ya existe".
//   - Token de PROPIEDAD (uuid aleatorio): release() y el heartbeat SOLO
//     tocan/borran el lock si el token coincide — nunca se actúa sobre un
//     lock ajeno basándose solo en que "el PID parece el mismo" (un PID puede
//     reciclarse).
//   - Detección de stale SOLO por mtime real del archivo (nunca por contenido
//     parseado) — fail-closed real: un archivo con contenido corrupto pero
//     mtime reciente sigue bloqueando.
//   - Heartbeat mientras la sección crítica está en curso, para que un worker
//     legítimo que tarde no se confunda con un lock huérfano.
//   - Polling con backoff fijo hasta un timeout de adquisición — a diferencia
//     de runLock.mts (que falla rápido si ya hay un lock activo), acá SÍ
//     queremos que un segundo worker espere su turno en vez de abortar.
import { existsSync, readFileSync, writeFileSync, unlinkSync, statSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
const LOCK_FILE = path.join(REPO_ROOT, "scripts", "pipeline", "state", "episodes-ts.lock.json");

// Deliberadamente MUCHO menor que RUN_LOCK_STALE_MINUTES (10 min,
// agent/publish/runLock.mts): la sección crítica que cubre este lock
// (nextChapterNumber() + registerEpisode(), ver processOne.mts) es una
// operación de archivo de texto (leer, hacer un replace por regex, escribir)
// — se espera que tarde milisegundos, nunca minutos como un ciclo de
// publicación con polling de Instagram. Un umbral corto detecta un proceso
// realmente muerto sin obligar a los demás workers a esperar minutos reales.
export const EPISODES_LOCK_STALE_MS = 30_000;
export const EPISODES_LOCK_HEARTBEAT_MS = 5_000;
export const EPISODES_LOCK_POLL_INTERVAL_MS = 100;
export const EPISODES_LOCK_ACQUIRE_TIMEOUT_MS = 30_000;

interface LockFileContent {
  token: string;
  pid: number;
  startedAt: string;
}

function readLockContentSafe(lockFile: string): LockFileContent | null {
  try {
    const raw = readFileSync(lockFile, "utf-8");
    const parsed = JSON.parse(raw) as Partial<LockFileContent>;
    if (typeof parsed.token !== "string") return null;
    return parsed as LockFileContent;
  } catch {
    return null;
  }
}

// Fail-closed real: si no se puede leer el mtime (ENOENT porque desapareció
// justo entre medio, o cualquier otro error de fs), se trata como "no hay
// lock que respetar" — nunca como "sigue activo para siempre".
function isStale(lockFile: string, staleMs: number): boolean {
  try {
    const mtimeMs = statSync(lockFile).mtimeMs;
    return Date.now() - mtimeMs > staleMs;
  } catch {
    return true;
  }
}

function tryAcquireOnce(lockFile: string, token: string): boolean {
  const content: LockFileContent = { token, pid: process.pid, startedAt: new Date().toISOString() };
  try {
    writeFileSync(lockFile, JSON.stringify(content), { encoding: "utf-8", flag: "wx" });
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "EEXIST") return false;
    throw err; // error real de fs (permisos/disco/etc.) — nunca se confunde con "ya existe"
  }
}

// Solo se llama tras confirmar isStale(). Best-effort: si otro proceso ya lo
// había liberado o renovado justo antes, unlinkSync puede fallar (ENOENT) o
// borrar una versión más nueva — el siguiente tryAcquireOnce() de todas
// formas decide con el sistema operativo, nunca se asume éxito de antemano.
function forceStealStaleLock(lockFile: string): void {
  try {
    unlinkSync(lockFile);
  } catch {
    // ya no estaba, o ya lo tomó otro — el próximo intento del bucle decide
  }
}

export type AcquireResult = { ok: true; token: string } | { ok: false; reason: string };

export type AcquireOptions = {
  lockFile?: string;
  staleMs?: number;
  pollIntervalMs?: number;
  timeoutMs?: number;
};

export async function acquireEpisodesFileLock(opts: AcquireOptions = {}): Promise<AcquireResult> {
  const lockFile = opts.lockFile ?? LOCK_FILE;
  const staleMs = opts.staleMs ?? EPISODES_LOCK_STALE_MS;
  const pollIntervalMs = opts.pollIntervalMs ?? EPISODES_LOCK_POLL_INTERVAL_MS;
  const timeoutMs = opts.timeoutMs ?? EPISODES_LOCK_ACQUIRE_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  const token = randomUUID();

  for (;;) {
    if (tryAcquireOnce(lockFile, token)) return { ok: true, token };

    if (isStale(lockFile, staleMs)) {
      forceStealStaleLock(lockFile);
      continue; // reintenta ya mismo, sin esperar el intervalo de polling
    }

    if (Date.now() >= deadline) {
      return { ok: false, reason: `no se pudo adquirir el lock de episodes.ts en ${timeoutMs}ms — otro worker lo sigue usando` };
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}

// Heartbeat: refresca el mtime del lock SIN alterar su contenido (mismo
// token/pid/startedAt) — igual que touchRunLock(). Si el archivo no existe, o
// el token ya no coincide (dejamos de ser el propietario, ej. porque
// expiramos y otro worker lo tomó), NO hace nada — best-effort, un fallo de
// heartbeat aislado nunca debe tumbar la sección crítica en curso.
function touchEpisodesFileLock(token: string, lockFile: string): void {
  const content = readLockContentSafe(lockFile);
  if (!content || content.token !== token) return;
  try {
    writeFileSync(lockFile, JSON.stringify(content), "utf-8");
  } catch {
    // best-effort
  }
}

// Libera el lock SOLO si el token coincide — NUNCA borra un lock ajeno,
// incluso si el PID "parece" el mismo o si el archivo simplemente existe.
export function releaseEpisodesFileLock(token: string, lockFile: string = LOCK_FILE): void {
  if (!existsSync(lockFile)) return;
  const content = readLockContentSafe(lockFile);
  if (!content || content.token !== token) return;
  try {
    unlinkSync(lockFile);
  } catch {
    // best-effort
  }
}

// Envuelve `fn` con adquisición+heartbeat+liberación garantizada (incluso si
// `fn` lanza) — mismo contrato que withEpisodesRegistryLock() (Día 1.1), pero
// cruzando procesos. Uso previsto en processOne.mts: anidado DENTRO de
// withEpisodesRegistryLock(), cubriendo exactamente nextChapterNumber() +
// registerEpisode() — nunca processProject() completo.
export async function withEpisodesFileLock<T>(fn: () => Promise<T>, opts: AcquireOptions = {}): Promise<T> {
  const lockFile = opts.lockFile ?? LOCK_FILE;
  const staleMs = opts.staleMs ?? EPISODES_LOCK_STALE_MS;
  const acquired = await acquireEpisodesFileLock({ ...opts, lockFile, staleMs });
  if (!acquired.ok) throw new Error(acquired.reason);

  const heartbeat = setInterval(() => touchEpisodesFileLock(acquired.token, lockFile), EPISODES_LOCK_HEARTBEAT_MS);
  try {
    return await fn();
  } finally {
    clearInterval(heartbeat);
    releaseEpisodesFileLock(acquired.token, lockFile);
  }
}

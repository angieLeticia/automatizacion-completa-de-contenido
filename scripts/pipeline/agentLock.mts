import { existsSync, rmSync } from "node:fs";
import { readJson, stateFilePath, writeJsonAtomic } from "./stateStore.mts";

// Lock de instancia única del agente de PRODUCCIÓN — completamente
// independiente del lock/estado del agente de publicación (agent/).
type LockInfo = { pid: number; startedAt: string };
const LOCK_PATH = stateFilePath("agent.lock");

// process.kill(pid, 0) no manda ninguna señal — solo prueba si el proceso
// existe y tenemos permiso sobre él. Confirmado que funciona en esta máquina
// Windows (PID propio -> true, PID inexistente -> ESRCH/false).
const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

export type AcquireResult = { acquired: true } | { acquired: false; heldBy: LockInfo };

// Nunca confía solamente en "el archivo existe" — si el lock apunta a un PID
// que ya no está vivo (el proceso murió sin liberar el lock, ej. crash), se
// considera huérfano y se puede tomar sin problema.
export const acquireLock = (): AcquireResult => {
  if (existsSync(LOCK_PATH)) {
    const info = readJson<LockInfo | null>(LOCK_PATH, null);
    if (info && info.pid !== process.pid && isAlive(info.pid)) {
      return { acquired: false, heldBy: info };
    }
  }
  writeJsonAtomic(LOCK_PATH, { pid: process.pid, startedAt: new Date().toISOString() } satisfies LockInfo);
  return { acquired: true };
};

export const releaseLock = (): void => {
  const info = readJson<LockInfo | null>(LOCK_PATH, null);
  if (info?.pid === process.pid) rmSync(LOCK_PATH, { force: true });
};

export const readLock = (): LockInfo | null => readJson<LockInfo | null>(LOCK_PATH, null);

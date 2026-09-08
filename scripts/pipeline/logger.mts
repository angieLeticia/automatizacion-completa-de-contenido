import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
const LOG_DIR = path.join(REPO_ROOT, "logs");

type Tag = "AGENT" | "WATCHER" | "QUEUE" | "WORKER" | "RECOVERY" | "ERROR";

const write = (tag: Tag, msg: string) => {
  const line = `[${new Date().toISOString()}] [${tag}] ${msg}`;
  if (tag === "ERROR") console.error(line);
  else console.log(line);
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    const file = path.join(LOG_DIR, `pipeline-${new Date().toISOString().slice(0, 10)}.log`);
    appendFileSync(file, line + "\n");
  } catch {
    // si no se puede escribir el log a disco, no tumbamos el agente por eso
  }
};

export const log = {
  agent: (msg: string) => write("AGENT", msg),
  watcher: (msg: string) => write("WATCHER", msg),
  queue: (msg: string) => write("QUEUE", msg),
  worker: (msg: string) => write("WORKER", msg),
  recovery: (msg: string) => write("RECOVERY", msg),
  error: (msg: string) => write("ERROR", msg),
};

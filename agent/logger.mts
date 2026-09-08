// Log estructurado a consola + archivo local (agent/logs/agent-YYYY-MM-DD.log).
// Sin dependencias nuevas — si escribir a disco falla, nunca debe tumbar al agente.
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const LOG_DIR = path.join(import.meta.dirname, "logs");
mkdirSync(LOG_DIR, { recursive: true });

type Level = "info" | "warn" | "error";

function write(level: Level, msg: string, meta?: Record<string, unknown>): void {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] [${level.toUpperCase()}] ${msg}${meta ? " " + JSON.stringify(meta) : ""}`;

  const method = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  method(line);

  try {
    appendFileSync(path.join(LOG_DIR, `agent-${timestamp.slice(0, 10)}.log`), line + "\n");
  } catch {
    // sin permisos de escritura, disco lleno, etc. — no es motivo para detener el agente
  }
}

export const log = {
  info: (msg: string, meta?: Record<string, unknown>) => write("info", msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => write("warn", msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => write("error", msg, meta),
};

// Idempotencia del Inbox: si el mismo submission_checksum ya fue procesado
// (el watcher lo detectó dos veces, el proceso se reinició, se re-escaneó la
// carpeta), no se vuelve a materializar. NO es una cola — es un registro
// insert-only de "esto ya se procesó", mismo espíritu que
// scripts/pipeline/fileRegistry.mts (hash -> record), pero copiado, no
// importado, por la misma razón de desacople ya establecida en el proyecto.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

export type SubmissionRecord = { submissionId: string; channel: string; episodeId: string; processedAt: string };
type Registry = Record<string, SubmissionRecord>; // submission_checksum -> record

// registryPath es explícito (no un default global oculto) para que los
// tests locales nunca puedan tocar por accidente el registro real del
// Inbox de producción — ver test-manifest-validation.mts.
export const defaultRegistryPath = (stateDir: string): string => path.join(stateDir, "submissions.json");

function readRegistry(registryPath: string): Registry {
  if (!existsSync(registryPath)) return {};
  try {
    return JSON.parse(readFileSync(registryPath, "utf-8")) as Registry;
  } catch {
    return {}; // JSON corrupto: se trata como vacío en vez de tumbar la ingesta
  }
}

function writeRegistry(registryPath: string, registry: Registry): void {
  mkdirSync(path.dirname(registryPath), { recursive: true });
  const tmp = `${registryPath}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(registry, null, 2) + "\n");
  renameSync(tmp, registryPath); // rename en el mismo volumen es atómico
}

export function isAlreadyProcessed(registryPath: string, submissionChecksum: string): boolean {
  return submissionChecksum in readRegistry(registryPath);
}

export function markProcessed(registryPath: string, submissionChecksum: string, record: SubmissionRecord): void {
  const registry = readRegistry(registryPath);
  registry[submissionChecksum] = record;
  writeRegistry(registryPath, registry);
}

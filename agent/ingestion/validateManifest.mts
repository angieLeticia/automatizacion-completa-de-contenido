// Valida un manifest.json ANTES de que cualquier cosa lo procese. Si es
// inválido, incompleto, o tiene un hash que no coincide: NO PROCESAR (ver
// docs/system-contracts.md §3). Nunca inventa fuentes, nunca descarga nada —
// solo verifica lo que la submission ya declara contra lo que existe
// realmente en disco.
import { existsSync, statSync } from "node:fs";
import { hashFile } from "./hashFile.mts";
import { resolveSafeSubmissionPath } from "./pathSafety.mts";
import type { ContentSubmission, ManifestFile } from "./types.mts";

export type ValidationResult =
  | { status: "VALID"; submission: ContentSubmission }
  | { status: "INVALID"; reason: string }
  | { status: "INCOMPLETE"; reason: string; missingFile: string }
  | { status: "INVALID_HASH"; reason: string; file: string; expected: string; actual: string };

const VALID_KINDS = new Set(["video", "image", "audio", "script", "reference"]);

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

// Solo la forma del manifest — no toca el filesystem. Separado de la
// verificación de archivos para poder reportar INVALID sin siquiera intentar
// leer disco (Caso B: manifest sin submission_id).
function validateShape(raw: unknown): { ok: true; value: ContentSubmission } | { ok: false; reason: string } {
  if (typeof raw !== "object" || raw === null) {
    return { ok: false, reason: "el manifest no es un objeto JSON válido" };
  }
  const m = raw as Record<string, unknown>;

  if (!isNonEmptyString(m.submission_id)) return { ok: false, reason: "falta submission_id" };
  if (!isNonEmptyString(m.channel)) return { ok: false, reason: "falta channel" };
  if (!isNonEmptyString(m.submission_checksum)) return { ok: false, reason: "falta submission_checksum" };
  if (typeof m.schema_version !== "number") return { ok: false, reason: "falta schema_version (número)" };
  if (!Array.isArray(m.files) || m.files.length === 0) {
    return { ok: false, reason: "files debe ser un array no vacío" };
  }

  for (const [i, f] of (m.files as unknown[]).entries()) {
    if (typeof f !== "object" || f === null) return { ok: false, reason: `files[${i}] no es un objeto` };
    const file = f as Record<string, unknown>;
    if (!VALID_KINDS.has(file.kind as string)) return { ok: false, reason: `files[${i}].kind inválido` };
    if (!isNonEmptyString(file.path)) return { ok: false, reason: `files[${i}].path faltante` };
    if (!isNonEmptyString(file.sha256)) return { ok: false, reason: `files[${i}].sha256 faltante` };
  }

  if (m.episode_id !== undefined && !isNonEmptyString(m.episode_id)) {
    return { ok: false, reason: "episode_id, si está presente, debe ser un string no vacío" };
  }

  return { ok: true, value: m as unknown as ContentSubmission };
}

export async function validateManifest(submissionRoot: string, raw: unknown): Promise<ValidationResult> {
  const shape = validateShape(raw);
  if (!shape.ok) return { status: "INVALID", reason: shape.reason };

  const submission = shape.value;

  for (const file of submission.files as ManifestFile[]) {
    const resolved = resolveSafeSubmissionPath(submissionRoot, file.path);
    if (!resolved) {
      return { status: "INVALID", reason: `ruta insegura o fuera del Inbox: "${file.path}"` };
    }
    if (!existsSync(resolved) || !statSync(resolved).isFile()) {
      return { status: "INCOMPLETE", reason: `archivo declarado no existe: ${file.path}`, missingFile: file.path };
    }
    const actual = await hashFile(resolved);
    if (actual !== file.sha256) {
      return {
        status: "INVALID_HASH",
        reason: `hash no coincide para ${file.path}`,
        file: file.path,
        expected: file.sha256,
        actual,
      };
    }
  }

  return { status: "VALID", submission };
}

// Pruebas reales y controladas del contrato de Ingesta (Fase 4.3). NO es un
// framework de tests (el proyecto no tiene uno) — sigue el MISMO patrón
// ad-hoc ya establecido en scripts/pipeline/test-authorization-gate.mts:
// archivos temporales reales, asserts explícitos, sin mocks.
//
// SEGURIDAD: requiere MATERIAL_ROOT e INBOX_ROOT apuntando a carpetas
// temporales (NUNCA D:\MATERIAL VIDEOS ni el INBOX real), seteadas en el
// entorno ANTES de invocar tsx — mismo motivo que el test de autorización:
// en ES modules los imports se evalúan antes que el código del propio
// archivo, así que fijar process.env aquí dentro llegaría tarde.
//
// Uso:
//   MATERIAL_ROOT="C:\...\tmp\material" INBOX_ROOT="C:\...\tmp\inbox" \
//     npx tsx agent/ingestion/test-manifest-validation.mts
// (el script auxiliar run-tests.mjs de esta misma carpeta arma las rutas
// temporales y hace esta invocación por vos — ver más abajo).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { MATERIAL_ROOT, INBOX_ROOT } from "./config.mts";
import { validateManifest } from "./validateManifest.mts";
import { resolveSafeSubmissionPath } from "./pathSafety.mts";
import { isAlreadyProcessed, markProcessed, defaultRegistryPath } from "./submissionRegistry.mts";
import { FsInboxContentProvider } from "./contentProvider.mts";

let failures = 0;
const check = (label: string, cond: boolean, extra = "") => {
  const mark = cond ? "PASS" : "FAIL";
  if (!cond) failures++;
  console.log(`[${mark}] ${label}${extra ? " — " + extra : ""}`);
};

function assertTestEnv() {
  if (!/test/i.test(MATERIAL_ROOT) || !/test/i.test(INBOX_ROOT)) {
    throw new Error(
      `MATERIAL_ROOT ("${MATERIAL_ROOT}") o INBOX_ROOT ("${INBOX_ROOT}") no parecen carpetas de prueba — abortando. ` +
        `Seteá ambas variables a carpetas temporales ANTES de invocar tsx.`
    );
  }
}

const sha256 = (content: string) => createHash("sha256").update(content).digest("hex");

function writeSubmissionFile(submissionDir: string, relPath: string, content: string): string {
  const full = path.join(submissionDir, relPath);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, content);
  return content;
}

async function main() {
  assertTestEnv();
  rmSync(MATERIAL_ROOT, { recursive: true, force: true });
  rmSync(INBOX_ROOT, { recursive: true, force: true });
  mkdirSync(MATERIAL_ROOT, { recursive: true });
  mkdirSync(INBOX_ROOT, { recursive: true });
  const stateDir = mkdtempSync(path.join(tmpdir(), "ingestion-state-"));

  // ---- Caso A: manifest válido ----
  {
    const dir = path.join(INBOX_ROOT, "sub-a");
    mkdirSync(dir, { recursive: true });
    const scriptContent = writeSubmissionFile(dir, "Guion.md", "# Guion\nHola.");
    const imgContent = writeSubmissionFile(dir, "Imagenes/01.jpg", "fake-jpg-bytes");
    const manifest = {
      submission_id: "sub-a",
      channel: "TESTCHANNEL",
      episode_id: "901",
      submission_checksum: "checksum-a",
      schema_version: 1,
      files: [
        { kind: "script", path: "Guion.md", sha256: sha256(scriptContent) },
        { kind: "image", path: "Imagenes/01.jpg", sha256: sha256(imgContent) },
      ],
    };
    const result = await validateManifest(dir, manifest);
    check("Caso A — Manifest válido: VALID", result.status === "VALID", result.status);
  }

  // ---- Caso B: manifest sin submission_id ----
  {
    const dir = path.join(INBOX_ROOT, "sub-b");
    mkdirSync(dir, { recursive: true });
    const manifest = {
      channel: "TESTCHANNEL",
      submission_checksum: "checksum-b",
      schema_version: 1,
      files: [{ kind: "script", path: "Guion.md", sha256: "deadbeef" }],
    };
    const result = await validateManifest(dir, manifest);
    check("Caso B — Manifest sin submission_id: INVALID", result.status === "INVALID", result.status);
  }

  // ---- Caso C: archivo declarado pero inexistente ----
  {
    const dir = path.join(INBOX_ROOT, "sub-c");
    mkdirSync(dir, { recursive: true });
    const manifest = {
      submission_id: "sub-c",
      channel: "TESTCHANNEL",
      submission_checksum: "checksum-c",
      schema_version: 1,
      files: [{ kind: "script", path: "Guion.md", sha256: "deadbeef" }],
    };
    const result = await validateManifest(dir, manifest);
    check("Caso C — Archivo inexistente: INCOMPLETE", result.status === "INCOMPLETE", result.status);
  }

  // ---- Caso D: hash declarado distinto al real ----
  {
    const dir = path.join(INBOX_ROOT, "sub-d");
    mkdirSync(dir, { recursive: true });
    writeSubmissionFile(dir, "Guion.md", "# Guion\nContenido real.");
    const manifest = {
      submission_id: "sub-d",
      channel: "TESTCHANNEL",
      submission_checksum: "checksum-d",
      schema_version: 1,
      files: [{ kind: "script", path: "Guion.md", sha256: "0".repeat(64) }],
    };
    const result = await validateManifest(dir, manifest);
    check("Caso D — Hash incorrecto: INVALID_HASH", result.status === "INVALID_HASH", result.status);
  }

  // ---- Path traversal: ruta declarada fuera de la submission ----
  {
    const dir = path.join(INBOX_ROOT, "sub-traversal");
    mkdirSync(dir, { recursive: true });
    const manifest = {
      submission_id: "sub-traversal",
      channel: "TESTCHANNEL",
      submission_checksum: "checksum-traversal",
      schema_version: 1,
      files: [{ kind: "script", path: "../../../etc/passwd", sha256: "deadbeef" }],
    };
    const result = await validateManifest(dir, manifest);
    check("Path traversal (../ en manifest): INVALID", result.status === "INVALID", result.status);

    const direct = resolveSafeSubmissionPath(dir, "..\\..\\evil.txt");
    check("pathSafety rechaza ruta absoluta/UNC/backslash traversal", direct === null);
    const winAbs = resolveSafeSubmissionPath(dir, "C:\\Windows\\System32\\evil.txt");
    check("pathSafety rechaza ruta absoluta con letra de unidad", winAbs === null);
  }

  // ---- Caso E: idempotencia — misma submission procesada dos veces ----
  {
    const dir = path.join(INBOX_ROOT, "sub-e");
    mkdirSync(dir, { recursive: true });
    const scriptContent = writeSubmissionFile(dir, "Guion.md", "# Guion E\nIdempotencia.");
    const manifest = {
      submission_id: "sub-e",
      channel: "TESTCHANNEL",
      episode_id: "902",
      submission_checksum: "checksum-e",
      schema_version: 1,
      files: [{ kind: "script", path: "Guion.md", sha256: sha256(scriptContent) }],
    };
    writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));

    const provider = new FsInboxContentProvider(INBOX_ROOT, stateDir);
    const run1 = await provider.listReadyPackages();
    const foundFirstRun = run1.packages.some((p) => p.manifest.submission_id === "sub-e");
    check("Caso E — primera pasada procesa sub-e", foundFirstRun);

    const run2 = await provider.listReadyPackages();
    const foundSecondRun = run2.packages.some((p) => p.manifest.submission_id === "sub-e");
    const skippedSecondRun = run2.skipped.some((s) => s.folder.endsWith("sub-e"));
    check("Caso E — segunda pasada NO reprocesa (IDEMPOTENT)", !foundSecondRun && skippedSecondRun);

    check(
      "Caso E — registro de idempotencia detecta el checksum directamente",
      isAlreadyProcessed(defaultRegistryPath(stateDir), "checksum-e")
    );
  }

  // ---- Caso F: dos episodios distintos, sin colisión ----
  {
    const mkSub = (name: string, episodeId: string, checksum: string, text: string) => {
      const dir = path.join(INBOX_ROOT, name);
      mkdirSync(dir, { recursive: true });
      const content = writeSubmissionFile(dir, "Guion.md", text);
      const manifest = {
        submission_id: name,
        channel: "TESTCHANNEL",
        episode_id: episodeId,
        submission_checksum: checksum,
        schema_version: 1,
        files: [{ kind: "script", path: "Guion.md", sha256: sha256(content) }],
      };
      writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
    };
    mkSub("sub-f1", "903", "checksum-f1", "# Episodio 903");
    mkSub("sub-f2", "904", "checksum-f2", "# Episodio 904");

    const provider = new FsInboxContentProvider(INBOX_ROOT, stateDir);
    const run = await provider.listReadyPackages();
    const p1 = run.packages.find((p) => p.manifest.submission_id === "sub-f1");
    const p2 = run.packages.find((p) => p.manifest.submission_id === "sub-f2");
    check("Caso F — ambos episodios se procesaron", Boolean(p1 && p2));
    check(
      "Caso F — NO_COLLISION: episode_id distintos y carpetas distintas",
      Boolean(p1 && p2 && p1.episodeId !== p2.episodeId && p1.files.folder !== p2.files.folder)
    );
  }

  console.log(`\n${failures === 0 ? "TODOS LOS CASOS PASARON" : `${failures} CASO(S) FALLARON`}`);

  rmSync(MATERIAL_ROOT, { recursive: true, force: true });
  rmSync(INBOX_ROOT, { recursive: true, force: true });
  rmSync(stateDir, { recursive: true, force: true });

  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Fallo fatal en tests de ingestión:", err);
  process.exit(1);
});

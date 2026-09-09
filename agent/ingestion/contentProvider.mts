// Fachada delgada sobre el scanner/completeness YA EXISTENTE de Agente 2.
// ContentProvider NO renderiza, NO publica, NO investiga, NO administra
// credenciales, NO toca estados de publicación. Su única responsabilidad:
// leer submissions del Inbox, validarlas, materializarlas en la convención
// de carpetas que Agente 2 ya sabe escanear, y devolver el resultado.
//
// PUNTO DE INTEGRACIÓN CON AGENTE 2 (documentado explícitamente, no
// automatizado todavía): materializar archivos en MATERIAL_ROOT es exactamente
// lo mismo que ya ocurre hoy manualmente. El watcher de scripts/pipeline/agent.mts
// (chokidar) los detecta solo, sin ningún cambio de código de este módulo.
// Esta función NO llama a decideEnqueue(), NO toca el lock, NO autoriza nada —
// la autorización de render sigue siendo 100% manual (`npm run pipeline:authorize`),
// exactamente igual que antes de que existiera el Inbox.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { scanEpisode, listEpisodeFolders } from "../../scripts/pipeline/materialScanner.mts";
import { checkCompleteness } from "../../scripts/pipeline/completenessChecker.mts";
import { EPISODE_FOLDER_RE, NARRATION_FILE_RE, MATERIAL_ROOT as PIPELINE_MATERIAL_ROOT } from "../../scripts/pipeline/config.mts";
import { validateManifest, type ValidationResult } from "./validateManifest.mts";
import { isAlreadyProcessed, markProcessed, defaultRegistryPath } from "./submissionRegistry.mts";
import { MANIFEST_FILENAME } from "./config.mts";
import type { ManifestFile } from "./types.mts";
import type { ContentPackage } from "./contentPackage.mts";

export interface ContentProvider {
  listReadyPackages(): Promise<IngestionRunResult>;
}

export interface IngestionRunResult {
  packages: ContentPackage[];
  rejected: Array<{ folder: string; result: Exclude<ValidationResult, { status: "VALID" }> }>;
  skipped: Array<{ folder: string; reason: string }>;
}

// Destino dentro del episodio, replicando exactamente la convención que
// scripts/pipeline/materialScanner.mts ya sabe escanear (Guion*.md en la
// raíz, Imagenes/, Sonidos/, Videos/). "reference" no es material de
// pipeline (Agente 2 no lo escanea) — queda como evidencia en
// Videos_Referencia/, igual que ya hacen los episodios reales.
function destinationFor(episodeFolder: string, file: ManifestFile, originalBasename: string): string {
  switch (file.kind) {
    case "script": {
      const looksLikeGuion = /^guion/i.test(originalBasename) && path.extname(originalBasename).toLowerCase() === ".md";
      return path.join(episodeFolder, looksLikeGuion ? originalBasename : "Guion.md");
    }
    case "image":
      return path.join(episodeFolder, "Imagenes", originalBasename);
    case "audio": {
      // Fase 5.1 — mismo patrón ya usado arriba para "script": la narración
      // (Narracion*.mp3|wav, Voz*.mp3|wav — scanEpisode la busca en la RAÍZ del
      // episodio, nunca en Sonidos/) necesita distinguirse del audio ambiental/
      // SFX genérico, que sí va en Sonidos/. Sin este caso especial, una
      // narración real ingresada por el Inbox nunca la encuentra scanEpisode()
      // y processProject() intenta generar una nueva vía ElevenLabs de más,
      // aunque la narración real ya exista.
      const looksLikeNarration = NARRATION_FILE_RE.test(originalBasename);
      return looksLikeNarration ? path.join(episodeFolder, originalBasename) : path.join(episodeFolder, "Sonidos", originalBasename);
    }
    case "video":
      return path.join(episodeFolder, "Videos", originalBasename);
    case "reference":
      return path.join(episodeFolder, "Videos_Referencia", originalBasename);
  }
}

// listEpisodeFolders() ya usa MATERIAL_ROOT internamente (mismo módulo
// scripts/pipeline/materialScanner.mts importado arriba) y ya filtra por
// EPISODE_FOLDER_RE — el filtro explícito de abajo es solo defensivo.
function nextFreeEpisodeId(channel: string): string {
  const existing = listEpisodeFolders(channel).filter((n) => EPISODE_FOLDER_RE.test(n));
  const max = existing.reduce((acc, n) => Math.max(acc, parseInt(n, 10) || 0), 0);
  return String(max + 1).padStart(3, "0");
}

export class FsInboxContentProvider implements ContentProvider {
  // NO recibe materialRoot como parámetro: scanEpisode()/listEpisodeFolders()
  // (importados arriba) ya usan MATERIAL_ROOT de scripts/pipeline/config.mts
  // internamente — inyectar uno distinto aquí crearía una ruta de escritura
  // distinta a la que Agente 2 realmente escanea. Para tests: setear
  // process.env.MATERIAL_ROOT ANTES de importar este módulo (mismo patrón
  // que scripts/pipeline/test-authorization-gate.mts).
  constructor(
    private readonly inboxRoot: string,
    private readonly stateDir: string,
    private readonly sourceOrigin: "human" | "research-agent" = "human"
  ) {}

  async listReadyPackages(): Promise<IngestionRunResult> {
    const result: IngestionRunResult = { packages: [], rejected: [], skipped: [] };
    if (!existsSync(this.inboxRoot)) return result;

    const submissionFolders = readdirSync(this.inboxRoot, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => path.join(this.inboxRoot, e.name));

    for (const folder of submissionFolders) {
      const manifestPath = path.join(folder, MANIFEST_FILENAME);
      if (!existsSync(manifestPath)) {
        result.skipped.push({ folder, reason: `no hay ${MANIFEST_FILENAME}` });
        continue;
      }

      let raw: unknown;
      try {
        raw = JSON.parse(readFileSync(manifestPath, "utf-8"));
      } catch {
        result.rejected.push({ folder, result: { status: "INVALID", reason: "manifest.json no es JSON válido" } });
        continue;
      }

      const validation = await validateManifest(folder, raw);
      if (validation.status !== "VALID") {
        result.rejected.push({ folder, result: validation });
        continue;
      }

      const submission = validation.submission;
      const registryPath = defaultRegistryPath(this.stateDir);
      if (isAlreadyProcessed(registryPath, submission.submission_checksum)) {
        result.skipped.push({ folder, reason: `submission_checksum ya procesado: ${submission.submission_checksum}` });
        continue;
      }

      const episodeId = submission.episode_id ?? nextFreeEpisodeId(submission.channel);
      const episodeFolder = path.join(PIPELINE_MATERIAL_ROOT, submission.channel, episodeId);
      mkdirSync(episodeFolder, { recursive: true });

      for (const file of submission.files) {
        const src = path.join(folder, file.path);
        const basename = path.basename(file.path);
        const dest = destinationFor(episodeFolder, file, basename);
        mkdirSync(path.dirname(dest), { recursive: true });
        copyFileSync(src, dest);
      }

      const files = scanEpisode(submission.channel, episodeId);
      const completeness = checkCompleteness(files);

      markProcessed(registryPath, submission.submission_checksum, {
        submissionId: submission.submission_id,
        channel: submission.channel,
        episodeId,
        processedAt: new Date().toISOString(),
      });

      result.packages.push({
        channel: submission.channel,
        episodeId,
        files,
        completeness,
        manifest: submission,
        sourceOrigin: this.sourceOrigin,
      });
    }

    return result;
  }
}

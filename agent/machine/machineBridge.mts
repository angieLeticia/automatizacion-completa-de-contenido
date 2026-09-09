// Implementación real de filesystem/health del MachineBridge (Fase 4.4).
// media/render se implementan en mediaBridge.mts/renderBridge.mts (Fase 4.5,
// ver más abajo). localAI queda sin instanciar (ver types.mts) — fuera de
// alcance de la Fase 4.5.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { isExecutableOnPath } from "./isExecutableOnPath.mts";
// Reutilizado por instrucción explícita de la Fase 4.4 (no duplicado, a
// diferencia de hashFile/pathSafety en otros módulos): la lógica de
// resolución segura de rutas es exactamente la misma que necesita cualquier
// operación de filesystem acotada a una raíz, sea una submission de Ingesta
// o MATERIAL_ROOT. El nombre de la función es específico de su origen
// (Ingesta) pero su contrato (root, relPath) -> ruta segura o null es general.
import { resolveSafeSubmissionPath as resolveSafePath } from "../ingestion/pathSafety.mts";
import { hashFile as hashFileImpl } from "./hashFile.mts";
import type { FilesystemBridge, HealthBridge, MachineBridge } from "./types.mts";

export class PathViolationError extends Error {
  constructor(root: string, relPath: string) {
    super(`Ruta fuera de la raíz permitida: root="${root}" relPath="${relPath}"`);
  }
}

function requireSafePath(root: string, relPath: string): string {
  const resolved = resolveSafePath(root, relPath);
  if (!resolved) throw new PathViolationError(root, relPath);
  return resolved;
}

export const filesystemBridge: FilesystemBridge = {
  async hashFile(root, relPath) {
    return hashFileImpl(requireSafePath(root, relPath));
  },
  async readFile(root, relPath) {
    return readFileSync(requireSafePath(root, relPath));
  },
  async writeFile(root, relPath, data) {
    const dest = requireSafePath(root, relPath);
    mkdirSync(path.dirname(dest), { recursive: true });
    writeFileSync(dest, data);
  },
  async exists(root, relPath) {
    const resolved = resolveSafePath(root, relPath);
    return resolved !== null && existsSync(resolved);
  },
};

// Comprobación de existencia, NUNCA de contenido. ffmpeg/ffprobe SÍ soportan
// "-version" y correrlo confirma que el binario realmente arranca (no solo
// que un archivo con ese nombre existe) — igual que checkBinary() en
// agent/analyze/checkEnvironment.mts. whisper NO tiene ninguna forma segura
// de invocarse sin argumentos reales (verificado: "whisper -version" y
// cualquier flag desconocido salen con "error: the following arguments are
// required: audio", exit code 2) — por eso, para whisper específicamente,
// se reutiliza la MISMA estrategia que ya existe en
// agent/analyze/checkEnvironment.mts::isExecutableOnPath(): escanear PATH +
// PATHEXT sin ejecutar el binario. No es una inconsistencia del Bridge, es
// el mismo motivo por el que el código original ya lo hacía así.
function checkBinaryVersion(name: string): boolean {
  try {
    execFileSync(name, ["-version"], { stdio: "ignore", timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

export const healthBridge: HealthBridge = {
  async checkToolAvailable(tool) {
    if (tool === "whisper") return isExecutableOnPath("whisper");
    return checkBinaryVersion(tool);
  },
  async checkOllamaReachable(baseUrl) {
    // Misma restricción que assertOllamaUrlIsLocal() en
    // agent/analyze/config.mts: rechaza cualquier baseUrl que no sea
    // localhost/127.0.0.1, por seguridad — MachineBridge no la relaja.
    let url: URL;
    try {
      url = new URL(baseUrl);
    } catch {
      return false;
    }
    if (url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
      throw new Error(`baseUrl="${baseUrl}" no es localhost — rechazado por seguridad.`);
    }
    try {
      const res = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(3_000) });
      return res.ok;
    } catch {
      return false;
    }
  },
};

// Fase 4.5 — importados acá (no arriba del archivo) porque mediaBridge.mts y
// renderBridge.mts importan PathViolationError desde este mismo archivo; el
// ciclo resultante es seguro porque ambos solo usan esa clase dentro de
// funciones (en tiempo de llamada, no de carga del módulo) — no en su propio
// nivel superior.
import { mediaBridge } from "./mediaBridge.mts";
import { renderBridge } from "./renderBridge.mts";

export const machineBridge: MachineBridge = {
  filesystem: filesystemBridge,
  health: healthBridge,
  media: mediaBridge,
  render: renderBridge,
  // localAI: intencionalmente ausente — fuera de alcance de la Fase 4.5, ver types.mts
};

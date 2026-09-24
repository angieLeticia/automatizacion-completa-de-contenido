// Fase 3.3 (aislamiento dirigido de Agent 1, etapa de registro) — mismo patron
// ya usado por agent/schedule/targetSelection.mts y
// agent/publish/targetPostSelection.mts: vive en su propio archivo, sin
// ningun import de supabaseClient.mts ni de node:fs, para poder probar la
// decision pura sin conexion real ni acceso a disco.
//
// AGENT1_FILE_PATH es OPCIONAL: ausente (o vacio) conserva el comportamiento
// GLOBAL de siempre (chokidar.watch sobre todo MATERIAL_ROOT), sin ninguna
// rama nueva ejecutandose. Presente -> modo "directed" - la validacion de
// contencion puede bloquear, pero JAMAS degrada de vuelta a "vigila todo
// MATERIAL_ROOT".
import path from "node:path";

export type WatchMode = { mode: "global" } | { mode: "directed"; filePath: string };

function readNonEmpty(value: string | undefined): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

export function resolveWatchMode(env: NodeJS.ProcessEnv): WatchMode {
  const filePath = readNonEmpty(env.AGENT1_FILE_PATH);
  if (!filePath) return { mode: "global" };
  return { mode: "directed", filePath };
}

export type ContainmentResult = { ok: true } | { ok: false; reason: string };

// Pura - solo aritmetica de rutas (path.relative/path.isAbsolute), sin tocar
// el filesystem. Bloquea si: la ruta no es absoluta, la ruta es MATERIAL_ROOT
// misma, o path.relative() produce ".." al inicio o una ruta absoluta (ambos
// casos indican que filePath queda fuera del arbol de MATERIAL_ROOT).
export function checkContainment(filePath: string, materialRoot: string): ContainmentResult {
  if (!path.isAbsolute(filePath)) {
    return { ok: false, reason: `AGENT1_FILE_PATH debe ser una ruta absoluta - recibido: '${filePath}'.` };
  }
  const rel = path.relative(materialRoot, filePath);
  if (rel === "") {
    return { ok: false, reason: "AGENT1_FILE_PATH es MATERIAL_ROOT mismo, no un archivo dentro de el - bloqueado." };
  }
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    return { ok: false, reason: `AGENT1_FILE_PATH queda fuera de MATERIAL_ROOT ('${materialRoot}') - bloqueado.` };
  }
  return { ok: true };
}

// Fase 3.3 (punto E del diseño) — comparacion PURA de dos lecturas de
// fs.stat separadas en el tiempo, mismo criterio (tamaño + mtime) que ya usa
// chokidar/awaitWriteFinish para el modo global, sin inventar una politica de
// estabilidad nueva. La espera/lectura real (IO) vive en agent/run.mts - esta
// funcion solo compara dos snapshots ya obtenidos.
export interface FileSnapshot {
  size: number;
  mtimeMs: number;
}

export function isStable(before: FileSnapshot, after: FileSnapshot): boolean {
  return before.size === after.size && before.mtimeMs === after.mtimeMs;
}

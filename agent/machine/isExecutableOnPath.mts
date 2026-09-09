// Copiado (no importado) de agent/analyze/checkEnvironment.mts — misma
// convención de desacople ya establecida en el proyecto para utilidades
// pequeñas entre módulos. Necesario porque whisper no tiene ninguna forma
// segura de invocarse sin argumentos reales (ver machineBridge.mts).
import { existsSync } from "node:fs";
import path from "node:path";

export function isExecutableOnPath(baseName: string): boolean {
  const dirs = (process.env.PATH ?? process.env.Path ?? "").split(path.delimiter).filter(Boolean);
  const exts = (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";").filter(Boolean);
  for (const dir of dirs) {
    if (existsSync(path.join(dir, baseName))) return true;
    for (const ext of exts) {
      if (existsSync(path.join(dir, baseName + ext.toLowerCase()))) return true;
      if (existsSync(path.join(dir, baseName + ext))) return true;
    }
  }
  return false;
}

// Resuelve una ruta declarada en un manifest.json SIEMPRE relativa a la
// carpeta de esa submission — nunca permite escapar de ella. Rechaza rutas
// absolutas y cualquier ".." que termine fuera de la carpeta, sin importar
// cuántos niveles de indirección use (path.resolve ya colapsa "a/../../b").
import path from "node:path";

export function resolveSafeSubmissionPath(submissionRoot: string, declaredPath: string): string | null {
  if (typeof declaredPath !== "string" || declaredPath.trim() === "") return null;
  if (path.isAbsolute(declaredPath)) return null;
  // Rutas estilo Windows con letra de unidad ("C:\...") que path.isAbsolute
  // en POSIX no siempre detecta — se rechazan explícitamente.
  if (/^[a-zA-Z]:[\\/]/.test(declaredPath)) return null;

  const root = path.resolve(submissionRoot);
  const resolved = path.resolve(root, declaredPath);
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;

  if (resolved !== root && !resolved.startsWith(rootWithSep)) return null;
  return resolved;
}

// Recalcula el SHA-256 REAL del archivo en disco y lo compara contra
// content_files.file_hash (el que calculo el watcher de la Fase 2 al detectarlo).
// Esto cierra un hueco de integridad: hasta ahora se confiaba ciegamente en el
// hash guardado en la fila; aqui se vuelve a calcular desde el archivo fisico.
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

export function computeSha256(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

export async function verifyFileHash(filePath: string, expectedHash: string): Promise<{ ok: true } | { ok: false; actualHash: string }> {
  const actualHash = await computeSha256(filePath);
  if (actualHash === expectedHash) return { ok: true };
  return { ok: false, actualHash };
}

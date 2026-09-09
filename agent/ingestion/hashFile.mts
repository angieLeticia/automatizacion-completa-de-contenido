// SHA-256 en streaming. Mismo patrón que agent/hashFile.mts y
// scripts/pipeline/fileHash.mts, copiado (no importado) — convención ya
// establecida en el proyecto para mantener cada agente desacoplado de los
// demás (ver comentario en scripts/pipeline/fileHash.mts).
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

export function hashFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

// SHA-256 en streaming. Copiado (no importado) — misma convención de
// desacople ya establecida en el proyecto (ver scripts/pipeline/fileHash.mts).
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

// SHA-256 en streaming — nunca carga el archivo completo en memoria (importante
// para videos de varios cientos de MB). Mismo patrón que agent/hashFile.mts,
// copiado (no importado) para mantener los dos agentes desacoplados.
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

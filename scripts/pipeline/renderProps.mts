// FASE 6.5 — soporte de `--props` para renderer.mts. Módulo pequeño y
// testeable por separado (ver test-renderer-props.mts): sabe (a) rechazar un
// objeto de props que contenga un campo con nombre de credencial ANTES de
// escribir nada a disco (fail-closed, nunca "redaction" — no se intenta
// limpiar el campo, se rechaza el render), y (b) serializarlo a un archivo
// JSON temporal seguro para pasarlo a Remotion como --props=<archivo>, nunca
// interpolado directo en la línea de comandos.
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export class PropsSecretDetectedError extends Error {
  constructor(keyPath: string) {
    super(
      `Los props de render contienen un campo cuyo nombre parece una credencial ("${keyPath}") — ` +
        `rechazado antes de escribir el archivo temporal. Si es un falso positivo, renombra el campo.`
    );
  }
}

// Solo revisa NOMBRES de campo, nunca valores — evita una función de
// "redaction" grande (fuera de alcance, pedido explícitamente no hacer) y
// cubre exactamente la lista de campos sensibles reales que puede traer un
// ChaosEpisodeConfig/EpisodeConfig por error: tokens, refresh tokens, client
// secrets, cookies, passwords, headers de autorización.
const SUSPICIOUS_KEY = /token|secret|passw(or)?d|api[_-]?key|authorization|cookie/i;

function assertNoSecretKeys(value: unknown, keyPath: string): void {
  if (value === null || typeof value !== "object") return;
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (SUSPICIOUS_KEY.test(key)) throw new PropsSecretDetectedError(`${keyPath}.${key}`);
    assertNoSecretKeys(val, `${keyPath}.${key}`);
  }
}

export function assertPropsHaveNoObviousSecrets(props: unknown): void {
  assertNoSecretKeys(props, "props");
}

// Directorio temporal DEDICADO vía mkdtemp (único garantizado por el SO —
// nunca sobrescribe nada existente), bajo os.tmpdir() — nunca dentro de
// D:\MATERIAL VIDEOS ni del repo. Mismo patrón ya usado por
// voiceGenerator.mts/transcriber.mts para temporales de este pipeline. El
// caller (renderer.mts) es responsable de invocar cleanup() en su propio
// try/finally, alrededor del proceso hijo real de `npx remotion render`.
export function writePropsTempFile(props: unknown): { propsFilePath: string; cleanup: () => void } {
  assertPropsHaveNoObviousSecrets(props);
  const dir = mkdtempSync(path.join(tmpdir(), "remotion-props-"));
  const propsFilePath = path.join(dir, "props.json");
  writeFileSync(propsFilePath, JSON.stringify(props, null, 2), "utf-8");
  return { propsFilePath, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

// Comprobaciones de arranque, propias de la Fase 3 (no reutiliza las de agent/run.mts
// de la Fase 2, para mantener el modulo de analisis completamente autonomo).
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { OLLAMA_BASE_URL, OLLAMA_MODEL, assertOllamaUrlIsLocal } from "./config.mts";

function checkBinary(name: string, arg: string): void {
  try {
    execFileSync(name, [arg], { stdio: "ignore" });
  } catch {
    throw new Error(`'${name}' no esta disponible en el PATH - es necesario para la Fase 3.`);
  }
}

// No se invoca "whisper --help" ni ninguna variante: en esta PC (y en general con
// el CLI de openai-whisper sobre la consola de Windows/cp1252) imprimir la ayuda
// completa puede lanzar un UnicodeEncodeError por un caracter no representable en
// cp1252 dentro de la lista de idiomas soportados - un fallo de la herramienta al
// imprimir texto, no una senal real de que falte el ejecutable. Por eso aqui solo
// se comprueba su EXISTENCIA en el PATH, sin ejecutarlo.
function isExecutableOnPath(baseName: string): boolean {
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

export async function assertAnalysisToolsAvailable(): Promise<void> {
  checkBinary("ffmpeg", "-version");
  checkBinary("ffprobe", "-version");
  if (!isExecutableOnPath("whisper")) {
    throw new Error("'whisper' no esta disponible en el PATH - es necesario para la Fase 3.");
  }

  // Salvaguarda de seguridad: nunca arrancar si LLM_PROVIDER="local" apuntara a
  // algo que no sea localhost - ver agent/analyze/config.mts.
  assertOllamaUrlIsLocal();

  let res: Response;
  try {
    res = await fetch(`${OLLAMA_BASE_URL}/api/tags`);
  } catch (err) {
    throw new Error(
      `No se pudo contactar Ollama en ${OLLAMA_BASE_URL} - ¿esta corriendo? (${err instanceof Error ? err.message : String(err)})`
    );
  }
  if (!res.ok) {
    throw new Error(`Ollama respondio ${res.status} en ${OLLAMA_BASE_URL}/api/tags`);
  }
  const data = (await res.json()) as { models?: Array<{ name: string }> };
  const installed = (data.models ?? []).map((m) => m.name);
  if (!installed.includes(OLLAMA_MODEL)) {
    throw new Error(
      `El modelo "${OLLAMA_MODEL}" no esta instalado en Ollama. Modelos disponibles: ${installed.join(", ") || "ninguno"}. Corre: ollama pull ${OLLAMA_MODEL}`
    );
  }
}

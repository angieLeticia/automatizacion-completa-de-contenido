// Fase 1.4 (workers multiproceso) — pruebas PURAS del contrato de exit codes
// entre processOne.mts (worker) y agent.mts (coordinador). Nunca invoca
// processProject() real, nunca spawnea ningún proceso — son funciones puras
// (resultToExitCode / classifyExitCode) probadas directamente con valores de
// entrada fabricados.
import { resultToExitCode, type ProcessResult } from "./processOne.mts";
import { classifyExitCode } from "./agent.mts";

let failures = 0;
const check = (label: string, cond: boolean, extra = "") => {
  const mark = cond ? "PASS" : "FAIL";
  if (!cond) failures++;
  console.log(`[${mark}] ${label}${extra ? " — " + extra : ""}`);
};

console.log("--- resultToExitCode() (processOne.mts) ---");
check(
  "COMPLETED -> exit 0",
  resultToExitCode({ status: "COMPLETED", mainOutput: "x", clipsExported: 0, clipsTotal: 0 } satisfies ProcessResult) === 0
);
check("WAITING_FOR_MATERIAL -> exit 3", resultToExitCode({ status: "WAITING_FOR_MATERIAL", reason: "sin guion" } satisfies ProcessResult) === 3);
check("NOT_AUTHORIZED -> exit 1", resultToExitCode({ status: "NOT_AUTHORIZED", reason: "sin autorizar" } satisfies ProcessResult) === 1);
check("MAIN_QA_FAILED -> exit 1", resultToExitCode({ status: "MAIN_QA_FAILED", reason: "duración fuera de rango" } satisfies ProcessResult) === 1);
check(
  "COMPLETED y WAITING_FOR_MATERIAL YA NO comparten el mismo exit code (ambigüedad original resuelta)",
  resultToExitCode({ status: "COMPLETED", mainOutput: "x", clipsExported: 0, clipsTotal: 0 } satisfies ProcessResult) !==
    resultToExitCode({ status: "WAITING_FOR_MATERIAL", reason: "x" } satisfies ProcessResult)
);

console.log("\n--- classifyExitCode() (agent.mts) ---");
check("exit 0 sin señal -> COMPLETED", classifyExitCode(0, null) === "COMPLETED");
check("exit 3 sin señal -> WAITING_FOR_MATERIAL", classifyExitCode(3, null) === "WAITING_FOR_MATERIAL");
check("exit 1 sin señal -> ERROR", classifyExitCode(1, null) === "ERROR");
check("exit code inesperado (ej. 2) -> ERROR (fail-safe, nunca éxito por defecto)", classifyExitCode(2, null) === "ERROR");
check("code null sin señal -> ERROR (fail-safe)", classifyExitCode(null, null) === "ERROR");
check(
  "terminado por señal (ej. SIGTERM de un kill) -> SIEMPRE ERROR, incluso si code=0",
  classifyExitCode(0, "SIGTERM") === "ERROR" && classifyExitCode(3, "SIGTERM") === "ERROR"
);
check("terminado por SIGKILL -> ERROR", classifyExitCode(null, "SIGKILL") === "ERROR");

console.log(`\n=== ${failures === 0 ? "TODO PASS" : `${failures} FALLO(S)`} ===`);
process.exit(failures === 0 ? 0 : 1);

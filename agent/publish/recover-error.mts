// H4-C.2 — CLI real de ERROR RECOVERY (error -> pending). Mismo patron EXACTO
// ya establecido en resolve-verification.mts (Fase 21 parte 2): capa
// DELIBERADAMENTE delgada. TODA la logica de validacion, elegibilidad,
// evidencia, limite anti-loop y transicion atomica vive en
// recoverErrorPost()/evaluateErrorRecoveryEligibility() (agent/publish/errorRecovery.mts,
// H4-C.1, NO se toca aqui). Este archivo unicamente: parsea argv, llama a esa
// funcion con las dependencias reales por defecto, y da formato legible al
// resultado. Cero logica de negocio, cero regla de elegibilidad duplicada,
// cero llamada a ningun publisher.
//
// Uso: npm run social:recover-error -- <post-id> <operator-id>
import "./config.mts";
import { fileURLToPath } from "node:url";
import { recoverErrorPost, type ErrorRecoveryResult } from "./errorRecovery.mts";
import { MAX_RECOVERIES } from "./config.mts";

export const USAGE_TEXT = [
  "Uso: npm run social:recover-error -- <post-id> <operator-id>",
  "Ejemplo: npm run social:recover-error -- 296ec9b7-29e7-405d-a30c-eeae4cca3a28 Anderson",
  "",
  "Toda decision de seguridad (status, plataforma, evidencia externa, limite",
  "de recoveries) vive exclusivamente en agent/publish/errorRecovery.mts -",
  "este comando NUNCA la duplica ni la reinterpreta.",
].join("\n");

export function isHelpFlag(argv: string[]): boolean {
  return argv[0] === "--help" || argv[0] === "-h";
}

export interface ParsedRecoverErrorArgs {
  postId: string;
  operatorId: string;
}

export type ParseRecoverErrorArgsResult = { ok: true; args: ParsedRecoverErrorArgs } | { ok: false; reason: string };

// Pura - valida UNICAMENTE la FORMA de los argumentos (presencia, no vacios)
// para evitar llamadas inutiles a recoverErrorPost()/Supabase - mismo
// alcance exacto que parseResolveVerificationArgs() (resolve-verification.mts).
// NUNCA valida existencia del post, su status, su plataforma, evidencia
// externa ni el limite de recoveries - eso es responsabilidad EXCLUSIVA de
// recoverErrorPost()/evaluateErrorRecoveryEligibility() (H4-C.1, sin
// modificar). No se acepta ningun flag adicional (--force/--skip-checks/
// --ignore-status/--ignore-evidence/--facebook/--reset-retries/
// --reset-recovery ni equivalentes) - solo se reconocen exactamente 2
// argumentos posicionales.
export function parseRecoverErrorArgs(argv: string[]): ParseRecoverErrorArgsResult {
  const [postId, operatorId] = argv;

  if (typeof postId !== "string" || postId.trim().length === 0) {
    return { ok: false, reason: "Falta <post-id>." };
  }
  // Validacion superficial de FORMA (evita una llamada inutil al nucleo) -
  // la validacion DEFINITIVA (misma regla, misma condicion) vive en
  // recoverErrorPost() (H4-C.1): OPERATOR_ID_MISSING si esta vacio. No se
  // introduce aqui ninguna regla nueva ni distinta.
  if (typeof operatorId !== "string" || operatorId.trim().length === 0) {
    return { ok: false, reason: "Falta <operator-id>. Todo recovery debe identificar explicitamente a quien lo ejecuta." };
  }

  return { ok: true, args: { postId, operatorId } };
}

// Salida SEGURA (nunca token/credencial/operation-ref real) - una funcion
// pura por resultado, separada de runRecoverErrorCli() para poder testear el
// texto exacto sin capturar console.log. Reutiliza EXACTAMENTE los codigos
// ya definidos por ErrorRecoveryResult (errorRecovery.mts) - no se inventa
// un segundo sistema de codigos.
export function describeRecoverErrorResult(result: ErrorRecoveryResult): string[] {
  switch (result.code) {
    case "POST_NOT_FOUND":
      return [`RESULT=POST_NOT_FOUND`, `post_id=${result.postId}`, `reason=No existe ningun social_post con ese id.`];
    case "OPERATOR_ID_MISSING":
      return [`RESULT=OPERATOR_ID_MISSING`, `post_id=${result.postId}`, `reason=operatorId vacio - todo recovery debe identificar explicitamente a quien lo ejecuta.`];
    case "WRONG_STATUS":
      return [
        `RESULT=WRONG_STATUS`,
        `post_id=${result.postId}`,
        `status_actual=${result.status}`,
        `reason=Solo se acepta status='error'. Rechazado ANTES de cualquier UPDATE.`,
      ];
    case "ACCOUNT_NOT_FOUND":
      return [
        `RESULT=ACCOUNT_NOT_FOUND`,
        `post_id=${result.postId}`,
        `reason=La social_account referenciada por este post no existe - dato inconsistente, recovery rechazado por seguridad (fail-closed).`,
      ];
    case "FACEBOOK_EXTERNAL_OUTCOME_UNKNOWN":
      return [
        `RESULT=FACEBOOK_EXTERNAL_OUTCOME_UNKNOWN`,
        `post_id=${result.postId}`,
        `reason=Facebook no tiene mecanismo de evidencia externa (publisher_operation_ref nunca refleja una operacion real para esta plataforma) - recovery general BLOQUEADO incondicionalmente. Ver ERROR RECOVERY CONTRACT v2 (informe H4-B.1) para el razonamiento completo.`,
      ];
    case "RECONCILIATION_REQUIRED":
      return [`RESULT=RECONCILIATION_REQUIRED`, `post_id=${result.postId}`, `reason=${result.reason}`];
    case "RECOVERY_LIMIT_EXCEEDED":
      return [
        `RESULT=RECOVERY_LIMIT_EXCEEDED`,
        `post_id=${result.postId}`,
        `recovery_count=${result.recoveryCount}`,
        `max_recoveries=${MAX_RECOVERIES}`,
        `reason=Se alcanzo el limite de recoveries manuales permitidos para este post. No se realizo ninguna escritura.`,
      ];
    case "CONFLICT":
      return [
        `RESULT=CONFLICT`,
        `post_id=${result.postId}`,
        `reason=Otro proceso ya modifico este post (status ya no era 'error', o el limite de recoveries se alcanzo, entre la lectura y esta escritura). No se sobrescribio nada - no se intento un segundo UPDATE.`,
      ];
    case "RECOVERED":
      return [
        `RESULT=RECOVERED`,
        `post_id=${result.postId}`,
        `status_anterior=error`,
        `status_resultante=pending`,
        `recovery_count=${result.recoveryCountBefore} -> ${result.recoveryCountAfter}`,
        `retry_count=PRESERVADO SIN CAMBIOS`,
        `external_post_id=PRESERVADO SIN CAMBIOS`,
        `NOTE=Este recovery NO otorgo ninguna autorizacion de publicacion. El siguiente intento real requiere una autorizacion humana NUEVA y explicita (npm run social:authorize-publication) y volvera a pasar por TODOS los gates normales de agent/publish/run.mts desde cero (DRY_RUN, channel_status, identidad estructural, hash, B2) - sin ningun bypass.`,
      ];
  }
}

const SUCCESS_CODES = new Set(["RECOVERED"]);

export interface RecoverErrorCliOutcome {
  exitCode: number;
  lines: string[];
}

// Orquestacion delgada, inyectable para tests: `recover` por defecto ES
// recoverErrorPost() real (que a su vez usa supabaseAdmin por defecto) - en
// produccion esto llama a Supabase real sin ninguna capa intermedia. En
// tests, se inyecta una funcion falsa para verificar el manejo de cada
// codigo de resultado sin tocar Supabase ni el nucleo real.
export async function runRecoverErrorCli(
  argv: string[],
  recover: (postId: string, operatorId: string) => Promise<ErrorRecoveryResult> = recoverErrorPost
): Promise<RecoverErrorCliOutcome> {
  const lines: string[] = ["=== ERROR RECOVERY (Agent 3, H4-C.2) ==="];

  if (isHelpFlag(argv)) {
    return { exitCode: 0, lines: [USAGE_TEXT] };
  }

  const parsed = parseRecoverErrorArgs(argv);
  if (!parsed.ok) {
    lines.push(`RESULT=INVALID_ARGUMENTS`, `reason=${parsed.reason}`, "", USAGE_TEXT);
    return { exitCode: 1, lines };
  }

  const { postId, operatorId } = parsed.args;
  lines.push(`post_id=${postId}`, `operator_id=${operatorId}`);

  let result: ErrorRecoveryResult;
  try {
    // UNICA llamada al nucleo - exactamente los 2 valores recibidos de argv,
    // sin ninguna transformacion, sin ningun flag adicional, sin ninguna
    // regla de elegibilidad propia.
    result = await recover(postId, operatorId);
  } catch (err) {
    // NUNCA se convierte una excepcion inesperada en RECOVERED. NUNCA se
    // imprime mas que el mensaje de la excepcion (que en este proyecto,
    // por convencion ya establecida en errorRecovery.mts/claimPost.mts,
    // nunca embebe tokens/credenciales/operation-refs reales - solo texto
    // diagnostico como "Error al leer social_posts id=X: <motivo>").
    const message = err instanceof Error ? err.message : String(err);
    lines.push(`RESULT=UNEXPECTED_ERROR`, `reason=${message}`);
    return { exitCode: 1, lines };
  }

  lines.push(...describeRecoverErrorResult(result));
  return { exitCode: SUCCESS_CODES.has(result.code) ? 0 : 1, lines };
}

// Guard de ejecucion directa: este archivo se importa desde
// test-recover-error-cli.mts para probar runRecoverErrorCli()/
// parseRecoverErrorArgs()/describeRecoverErrorResult() sin tocar Supabase
// real - mismo patron ya usado en resolve-verification.mts/
// authorize-publication.mts.
async function main(): Promise<void> {
  const { exitCode, lines } = await runRecoverErrorCli(process.argv.slice(2));
  for (const line of lines) console.log(line);
  process.exitCode = exitCode;
}

const isDirectRun = typeof process.argv[1] === "string" && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirectRun) {
  main().catch((err) => {
    console.error(`ERROR inesperado: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  });
}

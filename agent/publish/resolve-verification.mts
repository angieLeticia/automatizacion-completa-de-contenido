// Fase 21 (parte 2) — CLI real del cierre operativo de verification_required.
// Uso: npm run social:resolve-verification -- <post-id> <decision> <operator-id>
// Decisiones: published | retry | keep-blocked
//
// Capa DELIBERADAMENTE delgada: toda la logica de validacion, transicion
// atomica y evidencia vive en resolveVerificationRequired()
// (agent/publish/verificationResolution.mts, congelada en la fase anterior -
// NO se toca aqui). Este archivo unicamente: parsea argv, llama a esa
// funcion con las credenciales reales (default deps de
// verificationResolution.mts), y da formato legible al resultado. Cero SQL,
// cero logica de negocio, cero llamada a Meta/B2/publisher propias.
import "./config.mts";
import { fileURLToPath } from "node:url";
import { resolveVerificationRequired, type VerificationDecision, type VerificationResolutionResult } from "./verificationResolution.mts";

const VALID_DECISIONS: readonly VerificationDecision[] = ["published", "retry", "keep-blocked"];

export const USAGE_TEXT = [
  "Uso: npm run social:resolve-verification -- <post-id> <decision> <operator-id>",
  "Decisiones validas: published | retry | keep-blocked",
  "Ejemplo: npm run social:resolve-verification -- 296ec9b7-29e7-405d-a30c-eeae4cca3a28 retry operador@example.com",
].join("\n");

export function isHelpFlag(argv: string[]): boolean {
  return argv[0] === "--help" || argv[0] === "-h";
}

export interface ParsedResolveVerificationArgs {
  postId: string;
  decision: VerificationDecision;
  operatorId: string;
}

export type ParseResolveVerificationArgsResult = { ok: true; args: ParsedResolveVerificationArgs } | { ok: false; reason: string };

// Pura - solo valida la FORMA de los argumentos de CLI (presencia, decision
// dentro del enum permitido) para evitar llamadas inutiles a
// resolveVerificationRequired()/Supabase. NUNCA valida existencia del post ni
// su status - eso es responsabilidad exclusiva de resolveVerificationRequired().
export function parseResolveVerificationArgs(argv: string[]): ParseResolveVerificationArgsResult {
  const [postId, decision, operatorId] = argv;

  if (typeof postId !== "string" || postId.trim().length === 0) {
    return { ok: false, reason: "Falta <post-id>." };
  }
  if (typeof decision !== "string" || !VALID_DECISIONS.includes(decision as VerificationDecision)) {
    return { ok: false, reason: `Decision invalida o ausente: '${decision ?? ""}'. Valores permitidos: ${VALID_DECISIONS.join(", ")}.` };
  }
  if (typeof operatorId !== "string" || operatorId.trim().length === 0) {
    return { ok: false, reason: "Falta <operator-id>. Toda resolucion debe identificar explicitamente a quien la ejecuta." };
  }

  return { ok: true, args: { postId, decision: decision as VerificationDecision, operatorId } };
}

// Salida SEGURA (nunca token/credencial) - una funcion pura por resultado,
// separada de runResolveVerificationCli() para poder testear el texto exacto
// sin capturar console.log.
export function describeResolveVerificationResult(result: VerificationResolutionResult): string[] {
  switch (result.code) {
    case "POST_NOT_FOUND":
      return [`RESULT=POST_NOT_FOUND`, `post_id=${result.postId}`, `reason=No existe ningun social_post con ese id.`];
    case "OPERATOR_ID_MISSING":
      return [`RESULT=OPERATOR_ID_MISSING`, `post_id=${result.postId}`, `reason=operatorId vacio - toda resolucion debe identificar explicitamente a quien la ejecuta.`];
    case "WRONG_STATUS":
      return [
        `RESULT=WRONG_STATUS`,
        `post_id=${result.postId}`,
        `status_actual=${result.status}`,
        `reason=Solo se acepta status='verification_required'. Rechazado ANTES de cualquier UPDATE.`,
      ];
    case "CONFLICT":
      return [
        `RESULT=CONFLICT`,
        `post_id=${result.postId}`,
        `decision=${result.decision}`,
        `reason=Otra ejecucion ya resolvio este post primero (la condicion WHERE status='verification_required' ya no coincidio). No se sobrescribio nada.`,
      ];
    case "RESOLVED_PUBLISHED":
      return [
        `RESULT=RESOLVED_PUBLISHED`,
        `post_id=${result.postId}`,
        `status_anterior=verification_required`,
        `status_resultante=published`,
        `published_at=${result.publishedAt}`,
        `external_post_id=PRESERVADO SIN CAMBIOS - NUNCA inferido, NUNCA igualado al creationId`,
        `publisher_operation_ref=PRESERVADO SIN CAMBIOS`,
        `NOTE=La evidencia de esta reconciliacion (decision, creationId original si existia, timestamp, operador) ya fue escrita en error_message por resolveVerificationRequired(). Este CLI no realizo ninguna llamada adicional a Meta para intentar descubrir el media ID real.`,
      ];
    case "RESOLVED_RETRY":
      return [
        `RESULT=RESOLVED_RETRY`,
        `post_id=${result.postId}`,
        `status_anterior=verification_required`,
        `status_resultante=pending`,
        `claimed_at=LIMPIADO (null)`,
        `publisher_operation_ref=LIMPIADO (null)`,
        `publication_authorized_at=LIMPIADO (null)`,
        `publication_authorized_by=LIMPIADO (null)`,
        `external_post_id=PRESERVADO SIN CAMBIOS`,
        `retry_count=PRESERVADO SIN CAMBIOS`,
        `NOTE=Cualquier autorizacion humana anterior fue revocada como parte de esta misma transicion atomica. Se requiere una nueva autorizacion humana explicita antes de cualquier publicacion real. NO se autorizo automaticamente una nueva publicacion (authorizePublication() NO fue llamado). El proximo ciclo normal de Agent 3 reevaluara TODOS los gates (DRY_RUN, channel_status, Human Review, identidad estructural, hash, B2) desde cero, sin ningun bypass.`,
      ];
    case "RESOLVED_KEEP_BLOCKED":
      return [
        `RESULT=RESOLVED_KEEP_BLOCKED`,
        `post_id=${result.postId}`,
        `status_anterior=verification_required`,
        `status_resultante=verification_required (sin cambios)`,
        `NO UPDATE EXECUTED`,
        `NOTE=El operador decidio no actuar todavia. El post permanece bloqueado para revision posterior.`,
      ];
  }
}

const SUCCESS_CODES = new Set(["RESOLVED_PUBLISHED", "RESOLVED_RETRY", "RESOLVED_KEEP_BLOCKED"]);

export interface ResolveVerificationCliOutcome {
  exitCode: number;
  lines: string[];
}

// Orquestacion delgada, inyectable para tests: `resolve` por defecto ES
// resolveVerificationRequired() real (que a su vez usa supabaseAdmin por
// defecto) - en produccion esto llama a Supabase real sin ninguna capa
// intermedia. En tests, se inyecta un `resolve` falso para verificar el
// manejo de cada codigo de resultado sin tocar Supabase.
export async function runResolveVerificationCli(
  argv: string[],
  resolve: (postId: string, decision: VerificationDecision, operatorId: string) => Promise<VerificationResolutionResult> = resolveVerificationRequired
): Promise<ResolveVerificationCliOutcome> {
  const lines: string[] = ["=== RESOLUCION DE verification_required (Agent 3) ==="];

  if (isHelpFlag(argv)) {
    return { exitCode: 0, lines: [USAGE_TEXT] };
  }

  const parsed = parseResolveVerificationArgs(argv);
  if (!parsed.ok) {
    lines.push(`RESULT=INVALID_ARGUMENTS`, `reason=${parsed.reason}`, "", USAGE_TEXT);
    return { exitCode: 1, lines };
  }

  const { postId, decision, operatorId } = parsed.args;
  lines.push(`post_id=${postId}`, `decision=${decision}`, `operator_id=${operatorId}`);

  const result = await resolve(postId, decision, operatorId);
  lines.push(...describeResolveVerificationResult(result));

  return { exitCode: SUCCESS_CODES.has(result.code) ? 0 : 1, lines };
}

// Guard de ejecucion directa: este archivo se importa desde
// test-resolve-verification-cli.mts para probar runResolveVerificationCli()/
// parseResolveVerificationArgs()/describeResolveVerificationResult() sin
// tocar Supabase real - si main() se ejecutara incondicionalmente al
// importar (como hace reconcile-instagram.mts, que ningun test importa),
// pisaria el process.exitCode del propio test. Patron estandar de Node, no
// logica de negocio nueva.
async function main(): Promise<void> {
  const { exitCode, lines } = await runResolveVerificationCli(process.argv.slice(2));
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

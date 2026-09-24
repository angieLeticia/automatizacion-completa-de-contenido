// Fase 22 — CLI real de Human Review (autorizacion/revocacion de
// publicacion). Uso:
//   npm run social:authorize-publication -- <post-id> <operator-id>
//   npm run social:authorize-publication -- --revoke <post-id> <operator-id>
//
// Capa DELIBERADAMENTE delgada: authorizePublication()/revokePublicationAuthorization()
// (agent/publish/publicationAuthorization.mts, sin modificar en esta fase)
// ya contienen TODA la logica real (elegibilidad via evaluateAuthorizationEligibility(),
// idempotencia, lectura/escritura de publication_authorized_at/by). Este
// archivo unicamente parsea argv, llama a esas funciones REALES, y da
// formato legible al resultado REAL que devuelven - sin inventar codigos de
// resultado que ese modulo no tiene (solo expone {ok:true,...}/{ok:false,reason}).
//
// PRINCIPIO FUNDAMENTAL: este comando SOLO autoriza o revoca. NUNCA publica,
// NUNCA llama a Meta, NUNCA llama a B2, NUNCA cambia status/retry_count/
// credenciales/channel_status. authorizePublication() por si sola nunca
// dispara ninguna accion - solo levanta UNA de las tres condiciones
// independientes que run.mts ya exige (DRY_RUN=false, channel_status='ACTIVE',
// Human Review) para llegar a publicar de verdad en el PROXIMO ciclo normal.
//
// LIMITACION DELIBERADA (no se "arregla" en esta fase): operatorId es texto
// libre proporcionado por quien ejecuta el comando - NO es una identidad
// autenticada. No hay login, roles, JWT ni sesiones. Ver USAGE_TEXT.
import "./config.mts";
import { fileURLToPath } from "node:url";
import { authorizePublication, revokePublicationAuthorization, type AuthorizePublicationResult, type RevokePublicationAuthorizationResult } from "./publicationAuthorization.mts";

export const USAGE_TEXT = [
  "Uso:",
  "  npm run social:authorize-publication -- <post-id> <operator-id>",
  "  npm run social:authorize-publication -- --revoke <post-id> <operator-id>",
  "",
  "IMPORTANTE: <operator-id> es un identificador de TEXTO LIBRE proporcionado por quien",
  "ejecuta el comando - NO es una identidad autenticada. No existe login, roles, JWT ni",
  "sesiones. La trazabilidad de Human Review hoy se limita a este texto y a un timestamp.",
  "",
  "Este comando SOLO autoriza o revoca publication_authorized_at/publication_authorized_by.",
  "NUNCA publica nada, NUNCA llama a Meta, NUNCA llama a B2, NUNCA cambia status.",
].join("\n");

export function isHelpFlag(argv: string[]): boolean {
  return argv[0] === "--help" || argv[0] === "-h";
}

export type AuthorizeCliCommand = "authorize" | "revoke";

export interface ParsedAuthorizeArgs {
  command: AuthorizeCliCommand;
  postId: string;
  operatorId: string;
}

export type ParseAuthorizeArgsResult = { ok: true; args: ParsedAuthorizeArgs } | { ok: false; reason: string };

// Pura - solo valida la FORMA de argv (comando reconocido, post-id/operator-id
// presentes, sin argumentos sobrantes). NUNCA valida existencia del post ni su
// status/elegibilidad - eso es responsabilidad exclusiva de
// authorizePublication()/revokePublicationAuthorization() (ya existentes, sin tocar).
export function parseAuthorizePublicationArgs(argv: string[]): ParseAuthorizeArgsResult {
  let command: AuthorizeCliCommand = "authorize";
  let rest = argv;

  if (typeof argv[0] === "string" && argv[0].startsWith("--")) {
    if (argv[0] === "--revoke") {
      command = "revoke";
      rest = argv.slice(1);
    } else {
      return { ok: false, reason: `Comando desconocido: '${argv[0]}'. Unico flag soportado ademas de --help/-h: --revoke.` };
    }
  }

  if (rest.length > 2) {
    return { ok: false, reason: `Argumentos ambiguos: se recibieron ${rest.length} despues del comando, se esperaban exactamente 2 (<post-id> <operator-id>).` };
  }

  const [postId, operatorId] = rest;
  if (typeof postId !== "string" || postId.trim().length === 0) {
    return { ok: false, reason: "Falta <post-id>." };
  }
  if (typeof operatorId !== "string" || operatorId.trim().length === 0) {
    return {
      ok: false,
      reason: "Falta <operator-id>. Toda autorizacion/revocacion debe identificar explicitamente a quien la ejecuta (texto libre, NO es una identidad autenticada).",
    };
  }

  return { ok: true, args: { command, postId, operatorId } };
}

// Salida SEGURA - refleja EXACTAMENTE el contrato real de
// publicationAuthorization.mts ({ok:true,...}/{ok:false,reason}). No inventa
// codigos de resultado (POST_NOT_FOUND/WRONG_STATUS/etc.) que ese modulo no
// expone - "not found" y "not eligible" llegan aqui como el mismo
// {ok:false, reason:<texto real>}, y se reportan tal cual.
export function describeAuthorizeCliResult(command: AuthorizeCliCommand, postId: string, result: AuthorizePublicationResult | RevokePublicationAuthorizationResult): string[] {
  if (command === "authorize") {
    const r = result as AuthorizePublicationResult;
    if (!r.ok) {
      return [`RESULT=AUTHORIZE_FAILED`, `post_id=${postId}`, `reason=${r.reason}`];
    }
    if (r.alreadyAuthorized) {
      return [
        `RESULT=ALREADY_AUTHORIZED`,
        `post_id=${postId}`,
        `authorized_at=${r.authorizedAt}`,
        `authorized_by=${r.authorizedBy}`,
        `NOTE=Esta autorizacion ya existia - authorizePublication() es idempotente y NO la sobrescribio.`,
      ];
    }
    return [
      `RESULT=AUTHORIZED`,
      `post_id=${postId}`,
      `authorized_at=${r.authorizedAt}`,
      `authorized_by=${r.authorizedBy}`,
      `NOTE=Esta autorizacion NO publica nada por si sola. operatorId es un identificador de texto libre, NO una identidad autenticada. Una publicacion real solo puede ocurrir si TAMBIEN se cumplen, en el proximo ciclo normal de Agent 3: status='pending', DRY_RUN=false y channel_status='ACTIVE'. Este comando no llamo a Meta, B2, ni al publisher.`,
    ];
  }

  const r = result as RevokePublicationAuthorizationResult;
  if (!r.ok) {
    return [`RESULT=REVOKE_FAILED`, `post_id=${postId}`, `reason=${r.reason}`];
  }
  return [`RESULT=REVOKED`, `post_id=${postId}`, `NOTE=publication_authorized_at/publication_authorized_by fueron limpiados. Esto NO cambia status, retry_count, ni ningun otro campo.`];
}

export interface AuthorizePublicationCliDeps {
  authorize?: (postId: string, authorizedBy: string) => Promise<AuthorizePublicationResult>;
  revoke?: (postId: string) => Promise<RevokePublicationAuthorizationResult>;
}

export interface AuthorizePublicationCliOutcome {
  exitCode: number;
  lines: string[];
}

// Orquestacion delgada, inyectable para tests: por defecto usa las funciones
// REALES (que a su vez usan supabaseAdmin real) - en produccion esto llama a
// Supabase real sin ninguna capa intermedia. En tests, se inyectan fakes
// para verificar el manejo de cada resultado sin tocar Supabase.
export async function runAuthorizePublicationCli(argv: string[], deps: AuthorizePublicationCliDeps = {}): Promise<AuthorizePublicationCliOutcome> {
  const authorize = deps.authorize ?? authorizePublication;
  const revoke = deps.revoke ?? revokePublicationAuthorization;

  const lines: string[] = ["=== AUTORIZACION / REVOCACION DE PUBLICACION (Human Review) ==="];

  if (isHelpFlag(argv)) {
    return { exitCode: 0, lines: [USAGE_TEXT] };
  }

  const parsed = parseAuthorizePublicationArgs(argv);
  if (!parsed.ok) {
    lines.push(`RESULT=INVALID_ARGUMENTS`, `reason=${parsed.reason}`, "", USAGE_TEXT);
    return { exitCode: 1, lines };
  }

  const { command, postId, operatorId } = parsed.args;
  lines.push(`command=${command}`, `post_id=${postId}`, `operator_id=${operatorId}`);

  const result = command === "authorize" ? await authorize(postId, operatorId) : await revoke(postId);
  lines.push(...describeAuthorizeCliResult(command, postId, result));

  return { exitCode: result.ok ? 0 : 1, lines };
}

// Guard de ejecucion directa - mismo motivo exacto que resolve-verification.mts:
// este archivo se importa desde test-authorize-publication-cli.mts para
// probar runAuthorizePublicationCli()/parseAuthorizePublicationArgs()/
// describeAuthorizeCliResult() sin tocar Supabase real.
async function main(): Promise<void> {
  const { exitCode, lines } = await runAuthorizePublicationCli(process.argv.slice(2));
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

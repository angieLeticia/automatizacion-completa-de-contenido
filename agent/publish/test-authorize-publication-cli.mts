// Fase 22 — pruebas del CLI de Human Review (authorize-publication.mts).
// Mismo patron exacto que test-resolve-verification-cli.mts: importa el
// archivo CLI real para probar runAuthorizePublicationCli()/
// parseAuthorizePublicationArgs()/describeAuthorizeCliResult() - las
// funciones puras/inyectables que ese archivo exporta - SIN ejecutar su
// main() (protegido por el guard isDirectRun) y SIN tocar Supabase real:
// `authorize`/`revoke` se inyectan como stubs en cada prueba, nunca se usan
// los defaults reales (authorizePublication()/revokePublicationAuthorization()
// con supabaseAdmin).
//
// NO se usa el post real de Instagram mas alla de su ID como STRING de
// prueba. NO se llama Meta. NO se llama B2. NO se modifica ningun
// social_posts real - authorizePublication()/revokePublicationAuthorization()
// reales NUNCA se invocan en este archivo.
await import("./config.mts");
const { runAuthorizePublicationCli, parseAuthorizePublicationArgs, describeAuthorizeCliResult, isHelpFlag, USAGE_TEXT } = await import("./authorize-publication.mts");
import type { AuthorizePublicationResult, RevokePublicationAuthorizationResult } from "./publicationAuthorization.mts";

let failures = 0;
const check = (label: string, cond: boolean, extra = "") => {
  const mark = cond ? "PASS" : "FAIL";
  if (!cond) failures++;
  console.log(`[${mark}] ${label}${extra ? " — " + extra : ""}`);
};

// SEGURIDAD: fetch global lanza si se le llama - ni el CLI ni sus pruebas
// deben tocar red real en ningun caso.
const originalFetch = globalThis.fetch;
let fetchCalls = 0;
globalThis.fetch = (async (url: unknown) => {
  fetchCalls++;
  throw new Error(`SEGURIDAD: el CLI de authorize-publication NUNCA debe llamar a fetch/red real (intento hacia: ${String(url)})`);
}) as typeof fetch;

const POST_ID = "296ec9b7-29e7-405d-a30c-eeae4cca3a28"; // solo como STRING de prueba - authorize/revoke son stubs, nunca tocan el post real
const OPERATOR = "operador-test@example.com";

function stubDeps(opts: { authorizeResult?: AuthorizePublicationResult; revokeResult?: RevokePublicationAuthorizationResult }) {
  const authorizeCalls: Array<{ postId: string; authorizedBy: string }> = [];
  const revokeCalls: Array<{ postId: string }> = [];
  return {
    authorizeCalls,
    revokeCalls,
    authorize: async (postId: string, authorizedBy: string) => {
      authorizeCalls.push({ postId, authorizedBy });
      return opts.authorizeResult ?? { ok: true, alreadyAuthorized: false, authorizedAt: "2026-09-16T12:00:00.000Z", authorizedBy };
    },
    revoke: async (postId: string) => {
      revokeCalls.push({ postId });
      return opts.revokeResult ?? { ok: true };
    },
  };
}

async function main() {
  // ==================================================
  // 1. authorize con argumentos validos
  // ==================================================
  {
    const deps = stubDeps({ authorizeResult: { ok: true, alreadyAuthorized: false, authorizedAt: "2026-09-16T12:00:00.000Z", authorizedBy: OPERATOR } });
    const outcome = await runAuthorizePublicationCli([POST_ID, OPERATOR], deps);
    check("1. exitCode=0 para AUTHORIZED", outcome.exitCode === 0);
    check("1. authorize() fue llamado con (postId, operatorId) exactos", deps.authorizeCalls.length === 1 && deps.authorizeCalls[0].postId === POST_ID && deps.authorizeCalls[0].authorizedBy === OPERATOR);
    check("1. revoke() NUNCA fue llamado", deps.revokeCalls.length === 0);
    check("1. salida contiene RESULT=AUTHORIZED", outcome.lines.some((l) => l === "RESULT=AUTHORIZED"));
    check("1. salida menciona que operatorId no es identidad autenticada", outcome.lines.some((l) => l.includes("NO una identidad autenticada")));
  }

  // ==================================================
  // 2. revoke con argumentos validos
  // ==================================================
  {
    const deps = stubDeps({ revokeResult: { ok: true } });
    const outcome = await runAuthorizePublicationCli(["--revoke", POST_ID, OPERATOR], deps);
    check("2. exitCode=0 para REVOKED", outcome.exitCode === 0);
    check("2. revoke() fue llamado con postId exacto", deps.revokeCalls.length === 1 && deps.revokeCalls[0].postId === POST_ID);
    check("2. authorize() NUNCA fue llamado", deps.authorizeCalls.length === 0);
    check("2. salida contiene RESULT=REVOKED", outcome.lines.some((l) => l === "RESULT=REVOKED"));
    check("2. salida indica que status no cambia", outcome.lines.some((l) => l.includes("NO cambia status")));
  }

  // ==================================================
  // 3. postId faltante
  // ==================================================
  {
    const deps = stubDeps({});
    const outcome = await runAuthorizePublicationCli(["", OPERATOR], deps);
    check("3. exitCode=1 cuando postId esta ausente/vacio", outcome.exitCode === 1);
    check("3. ni authorize() ni revoke() fueron llamados", deps.authorizeCalls.length === 0 && deps.revokeCalls.length === 0);
    check("3. salida contiene RESULT=INVALID_ARGUMENTS con motivo de post-id", outcome.lines.some((l) => l === "RESULT=INVALID_ARGUMENTS") && outcome.lines.some((l) => l.toLowerCase().includes("post-id")));
  }
  {
    const deps = stubDeps({});
    const outcome = await runAuthorizePublicationCli([], deps);
    check("3b. argv vacio -> exitCode=1, ninguna funcion llamada", outcome.exitCode === 1 && deps.authorizeCalls.length === 0 && deps.revokeCalls.length === 0);
  }

  // ==================================================
  // 4. operatorId faltante
  // ==================================================
  {
    const deps = stubDeps({});
    const outcome = await runAuthorizePublicationCli([POST_ID], deps);
    check("4. exitCode=1 cuando operatorId esta ausente", outcome.exitCode === 1);
    check("4. ninguna funcion fue llamada", deps.authorizeCalls.length === 0 && deps.revokeCalls.length === 0);
    check("4. la razon menciona operator-id", outcome.lines.some((l) => l.toLowerCase().includes("operator-id")));
  }

  // ==================================================
  // 5. operatorId vacio (cadena de solo espacios)
  // ==================================================
  {
    const deps = stubDeps({});
    const outcome = await runAuthorizePublicationCli([POST_ID, "   "], deps);
    check("5. exitCode=1 cuando operatorId es solo espacios", outcome.exitCode === 1);
    check("5. ninguna funcion fue llamada", deps.authorizeCalls.length === 0 && deps.revokeCalls.length === 0);
  }

  // ==================================================
  // 6. comando invalido
  // ==================================================
  {
    const deps = stubDeps({});
    const outcome = await runAuthorizePublicationCli(["--publicar-ya", POST_ID, OPERATOR], deps);
    check("6. exitCode=1 para flag desconocido", outcome.exitCode === 1);
    check("6. ninguna funcion fue llamada", deps.authorizeCalls.length === 0 && deps.revokeCalls.length === 0);
    check("6. salida contiene RESULT=INVALID_ARGUMENTS mencionando el comando desconocido", outcome.lines.some((l) => l === "RESULT=INVALID_ARGUMENTS") && outcome.lines.some((l) => l.includes("--publicar-ya")));
  }
  {
    // argumentos ambiguos: demasiados argumentos tras el comando
    const deps = stubDeps({});
    const outcome = await runAuthorizePublicationCli([POST_ID, OPERATOR, "argumento-sobrante"], deps);
    check("6b. argumentos ambiguos (sobrantes) -> exitCode=1, ninguna funcion llamada", outcome.exitCode === 1 && deps.authorizeCalls.length === 0 && deps.revokeCalls.length === 0);
  }

  // ==================================================
  // 7. --help
  // ==================================================
  {
    const deps = stubDeps({});
    const outcome = await runAuthorizePublicationCli(["--help"], deps);
    check("7. --help -> exitCode=0, ninguna funcion llamada", outcome.exitCode === 0 && deps.authorizeCalls.length === 0 && deps.revokeCalls.length === 0);
    check("7. --help imprime el texto de uso completo", outcome.lines.some((l) => l.includes(USAGE_TEXT)));
    check("7. isHelpFlag() reconoce '-h' tambien", isHelpFlag(["-h"]) === true && isHelpFlag(["algo"]) === false);
  }

  // ==================================================
  // 8. resultado exitoso de authorize (ya cubierto arriba en 1, se añade el
  // caso "ya estaba autorizado" - idempotencia real de authorizePublication())
  // ==================================================
  {
    const deps = stubDeps({ authorizeResult: { ok: true, alreadyAuthorized: true, authorizedAt: "2026-09-10T00:00:00.000Z", authorizedBy: "operador-previo@example.com" } });
    const outcome = await runAuthorizePublicationCli([POST_ID, OPERATOR], deps);
    check("8. exitCode=0 para ALREADY_AUTHORIZED", outcome.exitCode === 0);
    check("8. salida contiene RESULT=ALREADY_AUTHORIZED", outcome.lines.some((l) => l === "RESULT=ALREADY_AUTHORIZED"));
    check("8. salida muestra los valores EXISTENTES (no sobrescritos)", outcome.lines.some((l) => l === "authorized_by=operador-previo@example.com"));
  }

  // ==================================================
  // 9. resultado exitoso de revoke (ya cubierto en 2 - se añade verificacion
  // de formato adicional)
  // ==================================================
  {
    const deps = stubDeps({ revokeResult: { ok: true } });
    const outcome = await runAuthorizePublicationCli(["--revoke", POST_ID, OPERATOR], deps);
    check("9. salida de REVOKED incluye post_id correcto", outcome.lines.some((l) => l === `post_id=${POST_ID}`));
  }

  // ==================================================
  // 10. resultado de publicacion NO autorizable (published) - viene de
  // evaluateAuthorizationEligibility() dentro de authorizePublication() real;
  // el CLI solo debe reportar el {ok:false, reason} tal cual, sin inventar
  // un codigo nuevo como "WRONG_STATUS".
  // ==================================================
  {
    const deps = stubDeps({ authorizeResult: { ok: false, reason: "El post ya está publicado (status='published') - no tiene sentido autorizar algo que ya ocurrió." } });
    const outcome = await runAuthorizePublicationCli([POST_ID, OPERATOR], deps);
    check("10. exitCode=1 para AUTHORIZE_FAILED por post ya publicado", outcome.exitCode === 1);
    check("10. salida contiene RESULT=AUTHORIZE_FAILED con el motivo REAL, sin inventar un codigo de estado nuevo", outcome.lines.some((l) => l === "RESULT=AUTHORIZE_FAILED") && outcome.lines.some((l) => l.includes("ya está publicado")));
  }

  // ==================================================
  // 11. error devuelto por la funcion existente (post inexistente / fallo
  // generico) - mismo tratamiento: {ok:false, reason} pasado tal cual.
  // ==================================================
  {
    const deps = stubDeps({ revokeResult: { ok: false, reason: "No existe ningún social_post con id='post-inexistente'." } });
    const outcome = await runAuthorizePublicationCli(["--revoke", "post-inexistente", OPERATOR], deps);
    check("11. exitCode=1 para REVOKE_FAILED", outcome.exitCode === 1);
    check("11. salida contiene RESULT=REVOKE_FAILED con el motivo real", outcome.lines.some((l) => l === "RESULT=REVOKE_FAILED") && outcome.lines.some((l) => l.includes("No existe ningún social_post")));
  }

  // ==================================================
  // 12. el CLI NUNCA ejecuta una segunda operacion (ni encadena authorize->revoke
  // ni llama a ninguna otra funcion mas alla de la solicitada)
  // ==================================================
  {
    const deps = stubDeps({ authorizeResult: { ok: true, alreadyAuthorized: false, authorizedAt: "2026-09-16T12:00:00.000Z", authorizedBy: OPERATOR } });
    await runAuthorizePublicationCli([POST_ID, OPERATOR], deps);
    check("12. exactamente UNA llamada total entre authorize/revoke (nunca ambas, nunca mas de una)", deps.authorizeCalls.length + deps.revokeCalls.length === 1);
  }

  // ==================================================
  // 13/14. Seguridad — cero llamadas HTTP/Meta/B2 en TODA la corrida anterior
  // ==================================================
  check("13. Meta/red: fetchCalls=0 tras todas las pruebas anteriores", fetchCalls === 0);
  console.log("14. B2: authorize-publication.mts y este test no importan storageBridge.mts ni @aws-sdk/client-s3 - cero llamadas posibles.");

  // ==================================================
  // 15. el CLI no modifica status por si mismo — ni parseAuthorizePublicationArgs()
  // ni runAuthorizePublicationCli() escriben ningun campo directamente; toda
  // escritura pasa exclusivamente por la funcion inyectada (authorize/revoke).
  // Se verifica aqui que el propio CLI nunca intenta tocar 'status' en su
  // salida como si fuera un campo que el mismo decide.
  // ==================================================
  {
    const deps = stubDeps({ authorizeResult: { ok: true, alreadyAuthorized: false, authorizedAt: "2026-09-16T12:00:00.000Z", authorizedBy: OPERATOR } });
    const outcome = await runAuthorizePublicationCli([POST_ID, OPERATOR], deps);
    check("15. la salida nunca incluye una linea 'status=' (el CLI no decide ni reporta cambios de status - eso es de resolveVerificationRequired()/run.mts)", !outcome.lines.some((l) => l.startsWith("status=")));
  }

  // ==================================================
  // Extra — parseAuthorizePublicationArgs()/describeAuthorizeCliResult() puras
  // ==================================================
  {
    const ok = parseAuthorizePublicationArgs([POST_ID, OPERATOR]);
    check("Extra. parseAuthorizePublicationArgs() con argv de authorize validos -> ok:true, command='authorize'", ok.ok === true && ok.args.command === "authorize");
    const okRevoke = parseAuthorizePublicationArgs(["--revoke", POST_ID, OPERATOR]);
    check("Extra. parseAuthorizePublicationArgs() con --revoke -> ok:true, command='revoke'", okRevoke.ok === true && okRevoke.args.command === "revoke");
    const lines = describeAuthorizeCliResult("authorize", POST_ID, { ok: true, alreadyAuthorized: false, authorizedAt: "2026-01-01T00:00:00.000Z", authorizedBy: OPERATOR });
    check("Extra. describeAuthorizeCliResult() es pura (no lanza, no usa I/O)", Array.isArray(lines) && lines.length > 0);
  }

  console.log(`\n${failures === 0 ? "TODAS LAS PRUEBAS PASARON" : `${failures} PRUEBA(S) FALLARON`}`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().finally(() => {
  globalThis.fetch = originalFetch;
});

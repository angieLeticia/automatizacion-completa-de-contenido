// Fase 21 (parte 2) — pruebas del CLI de resolucion de verification_required.
// Importa el archivo CLI real (agent/publish/resolve-verification.mts) para
// probar runResolveVerificationCli()/parseResolveVerificationArgs()/
// describeResolveVerificationResult() - las funciones puras/inyectables que
// ese archivo exporta - SIN ejecutar su main() (protegido por el guard
// isDirectRun al final del archivo, ver comentario ahi) y SIN tocar
// Supabase real: `resolve` se inyecta como un stub en cada prueba, nunca se
// usa el default real (resolveVerificationRequired() con supabaseAdmin).
//
// NO se usa el post real de Instagram. NO se llama Meta. NO se llama B2. NO
// se modifica ningun social_posts real - todas las pruebas usan un `resolve`
// falso que solo devuelve resultados sinteticos en memoria.
await import("./config.mts");
const { runResolveVerificationCli, parseResolveVerificationArgs, describeResolveVerificationResult, isHelpFlag, USAGE_TEXT } = await import("./resolve-verification.mts");
import type { VerificationDecision, VerificationResolutionResult } from "./verificationResolution.mts";

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
  throw new Error(`SEGURIDAD: el CLI de resolve-verification NUNCA debe llamar a fetch/red real (intento hacia: ${String(url)})`);
}) as typeof fetch;

const POST_ID = "296ec9b7-29e7-405d-a30c-eeae4cca3a28"; // usado solo como STRING de prueba - nunca se toca el post real (resolve es un stub)
const OPERATOR = "operador-test@example.com";

// Fabrica un `resolve` falso que registra la llamada y devuelve el resultado
// fijo indicado - nunca toca Supabase, nunca importa verificationResolution.mts
// de forma real mas alla de sus tipos (type-only import arriba).
function stubResolve(fixedResult: VerificationResolutionResult) {
  const calls: Array<{ postId: string; decision: VerificationDecision; operatorId: string }> = [];
  const resolve = async (postId: string, decision: VerificationDecision, operatorId: string) => {
    calls.push({ postId, decision, operatorId });
    return fixedResult;
  };
  return { resolve, calls };
}

async function main() {
  // ==================================================
  // 1. Argumentos validos + published
  // ==================================================
  {
    const { resolve, calls } = stubResolve({ code: "RESOLVED_PUBLISHED", postId: POST_ID, publishedAt: "2026-09-16T12:00:00.000Z" });
    const outcome = await runResolveVerificationCli([POST_ID, "published", OPERATOR], resolve);
    check("1. exitCode=0 para RESOLVED_PUBLISHED", outcome.exitCode === 0);
    check("1. resolve() fue llamado con (postId, 'published', operatorId) exactos", calls.length === 1 && calls[0].postId === POST_ID && calls[0].decision === "published" && calls[0].operatorId === OPERATOR);
    check("1. salida contiene RESULT=RESOLVED_PUBLISHED", outcome.lines.some((l) => l === "RESULT=RESOLVED_PUBLISHED"));
    check("1. salida indica external_post_id preservado (nunca inferido)", outcome.lines.some((l) => l.includes("external_post_id=PRESERVADO") && l.includes("NUNCA")));
    check("1. salida indica publisher_operation_ref preservado", outcome.lines.some((l) => l.startsWith("publisher_operation_ref=PRESERVADO")));
    check("1. salida NUNCA menciona 'creationId' copiado a external_post_id (no hay linea external_post_id=<valor real>)", !outcome.lines.some((l) => /external_post_id=(?!PRESERVADO)/.test(l)));
  }

  // ==================================================
  // 2. Argumentos validos + retry
  // ==================================================
  {
    const { resolve, calls } = stubResolve({ code: "RESOLVED_RETRY", postId: POST_ID });
    const outcome = await runResolveVerificationCli([POST_ID, "retry", OPERATOR], resolve);
    check("2. exitCode=0 para RESOLVED_RETRY", outcome.exitCode === 0);
    check("2. resolve() fue llamado con decision='retry'", calls[0].decision === "retry");
    check("2. salida indica claimed_at LIMPIADO", outcome.lines.some((l) => l.startsWith("claimed_at=LIMPIADO")));
    check("2. salida indica publisher_operation_ref LIMPIADO", outcome.lines.some((l) => l.startsWith("publisher_operation_ref=LIMPIADO")));
    check("2. salida indica publication_authorized_at LIMPIADO (fix: retry revoca autorizacion anterior)", outcome.lines.some((l) => l.startsWith("publication_authorized_at=LIMPIADO")));
    check("2. salida indica publication_authorized_by LIMPIADO", outcome.lines.some((l) => l.startsWith("publication_authorized_by=LIMPIADO")));
    check("2. salida indica external_post_id preservado", outcome.lines.some((l) => l.startsWith("external_post_id=PRESERVADO")));
    check("2. salida indica retry_count preservado", outcome.lines.some((l) => l.startsWith("retry_count=PRESERVADO")));
    check("2. salida deja explicito que se requiere nueva autorizacion humana explicita", outcome.lines.some((l) => l.includes("nueva autorizacion humana explicita")));
    check("2. salida deja explicito que NO se autorizo publicacion automatica", outcome.lines.some((l) => l.includes("NO se autorizo automaticamente")));
  }

  // ==================================================
  // 3. Argumentos validos + keep-blocked
  // ==================================================
  {
    const { resolve, calls } = stubResolve({ code: "RESOLVED_KEEP_BLOCKED", postId: POST_ID });
    const outcome = await runResolveVerificationCli([POST_ID, "keep-blocked", OPERATOR], resolve);
    check("3. exitCode=0 para RESOLVED_KEEP_BLOCKED", outcome.exitCode === 0);
    check("3. resolve() fue llamado con decision='keep-blocked'", calls[0].decision === "keep-blocked");
    check("3. salida contiene literalmente 'NO UPDATE EXECUTED'", outcome.lines.includes("NO UPDATE EXECUTED"));
  }

  // ==================================================
  // 4. Decision invalida
  // ==================================================
  {
    const { resolve, calls } = stubResolve({ code: "RESOLVED_KEEP_BLOCKED", postId: POST_ID }); // no deberia usarse
    const outcome = await runResolveVerificationCli([POST_ID, "publicar-ya", OPERATOR], resolve);
    check("4. exitCode=1 para decision invalida", outcome.exitCode === 1);
    check("4. resolve() NUNCA fue llamado (rechazo ANTES de tocar la funcion real)", calls.length === 0);
    check("4. salida contiene RESULT=INVALID_ARGUMENTS", outcome.lines.some((l) => l === "RESULT=INVALID_ARGUMENTS"));
    check("4. la razon menciona las decisiones validas", outcome.lines.some((l) => l.includes("published") && l.includes("retry") && l.includes("keep-blocked")));
  }

  // ==================================================
  // 5. postId faltante
  // ==================================================
  {
    const { resolve, calls } = stubResolve({ code: "RESOLVED_KEEP_BLOCKED", postId: "" });
    const outcome = await runResolveVerificationCli(["", "retry", OPERATOR], resolve);
    check("5. exitCode=1 cuando postId es cadena vacia", outcome.exitCode === 1);
    check("5. resolve() NUNCA fue llamado", calls.length === 0);
    check("5. salida contiene RESULT=INVALID_ARGUMENTS con motivo de post-id", outcome.lines.some((l) => l === "RESULT=INVALID_ARGUMENTS") && outcome.lines.some((l) => l.toLowerCase().includes("post-id")));
  }
  {
    // Tambien cubre "argv sin ningun elemento" (POST_ID undefined tras destructuring)
    const { resolve, calls } = stubResolve({ code: "RESOLVED_KEEP_BLOCKED", postId: "" });
    const outcome = await runResolveVerificationCli([], resolve);
    check("5b. argv vacio -> exitCode=1, resolve() nunca llamado", outcome.exitCode === 1 && calls.length === 0);
  }

  // ==================================================
  // 6. operatorId faltante
  // ==================================================
  {
    const { resolve, calls } = stubResolve({ code: "RESOLVED_KEEP_BLOCKED", postId: POST_ID });
    const outcome = await runResolveVerificationCli([POST_ID, "keep-blocked"], resolve);
    check("6. exitCode=1 cuando operatorId esta ausente", outcome.exitCode === 1);
    check("6. resolve() NUNCA fue llamado", calls.length === 0);
    check("6. la razon menciona operator-id", outcome.lines.some((l) => l.toLowerCase().includes("operator-id")));
  }
  {
    const { resolve, calls } = stubResolve({ code: "RESOLVED_KEEP_BLOCKED", postId: POST_ID });
    const outcome = await runResolveVerificationCli([POST_ID, "keep-blocked", "   "], resolve);
    check("6b. operatorId solo espacios -> exitCode=1, resolve() nunca llamado", outcome.exitCode === 1 && calls.length === 0);
  }

  // ==================================================
  // 7. resultado WRONG_STATUS (viene de la funcion real, el CLI solo lo reporta)
  // ==================================================
  {
    const { resolve } = stubResolve({ code: "WRONG_STATUS", postId: POST_ID, status: "pending" });
    const outcome = await runResolveVerificationCli([POST_ID, "retry", OPERATOR], resolve);
    check("7. exitCode=1 para WRONG_STATUS", outcome.exitCode === 1);
    check("7. salida contiene RESULT=WRONG_STATUS y el status real", outcome.lines.some((l) => l === "RESULT=WRONG_STATUS") && outcome.lines.some((l) => l === "status_actual=pending"));
  }

  // ==================================================
  // 8. resultado POST_NOT_FOUND
  // ==================================================
  {
    const { resolve } = stubResolve({ code: "POST_NOT_FOUND", postId: "post-inexistente" });
    const outcome = await runResolveVerificationCli(["post-inexistente", "published", OPERATOR], resolve);
    check("8. exitCode=1 para POST_NOT_FOUND", outcome.exitCode === 1);
    check("8. salida contiene RESULT=POST_NOT_FOUND", outcome.lines.some((l) => l === "RESULT=POST_NOT_FOUND"));
  }

  // ==================================================
  // 9. resultado CONFLICT
  // ==================================================
  {
    const { resolve } = stubResolve({ code: "CONFLICT", postId: POST_ID, decision: "published" });
    const outcome = await runResolveVerificationCli([POST_ID, "published", OPERATOR], resolve);
    check("9. exitCode=1 para CONFLICT", outcome.exitCode === 1);
    check("9. salida contiene RESULT=CONFLICT", outcome.lines.some((l) => l === "RESULT=CONFLICT"));
    check("9. salida deja claro que NO se sobrescribio nada", outcome.lines.some((l) => l.includes("No se sobrescribio nada")));
  }

  // ==================================================
  // Extra — --help no llama a resolve() en absoluto
  // ==================================================
  {
    const { resolve, calls } = stubResolve({ code: "RESOLVED_KEEP_BLOCKED", postId: POST_ID });
    const outcome = await runResolveVerificationCli(["--help"], resolve);
    check("Extra. --help -> exitCode=0, resolve() NUNCA llamado", outcome.exitCode === 0 && calls.length === 0);
    check("Extra. --help imprime el texto de uso", outcome.lines.some((l) => l.includes(USAGE_TEXT)));
    check("Extra. isHelpFlag() reconoce '-h' tambien", isHelpFlag(["-h"]) === true && isHelpFlag(["algo"]) === false);
  }

  // ==================================================
  // Extra — parseResolveVerificationArgs()/describeResolveVerificationResult() puras, sin I/O
  // ==================================================
  {
    const ok = parseResolveVerificationArgs([POST_ID, "retry", OPERATOR]);
    check("Extra. parseResolveVerificationArgs() con argv validos -> ok:true", ok.ok === true);
    const bad = parseResolveVerificationArgs([POST_ID, "borrar-todo", OPERATOR]);
    check("Extra. parseResolveVerificationArgs() con decision invalida -> ok:false", bad.ok === false);
    const lines = describeResolveVerificationResult({ code: "RESOLVED_PUBLISHED", postId: POST_ID, publishedAt: "2026-01-01T00:00:00.000Z" });
    check("Extra. describeResolveVerificationResult() es pura (no lanza, no usa I/O)", Array.isArray(lines) && lines.length > 0);
  }

  // ==================================================
  // 10. Seguridad — cero llamadas HTTP/Meta/B2 en TODA la corrida anterior
  // ==================================================
  check("10. Meta/red: fetchCalls=0 tras las 9 pruebas + extras anteriores", fetchCalls === 0);
  console.log("10. B2: este archivo y resolve-verification.mts no importan storageBridge.mts ni @aws-sdk/client-s3 - cero llamadas posibles.");
  console.log("10. Supabase real: todas las pruebas anteriores inyectaron un `resolve` falso - resolveVerificationRequired() real (y por tanto supabaseAdmin) nunca fue invocado.");

  console.log(`\n${failures === 0 ? "TODAS LAS PRUEBAS PASARON" : `${failures} PRUEBA(S) FALLARON`}`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().finally(() => {
  globalThis.fetch = originalFetch;
});

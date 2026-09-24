// FASE 5.10-B — pruebas de integracion del aislamiento RUN_SCOPE a traves de
// Analyze/Schedule/Publish/Agent1/Agent2. Sigue el mismo criterio ya
// establecido en este repo para codigo que llama a supabaseAdmin
// directamente sin Dependency Injection completa (agent/analyze/claimWork.mts,
// agent/publish/claimPost.mts's claimPost(), agent/schedule/run.mts,
// agent/publish/run.mts): las funciones que SI tienen un camino de
// cortocircuito alcanzable sin red (Decision K.2 - lista de scope vacia)
// se prueban EJECUTANDOLAS de verdad, con un stub de fetch que lanza si
// alguna vez se intenta una llamada real (mismo patron de
// agent/publish/test-recover-stale-claims.mts); el resto (las ramas que SI
// consultarian Supabase con datos no vacios) se verifica por LECTURA DE
// CODIGO del archivo fuente real - mismo criterio ya usado en
// agent/analyze/test-target-selection.mts para partes de run.mts que
// dependen de la estructura de control de main().
import { readFileSync } from "node:fs";

let failures = 0;
const check = (label: string, cond: boolean, extra = "") => {
  const mark = cond ? "PASS" : "FAIL";
  if (!cond) failures++;
  console.log(`[${mark}] ${label}${extra ? " — " + extra : ""}`);
};

function readSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf-8");
}

// Stub de fetch global - CUALQUIER llamada real (Supabase, Meta, Google, B2)
// pasa por fetch en este proyecto. Si alguna de las ramas "scope vacio"
// probadas abajo llegara a intentar una consulta real, esta prueba lo
// detectaria ruidosamente en vez de en silencio.
const originalFetch = globalThis.fetch;
let fetchCalls = 0;
globalThis.fetch = (async (url: unknown) => {
  fetchCalls++;
  throw new Error(`SEGURIDAD: se intento una llamada de red real hacia: ${String(url)} - las ramas de scope vacio NUNCA deben tocar Supabase.`);
}) as typeof fetch;

async function main() {
  // ==================================================================
  // PUBLISH — agent/publish/claimPost.mts::claimPost()
  // ==================================================================
  console.log("\n=== PUBLISH: claimPost() con scope vacio ===");
  {
    process.env.CLAIMED_AT_MIGRATION_APPLIED = "true";
    await import("./publish/config.mts");
    const { claimPost } = await import("./publish/claimPost.mts");

    const before = fetchCalls;
    const result = await claimPost("post-fuera-de-scope", []);
    check("claimPost(postId, []) devuelve null sin consultar Supabase (Decision K.2/K.5)", result === null && fetchCalls === before);
  }

  console.log("\n=== PUBLISH: recoverStaleClaims() con scope vacio ===");
  {
    const { recoverStaleClaims } = await import("./publish/claimPost.mts");
    let findStaleClaimsCalls = 0;
    const spyDeps = {
      async findStaleClaims() {
        findStaleClaimsCalls++;
        return [];
      },
      async updateIfPublishing() {
        return false;
      },
    };
    const result = await recoverStaleClaims([], spyDeps);
    check(
      "recoverStaleClaims([], deps) devuelve contadores en 0 y NUNCA llama a deps.findStaleClaims",
      result.recoveredToPending === 0 && result.movedToVerification === 0 && result.movedToError === 0 && findStaleClaimsCalls === 0
    );
  }

  // ==================================================================
  // ANALYZE — agent/analyze/claimWork.mts
  // ==================================================================
  console.log("\n=== ANALYZE: findPendingWork()/recoverStaleClaims() con scope vacio ===");
  {
    await import("./analyze/config.mts");
    const { findPendingWork, recoverStaleClaims: analyzeRecoverStaleClaims } = await import("./analyze/claimWork.mts");

    const before = fetchCalls;
    const items = await findPendingWork([]);
    check("findPendingWork([]) devuelve [] sin consultar Supabase", Array.isArray(items) && items.length === 0 && fetchCalls === before);

    const before2 = fetchCalls;
    await analyzeRecoverStaleClaims([]);
    check("analyze recoverStaleClaims([]) retorna sin consultar Supabase", fetchCalls === before2);
  }

  // ==================================================================
  // AGENT 1 — agent/discoverAccounts.mts / agent/recoverPending.mts
  // ==================================================================
  console.log("\n=== AGENT 1: getActiveContentAccounts()/recoverPending() con scope vacio ===");
  {
    await import("./config.mts");
    const { getActiveContentAccounts } = await import("./discoverAccounts.mts");
    const { recoverPending } = await import("./recoverPending.mts");

    const before = fetchCalls;
    const accounts = await getActiveContentAccounts([], true);
    check("getActiveContentAccounts([], true) devuelve Map vacio sin consultar Supabase", accounts.size === 0 && fetchCalls === before);

    const before2 = fetchCalls;
    await recoverPending([]);
    check("recoverPending([]) retorna sin consultar Supabase", fetchCalls === before2);
  }

  // ==================================================================
  // Verificacion por lectura de codigo — piezas que SI consultarian
  // Supabase con un scope no vacio (no ejecutables aqui sin red real).
  // ==================================================================
  console.log("\n=== Verificacion por lectura de codigo (patrones de scoping reales) ===");

  {
    const src = readSource("./publish/claimPost.mts");
    const claimPostBody = src.slice(src.indexOf("export async function claimPost("), src.indexOf("\n// Revierte un post"));
    check(
      "claimPost(): el UPDATE incluye .eq('status','pending') SEGUIDO de .in('account_id', allowedAccountIds) ANTES de .select( — mismo CAS, nunca SELECT previo",
      /\.eq\("status", "pending"\)\s*\n\s*\.in\("account_id", allowedAccountIds\)\s*\n\s*\.select\(/.test(claimPostBody)
    );
    check(
      "claimPost(): NO existe ningun .select( ANTES del .update( dentro de la funcion (nunca SELECT-then-UPDATE)",
      !/\.select\(/.test(claimPostBody.slice(0, claimPostBody.indexOf(".update(")))
    );
    check(
      "claimPost(): scope vacio retorna ANTES de construir el updatePayload/tocar supabaseAdmin",
      /if \(allowedAccountIds\.length === 0\) return null;/.test(claimPostBody)
    );

    check(
      "defaultRecoverStaleClaimsDeps.findStaleClaims incluye .in('account_id', allowedAccountIds)",
      /findStaleClaims\(cutoffIso, allowedAccountIds\)[\s\S]{0,400}\.in\("account_id", allowedAccountIds\)/.test(src)
    );
    check(
      "Endurecimiento (post-revision 5.10-B): defaultRecoverStaleClaimsDeps.updateIfPublishing TAMBIEN incluye .in('account_id', allowedAccountIds) en su propio UPDATE",
      /updateIfPublishing\(postId, payload, allowedAccountIds\)[\s\S]{0,400}\.in\("account_id", allowedAccountIds\)/.test(src)
    );
  }

  {
    const src = readSource("./schedule/run.mts");
    check(
      "schedule/run.mts resuelve RUN_SCOPE (resolveRunScope) antes de cualquier query",
      /const scope = await resolveRunScope\(\);/.test(src)
    );
    check(
      "schedule/run.mts modo global: content_files.in('content_account_id', scope.allowedContentAccountIds) ANTES de content_metadata",
      /content_files[\s\S]{0,200}\.in\("content_account_id", scope\.allowedContentAccountIds\)/.test(src)
    );
    check(
      "schedule/run.mts modo global: content_metadata filtrado por .in('content_file_id', scopedFileIds) — nunca la query global vieja sin filtro",
      /content_metadata"\)[\s\S]{0,200}\.eq\("status", "ready"\)[\s\S]{0,100}\.in\("content_file_id", scopedFileIds\)/.test(src)
    );
    check(
      "schedule/run.mts modo dirigido valida scope.allowedContentAccountIds.includes(fileRow.content_account_id) antes de procesar",
      /scope\.allowedContentAccountIds\.includes\(fileRow\.content_account_id/.test(src)
    );
    check("schedule/run.mts: scope vacio nunca ejecuta la query de content_files (K.2)", /scope\.allowedContentAccountIds\.length === 0/.test(src));
  }

  {
    const src = readSource("./publish/run.mts");
    check("publish/run.mts resuelve RUN_SCOPE antes de cualquier query", /const scope = await resolveRunScope\(\);/.test(src));
    check(
      "publish/run.mts modo 'all': query de vencidos incluye .in('account_id', scope.allowedSocialAccountIds)",
      /\.lte\("scheduled_at", new Date\(\)\.toISOString\(\)\)\s*\n\s*\.in\("account_id", scope\.allowedSocialAccountIds\)/.test(src)
    );
    check(
      "publish/run.mts modo dirigido (POST_ID) valida scope.allowedSocialAccountIds.includes(row.account_id) ANTES de evaluar elegibilidad",
      /scope\.allowedSocialAccountIds\.includes\(row\.account_id/.test(src)
    );
    check(
      "publish/run.mts: processPost()/claimPost() reciben scope.allowedSocialAccountIds en ambos modos",
      /processPost\(target\.postId, scope\.allowedSocialAccountIds\)/.test(src) && /processPost\(row\.id, scope\.allowedSocialAccountIds\)/.test(src)
    );
  }

  {
    const src = readSource("./analyze/run.mts");
    check("analyze/run.mts resuelve RUN_SCOPE antes de cualquier modo (directed o global)", /const scope = await resolveRunScope\(\);/.test(src));
    check(
      "analyze/run.mts modo dirigido valida scope.allowedContentAccountIds.includes(fileRow.content_account_id)",
      /scope\.allowedContentAccountIds\.includes\(fileRow\.content_account_id/.test(src)
    );
    check(
      "analyze/run.mts modo global pasa scope.allowedContentAccountIds a recoverStaleClaims/findPendingWork",
      /recoverStaleClaims\(scope\.allowedContentAccountIds\)/.test(src) && /findPendingWork\(scope\.allowedContentAccountIds\)/.test(src)
    );
  }

  {
    const src = readSource("./run.mts");
    check("agent/run.mts (watcher) resuelve RUN_SCOPE ANTES de assertMaterialRootExists()", /const scope = await resolveRunScope\(\);[\s\S]{0,1000}assertMaterialRootExists\(\)/.test(src));
    check("agent/run.mts: runDirected() recibe scope y lo pasa a processFile()", /runDirected\(watchMode\.filePath, scope\)/.test(src) && /processFile\(filePath, scope\.allowedContentAccountIds\)/.test(src));
    check("agent/run.mts: invariante materialRoot verificado (scope.materialRoot !== MATERIAL_ROOT)", /scope\.materialRoot !== MATERIAL_ROOT/.test(src));
  }

  {
    const configSrc = readSource("../scripts/pipeline/config.mts");
    const agentSrc = readSource("../scripts/pipeline/agent.mts");
    check(
      "scripts/pipeline/config.mts: resolveAgentTwoScope() PRODUCTION intersecta con la lista cerrada de 4 (nunca channelRegistry.mts's channelStatus)",
      /resolveScannableChannels\(\)\.filter\(\(name\) => \(PRODUCTION_FOLDER_NAMES as readonly string\[\]\)\.includes\(name\)\)/.test(configSrc)
    );
    check("scripts/pipeline/config.mts: TEST devuelve [] deliberadamente (comentario de limitacion conocida presente)", /Agent 2 TEST devuelve \[\] deliberadamente/.test(configSrc));
    check(
      "scripts/pipeline/agent.mts: resolveAgentTwoScope() se llama en main() ANTES de acquireLock()",
      /const scope = resolveAgentTwoScope\(\);[\s\S]{0,1000}acquireLock\(\)/.test(agentSrc)
    );
    check("scripts/pipeline/agent.mts: resolveProject()/ignored()/reconcileOnce() usan scopedAccounts, no ACCOUNTS directo", !/\(ACCOUNTS as readonly string\[\]\)/.test(agentSrc) && /scopedAccounts\.includes\(account\)/.test(agentSrc));
  }

  check("SEGURIDAD FINAL — ninguna prueba de scope vacio de este archivo llamo a fetch/red real", fetchCalls === 0);

  console.log(`\n${failures === 0 ? "TODAS LAS PRUEBAS PASARON" : `${failures} PRUEBA(S) FALLARON`}`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().finally(() => {
  globalThis.fetch = originalFetch;
});

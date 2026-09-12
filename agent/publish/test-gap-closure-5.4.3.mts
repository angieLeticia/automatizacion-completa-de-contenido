// Fase 5.4.3 — pruebas de los 3 gaps encontrados en la auditoria Fase 5.4.2 y
// cerrados en esta fase. Deliberadamente NO se importa run.mts ni claimPost.mts
// (ambos disparan la construccion real del cliente Supabase al importarse -
// mismo motivo documentado en test-uncertain-outcome.mts) - se prueba la
// logica pura extraida (GAP 2) y el estado real del filesystem (GAP 1).
//
// GAP 3 (aislamiento de markPublishAttemptStarted() en run.mts) NO tiene un
// test automatizado aqui: la propiedad exacta que had que demostrar -
// "si el checkpoint falla, publish() no se llama Y el ciclo de main() sigue
// con el siguiente post" - vive enteramente dentro de processPost()/main(),
// que no son exportables sin ejecutar main() contra Supabase real al
// importar el modulo (mismo limite arquitectonico que ya impidio probar
// TEST 10/11 en test-uncertain-outcome.mts). Se verifica por INSPECCION DE
// CODIGO explicita, no se fabrica una prueba automatizada para simular algo
// que requeriria mockear la cadena completa de llamadas a Supabase o
// reestructurar run.mts (fuera del alcance de un cierre quirurgico de gaps):
//
//   agent/publish/run.mts, líneas ~128-138: el nuevo bloque
//   `try { await markPublishAttemptStarted(...) } catch (err) { ...; await
//   finishWithFailure(...); return; }` está ANTES del try que envuelve
//   `await publish(...)` (línea ~141) - un `return` dentro del catch hace que
//   la ejecución de processPost() termine ahí, por lo que la línea que llama
//   a publish() es estructuralmente inalcanzable si el checkpoint lanza. Y
//   como esta captura vive DENTRO de processPost() (no en el nivel de
//   main()), una excepción de un post ya no puede escapar hacia el bucle
//   `for (const row of dueRows) { await processPost(row.id); }` de main() -
//   el siguiente post del mismo ciclo se sigue procesando con normalidad.
import { PublicationOutcomeUncertainError } from "../../lib/social/types.ts";
import { buildUncertainOutcomePersistFailureLog } from "./uncertainOutcome.mts";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

let failures = 0;
const check = (label: string, cond: boolean, extra = "") => {
  const mark = cond ? "PASS" : "FAIL";
  if (!cond) failures++;
  console.log(`[${mark}] ${label}${extra ? " — " + extra : ""}`);
};

const REPO_ROOT = path.join(import.meta.dirname, "..", "..");

function main() {
  // ==================================================
  // GAP 2 — buildUncertainOutcomePersistFailureLog() (pura, sin Supabase):
  // el log resultante nunca debe sugerir pending/retry, y debe conservar
  // suficiente contexto (postId, platform, operationRef, causa real) para
  // que una revisión manual sea directa.
  // ==================================================
  const fakeErr = new PublicationOutcomeUncertainError("YouTube respondió éxito pero no se pudo interpretar la respuesta", {
    platform: "youtube",
    operationRef: "https://upload.example.com/resumable/xyz",
    httpStatus: 200,
  });

  const fromReturnedError = buildUncertainOutcomePersistFailureLog("post-1", fakeErr, "duplicate key value violates unique constraint");
  check("TEST 1 — UPDATE que devuelve {error}: mensaje NO menciona pending/reintento", !/pending|reintent/i.test(fromReturnedError.message));
  check("TEST 1 — meta.postId correcto", fromReturnedError.meta.postId === "post-1");
  check("TEST 1 — meta.platform correcto", fromReturnedError.meta.platform === "youtube");
  check("TEST 1 — meta.operationRef conservado", fromReturnedError.meta.operationRef === "https://upload.example.com/resumable/xyz");
  check("TEST 1 — meta.persistFailureCause conserva la causa real devuelta por Supabase", fromReturnedError.meta.persistFailureCause === "duplicate key value violates unique constraint");

  const fromThrown = buildUncertainOutcomePersistFailureLog("post-2", fakeErr, "fetch failed: ECONNRESET");
  check("TEST 2 — UPDATE que lanza excepción: mensaje NO menciona pending/reintento", !/pending|reintent/i.test(fromThrown.message));
  check("TEST 2 — meta.persistFailureCause conserva la causa real de la excepción", fromThrown.meta.persistFailureCause === "fetch failed: ECONNRESET");
  check("TEST 2 — meta.originalReason conserva el motivo original del resultado incierto", fromThrown.meta.originalReason === fakeErr.message);
  check(
    "TEST 1/2 — el mensaje es observable (no vacío) en ambos casos, para que log.error() lo persista en agent/logs/",
    fromReturnedError.message.length > 20 && fromThrown.message.length > 20
  );

  // ==================================================
  // TEST 5 — Flow A ya no tiene ejecución automática: el archivo dejó de
  // vivir bajo .github/workflows/ con extensión .yml/.yaml (GitHub Actions
  // solo reconoce workflows ahí, con esa extensión exacta). Se verifica en
  // el filesystem real, sin invocar `gh`/GitHub Actions.
  // ==================================================
  const activeWorkflowPath = path.join(REPO_ROOT, ".github", "workflows", "publish-social.yml");
  const retiredWorkflowPath = path.join(REPO_ROOT, ".github", "workflows", "publish-social.yml.retired");
  check("TEST 5 — .github/workflows/publish-social.yml (activo) ya NO existe", !existsSync(activeWorkflowPath));
  check("TEST 5 — .github/workflows/publish-social.yml.retired existe (contenido conservado)", existsSync(retiredWorkflowPath));
  if (existsSync(retiredWorkflowPath)) {
    const retiredContent = readFileSync(retiredWorkflowPath, "utf-8");
    check("TEST 5 — el contenido conserva el cron original (evidencia, no se reescribió el trigger)", retiredContent.includes('cron: "*/10 * * * *"'));
    check("TEST 5 — el archivo documenta explícitamente su retiro", /RETIRAD[OA]/i.test(retiredContent));
  }

  // Fase 5.18 — se relajó de "cero archivos .yml/.yaml adicionales" a "ningún
  // OTRO workflow invoca al script legacy de publicación": el 12 sept 2026 se
  // agregó legítimamente `deploy-website-pages.yml` (despliegue de un sitio
  // estático a GitHub Pages, disparado solo por cambios en `website/**` —
  // relacionado con la verificación de dominio de TikTok de Fase 5.12, sin
  // ninguna relación con Flow A/social publishing). La garantía real que
  // importa (nunca reintroducir un segundo cron que publique) sigue
  // verificándose explícitamente: ningún workflow .yml activo debe mencionar
  // el script legacy ni ejecutar publicación automática.
  const workflowsDir = path.join(REPO_ROOT, ".github", "workflows");
  const activeYmlFiles = readdirSync(workflowsDir).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"));
  const workflowsReferencingLegacyPublish = activeYmlFiles.filter((f) => readFileSync(path.join(workflowsDir, f), "utf-8").includes("publish-due-social-posts"));
  check(
    "TEST 5 — ningún workflow ACTIVO (.yml/.yaml) invoca scripts/publish-due-social-posts.mts (Flow A sigue sin disparador automático)",
    workflowsReferencingLegacyPublish.length === 0,
    `workflows activos: ${JSON.stringify(activeYmlFiles)} | referencian Flow A: ${JSON.stringify(workflowsReferencingLegacyPublish)}`
  );

  console.log(`\n${failures === 0 ? "TODOS LOS CASOS PASARON" : `${failures} CASO(S) FALLARON`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main();

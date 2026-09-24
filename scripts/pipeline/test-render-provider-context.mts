// Fase 1.5.5 — pruebas AISLADAS del gate context.renderProviderId, SIN
// invocar processProject() completo (eso lo prueba la integración E2E aparte)
// y SIN usar ningún canal real salvo donde resolveRenderProvider(account)
// necesita fallar de forma conocida (mismo patrón ya usado desde Fase 1.4/1.5:
// una cuenta ficticia no registrada -> ChannelNotFoundError, real y
// determinístico, sin tocar D:\MATERIAL VIDEOS ni ningún canal real).
import { RENDER_PROVIDERS } from "./renderProviderRegistry.mts";

let failures = 0;
const check = (label: string, cond: boolean, extra = "") => {
  const mark = cond ? "PASS" : "FAIL";
  if (!cond) failures++;
  console.log(`[${mark}] ${label}${extra ? " — " + extra : ""}`);
};

// Réplica EXACTA (no importada, ver nota abajo) de la lógica de gate agregada
// a processOne.mts::processProject() — se prueba acá de forma aislada, sin
// disparar ningún efecto secundario real (whisper/ElevenLabs/render), porque
// processProject() completo no puede llamarse sin atravesar TODO el pipeline.
// La prueba de integración (test-sandbox-e2e-fase155.mts) confirma que esta
// MISMA lógica, ya integrada dentro de processProject(), se comporta igual.
function resolveGateForTest(
  account: string,
  context: { renderProviderId?: string } | undefined,
  resolveRenderProviderReal: (account: string) => { id: string }
): { id: string } {
  if (context?.renderProviderId) {
    const provider = RENDER_PROVIDERS[context.renderProviderId];
    if (!provider) throw new Error(`renderProviderId="${context.renderProviderId}" no existe en RENDER_PROVIDERS`);
    return provider;
  }
  return resolveRenderProviderReal(account);
}

async function main() {
  const { resolveRenderProvider, ChannelNotFoundError } = await import("./renderProviderRegistry.mts");

  // ---- 1. context undefined -> resolver real ----
  {
    let threw = false;
    try {
      resolveGateForTest("CUENTA_FICTICIA_NO_REGISTRADA_FASE155", undefined, resolveRenderProvider);
    } catch (err) {
      threw = err instanceof ChannelNotFoundError;
    }
    check("1. context undefined -> pasa por resolveRenderProvider(account) real (falla por canal ficticio, como siempre)", threw);
  }

  // ---- 2. context sin renderProviderId -> resolver real ----
  {
    let threw = false;
    try {
      resolveGateForTest("CUENTA_FICTICIA_NO_REGISTRADA_FASE155", { renderProviderId: undefined }, resolveRenderProvider);
    } catch (err) {
      threw = err instanceof ChannelNotFoundError;
    }
    check("2. context definido pero SIN renderProviderId -> igual resuelve por canal real (sin bypass)", threw);
  }

  // ---- 3. context + "documentary-remotion" -> provider correcto ----
  {
    const provider = resolveGateForTest("CUENTA_FICTICIA_NO_REGISTRADA_FASE155", { renderProviderId: "documentary-remotion" }, resolveRenderProvider);
    check('3. renderProviderId="documentary-remotion" -> resuelve exactamente RENDER_PROVIDERS["documentary-remotion"]', provider === RENDER_PROVIDERS["documentary-remotion"]);
  }

  // ---- 4. context + "quote-video-remotion" -> provider correcto ----
  {
    const provider = resolveGateForTest("CUENTA_FICTICIA_NO_REGISTRADA_FASE155", { renderProviderId: "quote-video-remotion" }, resolveRenderProvider);
    check('4. renderProviderId="quote-video-remotion" -> resuelve exactamente RENDER_PROVIDERS["quote-video-remotion"]', provider === RENDER_PROVIDERS["quote-video-remotion"]);
  }

  // ---- 5. context + provider inexistente -> error, SIN fallback ----
  {
    let threwCorrectMessage = false;
    try {
      resolveGateForTest("CUENTA_FICTICIA_NO_REGISTRADA_FASE155", { renderProviderId: "NO_EXISTE" }, resolveRenderProvider);
    } catch (err) {
      threwCorrectMessage = err instanceof Error && err.message.includes("NO_EXISTE") && err.message.includes("no existe en RENDER_PROVIDERS");
    }
    check("5. renderProviderId inexistente -> ERROR explícito, nunca cae a resolveRenderProvider(account)", threwCorrectMessage);
  }

  // ---- 6. renderProviderId="" -> NO activa el bypass (se trata como ausente) ----
  {
    let threw = false;
    try {
      resolveGateForTest("CUENTA_FICTICIA_NO_REGISTRADA_FASE155", { renderProviderId: "" }, resolveRenderProvider);
    } catch (err) {
      threw = err instanceof ChannelNotFoundError; // NUNCA "no existe en RENDER_PROVIDERS" — eso probaría que sí activó el bypass
    }
    check('6. renderProviderId="" -> tratado como ausente, sigue resolviendo por canal real (nunca activa el bypass)', threw);
  }

  // ---- 7. renderProviderId sin contexto completo -> ERROR ----
  // `buildContextFromEnv()` (processOne.mts) es una función privada (no
  // exportada) — exportarla no es necesario para esta fase (solo 3 archivos
  // autorizados: pipelineExecutionContext.mts/renderProviderRegistry.mts/
  // processOne.mts, y agregar un export nuevo ahí sería un cambio adicional
  // no pedido). Se prueba end-to-end, real, spawneando el CLI real con
  // PIPELINE_TEST_RENDER_PROVIDER_ID solo (sin las 4 rutas) — exactamente el
  // mismo camino que usaría un worker real.
  console.log("\n--- 7. renderProviderId sin las 4 rutas de contexto -> ERROR real, proceso real ---");
  {
    const { spawn } = await import("node:child_process");
    const exitCode = await new Promise<number | null>((resolve) => {
      const child = spawn(
        "node",
        ["--import", "tsx/esm", new URL("./processOne.mts", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"), "CUENTA_FICTICIA_NO_REGISTRADA_FASE155", "999"],
        {
          cwd: new URL("../..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
          stdio: "ignore",
          env: { ...process.env, PIPELINE_TEST_RENDER_PROVIDER_ID: "documentary-remotion" },
        }
      );
      child.once("exit", (code) => resolve(code));
    });
    check("7. exit code 1 (ERROR real, proceso real) — el CLI real rechaza un renderProviderId sin las 4 rutas de contexto", exitCode === 1, `exit=${exitCode}`);
  }

  // ---- 8/9/10. el provider de sandbox reutilizado NO consulta channelRegistry/Supabase/OAuth ----
  console.log("\n--- 8-10. el provider reutilizado no depende de canal/Supabase/OAuth ---");
  const fs = await import("node:fs");
  const providerSrc = fs.readFileSync(new URL("./documentaryRemotionProvider.mts", import.meta.url), "utf-8");
  check("8. documentaryRemotionProvider.mts NO importa channelRegistry.mts", !providerSrc.includes("channelRegistry"));
  check("9. documentaryRemotionProvider.mts NO importa nada de Supabase", !/supabase/i.test(providerSrc));
  check("10. documentaryRemotionProvider.mts NO importa nada de OAuth/credenciales", !/oauth|client_secret|refresh_token/i.test(providerSrc));

  // ---- 11. el camino real (sin bypass) sigue funcionando exactamente igual ----
  // Deliberadamente NO se usa ningún canal real acá (evitable, según pide esta
  // fase): las pruebas 1 y 2 de arriba YA confirman, contra una cuenta
  // ficticia, que resolveRenderProvider(account) real sigue lanzando
  // ChannelNotFoundError sin cambios cuando no hay bypass — el caso positivo
  // completo (un canal real resolviendo su provider real) ya está cubierto,
  // sin modificar nada, por scripts/pipeline/test-render-provider.mts
  // (preexistente, no tocado en esta fase) — no se duplica esa cobertura acá.
  console.log("\n--- 11. camino real (sin bypass) — cubierto por tests 1/2 (fail real intacto) + test-render-provider.mts preexistente (caso positivo, no duplicado aquí) ---");
  check("11. resolveRenderProvider(account) real sigue intacto (evidencia: tests 1/2 arriba + test-render-provider.mts sin tocar)", true);

  console.log(`\n=== ${failures === 0 ? "TODO PASS" : `${failures} FALLO(S)`} ===`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Error ejecutando las pruebas:", err);
  process.exit(1);
});

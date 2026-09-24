// Post-Fase 11 — "preparar el proyecto para las decisiones humanas
// pendientes": UNA prueba parametrizada para los 3 canales nuevos
// (ENCIENDE EL CAOS / LUNA VERDE / OBJETOS MALDITOS), vía
// documentaryChannelE2ETestKit.mts::runIsolationCheck() — identidad,
// guards de código fuente, render real sin watermark, bloqueo real de voz,
// seguridad. Deliberadamente NO repite la prueba pesada de "props reales
// con narración de 20s" (ya quedó probada con datos reales para los 3
// canales en la ronda anterior) — esta ronda es sobre AISLAMIENTO, no sobre
// re-demostrar el mecanismo de props.
//
// chaosNewsRemotionProvider (Fase 5/6.5) ya implementa exactamente el mismo
// contrato RealDataRenderProvider que lunaVerdeRemotionProvider/
// objetosMalditosRemotionProvider — se reutiliza el MISMO kit para los 3,
// sin duplicar lógica de prueba por canal.
import "./env.mts";
import path from "node:path";
import { readFileSync } from "node:fs";
import { runIsolationCheck, type DocumentaryChannelTestParams } from "./documentaryChannelE2ETestKit.mts";
import { chaosNewsRemotionProvider } from "./chaosNewsRemotionProvider.mts";
import { lunaVerdeRemotionProvider } from "./lunaVerdeRemotionProvider.mts";
import { objetosMalditosRemotionProvider } from "./objetosMalditosRemotionProvider.mts";
import { enciendeElCaosTheme } from "../../channels/enciende-el-caos/theme.ts";
import { lunaVerdeTheme } from "../../channels/luna-verde/theme.ts";
import { objetosMalditosTheme } from "../../channels/objetos-malditos/theme.ts";
import { documentaryRemotionProvider } from "./documentaryRemotionProvider.mts";
import { resolveChannelConfig, resolveScannableChannels } from "./channelRegistry.mts";
import { resolveRenderProvider } from "./renderProviderRegistry.mts";
import { sinExplicacionTheme } from "../../remotion/theme.ts";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");

let totalFailures = 0;
const check = (label: string, cond: boolean, extra = "") => {
  const mark = cond ? "PASS" : "FAIL";
  if (!cond) totalFailures++;
  console.log(`[${mark}] ${label}${extra ? " — " + extra : ""}`);
};

const channels: DocumentaryChannelTestParams[] = [
  {
    channelDisplayName: "ENCIENDE EL CAOS",
    testAccountName: "TESTECAOSISOL",
    testEpisodeId: "TESTECISOLEP1",
    renderProviderId: "chaos-news-remotion",
    provider: chaosNewsRemotionProvider,
    mainCompositionOutputPrefix: "chaos-news-main-",
    clipCompositionOutputPrefix: "chaos-news-clip-",
    theme: enciendeElCaosTheme,
    fixtureAssetFolder: "_fixture_chaos",
    mainCompositionSourceFile: path.join(REPO_ROOT, "remotion", "ChaosNewsMain.tsx"),
    expectedFixtureDurationSeconds: 12.5, // chaosMainFixture: hook(60f)+bumper(45f)+narración(270f)=375f
  },
  {
    channelDisplayName: "LUNA VERDE",
    testAccountName: "TESTLVISOL",
    testEpisodeId: "TESTLVISOLEP1",
    renderProviderId: "luna-verde-remotion",
    provider: lunaVerdeRemotionProvider,
    mainCompositionOutputPrefix: "luna-verde-main-",
    clipCompositionOutputPrefix: "luna-verde-clip-",
    theme: lunaVerdeTheme,
    fixtureAssetFolder: "_fixture_luna_verde",
    mainCompositionSourceFile: path.join(REPO_ROOT, "remotion", "GenericDocumentaryMain.tsx"),
    expectedFixtureDurationSeconds: 9,
  },
  {
    channelDisplayName: "OBJETOS MALDITOS",
    testAccountName: "TESTOMISOL",
    testEpisodeId: "TESTOMISOLEP1",
    renderProviderId: "objetos-malditos-remotion",
    provider: objetosMalditosRemotionProvider,
    mainCompositionOutputPrefix: "objetos-malditos-main-",
    clipCompositionOutputPrefix: "objetos-malditos-clip-",
    theme: objetosMalditosTheme,
    fixtureAssetFolder: "_fixture_objetos_malditos",
    mainCompositionSourceFile: path.join(REPO_ROOT, "remotion", "GenericDocumentaryMain.tsx"),
    expectedFixtureDurationSeconds: 9,
  },
];

async function main() {
  for (const params of channels) {
    const channelFailures = await runIsolationCheck(params);
    totalFailures += channelFailures;
  }

  // ============================================================
  // CONFIRMACIÓN EXPLÍCITA — SIN EXPLICACIÓN sigue exactamente igual
  // (requisito explícito del encargo: "confirma explícitamente que SIN
  // EXPLICACIÓN sigue exactamente igual").
  // ============================================================
  console.log("\n=== SIN EXPLICACIÓN — confirmación explícita de que nada cambió ===");
  check('resolveScannableChannels() === ["SIN EXPLICACIÓN"] (único canal escaneable, sin cambios)', JSON.stringify(resolveScannableChannels()) === JSON.stringify(["SIN EXPLICACIÓN"]));
  const config = resolveChannelConfig("SIN EXPLICACIÓN");
  check('SIN EXPLICACIÓN.channelStatus === "ACTIVE" (sin cambios)', config?.channelStatus === "ACTIVE");
  check('SIN EXPLICACIÓN.renderProviderId === "documentary-remotion" (sin cambios)', config?.renderProviderId === "documentary-remotion");
  check("SIN EXPLICACIÓN.voice sigue siendo el patrón real histórico (kate/velvet)", config?.voice?.narratorVoicePattern?.source?.toLowerCase().includes("kate") ?? false);
  const provider = resolveRenderProvider("SIN EXPLICACIÓN");
  check('resolveRenderProvider("SIN EXPLICACIÓN") === documentaryRemotionProvider (sin cambios)', provider === documentaryRemotionProvider);
  const docSrc = readFileSync(path.join(REPO_ROOT, "scripts", "pipeline", "documentaryRemotionProvider.mts"), "utf-8");
  check("documentaryRemotionProvider.mts no ganó renderMainWithRealData/renderClipWithRealData (nunca se le exigió la nueva capacidad)", !/renderMainWithRealData|renderClipWithRealData/.test(docSrc));
  check("sinExplicacionTheme.colors.accent es el valor real histórico (#c81e1e), sin cambios", sinExplicacionTheme.colors.accent === "#c81e1e");

  console.log(`\n=== ${totalFailures === 0 ? "TODO PASS (3 canales + SIN EXPLICACIÓN)" : `${totalFailures} FALLO(S) TOTAL`} ===`);
  process.exit(totalFailures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Error ejecutando la prueba de aislamiento de 3 canales:", err);
  process.exit(1);
});

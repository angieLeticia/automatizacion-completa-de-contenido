// FASE 9-11 — pruebas A-E de OBJETOS MALDITOS, vía el kit compartido (ver
// documentaryChannelE2ETestKit.mts para el detalle de cada test).
import "./env.mts";
import path from "node:path";
import { runDocumentaryChannelE2E } from "./documentaryChannelE2ETestKit.mts";
import { objetosMalditosRemotionProvider } from "./objetosMalditosRemotionProvider.mts";
import { objetosMalditosTheme } from "../../channels/objetos-malditos/theme.ts";

const failures = await runDocumentaryChannelE2E({
  channelDisplayName: "OBJETOS MALDITOS",
  testAccountName: "TESTOBJMALDITOSE2E",
  testEpisodeId: "TESTOMEP001",
  renderProviderId: "objetos-malditos-remotion",
  provider: objetosMalditosRemotionProvider,
  mainCompositionOutputPrefix: "objetos-malditos-main-",
  clipCompositionOutputPrefix: "objetos-malditos-clip-",
  theme: objetosMalditosTheme,
  fixtureAssetFolder: "_fixture_objetos_malditos",
  mainCompositionSourceFile: path.join(process.cwd(), "remotion", "GenericDocumentaryMain.tsx"),
  expectedFixtureDurationSeconds: 9,
});

process.exit(failures === 0 ? 0 : 1);

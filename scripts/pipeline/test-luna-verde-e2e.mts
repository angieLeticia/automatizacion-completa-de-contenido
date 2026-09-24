// FASE 9-11 — pruebas A-E de LUNA VERDE, vía el kit compartido (ver
// documentaryChannelE2ETestKit.mts para el detalle de cada test).
import "./env.mts";
import path from "node:path";
import { runDocumentaryChannelE2E } from "./documentaryChannelE2ETestKit.mts";
import { lunaVerdeRemotionProvider } from "./lunaVerdeRemotionProvider.mts";
import { lunaVerdeTheme } from "../../channels/luna-verde/theme.ts";

const failures = await runDocumentaryChannelE2E({
  channelDisplayName: "LUNA VERDE",
  testAccountName: "TESTLUNAVERDEE2E",
  testEpisodeId: "TESTLVEP001",
  renderProviderId: "luna-verde-remotion",
  provider: lunaVerdeRemotionProvider,
  mainCompositionOutputPrefix: "luna-verde-main-",
  clipCompositionOutputPrefix: "luna-verde-clip-",
  theme: lunaVerdeTheme,
  fixtureAssetFolder: "_fixture_luna_verde",
  mainCompositionSourceFile: path.join(process.cwd(), "remotion", "GenericDocumentaryMain.tsx"),
  expectedFixtureDurationSeconds: 9,
});

process.exit(failures === 0 ? 0 : 1);

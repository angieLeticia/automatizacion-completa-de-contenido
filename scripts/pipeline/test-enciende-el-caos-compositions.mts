// FASE 5.10-AQ (Fase 4 — composiciones de ENCIENDE EL CAOS) — pruebas
// estructurales (mismo patrón usado en todo el proyecto para remotion/*.tsx,
// sin infraestructura de render/testing de React) + verificación de que el
// registro real en Root.tsx ya fue confirmado con Remotion real
// (`npx remotion compositions` y 4 renders sintéticos parciales — ver
// informe de esta fase para la evidencia completa, no repetida aquí para no
// gastar tiempo de render en cada corrida de esta prueba).
import { readFileSync } from "node:fs";
import { chaosMainDurationInFrames, chaosClipDurationInFrames } from "../../remotion/lib/chaosEpisode.ts";
import { chaosMainFixture, chaosClipFixture } from "../../remotion/lib/chaosFixture.ts";
import { enciendeElCaosTheme } from "../../channels/enciende-el-caos/theme.ts";

let failures = 0;
const check = (label: string, cond: boolean, extra = "") => {
  const mark = cond ? "PASS" : "FAIL";
  if (!cond) failures++;
  console.log(`[${mark}] ${label}${extra ? " — " + extra : ""}`);
};

const read = (relPath: string): string => readFileSync(new URL(relPath, import.meta.url), "utf8");
// Quita "//" línea a línea Y "/* ... */"/"{/* ... */}" (JSX) multilínea —
// ChaosNewsMain.tsx/ChaosNewsClip.tsx usan comentarios JSX de bloque para
// las notas de seguridad de Watermark/AmbientAudio, que mencionan "SIN
// EXPLICACIÓN" legítimamente como documentación, no como código real.
const stripLineComments = (src: string): string =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/)
    .map((l) => l.replace(/\/\/.*/, ""))
    .join("\n");

// ============================================================
// REGISTRO
// ============================================================
{
  const rootSrc = read("../../remotion/Root.tsx");
  check('Root.tsx registra <Composition id="ChaosNewsMain">', /id="ChaosNewsMain"/.test(rootSrc));
  check('Root.tsx registra <Composition id="ChaosNewsClip">', /id="ChaosNewsClip"/.test(rootSrc));
  check('ID "ChaosNewsMain" es puramente alfanumérico (sin _, -, espacios)', /^[a-zA-Z0-9]+$/.test("ChaosNewsMain"));
  check('ID "ChaosNewsClip" es puramente alfanumérico (sin _, -, espacios)', /^[a-zA-Z0-9]+$/.test("ChaosNewsClip"));

  // Ninguna composición histórica fue eliminada/renombrada.
  for (const historicId of ['id={`MainDocumentary-${episode.id}`}', 'id="Intro"', 'id="IntroLandscape"', 'id={`Chapter-${chapter.number}`}', 'id="ClosingCTA"', 'id={`Short-${episode.id}-${i}`}', 'id={`Quote-alza-la-voz-${video.id}-${format.id}`}']) {
    check(`Root.tsx conserva la composición histórica: ${historicId}`, rootSrc.includes(historicId));
  }
  check("Root.tsx: el registro de ChaosNewsMain/ChaosNewsClip es ADITIVO (después de las composiciones históricas, mismo bloque <>...</>)", rootSrc.indexOf('id="ChaosNewsMain"') > rootSrc.indexOf('id="ClosingCTA"'));
}

// ============================================================
// CONTRATO — duración/props calculados correctamente
// ============================================================
{
  check("chaosMainDurationInFrames(fixture) es un número positivo", chaosMainDurationInFrames(chaosMainFixture) > 0);
  check(
    "chaosMainDurationInFrames = hook + bumper + max(narración, captions) (375 = 60+45+270)",
    chaosMainDurationInFrames(chaosMainFixture) === 375
  );
  check("chaosClipDurationInFrames(fixture) = endFrame - startFrame", chaosClipDurationInFrames(chaosClipFixture) === chaosClipFixture.endFrame - chaosClipFixture.startFrame);

  // Valores opcionales omitidos (audio, closing, narrationFile, logoSrc,
  // imageSrc de watermark) no rompen el cálculo ni el tipo.
  check("chaosMainFixture.audio está OMITIDO (sin selección definitiva de música/SFX todavía)", chaosMainFixture.audio === undefined);
  check("chaosMainFixture.closing está OMITIDO (sin CTA definitivo)", chaosMainFixture.closing === undefined);
  check("chaosMainFixture.narrationFile está OMITIDO (sin voz real)", chaosMainFixture.narrationFile === undefined);
  check("chaosMainFixture.bumper.logoSrc está OMITIDO (sin logo real)", chaosMainFixture.bumper.logoSrc === undefined);
  check("chaosMainFixture NO tiene watermark configurado (sin asset real)", (chaosMainFixture as { watermark?: unknown }).watermark === undefined);
}

// ============================================================
// CONTRATO — ausencia de logo/voz no genera referencias falsas
// ============================================================
{
  const fixtureSrc = read("../../remotion/lib/chaosFixture.ts");
  check('chaosFixture.ts NO referencia "logo-enciende-el-caos" (ningún archivo inventado)', !fixtureSrc.includes("logo-enciende-el-caos"));
  check("chaosFixture.ts NO define ningún narrationFile real (sin voz)", !/narrationFile:/.test(stripLineComments(fixtureSrc)));

  const mainSrc = read("../../remotion/ChaosNewsMain.tsx");
  const clipSrc = read("../../remotion/ChaosNewsClip.tsx");
  for (const [label, src] of [["ChaosNewsMain", mainSrc], ["ChaosNewsClip", clipSrc]] as const) {
    check(`${label}: <Watermark> solo se monta si watermark?.imageSrc existe (nunca hereda el logo de SIN EXPLICACIÓN por accidente)`, /\{watermark\?\.imageSrc && </.test(src));
    check(`${label}: <AmbientAudio> solo se monta si config.audio existe (nunca hereda la música de SIN EXPLICACIÓN por accidente)`, /\{config\.audio && </.test(src));
    check(`${label}: NO contiene ninguna ruta de asset con "enciende-el-caos" o "chaos" inventada (png/svg/mp3/mp4/wav)`, !/(enciende-el-caos|chaos)[^"'`]*\.(png|svg|mp3|mp4|wav|jpe?g)/i.test(stripLineComments(src)));
  }
}

// ============================================================
// CONTRATO — configuración visual/audio llega correctamente
// ============================================================
{
  const mainSrc = read("../../remotion/ChaosNewsMain.tsx");
  for (const usage of ["theme.colors.background", "theme.colors.accent", "theme.colors.ink", "theme.fonts.display", "theme.fonts.subtitle", "theme.fonts.caption"]) {
    check(`ChaosNewsMain.tsx usa "${usage}" (el theme llega por props, no hardcodeado)`, mainSrc.includes(usage));
  }
  check("ChaosNewsMain.tsx recibe `config: ChaosEpisodeConfig` como único prop (theme incluido en config, no separado)", /config: ChaosEpisodeConfig/.test(mainSrc));
  check("ChaosNewsMain.tsx pasa config.audio explícitamente a AmbientAudio (config inyectable)", /config=\{config\.audio\}/.test(mainSrc));
}

// ============================================================
// IDENTIDAD — sin dependencia de SIN EXPLICACIÓN/ALZA LA VOZ
// ============================================================
{
  const mainSrc = read("../../remotion/ChaosNewsMain.tsx");
  const clipSrc = read("../../remotion/ChaosNewsClip.tsx");
  for (const [label, src] of [["ChaosNewsMain", mainSrc], ["ChaosNewsClip", clipSrc]] as const) {
    check(`${label}: NO importa InteractiveText/GlitchText como identidad de texto`, !/^import[^\n]*InteractiveText/m.test(stripLineComments(src)));
    check(`${label}: NO importa FilmEffects.tsx histórico como identidad`, !/^import[^\n]*from ["']\.\/components\/FilmEffects["']/m.test(stripLineComments(src)));
    check(`${label}: NO importa remotion/theme.ts (SIN EXPLICACIÓN) directamente`, !/^import[^\n]*from ["']\.\/theme["']/m.test(stripLineComments(src)));
    check(`${label}: sin nombres de canal hardcodeados en código real`, !/SIN EXPLICACI|LUNA VERDE|OBJETOS MALDITOS|ALZA LA VOZ/.test(stripLineComments(src)));
    check(`${label}: sin comparaciones "if (channel === ...)"`, !/if\s*\(.*(channel|canal)\s*===/i.test(stripLineComments(src)));
  }
  check("enciendeElCaosTheme sigue siendo el mismo objeto real de Fase 2 (colors.accent = rojo aprobado)", enciendeElCaosTheme.colors.accent === "#E5092F");
}

// ============================================================
// REGRESIÓN — MainDocumentary/ShortClip/QuoteVideo no fueron tocados
// ============================================================
{
  const mainDocSrc = read("../../remotion/MainDocumentary.tsx");
  const shortClipSrc = read("../../remotion/ShortClip.tsx");
  const quoteVideoSrc = read("../../remotion/QuoteVideo.tsx");
  check("MainDocumentary.tsx no importa nada de ChaosNews*", !mainDocSrc.includes("ChaosNews"));
  check("ShortClip.tsx no importa nada de ChaosNews*", !shortClipSrc.includes("ChaosNews"));
  check("QuoteVideo.tsx no importa nada de ChaosNews*", !quoteVideoSrc.includes("ChaosNews"));
}

console.log(failures === 0 ? "\nTODAS LAS PRUEBAS PASARON" : `\n${failures} CASO(S) FALLARON`);
if (failures > 0) process.exit(1);

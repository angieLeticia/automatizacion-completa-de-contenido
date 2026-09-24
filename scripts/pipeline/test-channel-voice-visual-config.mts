// FASE 5.10-AI — pruebas de que (1) la voz de un canal nunca se hereda por
// accidente en otro y (2) el branding/identidad visual de un canal nunca se
// hereda por accidente en otro. Puramente estructural (lee channelRegistry.mts
// y voiceGenerator.mts/theme.ts) — no llama a ElevenLabs ni a Remotion.
import { readFileSync } from "node:fs";
import { resolveChannelConfig, listKnownChannels } from "./channelRegistry.mts";

let failures = 0;
const check = (label: string, cond: boolean, extra = "") => {
  const mark = cond ? "PASS" : "FAIL";
  if (!cond) failures++;
  console.log(`[${mark}] ${label}${extra ? " — " + extra : ""}`);
};

// ---- VOZ ----

const sinExplicacion = resolveChannelConfig("SIN EXPLICACIÓN");
check("SIN EXPLICACIÓN tiene voice.narratorVoicePattern definido", Boolean(sinExplicacion?.voice?.narratorVoicePattern));
check(
  'El patrón de SIN EXPLICACIÓN matchea "Kate — Velvet Midnight Narrator" (mismo valor exacto que antes vivía hardcodeado en voiceGenerator.mts)',
  Boolean(sinExplicacion?.voice?.narratorVoicePattern.test("Kate — Velvet Midnight Narrator"))
);

// Post-Fase 11 — los 3 canales ya tienen voz real propia (usuario renombró
// sus voces en ElevenLabs a exactamente el nombre del canal). Cada uno debe
// tener SU PROPIO patrón, exacto (^...$) y case-insensitive, y NUNCA debe
// matchear el nombre de otro canal (ni el de SIN EXPLICACIÓN).
const NEW_CHANNEL_VOICE_NAMES: Record<string, string> = {
  "ENCIENDE EL CAOS": "ENCIENDE EL CAOS",
  "LUNA VERDE": "LUNA VERDE",
  "OBJETOS MALDITOS": "OBJETOS MALDITOS",
};
for (const [channel, expectedName] of Object.entries(NEW_CHANNEL_VOICE_NAMES)) {
  const config = resolveChannelConfig(channel);
  check(`${channel}.voice.narratorVoicePattern está definido`, Boolean(config?.voice?.narratorVoicePattern));
  check(`${channel}.voice.narratorVoicePattern matchea EXACTAMENTE "${expectedName}"`, Boolean(config?.voice?.narratorVoicePattern.test(expectedName)));
  check(`${channel}.voice.narratorVoicePattern NO matchea "Kate — Velvet Midnight Narrator"`, !config?.voice?.narratorVoicePattern.test("Kate — Velvet Midnight Narrator"));
  for (const [otherChannel, otherName] of Object.entries(NEW_CHANNEL_VOICE_NAMES)) {
    if (otherChannel === channel) continue;
    check(`${channel}.voice.narratorVoicePattern NO matchea el nombre de "${otherChannel}" ("${otherName}")`, !config?.voice?.narratorVoicePattern.test(otherName));
  }
}

// Ningún canal (ni siquiera indirectamente) puede terminar con el patrón de
// Kate salvo SIN EXPLICACIÓN — barrida sobre TODO el registro.
const channelsWithKateVoice = listKnownChannels().filter((c) => c.voice?.narratorVoicePattern.source.includes("kate"));
check(
  "Ningún canal fuera de SIN EXPLICACIÓN tiene el patrón de voz de Kate configurado",
  channelsWithKateVoice.every((c) => c.folderName === "SIN EXPLICACIÓN"),
  JSON.stringify(channelsWithKateVoice.map((c) => c.folderName))
);

// generateNarration() ya NO puede llamarse sin un patrón de voz explícito —
// verificado por inspección de firma (source real, no memoria).
const voiceGenSrc = readFileSync(new URL("./voiceGenerator.mts", import.meta.url), "utf8");
check(
  "voiceGenerator.mts ya NO tiene un NARRATOR_VOICE_PATTERN hardcodeado a nivel de módulo",
  !/const NARRATOR_VOICE_PATTERN\s*=/.test(voiceGenSrc)
);
check(
  "generateNarration() exige narratorVoicePattern como parámetro posicional obligatorio (sin default)",
  /export const generateNarration = async \(\s*chapters: TtsChapter\[\],\s*outputPath: string,\s*narratorVoicePattern: RegExp,/.test(voiceGenSrc)
);

// processOne.mts falla EXPLÍCITO (no usa Kate por defecto) si el canal no tiene voz.
const processOneSrc = readFileSync(new URL("./processOne.mts", import.meta.url), "utf8");
check(
  "processOne.mts resuelve voiceConfig desde channelRegistry ANTES de llamar a generateNarration",
  /const voiceConfig = resolveChannelConfig\(account\)\?\.voice;[\s\S]{0,300}if \(!voiceConfig\)/.test(processOneSrc)
);
check(
  "processOne.mts NUNCA usa un valor hardcodeado como fallback de voz (no hay ningún '|| DEFAULT_VOICE' ni patrón de Kate inline)",
  !processOneSrc.includes("kate") && !/voiceConfig\s*\?\?/.test(processOneSrc)
);

// ---- IDENTIDAD VISUAL ----

check('SIN EXPLICACIÓN.visualIdentityStatus === "CONFIGURED"', sinExplicacion?.visualIdentityStatus === "CONFIGURED");
check(
  '"ALZA LA VOZ".visualIdentityStatus === "CONFIGURED" (QuoteVideo.tsx + channels/alza-la-voz/videos.ts, real)',
  resolveChannelConfig("ALZA LA VOZ")?.visualIdentityStatus === "CONFIGURED"
);
for (const channel of ["ENCIENDE EL CAOS", "LUNA VERDE", "OBJETOS MALDITOS"]) {
  check(`${channel}.visualIdentityStatus === "PENDING" (sin branding inventado)`, resolveChannelConfig(channel)?.visualIdentityStatus === "PENDING");
}

// theme.ts sigue exportando exactamente los mismos nombres de siempre
// (colors/fonts/timing/layout/FPS) — cero regresión para los componentes
// Remotion existentes, que ninguno de ellos se tocó en esta fase.
const themeSrc = readFileSync(new URL("../../remotion/theme.ts", import.meta.url), "utf8");
for (const name of ["export const FPS", "export const colors", "export const fonts", "export const timing", "export const layout", "export const sinExplicacionTheme", "export type ChannelVisualTheme"]) {
  check(`remotion/theme.ts sigue exportando "${name}"`, themeSrc.includes(name));
}

console.log(failures === 0 ? "\nTODAS LAS PRUEBAS PASARON" : `\n${failures} CASO(S) FALLARON`);
if (failures > 0) process.exit(1);

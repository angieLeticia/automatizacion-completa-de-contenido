// Fase 4.9 — pruebas reales de los contratos DerivedContent/HIGHLIGHT/VERTICAL/
// ResearchRequest/PublicationCandidate. Mismo patrón ad-hoc del proyecto:
// datos estructuralmente reales (mismo shape que produce el pipeline real),
// sin mocks de librerías, sin fabricar E2E.
import type { Caption } from "../../remotion/lib/captions.ts";
import { FPS } from "../../remotion/theme.ts";
import { clipMarkToDerivedContent } from "./derivedContent.mts";
import { selectHighlights } from "./highlightSelector.mts";
import { buildVerticalAsset, validateVerticalAsset } from "./verticalAsset.mts";
import { buildResearchRequest, ChannelResearchNotConfiguredError } from "./researchRequest.mts";
import { assertPlatformTextsDiffer, type PublicationCandidate } from "../../agent/publish/publicationCandidate.mts";

let failures = 0;
const check = (label: string, cond: boolean, extra = "") => {
  const mark = cond ? "PASS" : "FAIL";
  if (!cond) failures++;
  console.log(`[${mark}] ${label}${extra ? " — " + extra : ""}`);
};

function main() {
  // ---- DerivedContent: adapta un ClipMark real sin recalcular nada ----
  const mark = { startFrame: secToFrames(10), endFrame: secToFrames(70), hookText: "un momento real" };
  function secToFrames(s: number) {
    return Math.round(s * FPS);
  }
  const derived = clipMarkToDerivedContent(mark, "CLIP", { channel: "SIN EXPLICACIÓN", episodeId: "014", fps: FPS, aspectRatio: "9:16" });
  check("clipMarkToDerivedContent — duración real derivada del ClipMark (60s)", Math.abs(derived.durationSeconds - 60) < 0.01, `${derived.durationSeconds}s`);
  check("clipMarkToDerivedContent — id estable con channel/episode/type", derived.id.includes("SIN EXPLICACIÓN") && derived.id.includes("014") && derived.id.includes("CLIP"));
  check("clipMarkToDerivedContent — qualityStatus inicial es 'pending', outputPath null hasta renderizar", derived.qualityStatus === "pending" && derived.outputPath === null);

  // ---- HIGHLIGHT: heurística real sobre captions hook/reveal (estructura real) ----
  const captions: Caption[] = [
    { start: 0, end: 5, text: "Introducción normal.", type: "normal" },
    { start: 5, end: 10, text: "¿Pero qué pasó realmente esa noche?", type: "hook" },
    { start: 10, end: 30, text: "Desarrollo normal del capítulo.", type: "normal" },
    { start: 30, end: 36, text: "La verdad nunca se supo.", type: "reveal" },
    { start: 36, end: 90, text: "Resto del episodio sin señales.", type: "normal" },
  ];
  const silences = [{ start: 4.8, end: 5.0 }, { start: 35.8, end: 36.0 }, { start: 89.5, end: 90 }];
  const highlights = selectHighlights(captions, silences, 90);
  check("selectHighlights — encuentra al menos un highlight real (hay captions hook/reveal)", highlights.length >= 1, `${highlights.length} highlights`);
  if (highlights.length > 0) {
    check("selectHighlights — cada highlight trae score y reason reales", typeof highlights[0].score === "number" && highlights[0].score > 0 && highlights[0].reason.length > 0, JSON.stringify(highlights[0]));
  }
  const noSignalCaptions: Caption[] = [{ start: 0, end: 90, text: "todo normal, sin hooks ni reveals", type: "normal" }];
  check("selectHighlights — sin captions hook/reveal, devuelve [] (no fabrica highlights de la nada)", selectHighlights(noSignalCaptions, [], 90).length === 0);

  // ---- VERTICAL: separa origen (CLIP/HIGHLIGHT) de plataforma ----
  const vertical = buildVerticalAsset(derived, "tiktok");
  check("buildVerticalAsset — conserva sourceType real (CLIP) y arma id compuesto", vertical.sourceType === "CLIP" && vertical.id === `${derived.id}::tiktok`);
  let verticalFromVerticalThrew = false;
  try {
    const fakeVertical = { ...derived, type: "VERTICAL" as const };
    buildVerticalAsset(fakeVertical, "youtube_shorts");
  } catch {
    verticalFromVerticalThrew = true;
  }
  check("buildVerticalAsset — rechaza derivar un VERTICAL de otro VERTICAL", verticalFromVerticalThrew);

  const validInfo = { durationSeconds: 60, width: 1080, height: 1920, hasAudioStream: true };
  check("validateVerticalAsset — 1080x1920 real con audio: OK", validateVerticalAsset(validInfo).ok === true);
  const invalidInfo = { durationSeconds: 60, width: 1920, height: 1080, hasAudioStream: false };
  const invalidResult = validateVerticalAsset(invalidInfo);
  check("validateVerticalAsset — 1920x1080 horizontal sin audio: falla con motivos reales, no ambiguos", invalidResult.ok === false && !invalidResult.ok && invalidResult.reasons.length === 2, JSON.stringify(invalidResult));

  // ---- ResearchRequest: solo con evidencia real, error explícito si falta ----
  const req = buildResearchRequest("SIN EXPLICACIÓN");
  check('buildResearchRequest("SIN EXPLICACIÓN") — resuelve theme/language reales', req.theme.length > 0 && req.language === "es");
  check(
    'buildResearchRequest("SIN EXPLICACIÓN") — no hereda el bloqueo de copyright (no es PELICULAS/MUSICA)',
    req.copyrightPolicy.allowCommercialMusic === true && req.copyrightPolicy.blockedByExistingRule === undefined
  );
  let peliculasReqThrew = false;
  try {
    buildResearchRequest("PELICULAS");
  } catch (err) {
    peliculasReqThrew = err instanceof ChannelResearchNotConfiguredError;
  }
  check('buildResearchRequest("PELICULAS") — sin theme configurado, lanza error explícito (no fabrica un theme)', peliculasReqThrew);

  // ---- Fase 5.1 (cierre): la MISMA función sirve a los 9 canales — no existe
  // ni debe existir un segundo Agent1/researchRequest para canales sin
  // evidencia todavía. LUNA VERDE y ENCIENDE EL CAOS deben fallar con el
  // MISMO error tipado (NOT_CONFIGURED), no un mecanismo aparte. ----
  for (const channel of ["LUNA VERDE", "ENCIENDE EL CAOS"]) {
    let threwNotConfigured = false;
    try {
      buildResearchRequest(channel);
    } catch (err) {
      threwNotConfigured = err instanceof ChannelResearchNotConfiguredError;
    }
    check(
      `buildResearchRequest("${channel}") — sin evidencia real todavía, misma función/mismo error tipado NOT_CONFIGURED (no un Agent1 aparte)`,
      threwNotConfigured
    );
  }

  // ---- OBJETOS MALDITOS y ASMR sí tienen theme/language reales (Fase 5.1) —
  // misma función, camino "configurado" del mismo contrato. ----
  const objetosReq = buildResearchRequest("OBJETOS MALDITOS");
  check('buildResearchRequest("OBJETOS MALDITOS") — resuelve theme/language reales', objetosReq.theme.length > 0 && objetosReq.language === "es");
  const asmrReq = buildResearchRequest("ASMR");
  check('buildResearchRequest("ASMR") — resuelve theme/language reales, sin heredar bloqueo de copyright', asmrReq.theme.length > 0 && asmrReq.copyrightPolicy.allowCommercialMusic === true);

  // ---- PublicationCandidate: nunca el mismo texto en dos plataformas ----
  const base = {
    channel: "SIN EXPLICACIÓN",
    channelId: null,
    episodeId: "014",
    contentFileId: null,
    derivedContentId: null,
    videoPath: "out/main-014.mp4",
    thumbnailPath: null,
    authorization: { authorized: false } as const,
    schedule: null,
    correlationId: "test-014",
  };
  const differentTexts: PublicationCandidate[] = [
    { ...base, platformMetadata: { platform: "youtube", metadata: { title: "El Faro de Flannan", description: "Historia real...", hashtags: ["#misterio"] } } },
    { ...base, platformMetadata: { platform: "tiktok", metadata: { caption: "3 hombres desaparecieron sin dejar rastro 👀", hashtags: ["#misterio", "#fyp"] } } },
  ];
  let differentTextsThrew = false;
  try {
    assertPlatformTextsDiffer(differentTexts);
  } catch {
    differentTextsThrew = true;
  }
  check("assertPlatformTextsDiffer — textos distintos por plataforma: no lanza", !differentTextsThrew);

  const sameTextTwice: PublicationCandidate[] = [
    { ...base, platformMetadata: { platform: "instagram", metadata: { caption: "mismo texto exacto", hashtags: [] } } },
    { ...base, platformMetadata: { platform: "facebook", metadata: { caption: "mismo texto exacto", hashtags: [] } } },
  ];
  let sameTextThrew = false;
  try {
    assertPlatformTextsDiffer(sameTextTwice);
  } catch {
    sameTextThrew = true;
  }
  check("assertPlatformTextsDiffer — mismo texto copiado en dos plataformas: SÍ lanza (regla Sección 15)", sameTextThrew);

  console.log(`\n${failures === 0 ? "TODOS LOS CASOS PASARON" : `${failures} CASO(S) FALLARON`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main();

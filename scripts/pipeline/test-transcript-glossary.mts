// Pruebas OFFLINE del glosario de transcripción (lib/transcriptGlossary.ts).
// No renderiza, no llama a Whisper/ElevenLabs/Supabase, no escribe nada. La
// única lectura de datos reales es remotion/data/captions-ENCIENDEELCAOS009.json
// (del repo, solo lectura) para demostrar el efecto sobre la transcripción real.
import { readFileSync } from "node:fs";
import path from "node:path";
import { applyTranscriptGlossary, applyTranscriptGlossaryToSegments, TRANSCRIPT_GLOSSARY, type GlossaryRule } from "../../lib/transcriptGlossary.ts";

let failures = 0;
const check = (label: string, cond: boolean, extra = "") => {
  if (!cond) failures++;
  console.log(`[${cond ? "PASS" : "FAIL"}] ${label}${extra ? " — " + extra : ""}`);
};
const CAOS = "ENCIENDE EL CAOS";
const fix = (t: string, ch: string | undefined = CAOS, ep?: string) => applyTranscriptGlossary(t, ch, ep);

console.log("=== Correcciones pedidas (ENCIENDE EL CAOS) ===");
check("ejemplo principal", fix("Megan Distallion habló sobre Clay Thompson.") === "Megan Thee Stallion habló sobre Klay Thompson.");
check("Megan Distalion", fix("Megan Distalion llegó.") === "Megan Thee Stallion llegó.");
check("Megan Stallion", fix("Megan Stallion llegó.") === "Megan Thee Stallion llegó.");
check("Clay Thompson", fix("Clay Thompson no respondió.") === "Klay Thompson no respondió.");
check("frase sin ningún término queda idéntica", fix("Quédate porque todavía hay un giro más en esta historia.") === "Quédate porque todavía hay un giro más en esta historia.");

console.log("\n=== Conservador: solo palabras completas ===");
check("no toca 'Megan Thee Stallion' ya correcto (idempotente)", fix("Megan Thee Stallion habló.") === "Megan Thee Stallion habló." && fix(fix("Megan Distallion")) === "Megan Thee Stallion");
check("no reemplaza dentro de otra palabra (Clay Thompsonville)", fix("Clay Thompsonville") === "Clay Thompsonville");
check("no reemplaza prefijo pegado (XClay Thompson / Megan Distallions)", fix("XClay Thompson y Megan Distallions") === "XClay Thompson y Megan Distallions");
check("no toca 'Clay' suelto (solo la frase completa pedida)", fix("Con Clay. La confianza") === "Con Clay. La confianza");
check("posesivo/puntuación adyacente sí cuenta como palabra completa", fix("Clay Thompson's, Megan Distallion.") === "Klay Thompson's, Megan Thee Stallion.");
check("espacios dobles entre palabras", fix("Megan  Distallion y Clay   Thompson") === "Megan Thee Stallion y Klay Thompson");
check("mayúsculas coherentes (todo MAYÚSCULAS)", fix("CLAY THOMPSON Y MEGAN DISTALLION") === "KLAY THOMPSON Y MEGAN THEE STALLION");
check("minúsculas de Whisper se normalizan al nombre propio", fix("megan distallion y clay thompson") === "Megan Thee Stallion y Klay Thompson");

console.log("\n=== Segmentos: timestamps y estructura intactos ===");
const segs = [
  { start: 38.78, end: 43.44, text: "Megan Distallion y Clay Thompson, base de los Dallas Mavericks", type: "normal" },
  { start: 43.44, end: 50.1, text: "Sin nombres aquí.", type: "hook" },
];
const out = applyTranscriptGlossaryToSegments(segs, CAOS, "009");
check("misma cantidad y orden", out.length === 2);
check("start/end/type conservados", out.every((s, i) => s.start === segs[i].start && s.end === segs[i].end && s.type === segs[i].type));
check("solo cambia el texto que lo necesita", out[0].text === "Megan Thee Stallion y Klay Thompson, base de los Dallas Mavericks" && out[1].text === segs[1].text);
check("no muta el arreglo original", segs[0].text.startsWith("Megan Distallion"));

console.log("\n=== Aislamiento por canal ===");
const dirty = "Megan Distallion habló sobre Clay Thompson.";
for (const ch of ["SIN EXPLICACIÓN", "LUNA VERDE", "OBJETOS MALDITOS", "CANAL INEXISTENTE", ""]) {
  check(`canal "${ch || "(vacío)"}" NO recibe correcciones`, fix(dirty, ch) === dirty);
}
check("canal undefined NO recibe correcciones", applyTranscriptGlossary(dirty, undefined) === dirty);
check("solo ENCIENDE EL CAOS tiene reglas activas", Object.entries(TRANSCRIPT_GLOSSARY).filter(([, r]) => r.length > 0).map(([k]) => k).join() === CAOS);
check("clave de canal tolerante a mayúsculas/espacios", fix(dirty, " enciende el caos ") === "Megan Thee Stallion habló sobre Klay Thompson.");

console.log("\n=== Reglas por episodio (mecanismo disponible, sin activar reglas reales) ===");
const custom: Record<string, GlossaryRule[]> = { [CAOS]: [{ from: "Clay", to: "Klay", episodeIds: ["009"] }] };
check("regla con episodeIds aplica en su episodio", applyTranscriptGlossary("con Clay", CAOS, "009", custom) === "con Klay");
check("regla con episodeIds NO aplica en otro episodio ni sin episodio", applyTranscriptGlossary("con Clay", CAOS, "010", custom) === "con Clay" && applyTranscriptGlossary("con Clay", CAOS, undefined, custom) === "con Clay");

console.log("\n=== ENCIENDE EL CAOS / episodio 009: entrada → salida exigida ===");
const CAOS009 = (t: string) => applyTranscriptGlossary(t, CAOS, "009");
check("Megan Distallion y Clay Thompson → Megan Thee Stallion y Klay Thompson", CAOS009("Megan Distallion y Clay Thompson") === "Megan Thee Stallion y Klay Thompson");
check("Megan Distalion → Megan Thee Stallion", CAOS009("Megan Distalion") === "Megan Thee Stallion");
check("Megan Stallion → Megan Thee Stallion", CAOS009("Megan Stallion") === "Megan Thee Stallion");
check("Clay → Klay", CAOS009("Clay") === "Klay");
check("frase real: 'con Clay. La confianza' y 'si Clay fue infiel'", CAOS009("con Clay. La confianza") === "con Klay. La confianza" && CAOS009("si Clay fue infiel") === "si Klay fue infiel");
check("Clay Thompson no se convierte en 'Klay Klay'/'Klay Thompson' doble (orden de reglas)", CAOS009("Clay Thompson") === "Klay Thompson" && CAOS009("Klay Thompson") === "Klay Thompson");

console.log("\n=== Palabras normales NO se rompen (ENCIENDE 009) ===");
for (const w of ["clase", "claro", "clavo", "Claymore", "aclaró", "claridad", "clay-based".replace("clay", "clayx")]) {
  check(`"${w}" queda intacta`, CAOS009(`la ${w} de hoy`) === `la ${w} de hoy`);
}
check("frase con varias palabras normales cerca de 'Clay'", CAOS009("una clase clara, Clay, con clavo") === "una clase clara, Klay, con clavo");

console.log("\n=== Alcance: 'Clay' suelto SOLO en ENCIENDE EL CAOS + episodio 009 ===");
check("SIN EXPLICACIÓN + 009 + 'Clay Thompson' NO se modifica", applyTranscriptGlossary("Clay Thompson", "SIN EXPLICACIÓN", "009") === "Clay Thompson");
check("SIN EXPLICACIÓN + 009 + 'Clay' NO se modifica", applyTranscriptGlossary("Clay", "SIN EXPLICACIÓN", "009") === "Clay");
check("LUNA VERDE / OBJETOS MALDITOS + 009 + 'Clay' NO se modifican", applyTranscriptGlossary("Clay", "LUNA VERDE", "009") === "Clay" && applyTranscriptGlossary("Clay", "OBJETOS MALDITOS", "009") === "Clay");
check("ENCIENDE + otro episodio (010) + 'Clay' suelto NO se modifica", applyTranscriptGlossary("Clay", CAOS, "010") === "Clay");
check("ENCIENDE + sin episodio + 'Clay' suelto NO se modifica", applyTranscriptGlossary("Clay", CAOS) === "Clay");
check("ENCIENDE + otro episodio: reglas de frase completa SÍ aplican", applyTranscriptGlossary("Clay Thompson", CAOS, "010") === "Klay Thompson");
check("la regla 'Clay' está declarada con episodeIds=['009'] (no global)", TRANSCRIPT_GLOSSARY[CAOS].some((r) => r.from === "Clay" && JSON.stringify(r.episodeIds) === '["009"]') && !Object.entries(TRANSCRIPT_GLOSSARY).some(([k, rules]) => k !== CAOS && rules.some((r) => /clay/i.test(r.from))));

console.log("\n=== Preservación estructural (IDs, timestamps, orden, solo cambia text) ===");
const withIds = [
  { id: "seg-1", start: 0, end: 4.5, text: "Megan Distallion y Clay Thompson", type: "hook", words: [1, 2] },
  { id: "seg-2", start: 4.5, end: 9, text: "Clay no respondió", type: "normal" },
  { id: "seg-3", start: 9, end: 12, text: "La clase es clara", type: "normal" },
];
const snapshot = JSON.stringify(withIds);
const outIds = applyTranscriptGlossaryToSegments(withIds, CAOS, "009");
check("mismo número de segmentos", outIds.length === withIds.length);
check("IDs iguales y en el mismo orden", outIds.map((s) => s.id).join() === "seg-1,seg-2,seg-3");
check("timestamps (start/end) iguales", outIds.every((s, i) => s.start === withIds[i].start && s.end === withIds[i].end));
check("todos los demás campos (type/words) intactos", outIds.every((s, i) => s.type === withIds[i].type && JSON.stringify((s as { words?: number[] }).words) === JSON.stringify((withIds[i] as { words?: number[] }).words)));
check("solo cambia `text` (mismas claves en cada segmento)", outIds.every((s, i) => Object.keys(s).join() === Object.keys(withIds[i]).join()));
check("textos corregidos donde corresponde y sin tocar la frase normal", outIds[0].text === "Megan Thee Stallion y Klay Thompson" && outIds[1].text === "Klay no respondió" && outIds[2].text === "La clase es clara");
check("no muta la entrada original", JSON.stringify(withIds) === snapshot);
check("determinista: dos ejecuciones dan el mismo resultado", JSON.stringify(applyTranscriptGlossaryToSegments(withIds, CAOS, "009")) === JSON.stringify(outIds));
check("string sin canal/episodio: sin cambios y sin error", applyTranscriptGlossary("Clay", undefined, undefined) === "Clay" && applyTranscriptGlossary("", CAOS, "009") === "");

console.log("\n=== Integración (lectura del código fuente) ===");
const readSrc = (p: string) => readFileSync(path.join(import.meta.dirname, "..", "..", p), "utf-8");
const a2 = readSrc("scripts/pipeline/processOne.mts");
const a1 = readSrc("agent/analyze/processOne.mts");
const cw = readSrc("agent/analyze/claimWork.mts");
const rn = readSrc("agent/analyze/run.mts");
check("Agent 2: el glosario se aplica ANTES de tagCaptions()", a2.indexOf("applyTranscriptGlossaryToSegments(segments, account, episodeId)") !== -1 && a2.indexOf("applyTranscriptGlossaryToSegments(segments, account, episodeId)") < a2.indexOf("tagCaptions(segments, script)"));
check("Agent 2: pasa el canal y el episodeId crudo (alcance por episodio)", /applyTranscriptGlossaryToSegments\(segments, account, episodeId\)/.test(a2));
check("Agent 1: glosario sobre la transcripción nueva de Whisper, con episodeId", /transcript = applyTranscriptGlossary\(result\.transcript, item\.accountFolderName, item\.episodeId \?\? undefined\)/.test(a1));
check("Agent 1: glosario también sobre la transcripción cacheada", /transcript = applyTranscriptGlossary\(item\.cachedTranscript, item\.accountFolderName, item\.episodeId \?\? undefined\)/.test(a1));
const iGlossary = a1.indexOf("applyTranscriptGlossary(result.transcript");
const iSave = a1.search(/\.update\(\{\s*has_speech: true,\s*transcript,/);
const iOllama = a1.indexOf("runCanonicalAnalysis(item, transcript)");
check("Agent 1: el glosario corre ANTES de guardar el transcript y de llamar a Ollama", iGlossary !== -1 && iSave !== -1 && iOllama !== -1 && iGlossary < iSave && iGlossary < iOllama, `${iGlossary}<${iSave}, ${iGlossary}<${iOllama}`);
check("Agent 1: episode_id se lee en modo cola (claimWork) y dirigido (run.mts)", /content_account_id, episode_id/.test(cw) && /episodeId: \(file\.episode_id/.test(cw) && /content_account_id, episode_id/.test(rn) && /episodeId: \(fileRow!\.episode_id/.test(rn));

console.log("\n=== Transcripción REAL de 009 (solo lectura del JSON del repo) ===");
const real = JSON.parse(readFileSync(path.join(import.meta.dirname, "..", "..", "remotion", "data", "captions-ENCIENDEELCAOS009.json"), "utf-8")) as { start: number; end: number; text: string; type?: string }[];
const fixed = applyTranscriptGlossaryToSegments(real, CAOS, "009");
const changed = fixed.filter((s, i) => s.text !== real[i].text).length;
check("mismos segmentos y timestamps", fixed.length === real.length && fixed.every((s, i) => s.start === real[i].start && s.end === real[i].end && s.type === real[i].type));
check("ya no queda 'Distallion' ni 'Clay Thompson'", !fixed.some((s) => /Distallion|Clay Thompson/.test(s.text)) && fixed.some((s) => /Megan Thee Stallion/.test(s.text)));
console.log(`  segmentos corregidos: ${changed} de ${real.length}`);
check("ya no queda ningún 'Clay' ni 'Distallion' en toda la transcripción de 009", !fixed.some((s) => /\bClay\b|Distallion|Distalion/i.test(s.text)), `${fixed.filter((s) => /Klay/.test(s.text)).length} segmento(s) con 'Klay'`);
check("solo cambian segmentos que contenían un nombre a corregir (el resto idéntico)", fixed.every((s, i) => s.text === real[i].text || /Clay|Distallion|Distalion|Megan Stallion/i.test(real[i].text)));
const bare = real.filter((s) => /\bClay\b/.test(s.text)).length;
console.log(`  segmentos originales con 'Clay' (todos corregidos ahora): ${bare}`);

console.log(`\n=== ${failures === 0 ? "TODO PASS" : `${failures} FALLO(S)`} ===`);
process.exit(failures === 0 ? 0 : 1);

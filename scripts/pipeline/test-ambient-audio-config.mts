// FASE 5.10-AN (Fase 1 — generalización de audio) — prueba de regresión que
// demuestra que la nueva configuración por canal (AmbientAudioConfig) es
// EQUIVALENTE, byte a byte, al comportamiento hardcodeado que
// remotion/lib/musicBed.ts y remotion/components/AmbientAudio.tsx tenían
// antes de esta fase, y que el mecanismo es genéricamente reutilizable para
// un canal nuevo sin ningún if/else por nombre de canal.
import { readFileSync } from "node:fs";
import { buildMusicBed, blocksInRange, sinExplicacionAmbientAudioConfig, musicTracks, textureTracks, type AmbientAudioConfig } from "../../remotion/lib/musicBed.ts";

let failures = 0;
const check = (label: string, cond: boolean, extra = "") => {
  const mark = cond ? "PASS" : "FAIL";
  if (!cond) failures++;
  console.log(`[${mark}] ${label}${extra ? " — " + extra : ""}`);
};

// ---- 1. Los valores reales de SIN EXPLICACIÓN se preservan exactos ----
// (los mismos 3+8 nombres de archivo que este archivo tenía hardcodeados
// antes de esta fase, en el mismo orden).
const EXPECTED_MUSIC = ["Musica cinematica.mp3", "Musica de tension.mp3", "Musica misteriosa.mp3"];
const EXPECTED_TEXTURE = [
  "viento.wav",
  "Olas de mar.wav",
  "Pasando hojas.wav",
  "Piso de madera.wav",
  "Madera crujiendo.wav",
  "Reloj.wav",
  "Trenos.wav",
  "mixkit-wind-blowing-ambience-2658.wav",
];
check("sinExplicacionAmbientAudioConfig.musicTracks === valores originales exactos (mismo orden)", JSON.stringify(sinExplicacionAmbientAudioConfig.musicTracks) === JSON.stringify(EXPECTED_MUSIC));
check("sinExplicacionAmbientAudioConfig.textureTracks === valores originales exactos (mismo orden)", JSON.stringify(sinExplicacionAmbientAudioConfig.textureTracks) === JSON.stringify(EXPECTED_TEXTURE));

// ---- 2. Exports históricos (musicTracks/textureTracks) siguen existiendo e idénticos ----
check("export histórico musicTracks === sinExplicacionAmbientAudioConfig.musicTracks", JSON.stringify(musicTracks) === JSON.stringify(sinExplicacionAmbientAudioConfig.musicTracks));
check("export histórico textureTracks === sinExplicacionAmbientAudioConfig.textureTracks", JSON.stringify(textureTracks) === JSON.stringify(sinExplicacionAmbientAudioConfig.textureTracks));

// ---- 3. buildMusicBed() SIN config (default) === buildMusicBed() CON sinExplicacionAmbientAudioConfig explícito ----
// (prueba que el parámetro opcional realmente cae al default correcto — es
// la garantía de "SIN EXPLICACIÓN se comporta exactamente igual sin tocar
// ningún llamador".)
const TOTAL_FRAMES = 30 * 60 * 12; // ~12 minutos a 30fps, episodio típico real
const bedDefault = buildMusicBed(TOTAL_FRAMES);
const bedExplicit = buildMusicBed(TOTAL_FRAMES, sinExplicacionAmbientAudioConfig);
check("buildMusicBed(totalFrames) sin config === buildMusicBed(totalFrames, sinExplicacionAmbientAudioConfig)", JSON.stringify(bedDefault) === JSON.stringify(bedExplicit));

// ---- 4. Matemática de bloques sin cambios: BLOCK_SECONDS=100 por defecto, mismo comportamiento que antes ----
// (100s * 30fps = 3000 frames por bloque; 12 min = 21600 frames -> 8 bloques completos, ningún resto)
check("buildMusicBed produce bloques de 3000 frames (100s @ 30fps, default sin cambios)", bedDefault[0].timelineEnd - bedDefault[0].timelineStart === 3000);
check("buildMusicBed rota musicTracks en orden (bloque 0='Musica cinematica.mp3', bloque 1='Musica de tension.mp3')", bedDefault[0].file === "Musica cinematica.mp3" && bedDefault[1].file === "Musica de tension.mp3");
check("buildMusicBed cubre exactamente [0, totalFrames) sin huecos", bedDefault[bedDefault.length - 1].timelineEnd === TOTAL_FRAMES);

// ---- 5. blocksInRange sin cambios de comportamiento ----
const inRange = blocksInRange(bedDefault, 0, 3000);
check("blocksInRange(0, 3000) devuelve exactamente el primer bloque", inRange.length === 1 && inRange[0].file === "Musica cinematica.mp3");

// ---- 6. GENERICIDAD REAL: un canal nuevo con tracks DISTINTOS produce resultados DISTINTOS ----
// (prueba que no es solo un refactor cosmético — el mecanismo realmente
// respeta la config que se le pasa, nunca los valores de SIN EXPLICACIÓN).
const fakeChannelConfig: AmbientAudioConfig = {
  musicTracks: ["chaos-track-1.mp3", "chaos-track-2.mp3"],
  textureTracks: ["chaos-sfx-1.wav"],
  blockSeconds: 50,
  music: { peak: 0.3, fadeFrames: 30 },
  texture: { peak: 0.5, seconds: 1.0, fadeFrames: 10 },
};
const chaosBed = buildMusicBed(TOTAL_FRAMES, fakeChannelConfig);
check("Una config de canal distinta produce archivos DISTINTOS a los de SIN EXPLICACIÓN", chaosBed[0].file === "chaos-track-1.mp3" && chaosBed[0].file !== bedDefault[0].file);
check("Una config de canal distinta respeta su propio blockSeconds (50s @ 30fps = 1500 frames, no 3000)", chaosBed[0].timelineEnd - chaosBed[0].timelineStart === 1500);
check("Ningún archivo de SIN EXPLICACIÓN aparece en la cama de música de la config sintética", !chaosBed.some((b) => EXPECTED_MUSIC.includes(b.file)));

// ---- 7. Caso límite: musicTracks vacío nunca crashea (división/módulo por cero) ----
const emptyConfig: AmbientAudioConfig = { musicTracks: [], textureTracks: [] };
let emptyBedThrew = false;
let emptyBed: ReturnType<typeof buildMusicBed> = [];
try {
  emptyBed = buildMusicBed(TOTAL_FRAMES, emptyConfig);
} catch {
  emptyBedThrew = true;
}
check("buildMusicBed con musicTracks=[] nunca lanza (devuelve [] en vez de NaN/crash)", !emptyBedThrew && emptyBed.length === 0);

// Quita comentarios de línea (// ...) antes de buscar lógica condicional real
// — el nombre de un canal puede (y debe) aparecer en comentarios explicando
// el porqué, eso no es un if/else por canal. Suficiente para estos 2
// archivos, que no usan comentarios de bloque /* */.
// Corregido (encontrado al escribir el test de theme de ENCIENDE EL CAOS,
// Fase 2): sin "$" al final del patrón — con line endings CRLF (\r\n reales
// en este repo), "$" (sin flag /m) no matchea antes de un "\r" colgante tras
// el split, dejando el comentario sin recortar en la práctica. "." ya no
// cruza \r/\n por sí solo, así que no hace falta el ancla "$".
const stripLineComments = (src: string): string =>
  src
    .split(/\r?\n/)
    .map((line) => line.replace(/\/\/.*/, ""))
    .join("\n");

// ---- 8. AmbientAudio.tsx: sin if/else por nombre de canal (en CÓDIGO real, no en comentarios), config opcional con default correcto ----
const ambientAudioSrc = readFileSync(new URL("../../remotion/components/AmbientAudio.tsx", import.meta.url), "utf8");
check(
  "AmbientAudio.tsx no contiene, en código real (sin comentarios), ninguna comparación de string por nombre de canal",
  !/SIN EXPLICACI|ENCIENDE|LUNA VERDE|OBJETOS MALDITOS/.test(stripLineComments(ambientAudioSrc))
);
check("AmbientAudio.tsx recibe `config` como prop opcional", /config\?:\s*AmbientAudioConfig/.test(ambientAudioSrc));
check("AmbientAudio.tsx usa sinExplicacionAmbientAudioConfig como default del prop `config`", /config = sinExplicacionAmbientAudioConfig/.test(ambientAudioSrc));

// ---- 9. musicBed.ts: mismo chequeo de ausencia de if/else por canal (en código real) ----
const musicBedSrc = readFileSync(new URL("../../remotion/lib/musicBed.ts", import.meta.url), "utf8");
check(
  "musicBed.ts no contiene, en código real (sin comentarios), ninguna comparación de string por nombre de canal",
  !/SIN EXPLICACI|ENCIENDE|LUNA VERDE|OBJETOS MALDITOS/.test(stripLineComments(musicBedSrc))
);

console.log(failures === 0 ? "\nTODAS LAS PRUEBAS PASARON" : `\n${failures} CASO(S) FALLARON`);
if (failures > 0) process.exit(1);

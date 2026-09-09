import { FPS } from "../theme";
import { normalizeCaptions, secToFrames, totalDurationFromCaptions } from "./captions";
import type { Caption } from "./captions";
import type { ClipMark } from "./clips";
import type { ReelOptions, Shot, SourceImage, SourceVideo } from "./broll";
import rawCaptions002 from "../data/captions-002.json";
import rawClips002 from "../data/clips-002.json";
import rawCaptions014 from "../data/captions-014.json";
import rawClips014 from "../data/clips-014.json";
import rawShots014 from "../data/shots-014.json";
import rawCaptions013 from "../data/captions-013.json";
import rawClips013 from "../data/clips-013.json";
import rawShots013 from "../data/shots-013.json";
import rawCaptions011 from "../data/captions-011.json";
import rawClips011 from "../data/clips-011.json";
import rawShots011 from "../data/shots-011.json";
import rawCaptions012 from "../data/captions-012.json";
import rawClips012 from "../data/clips-012.json";
import rawShots012 from "../data/shots-012.json";
import rawCaptions010 from "../data/captions-010.json";
import rawClips010 from "../data/clips-010.json";
import rawShots010 from "../data/shots-010.json";
import rawCaptions008 from "../data/captions-008.json";
import rawClips008 from "../data/clips-008.json";
import rawShots008 from "../data/shots-008.json";
import rawCaptions003 from "../data/captions-003.json";
import rawClips003 from "../data/clips-003.json";
import rawCaptions004 from "../data/captions-004.json";
import rawClips004 from "../data/clips-004.json";

export type EpisodeConfig = {
  id: string; // namespaces staticFile paths (assets/video/{id}/..., etc.) and composition ids
  chapterNumber: number;
  narrationFile: string; // relative to /public/assets/audio/
  // Measured once with ffprobe against the narration file. Update if replaced.
  narrationDurationSeconds: number;
  captions: Caption[];
  clips: ClipMark[];
  videoPool: SourceVideo[];
  imagePool: SourceImage[];
  reelOptions?: ReelOptions;
  // Línea de tiempo pre-calculada por el pipeline automático (ver
  // scripts/pipeline/visualAssigner.mts), que empareja cada tramo por
  // palabra clave contra la narración en vez de la rotación ciega. Cuando
  // no está presente (episodios armados a mano), se cae a buildReel().
  shots?: Shot[];
};

// Chapter 1 — "Los fareros de Eilean Mor". Assets live flat under
// public/assets/{video,images}/ (predates the multi-episode namespacing).
const episode002: EpisodeConfig = {
  id: "002",
  chapterNumber: 1,
  narrationFile: "narracion.mp3",
  narrationDurationSeconds: 713.62,
  captions: normalizeCaptions(rawCaptions002 as Caption[]),
  clips: rawClips002 as ClipMark[],
  videoPool: [
    { kind: "video", file: "11676228-uhd_2560_1440_30fps.mp4", durationSec: 16.02, width: 2560, height: 1440 },
    { kind: "video", file: "14661777_3840_2160_30fps.mp4", durationSec: 9.78, width: 3840, height: 2160 },
    { kind: "video", file: "14718144_2160_3840_30fps.mp4", durationSec: 20.02, width: 2160, height: 3840 },
    { kind: "video", file: "14925932_2560_1440_30fps.mp4", durationSec: 9.18, width: 2560, height: 1440 },
    { kind: "video", file: "14941038_1440_2560_30fps.mp4", durationSec: 13.71, width: 1440, height: 2560 },
    { kind: "video", file: "15073450_1920_1080_25fps.mp4", durationSec: 33.6, width: 1920, height: 1080 },
    { kind: "video", file: "19842311-hd_1080_1920_60fps.mp4", durationSec: 14.85, width: 720, height: 1280 },
    { kind: "video", file: "856593-uhd_3840_2160_24fps.mp4", durationSec: 19.84, width: 3840, height: 2160 },
  ],
  imagePool: [
    { kind: "image", file: "WhatsApp Image 2026-08-19 at 3.17.04 PM.jpeg", width: 544, height: 334 },
    { kind: "image", file: "WhatsApp Image 2026-08-19 at 3.17.25 PM.jpeg", width: 640, height: 480 },
    { kind: "image", file: "WhatsApp Image 2026-08-19 at 3.17.38 PM.jpeg", width: 634, height: 429 },
    { kind: "image", file: "WhatsApp Image 2026-08-19 at 3.18.20 PM.jpeg", width: 960, height: 623 },
    { kind: "image", file: "WhatsApp Image 2026-08-19 at 3.19.05 PM.jpeg", width: 960, height: 702 },
    { kind: "image", file: "WhatsApp Image 2026-08-19 at 3.19.20 PM.jpeg", width: 500, height: 658 },
    { kind: "image", file: "WhatsApp Image 2026-08-19 at 3.19.49 PM.jpeg", width: 640, height: 480 },
    { kind: "image", file: "images (1).jfif", width: 620, height: 494 },
    { kind: "image", file: "images (2).jfif", width: 590, height: 338 },
    { kind: "image", file: "images (3).jfif", width: 225, height: 225 },
    { kind: "image", file: "images (4).jfif", width: 407, height: 491 },
    { kind: "image", file: "images (5).jfif", width: 597, height: 335 },
    { kind: "image", file: "images (6).jfif", width: 225, height: 225 },
    { kind: "image", file: "images (7).jfif", width: 369, height: 542 },
    { kind: "image", file: "images (8).jfif", width: 738, height: 390 },
    { kind: "image", file: "images (9).jfif", width: 335, height: 597 },
    { kind: "image", file: "images.jfif", width: 638, height: 480 },
    { kind: "image", file: "pexels-cottonbro-5370925.jpg", width: 4160, height: 6240 },
  ],
};

// Chapter 2 — "El Mary Celeste". Only 2 stock clips this time, so the reel
// leans harder on stills (3 images per video shot) to avoid repeating them
// into the ground over a ~9 minute documentary.
const episode003: EpisodeConfig = {
  id: "003",
  chapterNumber: 2,
  narrationFile: "narracion-003.mp3",
  narrationDurationSeconds: 534.553107,
  captions: normalizeCaptions(rawCaptions003 as Caption[]),
  clips: rawClips003 as ClipMark[],
  videoPool: [
    { kind: "video", file: "003/11395721-uhd_2160_3840_30fps.mp4", durationSec: 11.37, width: 1440, height: 2560 },
    { kind: "video", file: "003/12597269_1080_1920_30fps.mp4", durationSec: 11.4, width: 1080, height: 1920 },
  ],
  imagePool: [
    { kind: "image", file: "003/6388e6c65d9bc.jpeg", width: 449, height: 559 },
    { kind: "image", file: "003/Benjamin_briggs.jpg", width: 250, height: 304 },
    { kind: "image", file: "003/WhatsApp Image 2026-08-20 at 1.53.36 PM.jpeg", width: 960, height: 728 },
    { kind: "image", file: "003/WhatsApp Image 2026-08-20 at 1.53.55 PM.jpeg", width: 334, height: 420 },
    { kind: "image", file: "003/WhatsApp Image 2026-08-20 at 1.54.13 PM.jpeg", width: 960, height: 788 },
    { kind: "image", file: "003/WhatsApp Image 2026-08-20 at 1.57.34 PM.jpeg", width: 330, height: 612 },
    { kind: "image", file: "003/WhatsApp Image 2026-08-20 at 1.57.51 PM.jpeg", width: 250, height: 330 },
    { kind: "image", file: "003/images (1).jfif", width: 447, height: 447 },
    { kind: "image", file: "003/images.jfif", width: 447, height: 447 },
    { kind: "image", file: "003/pexels-kadirakman-18186577.jpg", width: 5047, height: 3365 },
    { kind: "image", file: "003/pexels-yesim-g-ozdemir-331486613-19233675.jpg", width: 3264, height: 4928 },
    {
      kind: "image",
      file: "003/representacion-de-un-barco-en-plena-tormenta_f1062b79_161843350_260519145311_1200x630.webp",
      width: 1200,
      height: 630,
    },
  ],
  reelOptions: { imagesPerVideo: 3 },
};

// Chapter 3 — "El Vuelo 19". Narration generated with ElevenLabs (voice: Kate
// - Velvet Midnight Narrator) from a script researched against Navy/NHHC
// sources, not transcribed from a pre-existing recording. 4 video clips + 10
// archival/public-domain stills (Wikimedia Commons / NARA), so images lean
// slightly (2 per video) without needing chapter 2's heavier 3:1 bias.
const episode004: EpisodeConfig = {
  id: "004",
  chapterNumber: 3,
  narrationFile: "narracion-004.mp3",
  narrationDurationSeconds: 411.086077,
  captions: normalizeCaptions(rawCaptions004 as Caption[]),
  clips: rawClips004 as ClipMark[],
  videoPool: [
    { kind: "video", file: "004/aerial-ocean-sunset.mp4", durationSec: 9.02, width: 1920, height: 1080 },
    { kind: "video", file: "004/night-sky-stars.mp4", durationSec: 8.7, width: 1280, height: 720 },
    { kind: "video", file: "004/storm-at-sea.mp4", durationSec: 26.26, width: 1280, height: 720 },
    { kind: "video", file: "004/storm-clouds-timelapse.mp4", durationSec: 22.96, width: 2560, height: 1440 },
  ],
  imagePool: [
    { kind: "image", file: "004/Charles_C._Taylor.jpg", width: 364, height: 529 },
    { kind: "image", file: "004/Flight_19_route_map.png", width: 1778, height: 1397 },
    { kind: "image", file: "004/Grumman_TBM-3E_Avenger_of_VT-81_in_flight,_in_March_1946.jpg", width: 1154, height: 848 },
    {
      kind: "image",
      file: "004/Martin_PBM-5_Mariner_in_flight,_circa_in_1945_(SDASM_00006374).jpg",
      width: 550,
      height: 437,
    },
    { kind: "image", file: "004/TBFs_flying_in_formation_Fort_Lauderdale_NARA_520767.jpg", width: 3000, height: 2445 },
    { kind: "image", file: "004/TBFs_in_flight_off_Fort_Lauderdale_1943.jpg", width: 2277, height: 1605 },
    { kind: "image", file: "004/TBM-3E_Avenger_VMTB-234_in_flight_1945.jpeg", width: 2116, height: 1636 },
    { kind: "image", file: "004/TBM_Avengers_of_VT-86_in_flight_1945.jpg", width: 2482, height: 1861 },
    { kind: "image", file: "004/TBM_Avengers_of_VT-88_in_flight_in_August_1945.jpg", width: 2888, height: 2253 },
    {
      kind: "image",
      file: "004/Three_General_Motors_TBM-3_Avenger_of_VT-6_in_flight,_in_1945.jpg",
      width: 1535,
      height: 1154,
    },
  ],
  reelOptions: { imagesPerVideo: 2 },
};


const episode008: EpisodeConfig = {
  id: "008",
  chapterNumber: 4,
  narrationFile: "narracion-008.mp3",
  narrationDurationSeconds: 582.278095,
  captions: normalizeCaptions(rawCaptions008 as Caption[]),
  clips: rawClips008 as ClipMark[],
  videoPool: [
    { kind: "video", file: "008/01_tormenta_olas_faro_costa_mixkit_720p.mp4", durationSec: 37.54, width: 1280, height: 720 },
    { kind: "video", file: "008/02_olas_rompiendo_costa_aerea_mixkit_720p.mp4", durationSec: 29.36, width: 1280, height: 720 },
    { kind: "video", file: "008/03_isla_rocosa_boscosa_aerea_mixkit_1080p.mp4", durationSec: 30.11, width: 1920, height: 1080 },
    { kind: "video", file: "008/04_peninsula_boscosa_costa_aerea_mixkit_1080p.mp4", durationSec: 18.18, width: 1920, height: 1080 },
    { kind: "video", file: "008/05_mapa_antiguo_vela_lupa_mixkit_1080p.mp4", durationSec: 10.00, width: 1920, height: 1080 },
    { kind: "video", file: "008/06_nubes_tormenta_oscuras_mixkit_720p.mp4", durationSec: 17.96, width: 1280, height: 720 },
    { kind: "video", file: "008/07_tormenta_electrica_oceano_noche_mixkit_1080p.mp4", durationSec: 19.07, width: 1920, height: 1080 },
    { kind: "video", file: "008/08_bosque_pinos_soleado_mixkit_1080p.mp4", durationSec: 23.73, width: 1920, height: 1080 },
    { kind: "video", file: "008/09_bosque_pantano_aereo_mixkit_720p.mp4", durationSec: 27.84, width: 1280, height: 720 },
    { kind: "video", file: "008/10_libros_antiguos_pila_mixkit_1080p.mp4", durationSec: 14.71, width: 1920, height: 1080 },
    { kind: "video", file: "008/11_bosque_niebla_otonal_mixkit_720p.mp4", durationSec: 56.49, width: 1280, height: 720 },
  ],
  imagePool: [
    { kind: "image", file: "008/Croatoan.jpg", width: 3664, height: 2282 },
    { kind: "image", file: "008/Roanoke_map_1584.jpg", width: 648, height: 1323 },
    { kind: "image", file: "008/Ruins_of_the_English_Settlement_at_Roanoke.jpg", width: 1000, height: 932 },
    { kind: "image", file: "008/The_Lost_Colony_JohnWhite_1590.jpg", width: 610, height: 424 },
    { kind: "image", file: "008/Village_of_Secoton_1590.jpg", width: 767, height: 1024 },
  ],
  shots: rawShots008 as Shot[],
};





const episode010: EpisodeConfig = {
  id: "010",
  chapterNumber: 5,
  narrationFile: "narracion-010.mp3",
  narrationDurationSeconds: 313.318458,
  captions: normalizeCaptions(rawCaptions010 as Caption[]),
  clips: rawClips010 as ClipMark[],
  videoPool: [],
  imagePool: [
    { kind: "image", file: "010/01_pagina_figuras_bano_folio68r.jpg", width: 1536, height: 731 },
    { kind: "image", file: "010/02_pagina_planta_desconocida_folio34r.jpg", width: 1182, height: 1536 },
    { kind: "image", file: "010/03_diagrama_astronomico_rosetta.jpg", width: 1280, height: 1396 },
    { kind: "image", file: "010/04_pagina_planta_drosera_folio56r.jpg", width: 960, height: 1252 },
  ],
  reelOptions: { imagesPerVideo: 3 },
  shots: rawShots010 as Shot[],
};


const episode012: EpisodeConfig = {
  id: "012",
  chapterNumber: 5,
  narrationFile: "narracion-012.mp3",
  narrationDurationSeconds: 505.988934,
  captions: normalizeCaptions(rawCaptions012 as Caption[]),
  clips: rawClips012 as ClipMark[],
  videoPool: [],
  imagePool: [
    { kind: "image", file: "012/01_valle_isdalen.jpg", width: 3264, height: 2448 },
    { kind: "image", file: "012/02_bergen_bryggen.jpg", width: 800, height: 600 },
    { kind: "image", file: "012/03_bergen_vagen.jpg", width: 3253, height: 2332 },
  ],
  reelOptions: { imagesPerVideo: 3 },
  shots: rawShots012 as Shot[],
};


const episode011: EpisodeConfig = {
  id: "011",
  chapterNumber: 5,
  narrationFile: "narracion-011.mp3",
  narrationDurationSeconds: 262.356463,
  captions: normalizeCaptions(rawCaptions011 as Caption[]),
  clips: rawClips011 as ClipMark[],
  videoPool: [],
  imagePool: [
    { kind: "image", file: "011/01_overtoun_bridge_geograph.jpg", width: 640, height: 480 },
    { kind: "image", file: "011/02_overtoun_house_bridge.jpg", width: 4388, height: 2860 },
    { kind: "image", file: "011/03_overtoun_bridge_vista.jpg", width: 1168, height: 1600 },
  ],
  reelOptions: { imagesPerVideo: 3 },
  shots: rawShots011 as Shot[],
};


const episode013: EpisodeConfig = {
  id: "013",
  chapterNumber: 6,
  narrationFile: "narracion-013.mp3",
  narrationDurationSeconds: 477.60254,
  captions: normalizeCaptions(rawCaptions013 as Caption[]),
  clips: rawClips013 as ClipMark[],
  videoPool: [],
  imagePool: [
    { kind: "image", file: "013/01_georgia_guidestones_monumento.jpg", width: 4288, height: 2848 },
    { kind: "image", file: "013/02_georgia_guidestones_vista.jpg", width: 3616, height: 2832 },
    { kind: "image", file: "013/03_georgia_guidestones_detalle.jpg", width: 3348, height: 2504 },
  ],
  reelOptions: { imagesPerVideo: 3 },
  shots: rawShots013 as Shot[],
};



const episode014: EpisodeConfig = {
  id: "014",
  chapterNumber: 6,
  narrationFile: "narracion-014.mp3",
  narrationDurationSeconds: 429.691066,
  captions: normalizeCaptions(rawCaptions014 as Caption[]),
  clips: rawClips014 as ClipMark[],
  videoPool: [],
  imagePool: [
    { kind: "image", file: "014/01_faro_eilean_mor.jpg", width: 544, height: 334 },
    { kind: "image", file: "014/02_faro_flannan_celda.jpg", width: 634, height: 429 },
    { kind: "image", file: "014/03_islas_flannan_vista.jpg", width: 640, height: 480 },
  ],
  reelOptions: { imagesPerVideo: 3 },
  shots: rawShots014 as Shot[],
};


export const episodes: EpisodeConfig[] = [episode002, episode003, episode004, episode008, episode010, episode012, episode011, episode013, episode014];

export const getEpisode = (id: string): EpisodeConfig => {
  const ep = episodes.find((e) => e.id === id);
  if (!ep) throw new Error(`Unknown episode "${id}"`);
  return ep;
};

// The narration-driven content length. An episode's clips.json/captions.json
// frame numbers are always relative to THIS (frame 0 = the first word of
// narration).
export const mainDurationInFrames = (ep: EpisodeConfig): number =>
  Math.max(secToFrames(ep.narrationDurationSeconds), secToFrames(totalDurationFromCaptions(ep.captions)));

export { FPS };

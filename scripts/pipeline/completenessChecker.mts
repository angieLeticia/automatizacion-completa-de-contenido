import type { Completeness, EpisodeFiles } from "./types.mts";

// Solo mira lo que hay en el disco ahora mismo — es una propiedad puramente
// técnica del material, sin memoria ni opinión sobre si debe producirse (eso
// es AUTHORIZED, ver authorization.mts). READY NO exige narración: si falta,
// se genera vía ElevenLabs dentro de processProject(), pero solo después de
// que el proyecto fue autorizado (Fase 4.5) — nunca durante detección/scan.
export const checkCompleteness = (ep: EpisodeFiles): Completeness => {
  if (!ep.scriptFile) return { status: "WAITING_FOR_MATERIAL", reason: "falta el guion (Guion*.md)" };
  if (ep.videoFiles.length === 0 && ep.imageFiles.length === 0) {
    return { status: "WAITING_FOR_MATERIAL", reason: "no hay videos ni imágenes en Videos/ o Imagenes/" };
  }
  return { status: "READY" };
};

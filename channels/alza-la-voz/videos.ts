// Fase 5.1 — migrado desde el repositorio independiente
// D:\MATERIAL VIDEOS\ALZA LA VOZ\Alza-la-Voz\remotion\data\videos.ts (ese
// repo tenía 0 commits reales, todo el código vivía sin respaldo solo en
// disco local — ver informe de Fase 5.1). Datos del canal, NO del template:
// el componente reusable vive en remotion/QuoteVideo.tsx.
//
// [PARCIAL] Solo se migraron los 4 videos que YA tenían assets reales
// verificados en disco (motivadoras, mujeres, dia-a-dia, estudiantes) —
// exactamente los mismos 4 que el propio render-all.mjs original
// contemplaba. Los otros 9 temas reales en D:\ (superacion, emprendedores,
// autoestima, padres, gratitud, momentos-dificiles, volver-a-empezar,
// cuidan-de-otros, empezar-de-nuevo-en-otro-lugar) tienen carpetas de
// episodio en D:\ pero NO se confirmó que tengan sus assets de audio/imagen
// ya preparados en el mismo formato — no se migran a ciegas sin verificar
// (ver Sección 16 del encargo: "no elimines/inventes sin evidencia").
export type Phrase = {
  text: string;
  image: string; // relativo a public/assets/alza-la-voz/
};

export type VideoDef = {
  id: string;
  title: string;
  music: string; // relativo a public/assets/alza-la-voz/
  accentColor: string;
  phrases: Phrase[];
};

export const SECONDS_PER_PHRASE = 10;

export const videos: VideoDef[] = [
  {
    id: "motivadoras",
    title: "Frases Motivadoras",
    music: "audio/motivacion.mp3",
    accentColor: "#F5A623",
    phrases: [
      { text: "Cada amanecer es una nueva oportunidad para empezar de nuevo.", image: "images/motivadoras/1.jpg" },
      { text: "El miedo solo dura un instante; el arrepentimiento dura toda la vida.", image: "images/motivadoras/2.jpg" },
      { text: "No necesitas ver todo el camino, solo el siguiente paso.", image: "images/motivadoras/3.png" },
      { text: "Tu esfuerzo de hoy es la fuerza que necesitarás mañana.", image: "images/motivadoras/4.jpg" },
      { text: "Las grandes metas se construyen con pequeños actos de valentía.", image: "images/motivadoras/5.jpg" },
      { text: "Nunca es tarde para convertirte en quien quieres ser.", image: "images/motivadoras/6.jpg" },
    ],
  },
  {
    id: "mujeres",
    title: "Frases para la Mujer",
    music: "audio/mujeres.mp3",
    accentColor: "#D14D72",
    phrases: [
      { text: "Una mujer que se levanta, levanta a todas las que vienen detrás.", image: "images/mujeres/1.jpg" },
      { text: "Nuestra voz no pide permiso, se hace escuchar.", image: "images/mujeres/2.jpg" },
      { text: "En cada tormenta que hemos resistido, encontramos una razón más para alzar la voz.", image: "images/mujeres/3.jpg" },
      { text: "Ser mujer es llevar la fuerza de mil historias en un solo latido.", image: "images/mujeres/4.jpg" },
      { text: "El mundo cambia cuando una mujer decide no quedarse en silencio.", image: "images/mujeres/5.jpg" },
      { text: "Nuestros derechos no son una concesión, son una conquista que se defiende cada día.", image: "images/mujeres/6.jpg" },
    ],
  },
  {
    id: "dia-a-dia",
    title: "Frases del Día a Día",
    music: "audio/dia-a-dia.mp3",
    accentColor: "#4A90D9",
    phrases: [
      { text: "La felicidad se esconde en las cosas pequeñas que hacemos cada día.", image: "images/dia-a-dia/1.jpg" },
      { text: "Hoy también puede ser un buen día, solo tienes que decidirlo.", image: "images/dia-a-dia/2.jpg" },
      { text: "No hace falta un gran plan, basta con un paso a la vez.", image: "images/dia-a-dia/3.jpg" },
      { text: "Agradece lo simple: un café caliente, una sonrisa, un momento de calma.", image: "images/dia-a-dia/4.jpg" },
      { text: "La rutina también puede tener magia si aprendes a mirarla distinto.", image: "images/dia-a-dia/5.jpg" },
      { text: "Cada día que sigues intentando, ya es una victoria.", image: "images/dia-a-dia/6.jpg" },
    ],
  },
  {
    id: "estudiantes",
    title: "Frases para Estudiantes",
    music: "audio/estudiantes.mp3",
    accentColor: "#5CB85C",
    phrases: [
      { text: "No saber qué carrera elegir no significa que estés perdido, significa que estás explorando.", image: "images/estudiantes/1.jpg" },
      { text: "Tu camino no tiene que estar decidido hoy para que sea el correcto.", image: "images/estudiantes/2.jpg" },
      { text: "Equivocarte de carrera no es fracasar, es aprender más rápido quién eres.", image: "images/estudiantes/3.jpg" },
      { text: "La universidad no define tu futuro, tú lo haces con cada decisión.", image: "images/estudiantes/4.jpg" },
      { text: "Está bien no tener todas las respuestas a los 18 años.", image: "images/estudiantes/5.jpg" },
      { text: "El primer paso no tiene que ser perfecto, solo tiene que ser tuyo.", image: "images/estudiantes/6.jpg" },
    ],
  },
];

export const durationInFrames = (video: VideoDef, fps: number) => video.phrases.length * SECONDS_PER_PHRASE * fps;

export const getVideo = (id: string): VideoDef | undefined => videos.find((v) => v.id === id);

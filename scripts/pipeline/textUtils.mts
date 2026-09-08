// Normaliza para comparar palabras clave de nombres de archivo (sin tildes)
// contra palabras del guion/transcripción (con tildes).
export const normalizeWord = (w: string): string =>
  w
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

const SPANISH_STOPWORDS = new Set([
  "el", "la", "los", "las", "un", "una", "unos", "unas", "de", "del", "en", "y", "o", "a", "que",
  "se", "su", "sus", "es", "era", "fue", "por", "para", "con", "sin", "al", "lo", "le", "les",
  "no", "si", "ya", "mas", "pero", "como", "cuando", "donde", "esto", "esta", "este", "esa", "ese",
  "eso", "hay", "muy", "tan", "solo", "sobre", "entre", "hasta", "desde", "todo", "toda", "todos",
  "todas", "otro", "otra", "cada", "años", "año", "dos", "tres",
]);

// Palabras de contenido (normalizadas, sin stopwords) de una frase del guion,
// para matchear contra las keywords de un archivo (ver mediaCatalog.ts).
export const contentWords = (text: string): string[] =>
  text
    .split(/[^a-záéíóúñü]+/i)
    .map(normalizeWord)
    .filter((w) => w.length > 2 && !SPANISH_STOPWORDS.has(w));

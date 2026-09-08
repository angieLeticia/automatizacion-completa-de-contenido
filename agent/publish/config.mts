// Configuracion de la Fase 4B.1 (capa de publicacion endurecida - claim atomico,
// puente de archivos, DRY_RUN). Aislado de agent/schedule y agent/analyze.
import path from "node:path";

try {
  process.loadEnvFile(path.join(import.meta.dirname, "..", "..", ".env.local"));
} catch {
  // .env.local no existe o ya esta cargado por el shell - seguimos sin frenar.
}

// Por defecto SIEMPRE en modo seguro: solo DRY_RUN=false (explicito) activa
// publicacion real. Cualquier otro valor (ausente, "true", mal escrito) es dry-run.
export const DRY_RUN = process.env.DRY_RUN !== "false";

export const MAX_RETRIES = 3; // mismo valor que agent/analyze/config.mts, por consistencia

// Tiempo maximo que un post puede permanecer en 'publishing' antes de
// considerarse un claim huerfano (proceso que murio a mitad de publicar).
// Justificacion del valor: la propia publishToInstagram ya espera hasta 5
// minutos de polling interno, y una subida real de YouTube por conexion lenta
// puede tomar varios minutos mas - 30 minutos da margen de sobra para CUALQUIER
// operacion legitima sin arriesgarse a recuperar un claim que sigue en curso.
// Mismo valor que STALE_CLAIM_MINUTES en agent/analyze/config.mts, por consistencia.
// Configurable via env (STALE_CLAIM_MINUTES) para ajustarlo sin tocar codigo si en
// el futuro un publisher legitimo tarda mas de 30 minutos.
const parsedStaleMinutes = Number(process.env.STALE_CLAIM_MINUTES);
export const STALE_CLAIM_MINUTES = Number.isFinite(parsedStaleMinutes) && parsedStaleMinutes > 0 ? parsedStaleMinutes : 30;

// GATE DE SEGURIDAD: la migracion "ALTER TABLE social_posts ADD COLUMN claimed_at"
// (propuesta en el informe de Fase 4B.2, NO ejecutada) todavia no existe en la
// base de datos real. Mientras esta bandera este en false (su valor por defecto),
// claimPost.mts NUNCA intenta leer/escribir claimed_at - evita romper el claim
// atomico (que SI funciona hoy) contra una columna que no existe. Cuando la
// migracion se aplique, cambiar a "true" (via env CLAIMED_AT_MIGRATION_APPLIED=true)
// activa el codigo ya preparado sin necesitar otro despliegue.
export const CLAIMED_AT_MIGRATION_APPLIED = process.env.CLAIMED_AT_MIGRATION_APPLIED === "true";

export const SOCIAL_VIDEOS_BUCKET = "social-videos";
export const STORAGE_PREFIX = "videos"; // videos/<file_hash><ext>

// Estabilidad del archivo local: dos lecturas de fs.stat separadas por este
// intervalo deben coincidir en tamano y mtime para considerarlo "completo".
export const FILE_STABILITY_CHECK_DELAY_MS = 500;

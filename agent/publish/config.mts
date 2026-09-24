// Configuracion de la Fase 4B.1 (capa de publicacion endurecida - claim atomico,
// puente de archivos, DRY_RUN). Aislado de agent/schedule y agent/analyze.
import path from "node:path";

try {
  process.loadEnvFile(path.join(import.meta.dirname, "..", "..", ".env.local"));
} catch {
  // .env.local no existe o ya esta cargado por el shell - seguimos sin frenar.
}

// Fase 13 — credenciales de Backblaze B2 (B2_KEY_ID/B2_APPLICATION_KEY/
// B2_BUCKET_NAME) viven en un archivo FUERA del repositorio, apuntado por
// B2_CREDENTIALS_FILE (variable NO secreta, solo una ruta - se agrega a
// .env.local). Mismo motivo que las demas credenciales de este proyecto:
// nunca en el codigo, nunca en Git. Si la variable no esta definida o el
// archivo no existe, seguimos sin frenar (igual que arriba) - el codigo que
// consuma B2_KEY_ID/B2_APPLICATION_KEY debe fallar explicito (PRESENT/MISSING)
// en vez de asumir.
try {
  const b2CredsPath = process.env.B2_CREDENTIALS_FILE;
  if (b2CredsPath) process.loadEnvFile(b2CredsPath);
} catch {
  // Archivo de credenciales B2 ausente/ilegible - seguimos sin frenar.
}

// Por defecto SIEMPRE en modo seguro: solo DRY_RUN=false (explicito) activa
// publicacion real. Cualquier otro valor (ausente, "true", mal escrito) es dry-run.
export const DRY_RUN = process.env.DRY_RUN !== "false";

export const MAX_RETRIES = 3; // mismo valor que agent/analyze/config.mts, por consistencia

// H4-C.1 (ERROR RECOVERY CONTRACT v2, decision cerrada #4) — limite de
// recoveries MANUALES permitidas por post, independiente y NUNCA mezclado
// con MAX_RETRIES (que gobierna solo reintentos AUTOMATICOS - ver
// retryPolicy.mts, sin modificar en esta fase). Constante clara y aislada a
// proposito, exactamente como MAX_RETRIES arriba: si en el futuro se
// necesita cambiar el valor, es un cambio de una sola linea, controlado y
// explicito, sin tocar la logica de errorRecovery.mts. Valor inicial = 2
// (ver docs/informe H4-B.1 para el razonamiento: un recovery manual ya
// implica que un humano revisó el problema una vez; una segunda oportunidad
// tras una correccion adicional es razonable; una tercera recuperacion sobre
// el MISMO post es señal de que el problema de fondo no se esta resolviendo
// y requiere escalamiento, no otro intento automatico).
export const MAX_RECOVERIES = 2;

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

export const SOCIAL_VIDEOS_BUCKET = "social-videos"; // legado - ver scripts/publish-due-social-posts.mts, ya no es la fuente operativa de Storage para Instagram/Facebook (ver B2_* abajo, Fase 13)
export const STORAGE_PREFIX = "videos"; // videos/<file_hash><ext> - mismo esquema determinista, ahora sobre B2

// Backblaze B2 (S3-compatible) — Fase 13: backend de Storage para
// Instagram/Facebook, en sustitucion operativa del bucket de Supabase Storage
// (limite de 50MiB en el plan Free, causa raiz confirmada del bloqueo real
// del piloto de Facebook - ver STORAGE_META_AUDIT/STORAGE_ALTERNATIVES_AUDIT/
// FINAL_STORAGE_DECISION_AUDIT/BACKBLAZE_B2_EXPERIMENT, todas previas a esta
// fase). B2_KEY_ID/B2_APPLICATION_KEY llegan SOLO via variables de entorno
// (ver arriba, B2_CREDENTIALS_FILE) - nunca hardcodeados. Endpoint/region NO
// son secretos: se derivaron UNA vez via la llamada oficial de solo lectura
// b2_authorize_account contra la cuenta real (experimento previo a esta
// fase) y se fijan aqui como constantes, evitando una llamada de red
// adicional en cada ejecucion del agente.
export const B2_ENDPOINT = "https://s3.us-east-005.backblazeb2.com";
export const B2_REGION = "us-east-005";
export const B2_BUCKET_NAME = process.env.B2_BUCKET_NAME ?? "";
// Ventana suficiente para cubrir el ciclo completo de un intento de
// publicacion, incluido el polling de hasta 5 minutos que Instagram hace
// mientras procesa el contenedor (ver lib/social/instagram.ts::POLL_TIMEOUT_MS),
// sin acercarse al maximo de 7 dias que B2 permite para una URL firmada. La
// URL nunca se persiste (ver storageBridge.mts) - una ventana corta no tiene
// costo de usabilidad, solo reduce la exposicion si llegara a filtrarse.
export const B2_PRESIGNED_URL_EXPIRY_SECONDS = 600;

// Estabilidad del archivo local: dos lecturas de fs.stat separadas por este
// intervalo deben coincidir en tamano y mtime para considerarlo "completo".
export const FILE_STABILITY_CHECK_DELAY_MS = 500;

// Fase 5.4 — pruebas reales de la lógica pura de recuperación de claims y
// reconciliación. Mismo patrón ad-hoc del proyecto: asserts explícitos, sin
// mocks de librerías, sin conexión a Supabase (todo lo probado aquí vive en
// archivos SIN import de supabaseClient.mts, exactamente por eso son
// probables sin credenciales — ver staleClaimClassification.mts/reconciliation.mts).
//
// Lo que este archivo NO prueba (documentado, no fabricado — ver
// docs/phase-5.4-claim-recovery.md): recoverStaleClaims()/claimPost() contra
// Supabase real (requiere que publisher_operation_ref exista en producción,
// todavía no aplicado); reconcileYouTube()/reconcileInstagram() contra la
// plataforma real (requiere credenciales OAuth reales, no disponibles ni
// autorizadas en esta fase); el callback onOperationRef de
// publishToYouTube/publishToInstagram contra la API real.
import { classifyStaleClaim, isRealOperationRef, publishAttemptPlaceholder } from "./staleClaimClassification.mts";
import { mapYouTubeResumableStatus, mapInstagramContainerStatus } from "./reconciliation.mts";
import { decideRetry } from "./retryPolicy.mts";
import { MAX_RETRIES } from "./config.mts";

let failures = 0;
const check = (label: string, cond: boolean, extra = "") => {
  const mark = cond ? "PASS" : "FAIL";
  if (!cond) failures++;
  console.log(`[${mark}] ${label}${extra ? " — " + extra : ""}`);
};

function main() {
  // ---- CASO A: publisher_operation_ref ausente -> reintento automático ----
  const casoA = classifyStaleClaim(null);
  check("CASO A — publisher_operation_ref=null -> action='retry'", casoA.action === "retry");
  const casoAUndefined = classifyStaleClaim(undefined);
  check("CASO A — publisher_operation_ref=undefined -> action='retry' (mismo tratamiento que null)", casoAUndefined.action === "retry");

  // ---- CASO B/C: cualquier valor no vacío -> verification_required, NUNCA retry ----
  const casoBReal = classifyStaleClaim("https://upload.youtube.com/resumable/session/abc123");
  check("CASO B — referencia real de YouTube -> action='verification_required'", casoBReal.action === "verification_required");
  const casoBPlaceholder = classifyStaleClaim(publishAttemptPlaceholder("facebook"));
  check("CASO B — placeholder 'pending:facebook' (Facebook, sin referencia real) -> TAMBIÉN 'verification_required', nunca 'retry'", casoBPlaceholder.action === "verification_required");
  const casoBInstagram = classifyStaleClaim("17895695668004550"); // creationId real de Instagram (numérico)
  check("CASO B — creationId real de Instagram -> action='verification_required'", casoBInstagram.action === "verification_required");

  // ---- isRealOperationRef: distingue placeholder de referencia real ----
  check("isRealOperationRef — placeholder 'pending:facebook' NO es una referencia real", isRealOperationRef(publishAttemptPlaceholder("facebook")) === false);
  check("isRealOperationRef — uploadUrl real de YouTube SÍ es una referencia real", isRealOperationRef("https://upload.youtube.com/x") === true);
  check("isRealOperationRef — null NO es una referencia real", isRealOperationRef(null) === false);
  check("isRealOperationRef — string vacío NO es una referencia real", isRealOperationRef("") === false);

  // ---- CASO E: retry_count >= MAX_RETRIES ya agotado — reutiliza decideRetry, no se inventa un límite aparte ----
  const decisionAgotada = decideRetry("retryable", MAX_RETRIES - 1);
  check(`CASO E — retry_count=${MAX_RETRIES - 1} (el intento MAX_RETRIES-ésimo) -> nextStatus='error' (límite respetado, no reintenta infinito)`, decisionAgotada.nextStatus === "error");
  const decisionConMargen = decideRetry("retryable", 0);
  check("CASO E (control) — retry_count=0 -> nextStatus='pending' (todavía hay margen)", decisionConMargen.nextStatus === "pending");

  // ---- Reconciliación YouTube — mapeo puro, sin red (Sección 4 de la auditoría, CONFIRMADO por doc oficial) ----
  check("mapYouTubeResumableStatus(201) -> CONFIRMED_PUBLISHED (subida resumible confirmada completa)", mapYouTubeResumableStatus(201) === "CONFIRMED_PUBLISHED");
  check("mapYouTubeResumableStatus(308) -> CONFIRMED_NOT_PUBLISHED (incompleta, nunca genera video visible)", mapYouTubeResumableStatus(308) === "CONFIRMED_NOT_PUBLISHED");
  check("mapYouTubeResumableStatus(404) -> CANNOT_VERIFY (sesión expirada, sin evidencia recuperable)", mapYouTubeResumableStatus(404) === "CANNOT_VERIFY");
  check("mapYouTubeResumableStatus(500) -> CANNOT_VERIFY (código inesperado, no se adivina)", mapYouTubeResumableStatus(500) === "CANNOT_VERIFY");

  // ---- Reconciliación Instagram — mapeo puro, sin red (Sección 5 de la auditoría, CONFIRMADO por doc oficial) ----
  check("mapInstagramContainerStatus('PUBLISHED') -> CONFIRMED_PUBLISHED", mapInstagramContainerStatus("PUBLISHED") === "CONFIRMED_PUBLISHED");
  check("mapInstagramContainerStatus('ERROR') -> CONFIRMED_NOT_PUBLISHED", mapInstagramContainerStatus("ERROR") === "CONFIRMED_NOT_PUBLISHED");
  check("mapInstagramContainerStatus('EXPIRED') -> CANNOT_VERIFY (contenedor perdido, >24h)", mapInstagramContainerStatus("EXPIRED") === "CANNOT_VERIFY");
  check("mapInstagramContainerStatus('FINISHED') -> CANNOT_VERIFY (no es un resultado terminal, no se confunde con PUBLISHED)", mapInstagramContainerStatus("FINISHED") === "CANNOT_VERIFY");
  check("mapInstagramContainerStatus('IN_PROGRESS') -> CANNOT_VERIFY", mapInstagramContainerStatus("IN_PROGRESS") === "CANNOT_VERIFY");

  // ---- Facebook: nunca tiene una referencia real reconciliable con la implementación actual ----
  check(
    "Facebook — el placeholder 'pending:facebook' nunca pasa isRealOperationRef, por lo que reconcileUnknownPublication() para Facebook siempre cae en CANNOT_VERIFY (ver reconciliation.mts)",
    isRealOperationRef(publishAttemptPlaceholder("facebook")) === false
  );

  console.log(`\n${failures === 0 ? "TODOS LOS CASOS PASARON" : `${failures} CASO(S) FALLARON`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main();

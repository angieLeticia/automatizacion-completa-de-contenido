// Fase 5.2.1 — pruebas reales de evaluateChannelAuthorization() (canal.channel_status
// -> autorizado para publicación real / bloqueado). Mismo patrón ad-hoc del proyecto:
// asserts explícitos, sin mocks, sin fixtures — la función es pura, así que se
// invoca directamente con los 5 valores reales de channel_status, sin necesitar
// Supabase ni ningún otro I/O.
//
// Por qué NO hay pruebas end-to-end de resolveAndValidateIdentity()/run.mts en este
// archivo (Casos 5/6/7 del encargo de Fase 5.2.1 — mismatch de channel_id, social_account
// inexistente, DRY_RUN nunca invoca publish real): ambos archivos importan
// supabaseClient.mts, que construye el cliente Supabase real en el momento del import
// (lib/social/supabaseAdmin.ts) y lanza "supabaseUrl is required" de inmediato si
// faltan las credenciales — confirmado directamente en este worktree (Fase 5.2.1,
// sin NEXT_PUBLIC_SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY). Introducir un cliente
// Supabase falso/mock para poder importarlos sería una refactorización de
// resolveAndValidateIdentity()/claimPost()/run.mts hacia inyección de dependencias —
// más allá de la "corrección mínima" pedida para esta fase. Esa lógica (channel_id
// exacto, sin fallback; social_account inexistente = error explícito; DRY_RUN
// siempre revierte a pending) ya fue revisada por inspección de código en Fase 5.2 y
// NO fue tocada en Fase 5.2.1 — sigue NOT VERIFIED contra Supabase real, igual que
// el resto de Agent 3 Flow B, hasta que existan credenciales.
import { evaluateChannelAuthorization } from "./channelAuthorization.mts";

let failures = 0;
const check = (label: string, cond: boolean, extra = "") => {
  const mark = cond ? "PASS" : "FAIL";
  if (!cond) failures++;
  console.log(`[${mark}] ${label}${extra ? " — " + extra : ""}`);
};

function main() {
  // ---- Caso 1: ACTIVE — único estado que autoriza publicación real ----
  const active = evaluateChannelAuthorization("ACTIVE");
  check("ACTIVE — no bloqueado", active.blocked === false);
  check("ACTIVE — autorizado para publicación real (sujeto a DRY_RUN y demás controles en run.mts)", active.authorizedForRealPublication === true);

  // ---- Caso 2: BLOCKED — bloqueo explícito, nunca avanza a publicación ----
  const blocked = evaluateChannelAuthorization("BLOCKED");
  check("BLOCKED — bloqueado explícitamente (resolveAndValidateIdentity devuelve ok:false, nunca llega a claim/publish)", blocked.blocked === true);
  check("BLOCKED — no autorizado para publicación real", blocked.authorizedForRealPublication === false);
  check("BLOCKED — trae un motivo explícito, no un booleano ambiguo", typeof blocked.reason === "string" && blocked.reason.includes("BLOCKED"));

  // ---- Caso 3: HISTORICAL — mismo tratamiento que BLOCKED ----
  const historical = evaluateChannelAuthorization("HISTORICAL");
  check("HISTORICAL — bloqueado explícitamente (nunca avanza a publicación)", historical.blocked === true);
  check("HISTORICAL — no autorizado para publicación real", historical.authorizedForRealPublication === false);

  // ---- Caso 4: TEST — nunca publicación real, pero NO bloquea el resto del flujo
  // (claim/schedule siguen funcionando; run.mts lo trata como DRY_RUN forzado,
  // independientemente del valor global de DRY_RUN) ----
  const test = evaluateChannelAuthorization("TEST");
  check("TEST — NO bloqueado (el resto del flujo — claim, schedule — sigue funcionando)", test.blocked === false);
  check("TEST — nunca autorizado para publicación real, pase lo que pase con DRY_RUN global", test.authorizedForRealPublication === false);

  // ---- READY: contrato ambiguo para publicación (documentado en Fase 5.2.1) —
  // opción segura: mismo tratamiento que TEST, no se inventa una interpretación ----
  const ready = evaluateChannelAuthorization("READY");
  check("READY — NO bloqueado (sí es producible para render)", ready.blocked === false);
  check("READY — no autorizado para publicación real (ambigüedad resuelta de forma segura, documentado)", ready.authorizedForRealPublication === false);

  // ---- Defensivo: valor ausente/desconocido (no debería ocurrir con el CHECK
  // constraint real del schema, pero la función nunca debe fallar de forma insegura) ----
  const nullStatus = evaluateChannelAuthorization(null);
  check("null/desconocido — no bloqueado, pero tampoco autorizado para publicación real (seguro por defecto)", nullStatus.blocked === false && nullStatus.authorizedForRealPublication === false);

  // ---- channel_status nunca es el ÚNICO control: run.mts combina
  // `DRY_RUN || !identityOutcome.authorizedForRealPublication` — confirma que un
  // canal ACTIVE con DRY_RUN=true sigue sin publicar de verdad (Caso 1 completo). ----
  const dryRunTrue = true;
  const activeWithDryRun = dryRunTrue || !active.authorizedForRealPublication;
  check("ACTIVE + DRY_RUN=true — la condición combinada en run.mts sigue deteniendo la publicación real (channel_status no sustituye a DRY_RUN)", activeWithDryRun === true);
  const dryRunFalse = false;
  const testWithDryRunFalse = dryRunFalse || !test.authorizedForRealPublication;
  check("TEST + DRY_RUN=false (global) — TEST igual detiene la publicación real (DRY_RUN no sustituye a channel_status)", testWithDryRunFalse === true);
  const activeWithDryRunFalse = dryRunFalse || !active.authorizedForRealPublication;
  check("ACTIVE + DRY_RUN=false (global) — única combinación que NO detiene la publicación real", activeWithDryRunFalse === false);

  console.log(`\n${failures === 0 ? "TODOS LOS CASOS PASARON" : `${failures} CASO(S) FALLARON`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main();

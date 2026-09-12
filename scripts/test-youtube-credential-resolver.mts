// Fase 5.19 — pruebas de resolveYoutubeChannelCredentials()/normalizeChannelArgument()
// (scripts/youtubeCredentialResolver.mts). 100% puras: usan objetos de
// entorno SINTÉTICOS (nunca el .env.local real, nunca process.env), así que
// no requieren credenciales reales ni tocan Supabase/YouTube. No duplica los
// tests de Agent 3 ya existentes (test-youtube-identity.mts) - esto prueba
// exclusivamente la resolución de credenciales del script de setup manual.
import {
  resolveYoutubeChannelCredentials,
  normalizeChannelArgument,
  resolveExpectedChannelId,
  decideProvisioningIdentityOutcome,
} from "./youtubeCredentialResolver.mts";
import { evaluateChannelIdentityMatch } from "../agent/publish/youtubeChannelIdentity.mts";

let failures = 0;
const check = (label: string, cond: boolean, extra = "") => {
  const mark = cond ? "PASS" : "FAIL";
  if (!cond) failures++;
  console.log(`[${mark}] ${label}${extra ? " — " + extra : ""}`);
};

// Entorno sintético con las 4 cuentas reales del proyecto + las genéricas
// (con valores obviamente falsos, nunca reales) - simula exactamente la
// forma de .env.local sin usar ningún valor real.
const fakeEnv = {
  YOUTUBE_CLIENT_ID: "generico-id.apps.googleusercontent.com",
  YOUTUBE_CLIENT_SECRET: "generico-secret",
  YOUTUBE_CLIENT_ID_SIN_EXPLICACION: "sin-explicacion-id.apps.googleusercontent.com",
  YOUTUBE_CLIENT_SECRET_SIN_EXPLICACION: "sin-explicacion-secret",
  YOUTUBE_CLIENT_ID_ENCIENDE_EL_CAOS: "enciende-el-caos-id.apps.googleusercontent.com",
  YOUTUBE_CLIENT_SECRET_ENCIENDE_EL_CAOS: "enciende-el-caos-secret",
  YOUTUBE_CLIENT_ID_LUNA_VERDE: "luna-verde-id.apps.googleusercontent.com",
  YOUTUBE_CLIENT_SECRET_LUNA_VERDE: "luna-verde-secret",
  YOUTUBE_CLIENT_ID_OBJETOS_MALDITOS: "objetos-malditos-id.apps.googleusercontent.com",
  YOUTUBE_CLIENT_SECRET_OBJETOS_MALDITOS: "objetos-malditos-secret",
} as unknown as NodeJS.ProcessEnv;

function main() {
  // ==================================================
  // 1-4 — los 4 canales reales del proyecto, credenciales completas -> PASS
  // ==================================================
  for (const channel of ["SIN_EXPLICACION", "ENCIENDE_EL_CAOS", "LUNA_VERDE", "OBJETOS_MALDITOS"]) {
    const result = resolveYoutubeChannelCredentials(channel, fakeEnv);
    check(`${channel} con credenciales completas -> PASS`, result.ok === true);
    if (result.ok) {
      check(`${channel} — clientId resuelto es el específico del canal, no el genérico`, result.clientId === fakeEnv[`YOUTUBE_CLIENT_ID_${channel}`]);
    }
  }

  // ==================================================
  // 5 — canal desconocido (ninguna variable existe para él) -> BLOCK
  // ==================================================
  const unknown = resolveYoutubeChannelCredentials("CANAL_QUE_NO_EXISTE", fakeEnv);
  check("5. Canal desconocido (cero variables configuradas) -> BLOCK", unknown.ok === false);
  check("5b. El mensaje distingue 'desconocido' de 'incompleto'", !unknown.ok && /desconocido/i.test(unknown.reason));

  // ==================================================
  // 6 — argumento ausente -> BLOCK
  // ==================================================
  const noArg = resolveYoutubeChannelCredentials(undefined, fakeEnv);
  check("6. Argumento de canal ausente -> BLOCK", noArg.ok === false);
  const emptyArg = resolveYoutubeChannelCredentials("   ", fakeEnv);
  check("6b. Argumento de canal vacío/solo espacios -> BLOCK", emptyArg.ok === false);

  // ==================================================
  // 7/8 — canal "conocido" (una de las 2 variables existe) pero incompleto -> BLOCK
  // ==================================================
  const envMissingSecret = { ...fakeEnv, YOUTUBE_CLIENT_ID_CANAL_PARCIAL: "algun-id.apps.googleusercontent.com" } as unknown as NodeJS.ProcessEnv;
  const missingSecret = resolveYoutubeChannelCredentials("CANAL_PARCIAL", envMissingSecret);
  check("7. client_id presente pero client_secret ausente -> BLOCK", missingSecret.ok === false);
  check("7b. El mensaje identifica específicamente el campo faltante (client_secret)", !missingSecret.ok && /CLIENT_SECRET/i.test(missingSecret.reason));

  const envMissingId = { ...fakeEnv, YOUTUBE_CLIENT_SECRET_OTRO_PARCIAL: "algun-secret" } as unknown as NodeJS.ProcessEnv;
  const missingId = resolveYoutubeChannelCredentials("OTRO_PARCIAL", envMissingId);
  check("8. client_secret presente pero client_id ausente -> BLOCK", missingId.ok === false);
  check("8b. El mensaje identifica específicamente el campo faltante (client_id)", !missingId.ok && /CLIENT_ID/i.test(missingId.reason));

  // ==================================================
  // 9 — NUNCA fallback a las variables genéricas, ni siquiera si el canal
  // solicitado no existe pero las genéricas sí tienen valores.
  // ==================================================
  const unknownButGenericExists = resolveYoutubeChannelCredentials("CANAL_INVENTADO", fakeEnv);
  check(
    "9. Canal desconocido con genéricas presentes -> BLOCK igual, NUNCA usa las genéricas como fallback",
    unknownButGenericExists.ok === false
  );
  const known = resolveYoutubeChannelCredentials("SIN_EXPLICACION", fakeEnv);
  check(
    "9b. Para un canal válido, el clientId resuelto NUNCA es el genérico",
    known.ok === true && known.clientId !== fakeEnv.YOUTUBE_CLIENT_ID
  );

  // ==================================================
  // 10 — normalización segura y predecible
  // ==================================================
  check("10. Minúsculas -> mayúsculas", normalizeChannelArgument("sin_explicacion") === "SIN_EXPLICACION");
  check("10b. Espacios -> guion_bajo", normalizeChannelArgument("SIN EXPLICACION") === "SIN_EXPLICACION");
  check("10c. Guiones -> guion_bajo", normalizeChannelArgument("SIN-EXPLICACION") === "SIN_EXPLICACION");
  check("10d. Espacios múltiples colapsan a un solo guion_bajo", normalizeChannelArgument("SIN   EXPLICACION") === "SIN_EXPLICACION");
  check("10e. Espacios al borde se recortan", normalizeChannelArgument("  SIN_EXPLICACION  ") === "SIN_EXPLICACION");
  check(
    "10f. Un canal normalizado coincide con el resuelto por resolveYoutubeChannelCredentials",
    resolveYoutubeChannelCredentials("sin explicacion", fakeEnv).ok === true
  );

  // ==================================================
  // resolveExpectedChannelId() — Fase 5.19 (corrección post-auditoría)
  // ==================================================
  const REAL_ID = "UCHtU7U5zZ1gndN5o-C2eeFQ"; // channel ID real de SIN EXPLICACIÓN (Fase 5.18) — público, no es secreto
  const OTHER_REAL_ID = "UCvoDZTSqHNGutaNiBhTY19w"; // channel ID real de ENCIENDE EL CAOS — público

  const envWithRegistry = { ...fakeEnv, YOUTUBE_CHANNEL_ID_SIN_EXPLICACION: REAL_ID } as unknown as NodeJS.ProcessEnv;

  // 1. expected ID ausente (ni registro ni argumento) -> bootstrap
  const noExpected = resolveExpectedChannelId("SIN_EXPLICACION", fakeEnv, undefined);
  check("R1. Sin registro y sin argumento -> mode='bootstrap'", noExpected.mode === "bootstrap");

  // 2. registro presente, sin argumento -> verify, fuente 'registry'
  const registryOnly = resolveExpectedChannelId("SIN_EXPLICACION", envWithRegistry, undefined);
  check("R2. Registro presente -> mode='verify', source='registry'", registryOnly.mode === "verify" && registryOnly.source === "registry");
  check("R2b. expectedChannelId = el valor del registro", registryOnly.mode === "verify" && registryOnly.expectedChannelId === REAL_ID);

  // 4. argumento correcto, sin registro -> verify, fuente 'argument'
  const argOnly = resolveExpectedChannelId("ENCIENDE_EL_CAOS", fakeEnv, OTHER_REAL_ID);
  check("R4. Sin registro, con argumento -> mode='verify', source='argument'", argOnly.mode === "verify" && argOnly.source === "argument");

  // 6. registro Y argumento presentes pero DISTINTOS -> inconsistent
  const inconsistent = resolveExpectedChannelId("SIN_EXPLICACION", envWithRegistry, OTHER_REAL_ID);
  check("R6. Registro y argumento inconsistentes -> mode='inconsistent'", inconsistent.mode === "inconsistent");
  check("R6b. El mensaje menciona ambos valores en conflicto", inconsistent.mode === "inconsistent" && inconsistent.reason.includes(REAL_ID) && inconsistent.reason.includes(OTHER_REAL_ID));

  // registro Y argumento presentes e IGUALES -> verify, sin inconsistencia
  const consistent = resolveExpectedChannelId("SIN_EXPLICACION", envWithRegistry, REAL_ID);
  check("R6c. Registro y argumento coinciden -> mode='verify' (no 'inconsistent')", consistent.mode === "verify");

  // ==================================================
  // decideProvisioningIdentityOutcome() — la función que protege el refresh_token
  // ==================================================
  // 2 (continuación) — expected correcto (registro) + canal real coincide -> VERIFIED, puede mostrar
  const verifiedFromRegistry = decideProvisioningIdentityOutcome(registryOnly, REAL_ID, evaluateChannelIdentityMatch);
  check("R-outcome. Registro + canal real coincide -> canShowRefreshToken=true, mode='verified'", verifiedFromRegistry.canShowRefreshToken === true && verifiedFromRegistry.mode === "verified");

  // 3 — expected correcto (registro) pero canal real es OTRO -> mismatch, BLOQUEADO
  const mismatchFromRegistry = decideProvisioningIdentityOutcome(registryOnly, OTHER_REAL_ID, evaluateChannelIdentityMatch);
  check("R3. Registro presente + canal real distinto -> canShowRefreshToken=false, mode='mismatch'", mismatchFromRegistry.canShowRefreshToken === false && mismatchFromRegistry.mode === "mismatch");

  // 5 — argumento correcto + canal real coincide -> VERIFIED
  const verifiedFromArg = decideProvisioningIdentityOutcome(argOnly, OTHER_REAL_ID, evaluateChannelIdentityMatch);
  check("R5. Solo argumento + canal real coincide -> canShowRefreshToken=true", verifiedFromArg.canShowRefreshToken === true);

  // argumento + canal real distinto -> mismatch
  const mismatchFromArg = decideProvisioningIdentityOutcome(argOnly, REAL_ID, evaluateChannelIdentityMatch);
  check("R5b. Solo argumento + canal real distinto -> canShowRefreshToken=false", mismatchFromArg.canShowRefreshToken === false);

  // 6 — configuración inconsistente -> BLOQUEADO sin ni siquiera mirar el canal real
  const blockedByInconsistency = decideProvisioningIdentityOutcome(inconsistent, REAL_ID, evaluateChannelIdentityMatch);
  check("R6d. Configuración inconsistente -> canShowRefreshToken=false, mode='inconsistent' (sin importar el canal real)", blockedByInconsistency.canShowRefreshToken === false && blockedByInconsistency.mode === "inconsistent");

  // 7 — bootstrap con canal real obtenido -> puede mostrar (modo bootstrap, sin verificación automática)
  const bootstrapOk = decideProvisioningIdentityOutcome(noExpected, REAL_ID, evaluateChannelIdentityMatch);
  check("R7. Bootstrap con canal real válido -> canShowRefreshToken=true, mode='bootstrap'", bootstrapOk.canShowRefreshToken === true && bootstrapOk.mode === "bootstrap");

  // 8 — identidad no verificada: channels.list no devolvió nada (null), en AMBOS modos
  const bootstrapNoReal = decideProvisioningIdentityOutcome(noExpected, null, evaluateChannelIdentityMatch);
  check("R8. Bootstrap SIN canal real (null) -> canShowRefreshToken=false (ni siquiera bootstrap lo permite)", bootstrapNoReal.canShowRefreshToken === false);
  const verifyNoReal = decideProvisioningIdentityOutcome(registryOnly, null, evaluateChannelIdentityMatch);
  check("R8b. Verify SIN canal real (null) -> canShowRefreshToken=false", verifyNoReal.canShowRefreshToken === false);

  // 9 — refresh_token SOLO tras identidad válida: barrido exhaustivo de todas
  // las combinaciones "malas" -> SIEMPRE canShowRefreshToken=false
  const badOutcomes = [
    decideProvisioningIdentityOutcome(inconsistent, REAL_ID, evaluateChannelIdentityMatch),
    decideProvisioningIdentityOutcome(registryOnly, OTHER_REAL_ID, evaluateChannelIdentityMatch),
    decideProvisioningIdentityOutcome(argOnly, REAL_ID, evaluateChannelIdentityMatch),
    decideProvisioningIdentityOutcome(noExpected, null, evaluateChannelIdentityMatch),
    decideProvisioningIdentityOutcome(registryOnly, null, evaluateChannelIdentityMatch),
  ];
  check("R9. TODAS las combinaciones inválidas dan canShowRefreshToken=false, sin excepción", badOutcomes.every((o) => o.canShowRefreshToken === false));
  const goodOutcomes = [
    decideProvisioningIdentityOutcome(registryOnly, REAL_ID, evaluateChannelIdentityMatch),
    decideProvisioningIdentityOutcome(argOnly, OTHER_REAL_ID, evaluateChannelIdentityMatch),
    decideProvisioningIdentityOutcome(noExpected, REAL_ID, evaluateChannelIdentityMatch),
  ];
  check("R9b. Las combinaciones válidas SIEMPRE dan canShowRefreshToken=true", goodOutcomes.every((o) => o.canShowRefreshToken === true));

  console.log(`\n${failures === 0 ? "TODOS LOS CASOS PASARON" : `${failures} CASO(S) FALLARON`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main();

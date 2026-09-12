// Fase 5.19 — resolución de credenciales OAuth de YouTube por canal, para
// scripts/get-youtube-refresh-token.mts. Vive en su propio archivo, sin
// disparar ningún side-effect (sin abrir servidores, sin leer .env.local
// directamente) - recibe el entorno como parámetro, para ser 100% testeable
// sin depender de qué haya realmente en el proceso.
//
// Registro basado en NOMBRE DE VARIABLE, no en una lista fija de canales
// (`if/else` por canal): "conocido" vs "desconocido" se decide por si
// EXISTE o no, en el entorno recibido, al menos una de las dos variables
// `YOUTUBE_CLIENT_ID_<CANAL>`/`YOUTUBE_CLIENT_SECRET_<CANAL>` - nunca por una
// lista hardcodeada. Agregar un canal nuevo es solo agregar sus 2 variables
// en .env.local, cero cambios de código aquí.
//
// Deliberadamente NUNCA cae en YOUTUBE_CLIENT_ID/YOUTUBE_CLIENT_SECRET
// (genéricas, sin sufijo) como fallback - esas variables siguen existiendo
// por compatibilidad histórica, pero esta función jamás las consulta.

export type CredentialResolutionResult =
  | { ok: true; channel: string; clientId: string; clientSecret: string }
  | { ok: false; reason: string };

// Normalización predecible: mayúsculas, separadores (espacio/guion) a
// guion_bajo, colapsa repetidos, recorta bordes. Deliberadamente NO hace
// plegado de acentos (ó → o) - un nombre de canal con acento que no
// coincide exactamente con la variable configurada debe fallar como
// "desconocido" (fail-closed), nunca adivinar una equivalencia ambigua.
export function normalizeChannelArgument(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

// Fase 5.19 (corrección post-auditoría) — cierra el gap encontrado: el
// segundo argumento (channel ID esperado) era puramente opcional para TODOS
// los canales, incluso uno cuya identidad real YA se conoce (SIN EXPLICACIÓN,
// Fase 5.18) - permitía volver a caer en el mismo riesgo que esta fase
// existe para eliminar, con solo olvidar escribir el argumento. Ahora la
// identidad esperada vive en un registro por canal, igual que las
// credenciales: `YOUTUBE_CHANNEL_ID_<CANAL>` (opcional). Si existe, la
// verificación deja de ser opcional - se vuelve obligatoria
// automáticamente, sin depender de que el humano recuerde un argumento.
export type ExpectedIdentityResolution =
  | { mode: "bootstrap" } // ni registro ni argumento - primera vez, sin nada que verificar todavía
  | { mode: "verify"; expectedChannelId: string; source: "registry" | "argument" }
  | { mode: "inconsistent"; reason: string }; // registro Y argumento presentes, pero DISTINTOS

// Pura - sin red. Decide de dónde sale (si sale) el channel ID esperado,
// ANTES de siquiera abrir el flujo de OAuth. El registro (`YOUTUBE_CHANNEL_ID_<CANAL>`)
// es SIEMPRE la fuente autoritativa cuando existe - un argumento que lo
// contradice nunca lo sobreescribe silenciosamente, bloquea por
// configuración inconsistente. Resuelto por nombre de variable, igual que
// las credenciales - ningún canal hardcodeado.
export function resolveExpectedChannelId(channel: string, env: NodeJS.ProcessEnv, explicitArg: string | undefined): ExpectedIdentityResolution {
  const registryKey = `YOUTUBE_CHANNEL_ID_${channel}`;
  const registryValue = env[registryKey];
  const arg = typeof explicitArg === "string" && explicitArg.trim().length > 0 ? explicitArg.trim() : undefined;

  if (registryValue) {
    if (arg && arg !== registryValue) {
      return {
        mode: "inconsistent",
        reason:
          `El channel ID pasado como argumento ('${arg}') no coincide con ${registryKey} ya configurado ('${registryValue}') - ` +
          `configuración inconsistente, no se continúa. El registro nunca se sobreescribe silenciosamente - corrige uno de los dos valores.`,
      };
    }
    return { mode: "verify", expectedChannelId: registryValue, source: "registry" };
  }

  if (arg) {
    return { mode: "verify", expectedChannelId: arg, source: "argument" };
  }

  return { mode: "bootstrap" };
}

export function resolveYoutubeChannelCredentials(rawChannelArgument: string | undefined, env: NodeJS.ProcessEnv): CredentialResolutionResult {
  if (typeof rawChannelArgument !== "string" || rawChannelArgument.trim().length === 0) {
    return {
      ok: false,
      reason:
        "Falta el argumento de canal. Uso: npm run social:youtube-token -- <CANAL> " +
        "(ej. SIN_EXPLICACION, ENCIENDE_EL_CAOS, LUNA_VERDE, OBJETOS_MALDITOS).",
    };
  }

  const channel = normalizeChannelArgument(rawChannelArgument);
  const clientIdKey = `YOUTUBE_CLIENT_ID_${channel}`;
  const clientSecretKey = `YOUTUBE_CLIENT_SECRET_${channel}`;
  const clientId = env[clientIdKey];
  const clientSecret = env[clientSecretKey];

  const hasEither = Boolean(clientId) || Boolean(clientSecret);
  if (!hasEither) {
    return {
      ok: false,
      reason: `Canal desconocido: no existe ninguna credencial configurada para '${channel}' ` +
        `(se buscó ${clientIdKey} y ${clientSecretKey} en el entorno, ninguna presente). ` +
        `Verifica el nombre del canal o agrega sus variables en .env.local.`,
    };
  }
  if (!clientId) {
    return { ok: false, reason: `Credenciales incompletas para '${channel}': falta ${clientIdKey}.` };
  }
  if (!clientSecret) {
    return { ok: false, reason: `Credenciales incompletas para '${channel}': falta ${clientSecretKey}.` };
  }

  return { ok: true, channel, clientId, clientSecret };
}

// Fase 5.19 (corrección) — ÚNICA función que decide si el refresh_token
// puede mostrarse. Pura: recibe la resolución ya calculada (resolveExpectedChannelId)
// y el channel ID real (o null si channels.list falló/vino vacío) - reutiliza
// evaluateChannelIdentityMatch (Fase 5.18, sin modificar) para la comparación
// real cuando hay algo que verificar. El script solo debe imprimir el
// refresh_token cuando `canShowRefreshToken === true` - nunca antes.
export type ProvisioningIdentityOutcome =
  | { canShowRefreshToken: true; mode: "bootstrap" | "verified"; realChannelId: string }
  | { canShowRefreshToken: false; mode: "inconsistent" | "unverifiable" | "mismatch"; reason: string };

export function decideProvisioningIdentityOutcome(
  resolution: ExpectedIdentityResolution,
  realChannelId: string | null,
  evaluateMatch: (real: string | null, expected: string | null | undefined) => { status: string; reason: string }
): ProvisioningIdentityOutcome {
  if (resolution.mode === "inconsistent") {
    return { canShowRefreshToken: false, mode: "inconsistent", reason: resolution.reason };
  }

  if (resolution.mode === "bootstrap") {
    if (typeof realChannelId !== "string" || realChannelId.length === 0) {
      return {
        canShowRefreshToken: false,
        mode: "unverifiable",
        reason: "No se pudo determinar el canal real (channels.list falló/respuesta vacía) - no se puede confirmar ni siquiera en modo bootstrap.",
      };
    }
    return { canShowRefreshToken: true, mode: "bootstrap", realChannelId };
  }

  // mode === "verify"
  const match = evaluateMatch(realChannelId, resolution.expectedChannelId);
  if (match.status !== "VERIFIED") {
    return { canShowRefreshToken: false, mode: "mismatch", reason: match.reason };
  }
  return { canShowRefreshToken: true, mode: "verified", realChannelId: realChannelId as string };
}

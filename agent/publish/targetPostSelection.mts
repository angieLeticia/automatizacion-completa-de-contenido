// Fase 5.20 (cierre de RIESGO 1 del preflight) — hasta ahora main() SIEMPRE
// recorria TODOS los social_posts pending+vencidos; no existia forma de
// ejecutar Agent 3 dirigido a un unico postId sin que los demas posts
// pendientes del mismo canal (channel_status es una propiedad del
// content_account completo, no del post) quedaran expuestos a la misma
// corrida. Esto vive en su propio archivo, sin ningun import de
// supabaseClient.mts, por el mismo motivo que channelAuthorization.mts/
// humanReviewGate.mts/youtubeCredentialResolver.mts: permite probar la
// decision pura sin conexion real.
//
// Generico a proposito - NO hardcodea ningun canal/plataforma/content_file.
// EXPECTED_PLATFORM y EXPECTED_CONTENT_FILE_ID son opcionales: si se dan,
// se vuelven obligatorios (deben coincidir); si se omiten, no se valida ese
// aspecto. Mismo patron de "opcional-pero-obligatorio-si-esta-presente" que
// YOUTUBE_CHANNEL_ID_<CANAL> en la Fase 5.19.
export type TargetMode =
  | { mode: "all" }
  | { mode: "single"; postId: string; expectedPlatform?: string; expectedContentFileId?: string };

function readNonEmpty(value: string | undefined): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

// Pura - sin red, sin Supabase. Ausencia de POST_ID = comportamiento
// existente sin cambios (modo "all"). NUNCA hay un fallback de "single" de
// vuelta a "all" - una vez que POST_ID esta presente, el modo es SIEMPRE
// "single" (la eligibilidad puede bloquear, pero jamas degrada a "procesa
// todos los posts").
export function resolveTargetMode(env: NodeJS.ProcessEnv): TargetMode {
  const postId = readNonEmpty(env.POST_ID);
  if (!postId) return { mode: "all" };
  return {
    mode: "single",
    postId,
    expectedPlatform: readNonEmpty(env.EXPECTED_PLATFORM),
    expectedContentFileId: readNonEmpty(env.EXPECTED_CONTENT_FILE_ID),
  };
}

// Fase 5.20 (Phase A5, auditoria post-piloto) — contrato real confirmado
// ANTES de decidir el comportamiento de null: supabase/schema.sql declara
// `scheduled_at TIMESTAMPTZ NOT NULL` - la columna JAMAS es null en
// produccion real, y SocialPostRow.scheduled_at (types.mts) ya lo tipa como
// `string`, nunca `string | null`. Aun asi, esta interfaz lo tipa opcional a
// proposito (ver mas abajo) para poder expresar en un test el escenario
// "algo entrego una fila sin scheduled_at" sin mentirle a TypeScript en el
// resto del codebase - el comportamiento elegido para ese caso (imposible
// hoy, pero mejor definido que dejarlo pasar) es BLOQUEAR, nunca asumir
// elegible: es la misma consistencia que ya tiene el modo general (main()),
// donde `.lte("scheduled_at", now)` en Postgres NUNCA selecciona una fila
// con scheduled_at NULL (la comparacion es UNKNOWN) - el modo dirigido no
// debe ser mas permisivo que el modo general en ningun escenario.
export interface TargetPostRow {
  id: string;
  status: string;
  content_file_id: string | null;
  scheduled_at?: string | null;
}

export type TargetEligibility = { ok: true } | { ok: false; reason: string };

// Pura - sin red. `row`/`actualPlatform` ya vienen resueltos - esta funcion
// SOLO decide, nunca consulta Supabase. Bloquea (ok:false) ante cualquier
// discrepancia; nunca "adivina" ni permite pasar por defecto. `now` es
// inyectable (default `new Date()`) para que la comparacion de tiempo sea
// 100% determinista en tests, sin mockear el reloj global.
//
// RIESGO 1 del preflight de prueba controlada (Fase 5.20) — el modo dirigido
// (POST_ID) NUNCA debe ser un bypass de scheduling: si `scheduled_at` esta
// en el futuro respecto a `now`, se bloquea exactamente igual que si el post
// no existiera - nada en este archivo ni en run.mts introduce un mecanismo
// de bypass explicito para esto (no se pidio, no se implementa).
export function evaluateTargetPostEligibility(
  row: TargetPostRow | null,
  actualPlatform: string | null,
  target: { postId: string; expectedPlatform?: string; expectedContentFileId?: string },
  now: Date = new Date()
): TargetEligibility {
  if (!row) {
    return { ok: false, reason: `POST_ID='${target.postId}' no existe en social_posts - bloqueado.` };
  }
  if (row.status !== "pending") {
    return { ok: false, reason: `POST_ID='${target.postId}' no esta en status='pending' (actual='${row.status}') - bloqueado.` };
  }
  if (target.expectedContentFileId && row.content_file_id !== target.expectedContentFileId) {
    return {
      ok: false,
      reason: `POST_ID='${target.postId}' tiene content_file_id='${row.content_file_id}', se esperaba '${target.expectedContentFileId}' (EXPECTED_CONTENT_FILE_ID) - bloqueado.`,
    };
  }
  if (target.expectedPlatform && actualPlatform !== target.expectedPlatform) {
    return {
      ok: false,
      reason: `POST_ID='${target.postId}' pertenece a la plataforma '${actualPlatform ?? "desconocida"}', se esperaba '${target.expectedPlatform}' (EXPECTED_PLATFORM) - bloqueado.`,
    };
  }
  if (!row.scheduled_at) {
    // Contractualmente imposible hoy (NOT NULL) - fail-closed de todas formas,
    // nunca "sin scheduled_at = sin restriccion".
    return { ok: false, reason: `POST_ID='${target.postId}' no tiene scheduled_at (ausente/vacio) - no se puede confirmar que este programacionalmente elegible. Bloqueado.` };
  }
  const scheduledTimeMs = new Date(row.scheduled_at).getTime();
  if (!Number.isFinite(scheduledTimeMs)) {
    return { ok: false, reason: `POST_ID='${target.postId}' tiene scheduled_at con formato invalido ('${row.scheduled_at}') - bloqueado.` };
  }
  if (scheduledTimeMs > now.getTime()) {
    return {
      ok: false,
      reason: `POST_ID='${target.postId}' tiene scheduled_at en el futuro (${row.scheduled_at}) - el modo dirigido respeta la programacion igual que el modo general, no existe un bypass. Bloqueado.`,
    };
  }
  return { ok: true };
}

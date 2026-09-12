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

export interface TargetPostRow {
  id: string;
  status: string;
  content_file_id: string | null;
}

export type TargetEligibility = { ok: true } | { ok: false; reason: string };

// Pura - sin red. `row` ya viene resuelto (o null si no existe) y
// `actualPlatform` ya viene resuelto (o null si no se pudo determinar) -
// esta funcion SOLO decide, nunca consulta Supabase. Bloquea (ok:false) ante
// cualquier discrepancia; nunca "adivina" ni permite pasar por defecto.
export function evaluateTargetPostEligibility(
  row: TargetPostRow | null,
  actualPlatform: string | null,
  target: { postId: string; expectedPlatform?: string; expectedContentFileId?: string }
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
  return { ok: true };
}

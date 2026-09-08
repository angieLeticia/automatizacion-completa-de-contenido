// Motor de busqueda de la proxima ventana disponible, usando posting_schedule_rules
// como UNICA fuente de configuracion (nada de horarios fijos en TypeScript).
// Respeta max_posts_per_day, la zona horaria de la cuenta, y distribuye los
// horarios dentro de la ventana en vez de agrupar todo al mismo minuto.
import { supabaseAdmin } from "../supabaseClient.mts";
import { SCHEDULE_LOOKAHEAD_DAYS } from "./config.mts";
import { getZonedDateParts, zonedTimeToUtc, addDays } from "./timezone.mts";

interface ScheduleRule {
  id: string;
  content_account_id: string | null;
  platform: string;
  day_of_week: number | null;
  window_start: string; // "HH:MM:SS"
  window_end: string;
  max_posts_per_day: number;
}

export interface WindowResult {
  scheduledAtUtc: Date;
  ruleId: string;
}

export type WindowOutcome = WindowResult | { error: string };

function parseTimeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

// Prioridad de regla aplicable un dia dado: especifica de la cuenta con dia exacto
// > especifica de la cuenta con dia comodin (NULL) > global con dia exacto >
// global con dia comodin. Esto permite tener una regla global de respaldo (como
// pide el punto 8 de la especificacion) y reglas mas finas por cuenta cuando existan.
function pickApplicableRule(rules: ScheduleRule[], contentAccountId: string, weekday: number): ScheduleRule | undefined {
  const bySpecificity = (list: ScheduleRule[]) => list.filter((r) => r.day_of_week === weekday)[0] ?? list.find((r) => r.day_of_week === null);
  const specific = rules.filter((r) => r.content_account_id === contentAccountId);
  const global = rules.filter((r) => r.content_account_id === null);
  return bySpecificity(specific) ?? bySpecificity(global);
}

export async function findNextAvailableWindow(
  contentAccountId: string,
  socialAccountId: string,
  socialPlatform: string,
  timezone: string
): Promise<WindowOutcome> {
  const { data: rules, error } = await supabaseAdmin
    .from("posting_schedule_rules")
    .select("id, content_account_id, platform, day_of_week, window_start, window_end, max_posts_per_day")
    .eq("platform", socialPlatform)
    .eq("is_active", true)
    .or(`content_account_id.eq.${contentAccountId},content_account_id.is.null`);

  if (error) return { error: `Error consultando posting_schedule_rules: ${error.message}` };
  if (!rules || rules.length === 0) {
    return { error: `No hay reglas activas en posting_schedule_rules para la plataforma '${socialPlatform}' (ni especificas de la cuenta ni globales).` };
  }

  const now = new Date();

  for (let offset = 0; offset <= SCHEDULE_LOOKAHEAD_DAYS; offset++) {
    const candidateInstant = addDays(now, offset);
    const { weekday, year, month, day } = getZonedDateParts(candidateInstant, timezone);

    const rule = pickApplicableRule(rules as ScheduleRule[], contentAccountId, weekday);
    if (!rule) continue; // sin regla aplicable ese dia de la semana - se prueba el siguiente dia

    const dayStartUtc = zonedTimeToUtc(year, month, day, 0, 0, timezone);
    const dayEndUtc = zonedTimeToUtc(year, month, day, 23, 59, timezone);

    const { count, error: countError } = await supabaseAdmin
      .from("social_posts")
      .select("id", { count: "exact", head: true })
      .eq("account_id", socialAccountId)
      .gte("scheduled_at", dayStartUtc.toISOString())
      .lte("scheduled_at", dayEndUtc.toISOString());

    if (countError) return { error: `Error contando publicaciones existentes ese dia: ${countError.message}` };

    const alreadyScheduled = count ?? 0;
    if (alreadyScheduled >= rule.max_posts_per_day) continue; // dia lleno para esta cuenta social, siguiente dia

    const startMin = parseTimeToMinutes(rule.window_start);
    const endMin = parseTimeToMinutes(rule.window_end);
    const span = Math.max(endMin - startMin, 1);
    const totalSlots = rule.max_posts_per_day + 1;

    // Prueba cada slot restante del dia en orden; solo pasa al dia siguiente si
    // TODOS los slots que quedan hoy ya estan en el pasado (ej. la ventana de hoy
    // ya paso), en vez de descartar el dia entero de forma prematura.
    for (let slot = alreadyScheduled + 1; slot <= rule.max_posts_per_day; slot++) {
      const offsetMin = Math.round((span * slot) / totalSlots);
      const targetMin = startMin + offsetMin;
      const hour = Math.floor(targetMin / 60);
      const minute = targetMin % 60;
      const scheduledAtUtc = zonedTimeToUtc(year, month, day, hour, minute, timezone);

      if (scheduledAtUtc.getTime() > now.getTime()) {
        return { scheduledAtUtc, ruleId: rule.id };
      }
    }
  }

  return { error: `No se encontro ninguna ventana disponible en los proximos ${SCHEDULE_LOOKAHEAD_DAYS} dias para '${socialPlatform}'.` };
}

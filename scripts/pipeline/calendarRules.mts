// Fase 3 acelerada — calendario PURO/LOCAL para el puente Agent2->Agent3.
// NO reemplaza posting_schedule_rules/findNextAvailableWindow (agent/schedule/
// findNextWindow.mts), que siguen siendo la fuente real de verdad en
// producción contra Supabase — este módulo es una capa aparte, testeable sin
// Supabase, que le da a Agent2/la cola local una ESTIMACIÓN de ventana antes
// de que el elemento llegue al scheduler real.
import type { SocialPlatform } from "../../agent/publish/types.mts";

export type PublicationWindowRule = {
  dayOfWeek?: number; // 0-6 (0=domingo), undefined = cualquier día
  startHour: number; // hora LOCAL del canal, 0-23
  endHour: number; // > startHour
  maxPostsPerDay: number;
};

// DEFAULT/CONFIGURABLE — placeholder seguro, NO basado en analytics reales de
// ningún canal. Una ventana amplia (10:00-22:00) y 1 post/día evita fabricar
// "mejores horarios" sin evidencia. Reemplazar con CHANNEL_RULES reales
// cuando existan datos confirmados.
export const DEFAULT_RULE: PublicationWindowRule = { startHour: 10, endHour: 22, maxPostsPerDay: 1 };

// Vacío por defecto — mismo criterio que SERIES_REGISTRY (seriesRegistry.mts):
// no se fabrican reglas reales por canal/plataforma sin evidencia confirmada.
export const CHANNEL_RULES: Record<string, Partial<Record<SocialPlatform, PublicationWindowRule[]>>> = {};

export type RuleSource = "CHANNEL_CONFIGURED" | "DEFAULT";

export const resolveRuleFor = (channel: string, platform: SocialPlatform): { rule: PublicationWindowRule; source: RuleSource } => {
  const configured = CHANNEL_RULES[channel]?.[platform]?.[0];
  return configured ? { rule: configured, source: "CHANNEL_CONFIGURED" } : { rule: DEFAULT_RULE, source: "DEFAULT" };
};

export type GetNextPublicationWindowParams = {
  channel: string;
  platform: SocialPlatform;
  derivativeId: string;
  // Aceptados por forma de contrato (Fase 3, Paso 4) pero deliberadamente NO
  // usados para la aritmética de la ventana: el orden/dependencia de una
  // serie SEQUENTIAL ya lo decide canProduceEpisode() (Fase 2,
  // seriesDependency.mts), la única fuente de verdad para esa lógica — NO se
  // duplica acá ("no crear una máquina de estados/lógica paralela").
  seriesType?: "SEQUENTIAL" | "THEMATIC";
  episodeOrder?: readonly string[];
  existingScheduledPosts: { platform: SocialPlatform; scheduledAtUtc: string }[];
};

export type PublicationWindow = { scheduledAtUtc: string; source: RuleSource };

// Pura — busca, día por día desde `now` (inyectable para tests), el primer
// día que respete dayOfWeek (si la regla lo exige) y que no supere
// maxPostsPerDay ya ocupado por existingScheduledPosts (misma plataforma,
// mismo día UTC) — devuelve las startHour:00 UTC de ese día.
export function getNextPublicationWindow(params: GetNextPublicationWindowParams, deps?: { now?: Date }): PublicationWindow {
  const { rule, source } = resolveRuleFor(params.channel, params.platform);
  const now = deps?.now ?? new Date();

  const postsOnDay = (day: Date): number =>
    params.existingScheduledPosts.filter((p) => p.platform === params.platform && sameUtcDay(new Date(p.scheduledAtUtc), day)).length;

  for (let offset = 0; offset < 366; offset++) {
    const candidate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offset, rule.startHour, 0, 0));
    if (rule.dayOfWeek !== undefined && candidate.getUTCDay() !== rule.dayOfWeek) continue;
    if (offset === 0 && candidate.getTime() <= now.getTime()) continue; // ya pasó la ventana de hoy
    if (postsOnDay(candidate) >= rule.maxPostsPerDay) continue;
    return { scheduledAtUtc: candidate.toISOString(), source };
  }
  // Inalcanzable en la práctica (366 días sin ninguna ventana libre) — fail
  // explícito en vez de devolver una fecha inventada.
  throw new Error(`getNextPublicationWindow: no se encontró ventana libre en 366 días para channel="${params.channel}" platform="${params.platform}"`);
}

const sameUtcDay = (a: Date, b: Date): boolean =>
  a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth() && a.getUTCDate() === b.getUTCDate();

// Fase 4.9 — Secciones 16/17. Documenta y tipa lo que YA es real (Etapa 1) y
// deja el contrato de lo que NO existe todavía (Etapa 2), sin fabricar
// ninguna optimización ni declarar un "mejor horario" sin evidencia.
//
// ETAPA 1 — YA IMPLEMENTADA Y REAL (no se reconstruye acá):
//   posting_schedule_rules (channel/content_account + platform + day_of_week +
//   timezone + ventana horaria) -> findNextAvailableWindow() (./findNextWindow.mts)
//   -> scheduleReadyContent() (./scheduleContent.mts). Ningún horario está
//   hardcodeado en TypeScript — todo viene de la tabla, por cuenta y por
//   plataforma, exactamente como pide la Sección 16 ("no hardcodees 'todos a
//   las 8pm'"). Esto YA es el `PublicationSchedule` que pedía el encargo, con
//   otro nombre.
export type { WindowResult, WindowOutcome } from "./findNextWindow.mts";

// ETAPA 2 — NO IMPLEMENTADA. `post_metrics` existe en la base de datos real
// de producción (verificado en Fase 1.1: id, post_id FK, metric_name,
// metric_value numeric, collected_at) pero está vacía y sin ningún código
// consumidor — se excluyó deliberadamente de supabase/schema.sql en la
// Fase 4.1 (ver docs/operational-status.md). Este contrato queda preparado
// para cuando exista evidencia real que lo alimente; no se activa nada.
export type MetricName = "views" | "impressions" | "retention_seconds" | "likes" | "comments" | "shares" | "followers_gained";

export type PerformanceSample = {
  channel: string;
  platform: string;
  contentType: "CLIP" | "HIGHLIGHT" | "VERTICAL" | "MAIN";
  weekday: number; // 0-6
  hour: number; // 0-23, en timezone del canal
  metricName: MetricName;
  metricValue: number;
  collectedAt: string;
};

export type ScheduleRecommendation = {
  channel: string;
  platform: string;
  weekday: number;
  hour: number;
  confidence: "BASELINE" | "DATA_DRIVEN"; // BASELINE = sin datos propios suficientes todavía (Sección 18)
  basedOnSamples: number;
};

// NO implementada — placeholder tipado que documenta la firma futura sin
// fabricar un algoritmo de recomendación sin datos reales que lo respalden.
// Cuando exista suficiente `PerformanceSample[]` real, esta función pasaría
// de BASELINE a DATA_DRIVEN — no antes.
export function recommendSchedule(_channel: string, _platform: string, _samples: PerformanceSample[]): ScheduleRecommendation {
  throw new Error(
    "NOT_IMPLEMENTED: recommendSchedule() requiere post_metrics real con datos propios (Etapa 2, Sección 17-18) — " +
      "no implementado en Fase 4.9 para no declarar un 'mejor horario' sin evidencia."
  );
}

// Helpers de fecha/hora conscientes de zona horaria, sin dependencias nuevas
// (solo Intl nativo). Necesarios porque cada content_account tiene su propia
// timezone (ej. America/Bogota) y NUNCA se debe usar la hora local del servidor.

const WEEKDAY_TO_NUMBER: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export interface ZonedDateParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number; // 0-23
  minute: number;
  weekday: number; // 0=domingo ... 6=sabado, igual a posting_schedule_rules.day_of_week
}

export function getZonedDateParts(date: Date, timeZone: string): ZonedDateParts {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const parts = dtf.formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")) % 24,
    minute: Number(get("minute")),
    weekday: WEEKDAY_TO_NUMBER[get("weekday")],
  };
}

// Convierte una hora de pared (year/month/day/hour/minute) EN una zona horaria
// dada al instante UTC correcto, calculando el offset real (incluye DST) en vez
// de asumir un offset fijo.
export function zonedTimeToUtc(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): Date {
  const asUTC = Date.UTC(year, month - 1, day, hour, minute, 0);
  const parts = getZonedDateParts(new Date(asUTC), timeZone);
  const asIfInterpretedInTZ = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0);
  const offsetMs = asIfInterpretedInTZ - asUTC;
  return new Date(asUTC - offsetMs);
}

export function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

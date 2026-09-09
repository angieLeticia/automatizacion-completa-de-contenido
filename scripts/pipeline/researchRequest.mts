// Fase 4.9 — Sección 6: contrato canal → investigación, para que Agent 1
// nunca reciba un tema genérico. NO reconstruye Agent 1 (que sigue viviendo
// en su propio motor, ver docs/agente-1-motor.md) — esto es solo el contrato
// de ENTRADA que resolvería channel -> ResearchRequest, y el punto donde su
// salida se reconecta con ContentSubmission (agent/ingestion/types.mts,
// Fase 4.3), sin duplicar ese tipo.
import { resolveChannelConfig } from "./channelRegistry.mts";

export type SourcePolicy = {
  minSources: number;
  preferredTiers: Array<"primary" | "secondary" | "tertiary">;
};

export type CopyrightPolicy = {
  allowCommercialMusic: boolean;
  allowCopyrightedFootage: boolean;
  // Referencia a la regla ya documentada (docs/agente-1-motor.md §5) — no se
  // duplica esa lógica acá, solo se declara si el canal la hereda.
  blockedByExistingRule?: string;
};

export type ResearchRequest = {
  channel: string;
  theme: string;
  language: string;
  topic?: string; // si viene dado por la persona; si no, Agent 1 lo propone dentro del theme
  sourcePolicy: SourcePolicy;
  copyrightPolicy: CopyrightPolicy;
  dateRange?: { from: string; to: string };
};

export class ChannelResearchNotConfiguredError extends Error {
  constructor(channel: string, missingField: string) {
    super(`CHANNEL_RESEARCH_NOT_CONFIGURED: "${channel}" no tiene "${missingField}" configurado — no se puede construir un ResearchRequest real (no se inventa el valor).`);
  }
}

const DEFAULT_SOURCE_POLICY: SourcePolicy = { minSources: 2, preferredTiers: ["primary", "secondary"] };

// PELICULAS/MUSICA: bloqueo de copyright ya documentado (agente-1-motor.md
// §5) — se hereda acá explícitamente, no se reinventa la regla.
const COPYRIGHT_BLOCKED_CHANNELS = new Set(["PELICULAS", "MUSICA"]);

export function buildResearchRequest(channel: string, topic?: string): ResearchRequest {
  const config = resolveChannelConfig(channel);
  if (!config) throw new Error(`CHANNEL_NOT_FOUND: "${channel}" no está en el registro de canales conocidos.`);
  if (!config.theme) throw new ChannelResearchNotConfiguredError(channel, "theme");
  if (!config.language) throw new ChannelResearchNotConfiguredError(channel, "language");

  const copyrightBlocked = COPYRIGHT_BLOCKED_CHANNELS.has(channel);
  return {
    channel,
    theme: config.theme,
    language: config.language,
    topic,
    sourcePolicy: DEFAULT_SOURCE_POLICY,
    copyrightPolicy: {
      allowCommercialMusic: !copyrightBlocked,
      allowCopyrightedFootage: false,
      blockedByExistingRule: copyrightBlocked ? "docs/agente-1-motor.md §5" : undefined,
    },
  };
}

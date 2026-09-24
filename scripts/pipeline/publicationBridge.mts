// Fase 3 acelerada — puente PURO/LOCAL Agent2 -> Agent3. NO persiste nada
// nuevo (no crea una segunda cola ni una tabla): computa, a partir de un Job
// COMPLETED de queue.mts (Fase 1.4/2), los elementos que EVENTUALMENTE le
// interesarían a Agent3 (canal/serie/episodio/derivado/plataforma/ventana/
// estado). No escribe en Supabase, no publica, no usa credenciales.
//
// Reutiliza (nunca duplica) la lógica ya existente:
//   - derivativeId()          (seriesRegistry.mts, Fase 2)
//   - canProduceEpisode()     (seriesDependency.mts, Fase 2)
//   - isPublicationAuthorized() (agent/publish/humanReviewGate.mts, Fase 5.14 —
//     import de SOLO tipos+función pura, ese archivo no importa supabaseClient.mts)
import type { SocialPlatform, SocialPostStatus } from "../../agent/publish/types.mts";
import { isPublicationAuthorized, type AuthorizationFields } from "../../agent/publish/humanReviewGate.mts";
import { derivativeId, findSeriesForEpisode, type DerivativeKind } from "./seriesRegistry.mts";
import { canProduceEpisode, type ProductionGate } from "./seriesDependency.mts";
import { getNextPublicationWindow, type GetNextPublicationWindowParams } from "./calendarRules.mts";
import type { Job } from "./queue.mts";

// Los 5 estados lógicos pedidos (Fase 3, Paso 9) — reexpresan estados YA
// existentes (SocialPostStatus + los 2 campos de Human Review), nunca una
// máquina de estados nueva. "published"/"error"/"verification_required" se
// devuelven tal cual (terminales/excepcionales, fuera de este pipeline de 5 pasos).
export type BridgeStatus = "READY_FOR_PUBLICATION" | "HUMAN_REVIEW" | "AUTHORIZED" | "SCHEDULED" | "READY_TO_PUBLISH" | SocialPostStatus;

export type PublicationBridgeEntry = {
  account: string; // canal — mismo valor que channelRegistry.mts folderName
  seriesId?: string;
  episodeId: string;
  derivativeId: string;
  contentFileId: string | null; // null hasta que Agent1/Supabase lo registre — nunca se inventa
  platform: SocialPlatform;
  scheduledAtUtc: string;
  status: BridgeStatus;
};

// Reexpresa el estado real (o de prueba) de una fila tipo social_posts en uno
// de los 5 estados lógicos — pura, sin leer Supabase. `scheduledAtUtc null`
// significa "todavía no se le asignó ventana" (equivalente a content_metadata
// en 'ready', antes de scheduleContent.mts).
export function resolvePublicationState(
  fields: AuthorizationFields & { status: SocialPostStatus; scheduledAtUtc: string | null },
  deps?: { now?: Date }
): BridgeStatus {
  if (fields.status === "published" || fields.status === "error" || fields.status === "verification_required") return fields.status;
  if (fields.status === "publishing") return "READY_TO_PUBLISH";
  // status === "pending" a partir de acá
  if (fields.scheduledAtUtc === null) return "READY_FOR_PUBLICATION";
  if (!isPublicationAuthorized(fields)) return "HUMAN_REVIEW";
  const now = deps?.now ?? new Date();
  return new Date(fields.scheduledAtUtc).getTime() <= now.getTime() ? "SCHEDULED" : "AUTHORIZED";
}

// Pura — deriva los candidatos (LONG + N clips) de un episodio COMPLETED.
// clipCount es explícito y opcional (default 0): sin evidencia real de cuántos
// clips existen para este episodio, no se inventan — el llamador (Agent2 real,
// que sí conoce el manifest) lo provee.
export function buildDerivativeCandidates(episodeId: string, clipCount = 0): { derivativeId: string; kind: DerivativeKind }[] {
  const candidates: { derivativeId: string; kind: DerivativeKind }[] = [{ derivativeId: derivativeId(episodeId, "LONG"), kind: "LONG" }];
  for (let i = 1; i <= clipCount; i++) {
    candidates.push({ derivativeId: derivativeId(episodeId, "CLIP", i), kind: "CLIP" });
  }
  return candidates;
}

export type BuildBridgeEntryDeps = {
  findSeries?: typeof findSeriesForEpisode;
  canProduce?: typeof canProduceEpisode;
  nextWindow?: typeof getNextPublicationWindow;
};

// Ensambla UN PublicationBridgeEntry para un job COMPLETED + un derivado +
// una plataforma. Respeta el gate de dependencia de serie (Fase 2): si el
// episodio todavía no puede producirse/publicarse según canProduceEpisode(),
// lanza en vez de fabricar una ventana — el llamador decide qué hacer (no
// se silencia el bloqueo).
export function buildBridgeEntry(
  job: Pick<Job, "account" | "episodeId" | "seriesId">,
  derivative: { derivativeId: string },
  platform: SocialPlatform,
  existingScheduledPosts: GetNextPublicationWindowParams["existingScheduledPosts"],
  deps?: BuildBridgeEntryDeps
): PublicationBridgeEntry {
  const canProduce = deps?.canProduce ?? canProduceEpisode;
  const gate: ProductionGate = canProduce(job.account, job.episodeId);
  if (!gate.canProduce) {
    throw new Error(`buildBridgeEntry: episodio "${job.account}/${job.episodeId}" no puede publicarse todavía — ${gate.reason}`);
  }

  const findSeries = deps?.findSeries ?? findSeriesForEpisode;
  const series = findSeries(job.account, job.episodeId);
  const nextWindow = deps?.nextWindow ?? getNextPublicationWindow;
  const window = nextWindow({
    channel: job.account,
    platform,
    derivativeId: derivative.derivativeId,
    seriesType: series?.seriesType,
    episodeOrder: series?.episodeOrder,
    existingScheduledPosts,
  });

  return {
    account: job.account,
    seriesId: job.seriesId,
    episodeId: job.episodeId,
    derivativeId: derivative.derivativeId,
    contentFileId: null, // se completa más adelante cuando Agent1/Supabase registre el archivo real
    platform,
    scheduledAtUtc: window.scheduledAtUtc,
    status: "READY_FOR_PUBLICATION",
  };
}

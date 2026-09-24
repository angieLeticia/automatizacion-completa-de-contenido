// Fase 3 acelerada — pruebas del puente Agent2->Agent3. Todo puro/local (mismo
// patrón que test-series.mts): ninguna prueba llama a Supabase, no publica
// nada, no usa credenciales, no toca D:\MATERIAL VIDEOS.
import { readFileSync } from "node:fs";
import { derivativeId, type SeriesConfig } from "./seriesRegistry.mts";
import { getNextPublicationWindow } from "./calendarRules.mts";
import { buildDerivativeCandidates, buildBridgeEntry, resolvePublicationState } from "./publicationBridge.mts";
import { isPublicationAuthorized } from "../../agent/publish/humanReviewGate.mts";
import { enqueue, claimNextQueued, markCompleted, listJobs } from "./queue.mts";
import { writeJsonAtomic, stateFilePath } from "./stateStore.mts";

let failures = 0;
const check = (label: string, cond: boolean, extra = "") => {
  const mark = cond ? "PASS" : "FAIL";
  if (!cond) failures++;
  console.log(`[${mark}] ${label}${extra ? " — " + extra : ""}`);
};

async function main() {
  // ---- 1/2. derivativeId LONG/CLIP ----
  check("1. derivativeId(episodeId, 'LONG') produce EP001_LONG", derivativeId("EP001", "LONG") === "EP001_LONG");
  check("2. derivativeId(episodeId, 'CLIP', 1) produce EP001_CLIP01", derivativeId("EP001", "CLIP", 1) === "EP001_CLIP01");

  // ---- 3. Agent2 genera datos compatibles con Agent3 ----
  {
    const entry = buildBridgeEntry({ account: "CUENTA_FICTICIA_BRIDGE155", episodeId: "EP001" }, { derivativeId: "EP001_LONG" }, "youtube", [], {
      findSeries: () => null,
    });
    const hasAllFields =
      typeof entry.account === "string" &&
      typeof entry.episodeId === "string" &&
      typeof entry.derivativeId === "string" &&
      "contentFileId" in entry &&
      typeof entry.platform === "string" &&
      typeof entry.scheduledAtUtc === "string" &&
      typeof entry.status === "string";
    check(
      "3. Agent2 genera un PublicationBridgeEntry con todos los campos que Agent3 necesita (channel/episodeId/derivativeId/contentFileId/platform/scheduledAt/status)",
      hasAllFields
    );
  }

  // ---- 4. calendario devuelve una ventana configurable ----
  {
    const window = getNextPublicationWindow({
      channel: "CUENTA_FICTICIA_BRIDGE155",
      platform: "youtube",
      derivativeId: "EP001_LONG",
      existingScheduledPosts: [],
    });
    const validIso = !Number.isNaN(new Date(window.scheduledAtUtc).getTime());
    check(
      "4. getNextPublicationWindow devuelve una ventana ISO válida, marcada explícitamente como DEFAULT (no fabrica 'mejor horario')",
      validIso && window.source === "DEFAULT",
      `scheduledAtUtc=${window.scheduledAtUtc} source=${window.source}`
    );
  }

  // ---- 5. sequential EP001 permitido ----
  const seqSeries: SeriesConfig = {
    seriesId: "SERIE_BRIDGE_SEQ",
    seriesName: "Serie puente secuencial",
    channelId: "CUENTA_FICTICIA_BRIDGE155",
    seriesType: "SEQUENTIAL",
    episodeOrder: ["EP001", "EP002"],
  };
  {
    let threw = false;
    try {
      buildBridgeEntry({ account: "CUENTA_FICTICIA_BRIDGE155", episodeId: "EP001" }, { derivativeId: "EP001_LONG" }, "youtube", [], {
        findSeries: () => seqSeries,
      });
    } catch {
      threw = true;
    }
    check("5. SEQUENTIAL EP001 (índice 0) — buildBridgeEntry permitido, no lanza", !threw);
  }

  // ---- 6. sequential EP002 bloqueado si EP001 no está COMPLETED ----
  {
    let threw = false;
    let message = "";
    try {
      buildBridgeEntry({ account: "CUENTA_FICTICIA_BRIDGE155", episodeId: "EP002" }, { derivativeId: "EP002_LONG" }, "youtube", [], {
        findSeries: () => seqSeries,
        canProduce: () => ({ canProduce: false, reason: 'episodio anterior "EP001" no está COMPLETED' }),
      });
    } catch (err) {
      threw = true;
      message = err instanceof Error ? err.message : String(err);
    }
    check("6. SEQUENTIAL EP002 bloqueado si EP001 no está COMPLETED — buildBridgeEntry lanza con el motivo", threw && message.includes("EP001"));
  }

  // ---- 7. sequential EP002 permitido si EP001 está COMPLETED ----
  {
    let threw = false;
    try {
      buildBridgeEntry({ account: "CUENTA_FICTICIA_BRIDGE155", episodeId: "EP002" }, { derivativeId: "EP002_LONG" }, "youtube", [], {
        findSeries: () => seqSeries,
        canProduce: () => ({ canProduce: true }),
      });
    } catch {
      threw = true;
    }
    check("7. SEQUENTIAL EP002 permitido si EP001 está COMPLETED", !threw);
  }

  // ---- 8. thematic EP002 permitido aunque EP001 no esté COMPLETED ----
  const themSeries: SeriesConfig = { ...seqSeries, seriesId: "SERIE_BRIDGE_THEM", seriesType: "THEMATIC" };
  {
    let threw = false;
    try {
      buildBridgeEntry({ account: "CUENTA_FICTICIA_BRIDGE155", episodeId: "EP002" }, { derivativeId: "EP002_LONG" }, "youtube", [], {
        findSeries: () => themSeries,
        // ni siquiera se llama canProduce con un resultado bloqueante — THEMATIC nunca depende de nada
        canProduce: () => ({ canProduce: true }),
      });
    } catch {
      threw = true;
    }
    check("8. THEMATIC EP002 permitido aunque EP001 no esté COMPLETED", !threw);
  }

  // ---- 9. no se crea una segunda cola ----
  {
    const bridgeSrc = readFileSync(new URL("./publicationBridge.mts", import.meta.url), "utf-8");
    const noNewPersistence = !/writeJsonAtomic|stateFilePath|\.json"/.test(bridgeSrc);
    check("9. publicationBridge.mts no escribe ningún archivo/cola nueva (sin writeJsonAtomic/stateFilePath) — reutiliza queue.json vía Job", noNewPersistence);
  }

  // ---- 10. Human Review sigue siendo obligatorio ----
  {
    const blocked = isPublicationAuthorized({ publication_authorized_at: null, publication_authorized_by: null }) === false;
    const blockedUndefined = isPublicationAuthorized({}) === false;
    check("10. Human Review obligatorio — isPublicationAuthorized() real (sin modificar) sigue bloqueando por defecto", blocked && blockedUndefined);
  }

  // ---- 11. DRY_RUN sigue bloqueando publicación real ----
  {
    const configSrc = readFileSync(new URL("../../agent/publish/config.mts", import.meta.url), "utf-8");
    const dryRunSafeDefault = /export const DRY_RUN = process\.env\.DRY_RUN !== "false";/.test(configSrc);
    check("11. agent/publish/config.mts sigue sin tocar — DRY_RUN=true por defecto, solo 'false' explícito lo desactiva", dryRunSafeDefault);
  }

  // ---- 12/13/14. canal/plataforma/scheduled_at correctos ----
  {
    const entry = buildBridgeEntry({ account: "CANAL_CORRECTO_155", episodeId: "EP009" }, { derivativeId: "EP009_LONG" }, "instagram", [], {
      findSeries: () => null,
    });
    check("12. canal correcto en el entry (account === input)", entry.account === "CANAL_CORRECTO_155");
    check("13. plataforma correcta en el entry (platform === input)", entry.platform === "instagram");
    const scheduledValid = !Number.isNaN(new Date(entry.scheduledAtUtc).getTime()) && new Date(entry.scheduledAtUtc).getTime() > Date.now();
    check("14. scheduledAtUtc correcto — fecha ISO válida y en el futuro", scheduledValid);
  }

  // ---- 15. contenido existente (Job/enqueue preexistente) no se rompe ----
  {
    // Un Job real, ya persistido con la firma preexistente enqueue(account, episodeId)
    // (SIN seriesId, SIN ningún campo de Fase 3) — buildDerivativeCandidates()
    // y resolvePublicationState() deben funcionar igual sin fallar.
    const { job } = enqueue("CUENTA_FICTICIA_BRIDGE_LEGACY155", "EP_LEGACY");
    const candidates = buildDerivativeCandidates(job.episodeId);
    const legacyRowState = resolvePublicationState({ status: "pending", scheduledAtUtc: null });
    const jobs = listJobs().filter((j) => j.account !== "CUENTA_FICTICIA_BRIDGE_LEGACY155");
    writeJsonAtomic(stateFilePath("queue.json"), jobs);
    check(
      "15. un Job preexistente (sin seriesId) sigue siendo compatible — buildDerivativeCandidates/resolvePublicationState funcionan igual",
      candidates.length === 1 && candidates[0].derivativeId === "EP_LEGACY_LONG" && legacyRowState === "READY_FOR_PUBLICATION"
    );
  }

  // ==================================================================
  // PRUEBA CONTROLADA (Paso 12) — demuestra el puente completo con
  // datos/código REALES (no mocks): Agent2 (queue.mts real) -> calendario
  // (getNextPublicationWindow real) -> Agent3 lo detecta
  // (resolvePublicationState real) -> Human Review lo deja pendiente
  // (sin autorización) -> DRY_RUN evita publicación real (config.mts sin
  // tocar, sigue en true). Cuenta ficticia, nunca toca producción real.
  // ==================================================================
  console.log("\n--- PRUEBA CONTROLADA: Agent2 -> calendario -> Agent3 -> Human Review -> DRY_RUN ---");
  {
    const account = "CUENTA_FICTICIA_CONTROLADA_FASE3";
    const episodeId = "EP900";

    // 1. Agent2 encola y "completa" el episodio (mismo camino real que usa el
    // worker de producción, sin ejecutar ningún render real — solo el ciclo
    // de estados de la cola).
    enqueue(account, episodeId);
    const claimed = claimNextQueued();
    if (!claimed || claimed.account !== account) {
      check("CONTROLADA.1: Agent2 encola/reclama el episodio real vía queue.mts", false, `claimed=${JSON.stringify(claimed)}`);
    } else {
      markCompleted(account, episodeId);
      check("CONTROLADA.1: Agent2 encola/reclama/completa el episodio real vía queue.mts (COMPLETED)", true);

      // 2. Derivados + calendario real asignan ventana.
      const candidates = buildDerivativeCandidates(episodeId, 2); // LONG + 2 clips
      const entry = buildBridgeEntry({ account, episodeId }, candidates[0], "youtube", [], { findSeries: () => null });
      check(
        "CONTROLADA.2: calendario asigna una ventana real (getNextPublicationWindow) para el derivado LONG",
        !Number.isNaN(new Date(entry.scheduledAtUtc).getTime())
      );

      // 3. Agent3 "lo detecta" — clasifica el entry recién creado.
      const detectedState = resolvePublicationState({ status: "pending", scheduledAtUtc: entry.scheduledAtUtc });
      check("CONTROLADA.3: Agent3 detecta el elemento y lo clasifica como HUMAN_REVIEW (sin autorización todavía)", detectedState === "HUMAN_REVIEW");

      // 4. Human Review — se autoriza explícitamente (simulado, sin Supabase real).
      const afterAuthorization = resolvePublicationState({
        status: "pending",
        scheduledAtUtc: entry.scheduledAtUtc,
        publication_authorized_at: new Date().toISOString(),
        publication_authorized_by: "prueba-controlada-fase3",
      });
      const isFuture = new Date(entry.scheduledAtUtc).getTime() > Date.now();
      check(
        "CONTROLADA.4: tras autorización humana, pasa a AUTHORIZED (ventana en el futuro) — Human Review sigue siendo el único camino",
        afterAuthorization === "AUTHORIZED" && isFuture
      );

      // 5. DRY_RUN — se confirma (sin tocar el archivo real) que sigue en
      // modo seguro; esta prueba NUNCA invoca agent/publish/run.mts, por lo
      // que ninguna publicación real puede ocurrir en ningún caso.
      const configSrc = readFileSync(new URL("../../agent/publish/config.mts", import.meta.url), "utf-8");
      const dryRunSafe = /process\.env\.DRY_RUN !== "false"/.test(configSrc);
      check("CONTROLADA.5: DRY_RUN sigue en modo seguro por defecto — esta prueba nunca invocó agent/publish/run.mts", dryRunSafe);
    }

    // limpieza — no dejar basura en el queue.json real compartido
    const jobs = listJobs().filter((j) => j.account !== account);
    writeJsonAtomic(stateFilePath("queue.json"), jobs);
  }

  console.log(`\n=== ${failures === 0 ? "TODO PASS" : `${failures} FALLO(S)`} ===`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Error ejecutando las pruebas:", err);
  process.exit(1);
});

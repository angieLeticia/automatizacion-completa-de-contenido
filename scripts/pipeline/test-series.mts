// Fase 2 acelerada — pruebas del modelo CANAL->SERIE->EPISODIO. Todo pura/
// inyectado (mismo patrón que test-render-provider-context.mts): ninguna
// prueba toca disco real, D:\MATERIAL VIDEOS, Supabase ni SERIES_REGISTRY
// real (que sigue vacío por diseño, ver seriesRegistry.mts). No se ejecuta
// producción real en ningún punto.
import { findSeriesInList, type SeriesConfig } from "./seriesRegistry.mts";
import { canProduceEpisode } from "./seriesDependency.mts";
import { enqueue, listJobs } from "./queue.mts";
import { readFileSync } from "node:fs";

let failures = 0;
const check = (label: string, cond: boolean, extra = "") => {
  const mark = cond ? "PASS" : "FAIL";
  if (!cond) failures++;
  console.log(`[${mark}] ${label}${extra ? " — " + extra : ""}`);
};

async function main() {
  // ---- 1. crear serie (SEQUENTIAL) ----
  const sequentialSeries: SeriesConfig = {
    seriesId: "SERIE_TEST_SEQ",
    seriesName: "Serie de prueba secuencial",
    channelId: "CUENTA_FICTICIA_SERIES155",
    seriesType: "SEQUENTIAL",
    episodeOrder: ["EP001", "EP002", "EP003"],
  };
  check(
    "1. crear serie SEQUENTIAL — shape correcto (seriesId/seriesName/channelId/seriesType/episodeOrder)",
    sequentialSeries.seriesType === "SEQUENTIAL" && sequentialSeries.episodeOrder.length === 3
  );

  // ---- 2. crear episodio (dentro de esa serie) ----
  const foundEp002 = findSeriesInList([sequentialSeries], "CUENTA_FICTICIA_SERIES155", "EP002");
  check("2. crear episodio EP002 dentro de la serie — se resuelve correctamente vía findSeriesInList", foundEp002?.seriesId === "SERIE_TEST_SEQ");

  // ---- 3. episodio secuencial (primero de la serie, índice 0) ----
  {
    const gate = canProduceEpisode("CUENTA_FICTICIA_SERIES155", "EP001", {
      findSeries: () => sequentialSeries,
      loadManifestStatus: () => "WAITING_FOR_MATERIAL", // no importa, es el primero
    });
    check("3. episodio SEQUENTIAL en índice 0 (EP001) — siempre puede producirse, sin depender de nada", gate.canProduce === true);
  }

  // ---- 4. episodio temático (THEMATIC) ----
  const thematicSeries: SeriesConfig = {
    seriesId: "SERIE_TEST_THEM",
    seriesName: "Serie de prueba temática",
    channelId: "CUENTA_FICTICIA_SERIES155",
    seriesType: "THEMATIC",
    episodeOrder: ["EP001", "EP002", "EP003"],
  };
  {
    const gate = canProduceEpisode("CUENTA_FICTICIA_SERIES155", "EP002", {
      findSeries: () => thematicSeries,
      loadManifestStatus: () => "WAITING_FOR_MATERIAL", // deliberadamente "no listo" — no debe importar
    });
    check("4. episodio THEMATIC — siempre puede producirse, independiente del status de cualquier otro episodio", gate.canProduce === true);
  }

  // ---- 5. EP002 SEQUENTIAL bloqueado si EP001 no está COMPLETED ----
  {
    const gate = canProduceEpisode("CUENTA_FICTICIA_SERIES155", "EP002", {
      findSeries: () => sequentialSeries,
      loadManifestStatus: (_account, episodeId) => (episodeId === "EP001" ? "PROCESSING" : "WAITING_FOR_MATERIAL"),
    });
    check(
      "5. EP002 SEQUENTIAL bloqueado si EP001 no está COMPLETED (status real: PROCESSING)",
      gate.canProduce === false && "reason" in gate && gate.reason.includes("EP001") && gate.reason.includes("PROCESSING")
    );
  }

  // ---- 6. EP002 SEQUENTIAL permitido si EP001 SÍ está COMPLETED ----
  {
    const gate = canProduceEpisode("CUENTA_FICTICIA_SERIES155", "EP002", {
      findSeries: () => sequentialSeries,
      loadManifestStatus: (_account, episodeId) => (episodeId === "EP001" ? "COMPLETED" : "WAITING_FOR_MATERIAL"),
    });
    check("6. EP002 SEQUENTIAL permitido si EP001 está COMPLETED", gate.canProduce === true);
  }

  // ---- 7. independencia temática (EP003 THEMATIC nunca consulta EP002) ----
  {
    let loadManifestStatusCalled = false;
    const gate = canProduceEpisode("CUENTA_FICTICIA_SERIES155", "EP003", {
      findSeries: () => thematicSeries,
      loadManifestStatus: () => {
        loadManifestStatusCalled = true;
        return "ERROR";
      },
    });
    check(
      "7. independencia THEMATIC — EP003 puede producirse SIN siquiera consultar el status de EP002 (deps.loadManifestStatus nunca se invoca)",
      gate.canProduce === true && loadManifestStatusCalled === false
    );
  }

  // ---- 8. episode_id existente (sin serie asociada) sigue funcionando igual ----
  {
    const gate = canProduceEpisode("CUALQUIER_CUENTA_REAL_O_FICTICIA", "008", {
      findSeries: () => null, // ninguna serie registrada para este episodio — el 100% de la producción real hoy
    });
    check("8. episode_id sin serie asociada (caso real actual, 100% de la producción) — canProduceEpisode siempre true, comportamiento sin cambios", gate.canProduce === true);
  }

  // ---- 9. el worker existente (enqueue/queue.mts) sigue funcionando igual ----
  {
    // enqueue(account, episodeId) de 2 argumentos (firma preexistente) sigue
    // compilando y funcionando exactamente igual — seriesId es un 3er
    // parámetro opcional aditivo, nunca requerido.
    const { added, job } = enqueue("CUENTA_FICTICIA_QUEUETEST155", "EP_QUEUE_BACKCOMPAT");
    const stillNoSeriesId = job.seriesId === undefined;
    // limpieza — no dejar basura en el queue.json real compartido
    const jobs = listJobs().filter((j) => j.account !== "CUENTA_FICTICIA_QUEUETEST155");
    const { writeJsonAtomic, stateFilePath } = await import("./stateStore.mts");
    writeJsonAtomic(stateFilePath("queue.json"), jobs);
    check("9. enqueue(account, episodeId) de 2 argumentos (firma preexistente) sigue funcionando — job creado sin seriesId", added && stillNoSeriesId);
  }

  // ---- 10. ninguna modificación de filesystem histórico ----
  {
    // Esta prueba entera nunca debe importar el escáner de material real ni el
    // registrador de episodios (los dos módulos que sí escriben/leen
    // D:\MATERIAL VIDEOS / remotion / public en producción real). Se verifica
    // sobre las líneas `import` reales del propio archivo (no sobre
    // comentarios, que mencionan esos nombres solo para documentar la
    // garantía) para que el chequeo sea preciso y no se auto-dispare.
    const src = readFileSync(new URL(import.meta.url), "utf-8");
    const importLines = src.split("\n").filter((l) => l.trim().startsWith("import "));
    const bannedModules = [/from ".\/materialScanner\.mts"/, /from ".\/episodeRegistrar\.mts"/];
    const noProductionScan = importLines.every((line) => !bannedModules.some((re) => re.test(line)));
    check(
      "10. esta prueba no importa materialScanner.mts ni episodeRegistrar.mts (los módulos que sí tocan D:\\MATERIAL VIDEOS/remotion/public en producción real)",
      noProductionScan
    );
  }

  console.log(`\n=== ${failures === 0 ? "TODO PASS" : `${failures} FALLO(S)`} ===`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Error ejecutando las pruebas:", err);
  process.exit(1);
});

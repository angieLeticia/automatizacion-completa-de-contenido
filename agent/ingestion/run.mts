// Punto de entrada MANUAL, de una sola pasada — NO es un watcher persistente,
// NO se registra como tarea programada en esta fase. Un humano lo invoca
// (`npm run agent:ingest`) cuando quiere que el Inbox se procese. No llama a
// Remotion, no llama a Supabase, no autoriza render, no publica nada.
import { INBOX_ROOT, STATE_DIR } from "./config.mts";
import { FsInboxContentProvider } from "./contentProvider.mts";

async function main(): Promise<void> {
  console.log(`[INGEST] Escaneando Inbox: ${INBOX_ROOT}`);
  const provider = new FsInboxContentProvider(INBOX_ROOT, STATE_DIR);
  const result = await provider.listReadyPackages();

  for (const pkg of result.packages) {
    console.log(
      `[INGEST] OK — ${pkg.channel}/${pkg.episodeId} materializado (${pkg.completeness.status}). ` +
        `submission_id=${pkg.manifest.submission_id}`
    );
  }
  for (const r of result.rejected) {
    console.warn(`[INGEST] RECHAZADO — ${r.folder}: [${r.result.status}] ${r.result.reason}`);
  }
  for (const s of result.skipped) {
    console.log(`[INGEST] omitido — ${s.folder}: ${s.reason}`);
  }

  console.log(
    `[INGEST] Fin. Procesados=${result.packages.length} Rechazados=${result.rejected.length} Omitidos=${result.skipped.length}`
  );
  console.log(
    `[INGEST] Recordatorio: esto solo coloca archivos en MATERIAL_ROOT. La autorización de render` +
      ` sigue siendo manual — correr "npm run pipeline:authorize" para cada episodio antes de que se procese.`
  );
}

main().catch((err) => {
  console.error("[INGEST] Fallo fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});

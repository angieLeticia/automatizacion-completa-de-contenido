// "Día 1.1" — pruebas del mutex de episodes.ts (episodesRegistryLock.mts) y
// de que registerEpisode() real, usado bajo ese mutex con llamadas
// concurrentes, nunca duplica chapterNumber ni pierde un registro. Mismo
// patrón ad-hoc sin framework ya usado en el resto de scripts/pipeline.
//
// SEGURIDAD: la parte de integración usa un archivo `episodesFile` FALSO en
// una carpeta temporal (nunca remotion/lib/episodes.ts real) — registerEpisode()
// ya acepta ese parámetro exactamente para poder probarse así.
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { withEpisodesRegistryLock } from "./episodesRegistryLock.mts";
import { registerEpisode } from "./episodeRegistrar.mts";

let failures = 0;
const check = (label: string, cond: boolean, extra = "") => {
  const mark = cond ? "PASS" : "FAIL";
  if (!cond) failures++;
  console.log(`[${mark}] ${label}${extra ? " — " + extra : ""}`);
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function testSerialization() {
  console.log("\n--- TEST 1/2: dos secciones críticas concurrentes se serializan (nunca se solapan) ---");
  const intervals: Array<{ id: string; start: number; end: number }> = [];

  const run = (id: string, delayMs: number) =>
    withEpisodesRegistryLock(async () => {
      const start = Date.now();
      await sleep(delayMs);
      const end = Date.now();
      intervals.push({ id, start, end });
    });

  await Promise.all([run("EP001", 120), run("EP002", 80)]);

  check("ambas secciones críticas se ejecutaron", intervals.length === 2);
  const [a, b] = intervals.sort((x, y) => x.start - y.start);
  check(
    "EP002 (encolado después) NUNCA empieza antes de que EP001 termine — sin solapamiento",
    a !== undefined && b !== undefined && b.start >= a.end,
    `a=[${a?.start}-${a?.end}] b=[${b?.start}-${b?.end}]`
  );
}

async function testNoLostWork() {
  console.log("\n--- TEST 3: ninguna sección crítica se pierde bajo carga concurrente ---");
  const completed: string[] = [];
  const N = 8;
  await Promise.all(
    Array.from({ length: N }, (_, i) =>
      withEpisodesRegistryLock(async () => {
        await sleep(5);
        completed.push(`EP${i}`);
      })
    )
  );
  check(`las ${N} secciones críticas se completaron (ninguna se perdió)`, completed.length === N, `completadas=${completed.length}`);
  check("todos los ids son distintos (sin duplicar ejecución)", new Set(completed).size === N);
}

async function testReleaseAfterSuccess() {
  console.log("\n--- TEST 5: el mutex se libera tras éxito (la siguiente corre sin demora extra) ---");
  await withEpisodesRegistryLock(async () => sleep(30));
  const startedAt = Date.now();
  await withEpisodesRegistryLock(async () => undefined);
  check("una llamada nueva tras un éxito previo corre casi inmediatamente (mutex libre)", Date.now() - startedAt < 100);
}

async function testReleaseAfterError() {
  console.log("\n--- TEST 6/7: una excepción NO deja el mutex bloqueado para siempre ---");
  let threw = false;
  try {
    await withEpisodesRegistryLock(async () => {
      throw new Error("fallo simulado dentro de la sección crítica");
    });
  } catch {
    threw = true;
  }
  check("la excepción SÍ se propaga a quien llamó (no se traga silenciosamente)", threw);

  const nextRan = await Promise.race([
    withEpisodesRegistryLock(async () => "ok"),
    sleep(500).then(() => "TIMEOUT — el mutex quedó bloqueado permanentemente"),
  ]);
  check("la SIGUIENTE llamada al mutex corre igual, sin quedar bloqueada por el fallo anterior", nextRan === "ok", String(nextRan));
}

async function testRealRegisterEpisodeNoDuplicateChapterNumbers() {
  console.log("\n--- Integración real: registerEpisode() concurrente bajo el mutex, sin chapterNumber duplicado ---");
  const dir = mkdtempSync(path.join(tmpdir(), "episodes-lock-test-"));
  const fakeEpisodesFile = path.join(dir, "episodes.ts");
  // Semilla mínima que respeta los anclas que episodeRegistrar.mts espera.
  writeFileSync(
    fakeEpisodesFile,
    `import rawClips000 from "../data/clips-000.json";\n\nexport const episodes: EpisodeConfig[] = [];\n`
  );

  // nextChapterNumber() real (processOne.mts) usa un import() dinámico contra
  // remotion/lib/episodes.ts real - acá se simula esa misma lógica
  // (max(chapterNumber)+1) pero LEYENDO el archivo falso por texto, para no
  // depender de import() (que cachea por specifier y no serviría contra un
  // archivo temporal). Es la misma sección crítica que processOne.mts protege
  // con el mutex: "calcular el próximo número" + "escribir el registro".
  const fakeNextChapterNumber = (): number => {
    const src = readFileSync(fakeEpisodesFile, "utf-8");
    const matches = [...src.matchAll(/chapterNumber: (\d+)/g)].map((m) => Number(m[1]));
    return matches.length === 0 ? 1 : Math.max(...matches) + 1;
  };

  const episodeIds = ["101", "102", "103", "104", "105"];
  const results = await Promise.all(
    episodeIds.map((episodeId) =>
      withEpisodesRegistryLock(async () => {
        await sleep(Math.random() * 20); // desfasa un poco las llegadas, a propósito
        const chapterNumber = fakeNextChapterNumber();
        const outcome = registerEpisode({
          episodeId,
          chapterNumber,
          narrationRelPath: `narracion-${episodeId}.mp3`,
          narrationDurationSeconds: 60,
          videoPool: [],
          imagePool: [],
          hasShots: false,
          episodesFile: fakeEpisodesFile,
        });
        return { episodeId, chapterNumber, outcome };
      })
    )
  );

  const finalSrc = readFileSync(fakeEpisodesFile, "utf-8");
  const chapterNumbers = results.map((r) => r.chapterNumber);
  check("los 5 episodios se registraron (ninguno 'updated' — todos eran nuevos)", results.every((r) => r.outcome === "inserted"));
  check("los 5 chapterNumber calculados son TODOS distintos (sin duplicados)", new Set(chapterNumbers).size === 5, JSON.stringify(chapterNumbers));
  for (const episodeId of episodeIds) {
    check(`episodes.ts final contiene el registro de ${episodeId} (ningún registro se perdió)`, finalSrc.includes(`id: "${episodeId}"`));
  }

  rmSync(dir, { recursive: true, force: true });
}

async function main() {
  await testSerialization();
  await testNoLostWork();
  await testReleaseAfterSuccess();
  await testReleaseAfterError();
  await testRealRegisterEpisodeNoDuplicateChapterNumbers();

  console.log(`\n=== ${failures === 0 ? "TODO PASS" : `${failures} FALLO(S)`} ===`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Error ejecutando las pruebas:", err);
  process.exit(1);
});

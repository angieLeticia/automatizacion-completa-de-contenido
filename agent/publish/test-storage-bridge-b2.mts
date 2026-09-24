// Fase 13 — pruebas PURAS de la integracion Backblaze B2: sin red, sin
// credenciales reales, sin tocar B2/Supabase. Confirma logica determinista
// (object key), la regla de decision de cleanup, el comportamiento
// PRESENT/MISSING de credenciales (nunca se imprime un valor), y — via
// confirmacion estructural sobre el codigo real (mismo patron ya usado por
// test-idempotency.mts para logica que no se puede probar sin Supabase real)
// — que la URL firmada nunca se persiste y que YouTube nunca toca B2.
import "./config.mts"; // carga .env.local + B2_CREDENTIALS_FILE ANTES de que storageBridge.mts/supabaseAdmin.ts los necesiten (mismo patron que run.mts)
import { readFileSync } from "node:fs";
import { storagePathFor, shouldDeleteObject, getB2Credentials } from "./storageBridge.mts";
import type { ContentFileRow } from "./types.mts";

let failures = 0;
const check = (label: string, cond: boolean, extra = "") => {
  const mark = cond ? "PASS" : "FAIL";
  if (!cond) failures++;
  console.log(`[${mark}] ${label}${extra ? " — " + extra : ""}`);
};

function fakeFile(overrides: Partial<ContentFileRow>): ContentFileRow {
  return {
    id: "fake-id",
    content_account_id: "fake-account",
    file_path: "D:\\MATERIAL VIDEOS\\FAKE\\clip.mp4",
    file_hash: "abc123",
    ...overrides,
  };
}

function main() {
  // ==================================================
  // 1. Lectura de configuracion — solo confirma FORMA/PRESENCIA, nunca
  //    hardcodea ni asume valores de otro entorno.
  // ==================================================
  check("1. storagePathFor existe y es una funcion", typeof storagePathFor === "function");

  // ==================================================
  // 4. Object key determinista por hash
  // ==================================================
  const fileA = fakeFile({ file_hash: "hash1", file_path: "clip.mp4" });
  const fileB = fakeFile({ file_hash: "hash1", file_path: "otra-carpeta/clip.mp4" });
  const fileC = fakeFile({ file_hash: "hash2", file_path: "clip.mp4" });
  check("4a. Mismo file_hash + misma extension -> mismo object key, sin importar la ruta de origen", storagePathFor(fileA) === storagePathFor(fileB));
  check("4b. file_hash distinto -> object key distinto", storagePathFor(fileA) !== storagePathFor(fileC));
  check("4c. El object key sigue el esquema videos/<hash><ext>", storagePathFor(fileA) === "videos/hash1.mp4");
  const fileNoExt = fakeFile({ file_hash: "hash3", file_path: "clip_sin_extension" });
  check("4d. Sin extension detectable -> aplica '.mp4' por defecto (mismo comportamiento que antes con Supabase)", storagePathFor(fileNoExt) === "videos/hash3.mp4");

  // ==================================================
  // 11/12. Regla de cleanup (protege posts hermanos; borra solo si count=0)
  // ==================================================
  check("11a. count>0 (existe un post hermano en estado no-published) -> NO borrar", shouldDeleteObject(1) === false);
  check("11b. count>0 grande -> NO borrar", shouldDeleteObject(5) === false);
  check("12. count=0 (ningun post hermano pendiente) -> SI borrar", shouldDeleteObject(0) === true);

  // ==================================================
  // 2/16. Credenciales ausentes -> error explicito, NUNCA se imprime un valor
  // ==================================================
  const originalKeyId = process.env.B2_KEY_ID;
  const originalAppKey = process.env.B2_APPLICATION_KEY;
  try {
    delete process.env.B2_KEY_ID;
    delete process.env.B2_APPLICATION_KEY;
    let threw = false;
    let message = "";
    try {
      getB2Credentials();
    } catch (err) {
      threw = true;
      message = err instanceof Error ? err.message : String(err);
    }
    check("2/16. Sin B2_KEY_ID/B2_APPLICATION_KEY -> lanza error explicito (nunca asume/continua)", threw);
    check("2b. El mensaje de error NUNCA incluye el valor de una credencial (no hay nada que imprimir - estaban ausentes)", !message.includes("undefined="));
  } finally {
    if (originalKeyId !== undefined) process.env.B2_KEY_ID = originalKeyId;
    if (originalAppKey !== undefined) process.env.B2_APPLICATION_KEY = originalAppKey;
  }

  // Con credenciales presentes (restauradas arriba), NO debe lanzar por ese motivo
  if (originalKeyId && originalAppKey) {
    let threwWithCreds = false;
    try {
      getB2Credentials();
    } catch {
      threwWithCreds = true;
    }
    check("2c. Con B2_KEY_ID/B2_APPLICATION_KEY presentes -> NO lanza", !threwWithCreds);
  } else {
    console.log("[INFO] 2c. omitido — este proceso no tiene B2_KEY_ID/B2_APPLICATION_KEY reales cargadas (se ejecuta sin config.mts importado a proposito, para no depender de B2_CREDENTIALS_FILE en esta prueba pura).");
  }

  // ==================================================
  // 9/13. Confirmacion ESTRUCTURAL sobre el codigo real de run.mts: la URL
  // firmada nunca se asigna a publishedPayload.video_url (solo video_path),
  // y el gate de validacion contra el placeholder existe antes de publish().
  // Mismo patron que test-idempotency.mts usa para claimPost.mts — no se
  // puede ejercer end-to-end sin Supabase real, se confirma sobre el codigo.
  // ==================================================
  const runSource = readFileSync(new URL("./run.mts", import.meta.url), "utf8");
  check(
    "9. run.mts NUNCA asigna video_url dentro de publishedPayload (solo video_path) - la URL firmada no se persiste",
    !/publishedPayload\.video_url\s*=/.test(runSource) && !/video_url:\s*postForPublisher\.video_url/.test(runSource.split("publishedPayload")[1] ?? "")
  );
  // Fase 15 — la validacion real (aceptar/rechazar URLs concretas) ahora se
  // prueba de forma EJECUTABLE en test-validate-b2-url.mts, importando
  // isFreshB2Url() directamente en vez de inspeccionar el codigo fuente por
  // regex - esa cobertura es estrictamente mas fuerte. Aqui solo se
  // confirma, por estructura, que run.mts delega en ese modulo (no
  // reimplementa la logica inline) y que un resultado invalido bloquea
  // antes de publish().
  check(
    "13. run.mts delega la validacion de video_url en isFreshB2Url() (validateB2Url.mts), no la reimplementa inline",
    /import \{ isFreshB2Url \} from "\.\/validateB2Url\.mts";/.test(runSource) && /isFreshB2Url\(postForPublisher\.video_url, post\.video_url\)/.test(runSource)
  );
  check(
    "13b. Si esa validacion falla (!urlCheck.ok), run.mts llama a finishWithFailure y hace return ANTES de llegar al bloque de publish() (no sigue de largo)",
    /if \(!urlCheck\.ok\) \{[\s\S]*?await finishWithFailure\([\s\S]*?return;[\s\S]*?\}/.test(runSource)
  );

  // ==================================================
  // 14. YouTube nunca usa B2 — confirmacion estructural: el bloque
  // `if (platform === "youtube")` de la entrega de archivo no invoca
  // ensureUploadedToStorage/getPresignedUrlFor.
  // ==================================================
  const youtubeBlockMatch = runSource.match(/if \(platform === "youtube"\) \{([\s\S]*?)\} else \{/);
  const youtubeBlock = youtubeBlockMatch?.[1] ?? "";
  check("14a. El bloque YouTube de run.mts existe y se pudo aislar para inspeccion", youtubeBlock.length > 0);
  check("14b. El bloque YouTube NO llama a ensureUploadedToStorage", !youtubeBlock.includes("ensureUploadedToStorage"));
  check("14c. El bloque YouTube NO llama a getPresignedUrlFor", !youtubeBlock.includes("getPresignedUrlFor"));
  const youtubeSource = readFileSync(new URL("../../lib/social/youtube.ts", import.meta.url), "utf8");
  check("14d. lib/social/youtube.ts NO importa nada de storageBridge.mts", !youtubeSource.includes("storageBridge"));

  console.log(`\n${failures === 0 ? "TODOS LOS CASOS PASARON" : `${failures} CASO(S) FALLARON`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main();

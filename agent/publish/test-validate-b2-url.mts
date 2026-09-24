// Fase 15 — pruebas deterministas de isFreshB2Url() (validateB2Url.mts).
// Cubre exactamente los casos A-G del encargo de Fase 15, mas la
// reproduccion explicita del Bug #1 encontrado en el preflight de Fase 14
// (FASE_14_FACEBOOK_PREFLIGHT), y una prueba REAL (sin publicar, sin tocar
// Supabase) contra getPresignedUrlFor() con el object key exacto del piloto.
import "./config.mts"; // carga .env.local + B2_CREDENTIALS_FILE antes de leer B2_BUCKET_NAME/B2_REGION
import { isFreshB2Url } from "./validateB2Url.mts";
import { B2_BUCKET_NAME, B2_REGION } from "./config.mts";
import { getPresignedUrlFor } from "./storageBridge.mts";

let failures = 0;
const check = (label: string, cond: boolean, extra = "") => {
  const mark = cond ? "PASS" : "FAIL";
  if (!cond) failures++;
  console.log(`[${mark}] ${label}${extra ? " — " + extra : ""}`);
};

const PLACEHOLDER = "placeholder://pending-upload/e9724e07-4243-401f-bb45-9f18a99efbdf.mp4";
const OLD_SUPABASE_PLACEHOLDER = "https://xbwbwzehnbofargskxyb.supabase.co/storage/v1/object/public/social-videos/pending-upload/e9724e07-4243-401f-bb45-9f18a99efbdf.mp4";

async function main() {
  // ==================================================
  // A. URL virtual-hosted B2 REAL -> ACCEPT
  // ==================================================
  const virtualHostedUrl = `https://${B2_BUCKET_NAME}.s3.${B2_REGION}.backblazeb2.com/videos/example.mp4?X-Amz-Signature=fake`;
  const resultA = isFreshB2Url(virtualHostedUrl, PLACEHOLDER);
  check("A. URL virtual-hosted B2 real (bucket como subdominio) -> ACCEPT", resultA.ok === true, resultA.reason);

  // ==================================================
  // B. URL path-style (antigua/alternativa) -> RECHAZADA, decision explicita
  //    (storageBridge.mts fuerza forcePathStyle=false, el codigo actual
  //    NUNCA genera este formato - ver comentario de diseño en
  //    validateB2Url.mts)
  // ==================================================
  const pathStyleUrl = `https://s3.${B2_REGION}.backblazeb2.com/${B2_BUCKET_NAME}/videos/example.mp4?X-Amz-Signature=fake`;
  const resultB = isFreshB2Url(pathStyleUrl, PLACEHOLDER);
  check("B. URL path-style -> REJECT (decision explicita: el codigo actual nunca genera este formato)", resultB.ok === false, resultB.reason);

  // ==================================================
  // C. URL de otro dominio -> REJECT
  // ==================================================
  const otherDomainUrl = "https://example.com/videos/example.mp4";
  const resultC = isFreshB2Url(otherDomainUrl, PLACEHOLDER);
  check("C. URL de otro dominio (example.com) -> REJECT", resultC.ok === false, resultC.reason);

  // ==================================================
  // D. Placeholder (esquema placeholder://) -> REJECT
  // ==================================================
  const resultD = isFreshB2Url(PLACEHOLDER, PLACEHOLDER);
  check("D. Placeholder placeholder://... -> REJECT", resultD.ok === false, resultD.reason);
  // Tambien debe rechazar el placeholder LEGADO de Supabase (filas creadas antes de Fase 13)
  const resultD2 = isFreshB2Url(OLD_SUPABASE_PLACEHOLDER, OLD_SUPABASE_PLACEHOLDER);
  check("D2. Placeholder legado de Supabase (filas de antes de Fase 13) -> tambien REJECT", resultD2.ok === false, resultD2.reason);

  // ==================================================
  // E. URL B2 de OTRO bucket -> REJECT
  // ==================================================
  const otherBucketUrl = `https://otro-bucket-distinto.s3.${B2_REGION}.backblazeb2.com/videos/example.mp4?X-Amz-Signature=fake`;
  const resultE = isFreshB2Url(otherBucketUrl, PLACEHOLDER);
  check("E. URL B2 valida pero de OTRO bucket -> REJECT", resultE.ok === false, resultE.reason);

  // ==================================================
  // F. HTTP en vez de HTTPS -> REJECT
  // ==================================================
  const httpUrl = `http://${B2_BUCKET_NAME}.s3.${B2_REGION}.backblazeb2.com/videos/example.mp4?X-Amz-Signature=fake`;
  const resultF = isFreshB2Url(httpUrl, PLACEHOLDER);
  check("F. Mismo hostname/bucket correctos pero HTTP en vez de HTTPS -> REJECT", resultF.ok === false, resultF.reason);

  // ==================================================
  // G. URL B2 valida pero IDENTICA al placeholder original -> REJECT
  //    (condicion de "fresh URL": debe ser distinta de lo que ya estaba
  //    persistido, aunque el formato en si sea valido)
  // ==================================================
  const sameAsPlaceholder = virtualHostedUrl; // reutiliza la URL valida de A
  const resultG = isFreshB2Url(sameAsPlaceholder, sameAsPlaceholder);
  check("G. URL B2 con formato valido pero IDENTICA al placeholder original -> REJECT (no es 'fresca')", resultG.ok === false, resultG.reason);

  // ==================================================
  // 12. REPRODUCCION EXACTA DEL BUG #1 DE FASE 14
  // ==================================================
  // La comparacion ORIGINAL (ya eliminada de run.mts) era:
  //   url.startsWith(B2_ENDPOINT)  donde B2_ENDPOINT = "https://s3.<region>.backblazeb2.com"
  // Contra una URL real (virtual-hosted, bucket como subdominio), esa
  // comparacion SIEMPRE daba false - se reproduce aqui literalmente para
  // dejar constancia del bug, y se demuestra que la NUEVA validacion (que
  // reemplazo esa linea en run.mts) SI la acepta.
  const B2_ENDPOINT_OLD = `https://s3.${B2_REGION}.backblazeb2.com`;
  const oldBuggyCheck = virtualHostedUrl.startsWith(B2_ENDPOINT_OLD);
  check("12a. Reproduccion del bug: la comparacion ANTIGUA (url.startsWith(B2_ENDPOINT)) da FALSE para una URL real -> confirma el bug existia", oldBuggyCheck === false);
  const newCheck = isFreshB2Url(virtualHostedUrl, PLACEHOLDER);
  check("12b. La NUEVA validacion (isFreshB2Url) SI acepta esa misma URL real -> confirma el bug esta corregido", newCheck.ok === true);

  // ==================================================
  // 13. PRUEBA REAL contra getPresignedUrlFor() con el object key EXACTO
  //     del piloto de Facebook (746feff7-105e-48fb-83db-5a7eb4d96612) - sin
  //     publicar, sin tocar Supabase, sin guardar la URL en ningun lado.
  // ==================================================
  const PILOT_OBJECT_KEY = "videos/b40d69a7cc90b0db5ccec2d83f3513170253d6079e75cda59d7c34981d3a7040.mp4";
  let realUrl: string | null = null;
  let realUrlError: string | null = null;
  try {
    realUrl = await getPresignedUrlFor(PILOT_OBJECT_KEY);
  } catch (err) {
    realUrlError = err instanceof Error ? err.message : String(err);
  }
  check("13a. getPresignedUrlFor() genera una URL real para el object key del piloto sin lanzar", realUrl !== null, realUrlError ?? "");
  if (realUrl) {
    const parsed = new URL(realUrl);
    check("13b. La URL real generada usa HTTPS", parsed.protocol === "https:");
    check("13c. El hostname de la URL real coincide con <bucket>.s3.<region>.backblazeb2.com (configuracion real)", parsed.hostname === `${B2_BUCKET_NAME}.s3.${B2_REGION}.backblazeb2.com`);
    const realCheck = isFreshB2Url(realUrl, OLD_SUPABASE_PLACEHOLDER);
    check("13d. La NUEVA validacion ACEPTA esta URL real generada para el piloto", realCheck.ok === true, realCheck.reason);
    console.log("[INFO] La URL real generada en esta prueba NO se imprime completa, NO se guarda en Supabase, y NO se envia a ningun publisher.");
  }

  console.log(`\n${failures === 0 ? "TODOS LOS CASOS PASARON" : `${failures} CASO(S) FALLARON`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main();

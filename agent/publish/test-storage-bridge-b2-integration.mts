// Fase 13 — pruebas de INTEGRACION REALES de storageBridge.mts contra el
// bucket EXPERIMENTAL (social-videos-experiment), usando las credenciales de
// produccion ya autorizadas para esta fase (via B2_CREDENTIALS_FILE). NUNCA
// toca Supabase (social_posts) ni ningun publisher — usa objetos
// ContentFileRow sinteticos, nunca datos reales de negocio. Limpia TODOS los
// objetos que crea al finalizar.
import "./config.mts";
import { writeFileSync, unlinkSync, createReadStream } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { ensureUploadedToStorage, getPresignedUrlFor, storagePathFor } from "./storageBridge.mts";
import { B2_BUCKET_NAME } from "./config.mts";
import { S3Client, DeleteObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { B2_ENDPOINT, B2_REGION } from "./config.mts";
import type { ContentFileRow } from "./types.mts";

let failures = 0;
const check = (label: string, cond: boolean, extra = "") => {
  const mark = cond ? "PASS" : "FAIL";
  if (!cond) failures++;
  console.log(`[${mark}] ${label}${extra ? " — " + extra : ""}`);
};

function sha256File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("data", (c) => hash.update(c));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

const s3 = new S3Client({
  region: B2_REGION,
  endpoint: B2_ENDPOINT,
  forcePathStyle: false,
  credentials: { accessKeyId: process.env.B2_KEY_ID!, secretAccessKey: process.env.B2_APPLICATION_KEY! },
});

async function objectExistsDirect(key: string): Promise<boolean> {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: B2_BUCKET_NAME, Key: key }));
    return true;
  } catch {
    return false;
  }
}

const createdKeys: string[] = [];

async function main() {
  console.log(`BUCKET_USED=${B2_BUCKET_NAME}`);
  check("0. B2_BUCKET_NAME apunta al bucket experimental, nunca uno distinto", B2_BUCKET_NAME === "social-videos-experiment");

  // ==================================================
  // 3. Bucket correcto + 5/6. HEAD/exists + upload
  // ==================================================
  const smallHash = `b2-integration-small-${Date.now()}`;
  const smallPath = "./_tmp-b2-test-small.bin";
  writeFileSync(smallPath, randomBytes(200 * 1024));
  const smallShaBefore = await sha256File(smallPath);
  const smallFile: ContentFileRow = { id: "test", content_account_id: "test", file_path: smallPath, file_hash: smallHash };
  const smallKey = storagePathFor(smallFile);
  createdKeys.push(smallKey);

  check("5a. El objeto NO existe todavia antes de subir", !(await objectExistsDirect(smallKey)));

  const upload1 = await ensureUploadedToStorage(smallFile);
  check("6. ensureUploadedToStorage sube el archivo (alreadyExisted=false la primera vez)", upload1.alreadyExisted === false);
  check("6b. El object key devuelto sigue el esquema determinista", upload1.videoPath === smallKey);
  check("5b. El objeto SI existe ahora (HEAD real)", await objectExistsDirect(smallKey));

  // ==================================================
  // 7. Idempotencia — no duplicar subida si ya existe
  // ==================================================
  const upload2 = await ensureUploadedToStorage(smallFile);
  check("7. Segunda llamada con el MISMO content_file -> alreadyExisted=true (no vuelve a subir)", upload2.alreadyExisted === true);
  check("7b. Mismo object key en ambas llamadas", upload2.videoPath === upload1.videoPath);

  // ==================================================
  // 9. Verificacion de hash del objeto subido (descarga directa via HEAD+GET simple)
  // ==================================================
  const getRes = await s3.send(new (await import("@aws-sdk/client-s3")).GetObjectCommand({ Bucket: B2_BUCKET_NAME, Key: smallKey }));
  const chunks: Buffer[] = [];
  for await (const chunk of getRes.Body as AsyncIterable<Buffer>) chunks.push(chunk as Buffer);
  const downloadedHash = createHash("sha256").update(Buffer.concat(chunks)).digest("hex");
  check("9. SHA-256 del objeto descargado coincide con el subido", downloadedHash === smallShaBefore);

  // ==================================================
  // 10. Presigned URL — generacion + acceso HTTPS externo real
  // ==================================================
  const url1 = await getPresignedUrlFor(smallKey);
  check("10a. getPresignedUrlFor devuelve una URL HTTPS", url1.startsWith("https://"));
  const fetchRes = await fetch(url1);
  check("10b. Acceso HTTPS externo real a la URL firmada -> HTTP 200", fetchRes.status === 200);
  const externalHash = createHash("sha256").update(Buffer.from(await fetchRes.arrayBuffer())).digest("hex");
  check("10c. El contenido descargado via la URL firmada tiene el hash correcto", externalHash === smallShaBefore);

  // ==================================================
  // 13. Retry genera URL nueva — dos llamadas consecutivas NO deben devolver
  // la misma URL (firma/expiracion distintas), aunque apunten al mismo objeto.
  // ==================================================
  const url2 = await getPresignedUrlFor(smallKey);
  check("13. Dos llamadas a getPresignedUrlFor para el mismo objeto devuelven URLs DISTINTAS (nunca se cachea/reutiliza)", url1 !== url2);
  const fetchRes2 = await fetch(url2);
  check("13b. La segunda URL tambien es valida y accesible (HTTP 200)", fetchRes2.status === 200);

  // ==================================================
  // 15. Errores de B2 manejados con gracia — objeto inexistente
  // ==================================================
  const nonExistentKey = `videos/no-existe-${Date.now()}.mp4`;
  check("15a. HeadObject sobre un key inexistente -> objectExistsDirect() devuelve false, no lanza sin control", !(await objectExistsDirect(nonExistentKey)));
  let presignedForMissingWorks = false;
  try {
    const missingUrl = await getPresignedUrlFor(nonExistentKey);
    presignedForMissingWorks = typeof missingUrl === "string";
  } catch {
    presignedForMissingWorks = false;
  }
  check("15b. getPresignedUrlFor NO lanza para un key inexistente (firmar no requiere que el objeto exista - el error real ocurriria al acceder)", presignedForMissingWorks);
  if (presignedForMissingWorks) {
    const missingUrl = await getPresignedUrlFor(nonExistentKey);
    const missingRes = await fetch(missingUrl);
    check("15c. Acceder a la URL firmada de un objeto inexistente devuelve un error HTTP claro (no 200)", !missingRes.ok);
  }

  // ==================================================
  // 8. Archivo grande (>50 MiB) — sintetico, para no depender de
  // D:\MATERIAL VIDEOS ni re-subir el clip real del piloto en cada corrida de
  // tests. Ya se probo el archivo real de 147MB exitosamente en el
  // experimento previo a esta fase (BACKBLAZE_B2_EXPERIMENT).
  // ==================================================
  const bigHash = `b2-integration-big-${Date.now()}`;
  const bigPath = "./_tmp-b2-test-big.bin";
  const bigSizeBytes = 60 * 1024 * 1024; // 60 MiB > 50 MiB (el limite que bloqueaba Supabase Storage Free)
  writeFileSync(bigPath, randomBytes(bigSizeBytes));
  const bigShaBefore = await sha256File(bigPath);
  const bigFile: ContentFileRow = { id: "test-big", content_account_id: "test", file_path: bigPath, file_hash: bigHash };
  const bigKey = storagePathFor(bigFile);
  createdKeys.push(bigKey);

  const bigUpload = await ensureUploadedToStorage(bigFile);
  check("8a. Archivo de 60MiB (>50MiB) sube correctamente sin el limite de Supabase Storage Free", bigUpload.alreadyExisted === false);
  const bigHead = await s3.send(new HeadObjectCommand({ Bucket: B2_BUCKET_NAME, Key: bigKey }));
  check("8b. Tamano remoto coincide exactamente con el tamano local", bigHead.ContentLength === bigSizeBytes);

  const bigGetRes = await s3.send(new (await import("@aws-sdk/client-s3")).GetObjectCommand({ Bucket: B2_BUCKET_NAME, Key: bigKey }));
  const bigChunks: Buffer[] = [];
  for await (const chunk of bigGetRes.Body as AsyncIterable<Buffer>) bigChunks.push(chunk as Buffer);
  const bigDownloadedHash = createHash("sha256").update(Buffer.concat(bigChunks)).digest("hex");
  check("8c. SHA-256 del archivo grande coincide antes/despues de subir y descargar", bigDownloadedHash === bigShaBefore);

  unlinkSync(smallPath);
  unlinkSync(bigPath);

  console.log(`\n${failures === 0 ? "TODOS LOS CASOS PASARON" : `${failures} CASO(S) FALLARON`}`);
}

async function cleanup() {
  console.log("\n--- LIMPIEZA: borrando todos los objetos creados por este test ---");
  for (const key of createdKeys) {
    try {
      await s3.send(new DeleteObjectCommand({ Bucket: B2_BUCKET_NAME, Key: key }));
      console.log(`  borrado: ${key}`);
    } catch (err) {
      console.log(`  ERROR borrando ${key}: ${err instanceof Error ? err.message : String(err)}`);
      failures++;
    }
  }
  const stillExist = await Promise.all(createdKeys.map((k) => objectExistsDirect(k)));
  check("LIMPIEZA. Ningun objeto de este test permanece en el bucket", stillExist.every((exists) => !exists));
}

main()
  .catch((err) => {
    console.log(`FATAL_ERROR=${err instanceof Error ? err.message : String(err)}`);
    failures++;
  })
  .finally(async () => {
    await cleanup();
    process.exit(failures === 0 ? 0 : 1);
  });

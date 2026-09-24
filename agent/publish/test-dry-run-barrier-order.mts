// Fase 5.10-AB — verifica por INSPECCION DE CODIGO estructural (mismo patron
// ya usado en test-success-path-cas.mts/test-storage-bridge-b2.mts) que la
// barrera DRY_RUN vive ANTES de cualquier operacion externa de
// almacenamiento (ensureUploadedToStorage/getPresignedUrlFor, exclusivas de
// Instagram/Facebook). Hallazgo de la Fase 5.10-Z: con el orden anterior,
// DRY_RUN=true todavia ejecutaba una subida real a Backblaze B2 antes de
// detenerse. run.mts no exporta processPost() (dispararia main() contra
// Supabase real al importarlo), asi que esta prueba nunca ejecuta el archivo
// - solo lee su texto fuente.
import { readFileSync } from "node:fs";

let failures = 0;
const check = (label: string, cond: boolean, extra = "") => {
  const mark = cond ? "PASS" : "FAIL";
  if (!cond) failures++;
  console.log(`[${mark}] ${label}${extra ? " — " + extra : ""}`);
};

const source = readFileSync(new URL("./run.mts", import.meta.url), "utf8");

const dryRunBarrierIdx = source.indexOf("if (DRY_RUN || !identityOutcome.authorizedForRealPublication || !humanAuthorized)");
const ensureUploadIdx = source.indexOf("await ensureUploadedToStorage(fileOutcome.contentFile)");
const presignedUrlIdx = source.indexOf("await getPresignedUrlFor(uploadResult.videoPath)");
const isFreshB2UrlIdx = source.indexOf("isFreshB2Url(postForPublisher.video_url, post.video_url)");
const publisherLookupIdx = source.indexOf('const publish = PUBLISHERS[platform as Exclude<typeof platform, "tiktok">];');
const humanAuthorizedIdx = source.indexOf("const humanAuthorized = isPublicationAuthorized(post);");
const resolveIdentityIdx = source.indexOf("resolveAndValidateIdentity(post.account_id, fileOutcome.contentFile.content_account_id)");

check("1. La barrera DRY_RUN existe y fue localizada", dryRunBarrierIdx !== -1);
check("2. ensureUploadedToStorage() existe y fue localizado", ensureUploadIdx !== -1);
check("3. getPresignedUrlFor() existe y fue localizado", presignedUrlIdx !== -1);
check("4. isFreshB2Url() existe y fue localizado", isFreshB2UrlIdx !== -1);
check("5. La barrera DRY_RUN aparece ANTES de ensureUploadedToStorage()", dryRunBarrierIdx !== -1 && ensureUploadIdx !== -1 && dryRunBarrierIdx < ensureUploadIdx);
check("6. La barrera DRY_RUN aparece ANTES de getPresignedUrlFor()", dryRunBarrierIdx !== -1 && presignedUrlIdx !== -1 && dryRunBarrierIdx < presignedUrlIdx);
check("7. La barrera DRY_RUN aparece ANTES de isFreshB2Url()", dryRunBarrierIdx !== -1 && isFreshB2UrlIdx !== -1 && dryRunBarrierIdx < isFreshB2UrlIdx);
check(
  "8. resolveAndValidateIdentity() (identidad) sigue ANTES de la barrera DRY_RUN (orden no se invirtio de mas)",
  resolveIdentityIdx !== -1 && dryRunBarrierIdx !== -1 && resolveIdentityIdx < dryRunBarrierIdx
);
check(
  "9. humanAuthorized se calcula ANTES de la barrera DRY_RUN (la barrera lo consume)",
  humanAuthorizedIdx !== -1 && dryRunBarrierIdx !== -1 && humanAuthorizedIdx < dryRunBarrierIdx
);
check(
  "10. El lookup de PUBLISHERS[platform] sigue DESPUES de la barrera DRY_RUN (nunca se resuelve un publisher real en dry-run)",
  publisherLookupIdx !== -1 && dryRunBarrierIdx !== -1 && dryRunBarrierIdx < publisherLookupIdx
);
check(
  "11. El bloque DRY_RUN ya NO referencia 'deliveryLog' (variable eliminada - no existiria aun en este punto tras el reordenamiento)",
  !/\.\.\.deliveryLog/.test(source) && !/let deliveryLog/.test(source)
);
check("12. revertToPending(post.id) sigue presente dentro del bloque DRY_RUN", /await revertToPending\(post\.id\);/.test(source));

console.log(failures === 0 ? "\nTODOS LOS CASOS PASARON" : `\n${failures} CASO(S) FALLARON`);
if (failures > 0) process.exit(1);

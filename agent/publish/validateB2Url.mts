// Fase 15 — corrige el Bug #1 encontrado en el preflight de Fase 14: el SDK
// S3 (forcePathStyle=false, ver storageBridge.mts) genera las presigned URLs
// reales en formato VIRTUAL-HOSTED:
//
//   https://<bucket>.s3.<region>.backblazeb2.com/<object-key>?<firma>
//
// El bucket va como SUBDOMINIO, nunca como prefijo literal de B2_ENDPOINT
// ("https://s3.<region>.backblazeb2.com"). La validacion original en
// run.mts (`url.startsWith(B2_ENDPOINT)`) comparaba un prefijo que la URL
// real JAMAS tiene - confirmado en vivo en el preflight de Fase 14 con una
// llamada real a getPresignedUrlFor() sobre el object key del piloto de
// Facebook: la comparacion daba `false` para una URL perfectamente valida,
// bloqueando SIEMPRE cualquier publicacion real (fail-closed, pero
// completamente inoperante).
//
// Este modulo construye el hostname ESPERADO a partir de la configuracion
// REAL del proyecto (B2_BUCKET_NAME/B2_REGION, agent/publish/config.mts) -
// nunca hardcodea "social-videos-experiment" ni "us-east-005" - y compara
// contra el hostname REAL de la URL via `new URL()` (parseo real, no un
// `includes()`/`startsWith()` sobre el string completo, que seria vulnerable
// a que el hostname esperado apareciera en otra parte de la URL, ej. la
// query string de la firma).
//
// DECISION DE DISEÑO explicita (punto 7/11B del encargo de esta fase): el
// formato path-style (`https://s3.<region>.backblazeb2.com/<bucket>/...`)
// se RECHAZA a proposito. storageBridge.mts fija `forcePathStyle: false` de
// forma fija en el codigo (no es una opcion configurable via env) - el
// codigo actual NUNCA genera ese formato, asi que aceptarlo no traeria
// ningun beneficio real y solo ampliaria la superficie de lo que esta
// validacion considera "valido" sin necesidad. Si en el futuro
// `forcePathStyle` cambiara a `true`, esta validacion DEBE actualizarse en
// el mismo cambio - quedan deliberadamente acoplados.
import { B2_BUCKET_NAME, B2_REGION } from "./config.mts";

export interface B2UrlValidationResult {
  ok: boolean;
  reason: string;
}

// Pura - sin red, sin efectos secundarios. `originalPlaceholderUrl` es
// `post.video_url` (el valor YA persistido en la fila ANTES de este
// intento) - una URL fresca nunca debe coincidir con el placeholder que ya
// estaba ahi, sea cual sea su formato exacto (Supabase legado o
// `placeholder://` nuevo, ver scheduleContent.mts).
export function isFreshB2Url(url: unknown, originalPlaceholderUrl: string): B2UrlValidationResult {
  if (typeof url !== "string" || url.length === 0) {
    return { ok: false, reason: "video_url ausente o no es un string." };
  }
  if (url === originalPlaceholderUrl) {
    return {
      ok: false,
      reason: "video_url coincide exactamente con el placeholder original persistido en el post - no se genero una URL fresca en este intento.",
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: "video_url no es una URL valida (fallo al parsear con new URL())." };
  }

  if (parsed.protocol !== "https:") {
    return { ok: false, reason: `video_url no usa HTTPS (protocolo real: '${parsed.protocol}').` };
  }

  if (!B2_BUCKET_NAME) {
    return { ok: false, reason: "B2_BUCKET_NAME no esta configurado - no se puede calcular el hostname B2 esperado." };
  }

  // Formato REAL que genera hoy getPresignedUrlFor() (storageBridge.mts,
  // forcePathStyle=false): virtual-hosted, bucket como subdominio.
  const expectedHostname = `${B2_BUCKET_NAME}.s3.${B2_REGION}.backblazeb2.com`;
  if (parsed.hostname !== expectedHostname) {
    return {
      ok: false,
      reason:
        `El hostname de video_url ('${parsed.hostname}') no coincide con el endpoint B2 esperado para el bucket configurado ('${expectedHostname}'). ` +
        `El formato path-style no se acepta a proposito (ver comentario del modulo) - solo se acepta el formato virtual-hosted que storageBridge.mts genera realmente hoy.`,
    };
  }

  return { ok: true, reason: "video_url es una URL B2 fresca y valida para el bucket/region configurados (formato virtual-hosted, HTTPS, distinta del placeholder)." };
}

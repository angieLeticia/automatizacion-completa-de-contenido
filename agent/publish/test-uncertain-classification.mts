// H2 (auditoria post-publicacion) — prueba real de la nueva clasificacion:
// (a) Instagram: timeout de polling (contenedor ya creado, resultado no
//     determinable) -> PublicationOutcomeUncertainError (antes: Error
//     generico, clasificable como retryable).
// (b) YouTube: HTTP no-OK en el PUT de finalizacion del resumable upload ->
//     PublicationOutcomeUncertainError, EXCEPTO 401/403 (credencial
//     invalida), que se mantienen como fallo permanente normal, sin cambios.
// Mismo patron de fetch-stubbing que test-uncertain-outcome.mts (Fase 5.4.1) -
// sin red real, sin credenciales reales, sin Supabase.
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PublicationOutcomeUncertainError } from "../../lib/social/types.ts";
import type { SocialPost } from "../../lib/social/types.ts";
import { publishToYouTube } from "../../lib/social/youtube.ts";
import { classifyError } from "./retryPolicy.mts";

// IMPORTANTE: INSTAGRAM_POLL_TIMEOUT_MS/INTERVAL_MS se leen UNA SOLA VEZ,
// como `const` de modulo, en el momento en que lib/social/instagram.ts se
// importa (ver ese archivo) - no en cada llamada. Por eso estas variables
// deben fijarse ANTES del `import`, y el import de publishToInstagram debe
// ser DINAMICO (nunca un `import` estatico de nivel superior, que se
// resolveria antes de que main() llegue a fijar las variables).
process.env.INSTAGRAM_POLL_TIMEOUT_MS = "50";
process.env.INSTAGRAM_POLL_INTERVAL_MS = "10";
const { publishToInstagram } = await import("../../lib/social/instagram.ts");

let failures = 0;
const check = (label: string, cond: boolean, extra = "") => {
  const mark = cond ? "PASS" : "FAIL";
  if (!cond) failures++;
  console.log(`[${mark}] ${label}${extra ? " — " + extra : ""}`);
};

type FetchHandler = (url: string, init?: RequestInit) => Promise<Response> | Response;

async function withStubbedFetch<T>(handler: FetchHandler, fn: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => handler(String(url), init)) as typeof fetch;
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
  }
}

const basePost: SocialPost = {
  id: "test-post-id",
  account_id: "test-account-id",
  video_url: "https://example.com/video.mp4",
  video_path: "videos/test.mp4",
  title: "Título de prueba",
  caption: "Caption de prueba",
  scheduled_at: new Date().toISOString(),
  status: "publishing",
  external_post_id: null,
  error_message: null,
  created_at: new Date().toISOString(),
  published_at: null,
};

async function main() {
  // ==================================================
  // TEST 1 (H2 test requerido #1) — fallo ANTES de operacion externa (Meta
  // rechaza la CREACION del contenedor de Instagram) -> Error normal,
  // clasificable via retryPolicy.mts, NUNCA incierto. Sin cambios respecto
  // al comportamiento anterior - control de que el fix no sobre-aplica.
  // ==================================================
  await withStubbedFetch(
    () => new Response("bad request", { status: 400 }),
    async () => {
      try {
        await publishToInstagram(basePost, { ig_user_id: "1", access_token: "x" });
        check("1. Instagram: fallo al CREAR el container debia lanzar", false);
      } catch (err) {
        check("1. Instagram: fallo ANTES de operacion externa (crear container) -> Error normal, NUNCA incierto", !(err instanceof PublicationOutcomeUncertainError));
        if (err instanceof Error) check("1b. clasificable como 'permanent' via retryPolicy (HTTP 400)", classifyError(err.message) === "permanent");
      }
    }
  );

  // ==================================================
  // TEST 2 (H2 test requerido #2) — timeout de polling CON contenedor ya
  // creado -> PublicationOutcomeUncertainError con el creationId real
  // preservado. INSTAGRAM_POLL_TIMEOUT_MS/INTERVAL_MS ya se fijaron ANTES
  // del import de instagram.ts, arriba del archivo (ver esa nota) - aqui no
  // hace falta tocarlos de nuevo.
  // ==================================================
  const REAL_CREATION_ID = "17895695668004550";
  await withStubbedFetch(
    (url) => {
      if (url.includes("status_code")) return new Response(JSON.stringify({ status_code: "IN_PROGRESS" }), { status: 200 }); // nunca termina
      if (url.includes("/media")) return new Response(JSON.stringify({ id: REAL_CREATION_ID }), { status: 200 });
      throw new Error(`fetch inesperado: ${url}`);
    },
    async () => {
      try {
        await publishToInstagram(basePost, { ig_user_id: "1", access_token: "x" });
        check("2. Instagram: timeout de polling debia lanzar", false);
      } catch (err) {
        check("2. Instagram: timeout de polling (contenedor ya creado) -> PublicationOutcomeUncertainError", err instanceof PublicationOutcomeUncertainError);
        if (err instanceof PublicationOutcomeUncertainError) {
          check("2b. creationId real preservado en operationRef", err.operationRef === REAL_CREATION_ID);
          check("2c. platform correcto", err.platform === "instagram");
        }
      }
    }
  );
  // ==================================================
  // TEST 3 (H2 test requerido #3) — error de red SIN respuesta DESPUES de
  // que el contenedor ya existe (fallo en media_publish, fetch lanza) -> ya
  // era PublicationOutcomeUncertainError ANTES de esta fase (Fase 5.4.1) -
  // se re-confirma aqui como parte de la cobertura explicita de H2.
  // ==================================================
  await withStubbedFetch(
    (url) => {
      if (url.includes("status_code")) return new Response(JSON.stringify({ status_code: "FINISHED" }), { status: 200 });
      if (url.includes("media_publish")) throw new Error("simulated: network failure durante media_publish");
      if (url.includes("/media")) return new Response(JSON.stringify({ id: REAL_CREATION_ID }), { status: 200 });
      throw new Error(`fetch inesperado: ${url}`);
    },
    async () => {
      try {
        await publishToInstagram(basePost, { ig_user_id: "1", access_token: "x" });
        check("3. Instagram: fallo de red en media_publish debia lanzar", false);
      } catch (err) {
        check("3. Instagram: fallo de red SIN respuesta tras crear el contenedor -> PublicationOutcomeUncertainError (ya existente, re-confirmado)", err instanceof PublicationOutcomeUncertainError);
      }
    }
  );

  // ==================================================
  // TEST 4 (H2 test requerido #4) — error HTTP permanente conocido (401/403)
  // en la FINALIZACION de YouTube -> se mantiene como Error normal/permanente,
  // NUNCA incierto (semantica preservada explicitamente).
  // ==================================================
  const youtubeCreds = { client_id: "x", client_secret: "y", refresh_token: "z" };
  for (const authStatus of [401, 403]) {
    const tempPath = path.join(tmpdir(), `h2-test-yt-auth-${authStatus}.mp4`);
    writeFileSync(tempPath, "bytes-de-prueba");
    await withStubbedFetch(
      (url) => {
        if (url.includes("oauth2.googleapis.com")) return new Response(JSON.stringify({ access_token: "fake-token" }), { status: 200 });
        if (url.includes("upload/youtube/v3/videos") && !url.startsWith("https://upload.example.com")) return new Response(null, { status: 200, headers: { Location: "https://upload.example.com/resumable-session/auth-test" } });
        if (url === "https://upload.example.com/resumable-session/auth-test") return new Response("unauthorized", { status: authStatus });
        throw new Error(`fetch inesperado: ${url}`);
      },
      async () => {
        try {
          await publishToYouTube({ ...basePost, local_file_path: tempPath }, youtubeCreds);
          check(`4. YouTube: finalizacion HTTP ${authStatus} debia lanzar`, false);
        } catch (err) {
          check(`4. YouTube: finalizacion HTTP ${authStatus} (credencial invalida) -> Error normal, NUNCA incierto (semantica preservada)`, !(err instanceof PublicationOutcomeUncertainError) && err instanceof Error);
          if (err instanceof Error) check(`4b. clasificable como 'permanent' via retryPolicy (HTTP ${authStatus})`, classifyError(err.message) === "permanent");
        } finally {
          unlinkSync(tempPath);
        }
      }
    );
  }

  // ==================================================
  // TEST 5 (H2 test requerido #5) — YouTube: finalizacion AMBIGUA (HTTP 500,
  // no 401/403) -> PublicationOutcomeUncertainError (antes: Error generico,
  // clasificable como retryable via retryPolicy -> riesgo real de duplicado,
  // ver auditoria H2-B).
  // ==================================================
  const tempPath5 = path.join(tmpdir(), "h2-test-yt-ambiguous.mp4");
  writeFileSync(tempPath5, "bytes-de-prueba");
  await withStubbedFetch(
    (url) => {
      if (url.includes("oauth2.googleapis.com")) return new Response(JSON.stringify({ access_token: "fake-token" }), { status: 200 });
      if (url.includes("upload/youtube/v3/videos") && !url.startsWith("https://upload.example.com")) return new Response(null, { status: 200, headers: { Location: "https://upload.example.com/resumable-session/ambiguous-test" } });
      if (url === "https://upload.example.com/resumable-session/ambiguous-test") return new Response("internal server error", { status: 500 });
      throw new Error(`fetch inesperado: ${url}`);
    },
    async () => {
      try {
        await publishToYouTube({ ...basePost, local_file_path: tempPath5 }, youtubeCreds);
        check("5. YouTube: finalizacion HTTP 500 debia lanzar", false);
      } catch (err) {
        check("5. YouTube: finalizacion ambigua (HTTP 500, no 401/403) -> PublicationOutcomeUncertainError", err instanceof PublicationOutcomeUncertainError);
        if (err instanceof PublicationOutcomeUncertainError) {
          check("5b. operationRef = uploadUrl real (para reconciliar)", err.operationRef === "https://upload.example.com/resumable-session/ambiguous-test");
          check("5c. httpStatus preservado", err.httpStatus === 500);
        }
      } finally {
        unlinkSync(tempPath5);
      }
    }
  );

  // ==================================================
  // TEST 6 (control) — fallo ANTES de operacion externa en YouTube (init
  // POST rechazado) -> sigue siendo Error normal, NUNCA incierto. Confirma
  // que el fix no se extendio de mas al paso de INICIO.
  // ==================================================
  await withStubbedFetch(
    (url) => {
      if (url.includes("oauth2.googleapis.com")) return new Response(JSON.stringify({ access_token: "fake-token" }), { status: 200 });
      if (url.includes("upload/youtube/v3/videos")) return new Response("forbidden", { status: 403 });
      throw new Error(`fetch inesperado: ${url}`);
    },
    async () => {
      const tempPath6 = path.join(tmpdir(), "h2-test-yt-init-fail.mp4");
      writeFileSync(tempPath6, "bytes");
      try {
        await publishToYouTube({ ...basePost, local_file_path: tempPath6 }, youtubeCreds);
        check("6. YouTube: fallo en INICIO (antes de operacion externa) debia lanzar", false);
      } catch (err) {
        check("6. YouTube: fallo en el INICIO de la sesion (antes de que exista uploadUrl) -> Error normal, NUNCA incierto", !(err instanceof PublicationOutcomeUncertainError));
      } finally {
        unlinkSync(tempPath6);
      }
    }
  );

  console.log(`\n${failures === 0 ? "TODOS LOS CASOS PASARON" : `${failures} CASO(S) FALLARON`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main();

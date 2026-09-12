// Fase 5.20 (cierre de RIESGO 2 del preflight de prueba controlada) — tests
// de publishToYouTube() con fetch stubbeado, mismo patrón que
// agent/publish/test-youtube-identity.mts/test-uncertain-outcome.mts: sin
// red real, sin credenciales reales, sin archivos locales (se usa
// post.video_url, nunca local_file_path, para no depender del disco).
import assert from "node:assert/strict";
import { publishToYouTube } from "./youtube.ts";
import { PublicationOutcomeUncertainError } from "./types.ts";
import type { SocialPost } from "./types.ts";

let passed = 0;
function test(name: string, fn: () => Promise<void> | void) {
  return (async () => {
    try {
      await fn();
      passed++;
      console.log(`[PASS] ${name}`);
    } catch (err) {
      console.error(`[FALLO] ${name}`);
      console.error(err);
      process.exitCode = 1;
    }
  })();
}

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

const CREDS = { client_id: "cid", client_secret: "csecret", refresh_token: "rtoken" };
const UPLOAD_URL = "https://upload.example.com/session/abc123";

function makePost(overrides: Partial<SocialPost> = {}): SocialPost {
  return {
    id: "post-1",
    account_id: "account-1",
    video_url: "https://videos.example.com/clip.mp4",
    video_path: "videos/clip.mp4",
    title: "Titulo de prueba",
    caption: "Descripcion de prueba",
    scheduled_at: new Date().toISOString(),
    status: "publishing",
    external_post_id: null,
    error_message: null,
    created_at: new Date().toISOString(),
    published_at: null,
    ...overrides,
  };
}

// Fake ReadableStream minimo - suficiente para pasar por resolveVideoSource()
// y llegar al PUT stubbeado, que nunca inspecciona el body real.
function fakeVideoBody(): ReadableStream {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3]));
      controller.close();
    },
  });
}

function tokenResponse(): Response {
  return new Response(JSON.stringify({ access_token: "fake-access-token" }), { status: 200 });
}

function videoDownloadResponse(): Response {
  return new Response(fakeVideoBody(), { status: 200, headers: { "content-length": "3" } });
}

function initUploadResponse(): Response {
  return new Response(null, { status: 200, headers: { location: UPLOAD_URL } });
}

async function main() {
  await test("1. Fallo de red durante el PUT (fetch lanza, sin respuesta HTTP) -> PublicationOutcomeUncertainError, NO un error retryable normal", async () => {
    let operationRefReceived: string | undefined;
    let callCount = 0;
    await withStubbedFetch(
      (url) => {
        callCount++;
        if (url.includes("oauth2.googleapis.com/token")) return tokenResponse();
        if (url.includes("videos.example.com")) return videoDownloadResponse();
        if (url.includes("upload/youtube/v3/videos")) return initUploadResponse();
        if (url === UPLOAD_URL) throw new Error("ECONNRESET - conexión cerrada por el peer");
        throw new Error(`fetch inesperado a ${url}`);
      },
      async () => {
        await assert.rejects(
          () => publishToYouTube(makePost(), CREDS, (ref) => { operationRefReceived = ref; }),
          (err: unknown) => {
            assert.ok(err instanceof PublicationOutcomeUncertainError, `se esperaba PublicationOutcomeUncertainError, se obtuvo ${err}`);
            assert.equal((err as PublicationOutcomeUncertainError).platform, "youtube");
            assert.equal((err as PublicationOutcomeUncertainError).operationRef, UPLOAD_URL);
            return true;
          }
        );
      }
    );
    // El operation ref debe haberse persistido ANTES del fallo de red - es
    // justamente lo que hace posible la reconciliación futura.
    assert.equal(operationRefReceived, UPLOAD_URL);
    assert.equal(callCount, 4, "se esperaban exactamente 4 llamadas a fetch (token, descarga, init, PUT) - NUNCA una segunda sesión de subida dentro de esta misma llamada");
  });

  await test("2. Regresión — subida exitosa con cuerpo interpretable sigue devolviendo externalPostId normalmente", async () => {
    await withStubbedFetch(
      (url) => {
        if (url.includes("oauth2.googleapis.com/token")) return tokenResponse();
        if (url.includes("videos.example.com")) return videoDownloadResponse();
        if (url.includes("upload/youtube/v3/videos")) return initUploadResponse();
        if (url === UPLOAD_URL) return new Response(JSON.stringify({ id: "yt-video-xyz" }), { status: 200 });
        throw new Error(`fetch inesperado a ${url}`);
      },
      async () => {
        const result = await publishToYouTube(makePost(), CREDS);
        assert.equal(result.externalPostId, "yt-video-xyz");
      }
    );
  });

  await test("3. Regresión — HTTP de error SÍ recibido en el PUT (YouTube respondió, rechazando) sigue siendo un Error normal, NO uncertain", async () => {
    await withStubbedFetch(
      (url) => {
        if (url.includes("oauth2.googleapis.com/token")) return tokenResponse();
        if (url.includes("videos.example.com")) return videoDownloadResponse();
        if (url.includes("upload/youtube/v3/videos")) return initUploadResponse();
        if (url === UPLOAD_URL) return new Response("forbidden", { status: 403 });
        throw new Error(`fetch inesperado a ${url}`);
      },
      async () => {
        await assert.rejects(
          () => publishToYouTube(makePost(), CREDS),
          (err: unknown) => {
            assert.ok(!(err instanceof PublicationOutcomeUncertainError), "una respuesta HTTP de error SÍ recibida no debe tratarse como resultado incierto");
            return true;
          }
        );
      }
    );
  });

  await test("4. Regresión — éxito HTTP sin cuerpo interpretable sigue siendo PublicationOutcomeUncertainError (Fase 5.4.1, sin cambios)", async () => {
    await withStubbedFetch(
      (url) => {
        if (url.includes("oauth2.googleapis.com/token")) return tokenResponse();
        if (url.includes("videos.example.com")) return videoDownloadResponse();
        if (url.includes("upload/youtube/v3/videos")) return initUploadResponse();
        if (url === UPLOAD_URL) return new Response("no es json valido {{{", { status: 200 });
        throw new Error(`fetch inesperado a ${url}`);
      },
      async () => {
        await assert.rejects(
          () => publishToYouTube(makePost(), CREDS),
          (err: unknown) => {
            assert.ok(err instanceof PublicationOutcomeUncertainError);
            assert.equal((err as PublicationOutcomeUncertainError).operationRef, UPLOAD_URL);
            return true;
          }
        );
      }
    );
  });

  await test("5. Fallo de red ANTES de obtener uploadUrl (durante el init POST) -> sigue siendo un Error normal (retryable), nunca uncertain — el operation ref todavía no existía", async () => {
    let onOperationRefCalled = false;
    await withStubbedFetch(
      (url) => {
        if (url.includes("oauth2.googleapis.com/token")) return tokenResponse();
        if (url.includes("videos.example.com")) return videoDownloadResponse();
        if (url.includes("upload/youtube/v3/videos")) throw new Error("ECONNRESET durante el init");
        throw new Error(`fetch inesperado a ${url}`);
      },
      async () => {
        await assert.rejects(
          () => publishToYouTube(makePost(), CREDS, () => { onOperationRefCalled = true; }),
          (err: unknown) => {
            assert.ok(!(err instanceof PublicationOutcomeUncertainError), "un fallo ANTES de tener uploadUrl no debe tratarse como resultado incierto - todavía no se pudo haber enviado ningún byte del video");
            return true;
          }
        );
      }
    );
    assert.equal(onOperationRefCalled, false, "el operation ref nunca se llama si no se llegó a obtener uploadUrl");
  });

  console.log(`\n${passed} test(s) pasados.`);
  if (process.exitCode) {
    console.error("\nHay tests fallidos.");
    process.exit(1);
  }
}

main();

// Fase 5.20 (Phase A2/B4) — tests de publishToInstagram() con fetch
// stubbeado, mismo patron que test-youtube-upload.mts. El polling interno
// usa sleep(5000) real (setTimeout) - se acelera con un timer falso local
// (nunca se toca el codigo de produccion) para que los tests no tarden
// minutos.
import assert from "node:assert/strict";
import { publishToInstagram } from "./instagram.ts";
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
  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => handler(String(url), init)) as typeof fetch;
  // Acelera el polling interno de publishToInstagram (sleep(5000) real) SOLO
  // durante este test - nunca toca lib/social/instagram.ts.
  (globalThis as any).setTimeout = (fn: () => void) => {
    fn();
    return 0 as unknown as NodeJS.Timeout;
  };
  try {
    return await fn();
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
  }
}

const CREDS = { ig_user_id: "IGUSER1", access_token: "token-x" };
const CREATION_ID = "CREATION123";

function makePost(overrides: Partial<SocialPost> = {}): SocialPost {
  return {
    id: "post-1",
    account_id: "account-1",
    video_url: "https://videos.example.com/clip.mp4",
    video_path: "videos/clip.mp4",
    title: "Titulo",
    caption: "Caption de prueba",
    scheduled_at: new Date().toISOString(),
    status: "publishing",
    external_post_id: null,
    error_message: null,
    created_at: new Date().toISOString(),
    published_at: null,
    ...overrides,
  };
}

function creationResponse(): Response {
  return new Response(JSON.stringify({ id: CREATION_ID }), { status: 200 });
}
function statusFinishedResponse(): Response {
  return new Response(JSON.stringify({ status_code: "FINISHED" }), { status: 200 });
}

function classify(url: string): "create" | "poll" | "publish" | "unknown" {
  if (url.endsWith(`/${CREDS.ig_user_id}/media`)) return "create";
  if (url.includes(CREATION_ID) && url.includes("status_code")) return "poll";
  if (url.endsWith(`/${CREDS.ig_user_id}/media_publish`)) return "publish";
  return "unknown";
}

async function main() {
  await test("1. Fallo de red ANTES de que exista creationId (falla la creacion del contenedor) -> Error normal, NUNCA uncertain", async () => {
    await withStubbedFetch(
      (url) => {
        const kind = classify(url);
        if (kind === "create") throw new Error("ECONNRESET durante la creacion del contenedor");
        throw new Error(`fetch inesperado (${kind}) a ${url}`);
      },
      async () => {
        await assert.rejects(
          () => publishToInstagram(makePost(), CREDS),
          (err: unknown) => {
            assert.ok(!(err instanceof PublicationOutcomeUncertainError), "un fallo ANTES de creationId no debe ser uncertain - nada pudo haberse publicado todavia");
            return true;
          }
        );
      }
    );
  });

  await test("2. Existe creationId, media_publish lanza sin respuesta HTTP -> PublicationOutcomeUncertainError con operationRef=creationId, NUNCA retry ciego", async () => {
    let operationRefReceived: string | undefined;
    await withStubbedFetch(
      (url) => {
        const kind = classify(url);
        if (kind === "create") return creationResponse();
        if (kind === "poll") return statusFinishedResponse();
        if (kind === "publish") throw new Error("ECONNRESET durante media_publish");
        throw new Error(`fetch inesperado (${kind}) a ${url}`);
      },
      async () => {
        await assert.rejects(
          () => publishToInstagram(makePost(), CREDS, (ref) => { operationRefReceived = ref; }),
          (err: unknown) => {
            assert.ok(err instanceof PublicationOutcomeUncertainError);
            assert.equal((err as PublicationOutcomeUncertainError).platform, "instagram");
            assert.equal((err as PublicationOutcomeUncertainError).operationRef, CREATION_ID);
            return true;
          }
        );
      }
    );
    assert.equal(operationRefReceived, CREATION_ID, "el operation ref debio persistirse ANTES del fallo de red");
  });

  await test("3. HTTP 4xx recibido normalmente en media_publish -> Error normal, NUNCA uncertain (Meta SI contesto)", async () => {
    await withStubbedFetch(
      (url) => {
        const kind = classify(url);
        if (kind === "create") return creationResponse();
        if (kind === "poll") return statusFinishedResponse();
        if (kind === "publish") return new Response("forbidden", { status: 403 });
        throw new Error(`fetch inesperado (${kind}) a ${url}`);
      },
      async () => {
        await assert.rejects(
          () => publishToInstagram(makePost(), CREDS),
          (err: unknown) => {
            assert.ok(!(err instanceof PublicationOutcomeUncertainError));
            return true;
          }
        );
      }
    );
  });

  await test("4. HTTP 5xx recibido normalmente en media_publish -> Error normal, NUNCA uncertain", async () => {
    await withStubbedFetch(
      (url) => {
        const kind = classify(url);
        if (kind === "create") return creationResponse();
        if (kind === "poll") return statusFinishedResponse();
        if (kind === "publish") return new Response("server error", { status: 500 });
        throw new Error(`fetch inesperado (${kind}) a ${url}`);
      },
      async () => {
        await assert.rejects(
          () => publishToInstagram(makePost(), CREDS),
          (err: unknown) => {
            assert.ok(!(err instanceof PublicationOutcomeUncertainError));
            return true;
          }
        );
      }
    );
  });

  await test("5. Regresion — HTTP 200 en media_publish con cuerpo invalido -> PublicationOutcomeUncertainError (Fase 5.4.1, sin cambios)", async () => {
    await withStubbedFetch(
      (url) => {
        const kind = classify(url);
        if (kind === "create") return creationResponse();
        if (kind === "poll") return statusFinishedResponse();
        if (kind === "publish") return new Response("no es json {{{", { status: 200 });
        throw new Error(`fetch inesperado (${kind}) a ${url}`);
      },
      async () => {
        await assert.rejects(
          () => publishToInstagram(makePost(), CREDS),
          (err: unknown) => {
            assert.ok(err instanceof PublicationOutcomeUncertainError);
            assert.equal((err as PublicationOutcomeUncertainError).operationRef, CREATION_ID);
            return true;
          }
        );
      }
    );
  });

  await test("6. Regresion — flujo feliz completo sigue devolviendo externalPostId", async () => {
    await withStubbedFetch(
      (url) => {
        const kind = classify(url);
        if (kind === "create") return creationResponse();
        if (kind === "poll") return statusFinishedResponse();
        if (kind === "publish") return new Response(JSON.stringify({ id: "ig-post-real" }), { status: 200 });
        throw new Error(`fetch inesperado (${kind}) a ${url}`);
      },
      async () => {
        const result = await publishToInstagram(makePost(), CREDS);
        assert.equal(result.externalPostId, "ig-post-real");
      }
    );
  });

  await test("7. La composicion caption+hashtags llega realmente al body de la creacion del contenedor", async () => {
    let capturedBody: any = null;
    await withStubbedFetch(
      (url, init) => {
        const kind = classify(url);
        if (kind === "create") {
          capturedBody = JSON.parse(String(init?.body));
          return creationResponse();
        }
        if (kind === "poll") return statusFinishedResponse();
        if (kind === "publish") return new Response(JSON.stringify({ id: "ig-post-real" }), { status: 200 });
        throw new Error(`fetch inesperado (${kind}) a ${url}`);
      },
      async () => {
        await publishToInstagram(makePost({ caption: "Mi caption", hashtags: ["#Uno", "#Dos"] } as any), CREDS);
      }
    );
    assert.equal(capturedBody.caption, "Mi caption\n\n#Uno #Dos");
  });

  console.log(`\n${passed} test(s) pasados.`);
  if (process.exitCode) {
    console.error("\nHay tests fallidos.");
    process.exit(1);
  }
}

main();

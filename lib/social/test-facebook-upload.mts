// Fase 5.20 (Phase A3/B4) — tests de publishToFacebook() con fetch
// stubbeado, mismo patron que test-youtube-upload.mts/test-instagram-upload.mts.
import assert from "node:assert/strict";
import { publishToFacebook } from "./facebook.ts";
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

const CREDS = { page_id: "PAGE1", access_token: "token-x" };

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

async function main() {
  await test("1. Fallo de red SIN respuesta HTTP -> PublicationOutcomeUncertainError (Fase 5.20, Phase A3: decision Opcion B, fail-closed)", async () => {
    await withStubbedFetch(
      () => {
        throw new Error("ECONNRESET - conexion cerrada por el peer");
      },
      async () => {
        await assert.rejects(
          () => publishToFacebook(makePost(), CREDS),
          (err: unknown) => {
            assert.ok(err instanceof PublicationOutcomeUncertainError, `se esperaba PublicationOutcomeUncertainError, se obtuvo ${err}`);
            assert.equal((err as PublicationOutcomeUncertainError).platform, "facebook");
            // Facebook NUNCA inventa un operationRef propio (Fase 5.4.1/5.11) -
            // sigue siendo asi incluso en este nuevo camino.
            assert.equal((err as PublicationOutcomeUncertainError).operationRef, undefined);
            return true;
          }
        );
      }
    );
  });

  await test("2. HTTP 4xx recibido normalmente -> Error normal, NUNCA uncertain (Meta SI contesto)", async () => {
    await withStubbedFetch(
      () => new Response("forbidden", { status: 403 }),
      async () => {
        await assert.rejects(
          () => publishToFacebook(makePost(), CREDS),
          (err: unknown) => {
            assert.ok(!(err instanceof PublicationOutcomeUncertainError));
            return true;
          }
        );
      }
    );
  });

  await test("3. HTTP 5xx recibido normalmente -> Error normal, NUNCA uncertain", async () => {
    await withStubbedFetch(
      () => new Response("server error", { status: 500 }),
      async () => {
        await assert.rejects(
          () => publishToFacebook(makePost(), CREDS),
          (err: unknown) => {
            assert.ok(!(err instanceof PublicationOutcomeUncertainError));
            return true;
          }
        );
      }
    );
  });

  await test("4. Regresion — HTTP 200 con cuerpo invalido -> PublicationOutcomeUncertainError (Fase 5.4.1, sin cambios)", async () => {
    await withStubbedFetch(
      () => new Response("no es json {{{", { status: 200 }),
      async () => {
        await assert.rejects(
          () => publishToFacebook(makePost(), CREDS),
          (err: unknown) => {
            assert.ok(err instanceof PublicationOutcomeUncertainError);
            return true;
          }
        );
      }
    );
  });

  await test("5. Regresion — HTTP 200 con JSON valido pero SIN 'id' -> PublicationOutcomeUncertainError (Fase 5.11, sin cambios)", async () => {
    await withStubbedFetch(
      () => new Response(JSON.stringify({}), { status: 200 }),
      async () => {
        await assert.rejects(
          () => publishToFacebook(makePost(), CREDS),
          (err: unknown) => {
            assert.ok(err instanceof PublicationOutcomeUncertainError);
            return true;
          }
        );
      }
    );
  });

  await test("6. Regresion — flujo feliz sigue devolviendo externalPostId", async () => {
    await withStubbedFetch(
      () => new Response(JSON.stringify({ id: "fb-video-real" }), { status: 200 }),
      async () => {
        const result = await publishToFacebook(makePost(), CREDS);
        assert.equal(result.externalPostId, "fb-video-real");
      }
    );
  });

  await test("7. La composicion caption+hashtags llega realmente al body (campo 'description')", async () => {
    let capturedBody: any = null;
    await withStubbedFetch(
      (_url, init) => {
        capturedBody = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ id: "fb-video-real" }), { status: 200 });
      },
      async () => {
        await publishToFacebook(makePost({ caption: "Mi caption", hashtags: ["#Uno", "#Dos"] } as any), CREDS);
      }
    );
    assert.equal(capturedBody.description, "Mi caption\n\n#Uno #Dos");
  });

  console.log(`\n${passed} test(s) pasados.`);
  if (process.exitCode) {
    console.error("\nHay tests fallidos.");
    process.exit(1);
  }
}

main();

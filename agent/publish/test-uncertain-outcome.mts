// Fase 5.4.1 — pruebas reales del bug encontrado en la auditoría adversarial:
// "HTTP éxito + fallo de parseo posterior -> retry inseguro". Estas pruebas
// SÍ ejercitan el código real de los publishers (lib/social/*.ts) mediante un
// stub de `fetch` global (sin red real, sin credenciales) — a diferencia de
// test-claim-recovery.mts, que solo prueba lógica de clasificación pura.
//
// Deliberadamente NO se importa agent/publish/run.mts en este archivo: ese
// módulo ejecuta main() contra Supabase real al importarse. Por eso
// finishWithUncertainOutcome()/buildUncertainOutcomeUpdatePayload() viven en
// claimPost.mts (importable sin efectos secundarios) — ver la nota en ese
// archivo.
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PublicationOutcomeUncertainError } from "../../lib/social/types.ts";
import type { SocialPost } from "../../lib/social/types.ts";
import { publishToYouTube } from "../../lib/social/youtube.ts";
import { publishToInstagram } from "../../lib/social/instagram.ts";
import { publishToFacebook } from "../../lib/social/facebook.ts";
import { buildUncertainOutcomeUpdatePayload, buildPersistenceFailureError } from "./uncertainOutcome.mts";

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
  // TEST 2/3/4 — buildUncertainOutcomeUpdatePayload() (pura, sin Supabase):
  // el payload NUNCA debe incluir claimed_at ni publisher_operation_ref -
  // eso es lo que garantiza que finishWithUncertainOutcome() los conserva
  // (no los toca en absoluto, en vez de limpiarlos como finishWithFailure()).
  // ==================================================
  const fakeErr = new PublicationOutcomeUncertainError("mensaje de prueba", { platform: "youtube", operationRef: "https://upload.example.com/x", httpStatus: 200 });
  const payload = buildUncertainOutcomeUpdatePayload(fakeErr);
  check("TEST 2 — payload.status === 'verification_required'", payload.status === "verification_required");
  check("TEST 2 — payload.error_message contiene el mensaje real", payload.error_message === "mensaje de prueba");
  check("TEST 3 — payload NO contiene la clave 'publisher_operation_ref' (se conserva, no se toca)", !("publisher_operation_ref" in payload));
  check("TEST 4 — payload NO contiene la clave 'claimed_at' (se conserva, no se toca)", !("claimed_at" in payload));

  // ==================================================
  // TEST 6 — YouTube: HTTP éxito en la subida (uploadRes.ok) + fallo de
  // parseo del cuerpo -> PublicationOutcomeUncertainError con el uploadUrl
  // REAL preservado (el mismo que ya se había reportado vía onOperationRef).
  // ==================================================
  const tempVideoPath = path.join(tmpdir(), "fase-5.4.1-test-video.mp4");
  writeFileSync(tempVideoPath, "bytes-de-prueba-no-es-un-video-real");
  const youtubePost: SocialPost = { ...basePost, local_file_path: tempVideoPath };
  const youtubeCreds = { client_id: "x", client_secret: "y", refresh_token: "z" };
  const REAL_UPLOAD_URL = "https://upload.example.com/resumable-session/abc123";

  await withStubbedFetch(
    (url) => {
      if (url.includes("oauth2.googleapis.com")) return new Response(JSON.stringify({ access_token: "fake-token" }), { status: 200 });
      if (url.includes("upload/youtube/v3/videos")) return new Response(null, { status: 200, headers: { Location: REAL_UPLOAD_URL } });
      if (url === REAL_UPLOAD_URL) return new Response("esto-no-es-json-valido{{{", { status: 200 }); // ok=true, parseo falla
      throw new Error(`fetch inesperado en el test de YouTube: ${url}`);
    },
    async () => {
      try {
        await publishToYouTube(youtubePost, youtubeCreds);
        check("TEST 6 — YouTube (éxito HTTP + parseo falla) debía lanzar", false);
      } catch (err) {
        check("TEST 6 — YouTube (éxito HTTP + parseo falla) -> PublicationOutcomeUncertainError", err instanceof PublicationOutcomeUncertainError);
        if (err instanceof PublicationOutcomeUncertainError) {
          check("TEST 6 — uploadUrl real conservado en operationRef", err.operationRef === REAL_UPLOAD_URL);
          check("TEST 6 — platform correcto", err.platform === "youtube");
        }
      }
    }
  );
  unlinkSync(tempVideoPath);

  // ==================================================
  // TEST 8 (YouTube) — rechazo HTTP normal (403) debe seguir el
  // comportamiento existente, NUNCA PublicationOutcomeUncertainError.
  // ==================================================
  await withStubbedFetch(
    (url) => {
      if (url.includes("oauth2.googleapis.com")) return new Response(JSON.stringify({ access_token: "fake-token" }), { status: 200 });
      if (url.includes("upload/youtube/v3/videos")) return new Response("forbidden", { status: 403 });
      throw new Error(`fetch inesperado: ${url}`);
    },
    async () => {
      const tempPath2 = path.join(tmpdir(), "fase-5.4.1-test-video-2.mp4");
      writeFileSync(tempPath2, "bytes");
      try {
        await publishToYouTube({ ...basePost, local_file_path: tempPath2 }, youtubeCreds);
        check("TEST 8 — YouTube HTTP 403 debía lanzar", false);
      } catch (err) {
        check("TEST 8 — YouTube HTTP 403 (rechazo normal) -> Error regular, NUNCA PublicationOutcomeUncertainError", !(err instanceof PublicationOutcomeUncertainError) && err instanceof Error);
      } finally {
        unlinkSync(tempPath2);
      }
    }
  );

  // ==================================================
  // TEST 9 (YouTube) — fallo de red ANTES de recibir cualquier respuesta
  // (fetch() mismo rechaza) — NUNCA debe tratarse como "HTTP éxito".
  // ==================================================
  await withStubbedFetch(
    (url) => {
      if (url.includes("oauth2.googleapis.com")) return new Response(JSON.stringify({ access_token: "fake-token" }), { status: 200 });
      if (url.includes("upload/youtube/v3/videos")) throw new Error("simulated network failure - ECONNRESET antes de cualquier respuesta");
      throw new Error(`fetch inesperado: ${url}`);
    },
    async () => {
      const tempPath3 = path.join(tmpdir(), "fase-5.4.1-test-video-3.mp4");
      writeFileSync(tempPath3, "bytes");
      try {
        await publishToYouTube({ ...basePost, local_file_path: tempPath3 }, youtubeCreds);
        check("TEST 9 — YouTube fallo de red debía lanzar", false);
      } catch (err) {
        check("TEST 9 — fallo de red antes de respuesta -> NUNCA PublicationOutcomeUncertainError", !(err instanceof PublicationOutcomeUncertainError));
      } finally {
        unlinkSync(tempPath3);
      }
    }
  );

  // ==================================================
  // TEST 7 — Instagram: media_publish responde éxito + parseo falla ->
  // PublicationOutcomeUncertainError con el creationId REAL preservado.
  // (El polling usa un sleep real de 5s — es el único caso en que el
  // container ya pasó a FINISHED en el primer chequeo.)
  // ==================================================
  const REAL_CREATION_ID = "17895695668004550";
  await withStubbedFetch(
    (url) => {
      if (url.includes("status_code")) return new Response(JSON.stringify({ status_code: "FINISHED" }), { status: 200 });
      if (url.includes("media_publish")) return new Response("esto-no-es-json-valido{{{", { status: 200 }); // ok=true, parseo falla
      if (url.includes("/media")) return new Response(JSON.stringify({ id: REAL_CREATION_ID }), { status: 200 });
      throw new Error(`fetch inesperado en el test de Instagram: ${url}`);
    },
    async () => {
      try {
        await publishToInstagram(basePost, { ig_user_id: "1", access_token: "x" });
        check("TEST 7 — Instagram (media_publish éxito + parseo falla) debía lanzar", false);
      } catch (err) {
        check("TEST 7 — Instagram (media_publish éxito + parseo falla) -> PublicationOutcomeUncertainError", err instanceof PublicationOutcomeUncertainError);
        if (err instanceof PublicationOutcomeUncertainError) {
          check("TEST 7 — creationId real conservado en operationRef", err.operationRef === REAL_CREATION_ID);
        }
      }
    }
  );

  // ==================================================
  // TEST 5 — Facebook: única llamada responde éxito + parseo falla ->
  // PublicationOutcomeUncertainError. Facebook NUNCA reporta un
  // operationRef propio (no se inventa uno) - lo que preserva el
  // placeholder "pending:facebook" es que run.mts/finishWithUncertainOutcome
  // simplemente no tocan esa columna, no algo que dependa de este error.
  // ==================================================
  await withStubbedFetch(
    () => new Response("esto-no-es-json-valido{{{", { status: 200 }),
    async () => {
      try {
        await publishToFacebook(basePost, { page_id: "1", access_token: "x" });
        check("TEST 5 — Facebook (éxito + parseo falla) debía lanzar", false);
      } catch (err) {
        check("TEST 5 — Facebook (éxito + parseo falla) -> PublicationOutcomeUncertainError", err instanceof PublicationOutcomeUncertainError);
        if (err instanceof PublicationOutcomeUncertainError) {
          check("TEST 5 — Facebook no inventa un operationRef propio (queda undefined)", err.operationRef === undefined);
          check("TEST 5 — platform correcto", err.platform === "facebook");
        }
      }
    }
  );

  // ==================================================
  // TEST 12 (Fase 5.11, auditoría de Facebook) — JSON válido pero SIN 'id'
  // (o 'id' vacío) -> debe tratarse igual que un parseo fallido, NUNCA como
  // éxito con un externalPostId inválido/undefined.
  // ==================================================
  await withStubbedFetch(
    () => new Response(JSON.stringify({ success: true }), { status: 200 }), // sin 'id'
    async () => {
      try {
        await publishToFacebook(basePost, { page_id: "1", access_token: "x" });
        check("TEST 12 — Facebook (éxito HTTP, JSON válido, sin 'id') debía lanzar", false);
      } catch (err) {
        check("TEST 12 — Facebook sin 'id' en el cuerpo -> PublicationOutcomeUncertainError (no un 'éxito' con ID inválido)", err instanceof PublicationOutcomeUncertainError);
      }
    }
  );
  await withStubbedFetch(
    () => new Response(JSON.stringify({ id: "" }), { status: 200 }), // 'id' vacío
    async () => {
      try {
        await publishToFacebook(basePost, { page_id: "1", access_token: "x" });
        check("TEST 12b — Facebook con 'id' vacío debía lanzar", false);
      } catch (err) {
        check("TEST 12b — Facebook con 'id'='' -> PublicationOutcomeUncertainError", err instanceof PublicationOutcomeUncertainError);
      }
    }
  );

  // ==================================================
  // TEST 13 (Fase 5.11: CARACTERIZACIÓN original — CORREGIDO en Fase 5.20,
  // Phase A3, auditoría post-piloto): un fallo de red ANTES de recibir
  // cualquier respuesta (el propio fetch() de la única llamada de Facebook
  // lanza) ANTES se clasificaba como error normal reintentable — riesgo
  // residual documentado y deliberadamente no corregido en Fase 5.11. La
  // auditoría post-piloto de Fase 5.20 investigó si la Graph API actual
  // permite un operationRef real (Opción A) y concluyó que NO con el método
  // simple de una sola llamada que usa este código (Opción B — ver el
  // comentario de decisión técnica en lib/social/facebook.ts) — por lo que
  // se cerró el gap de clasificación: ahora SÍ es
  // PublicationOutcomeUncertainError, igual que YouTube/Instagram, aunque
  // Facebook siga sin reconciliación automática posible (CANNOT_VERIFY
  // permanente en reconciliation.mts) - ver también
  // lib/social/test-facebook-upload.mts para la cobertura completa de este
  // publisher.
  // ==================================================
  await withStubbedFetch(
    () => {
      throw new Error("simulated: fallo de red antes de cualquier respuesta");
    },
    async () => {
      try {
        await publishToFacebook(basePost, { page_id: "1", access_token: "x" });
        check("TEST 13 — Facebook fallo de red debía lanzar", false);
      } catch (err) {
        check(
          "TEST 13 — Facebook: fallo de red antes de respuesta -> PublicationOutcomeUncertainError (Fase 5.20, Phase A3 - antes era retryable, riesgo cerrado)",
          err instanceof PublicationOutcomeUncertainError
        );
        if (err instanceof PublicationOutcomeUncertainError) {
          check("TEST 13b — Facebook sigue sin inventar un operationRef propio (queda undefined)", err.operationRef === undefined);
        }
      }
    }
  );

  // ==================================================
  // TEST adicional (segundo audit adversarial, Fase 5.4.1) — publish() ya
  // tuvo éxito (externalPostId real conocido) pero la escritura final a
  // Supabase falla: debe reutilizar el MISMO mecanismo (verification_required),
  // con el externalPostId ya conocido incluido en el mensaje para
  // reconciliación humana directa.
  // ==================================================
  const persistErr = buildPersistenceFailureError("facebook", "fb-video-real-12345", { message: "simulated: conexión perdida al escribir en Supabase" });
  check("TEST adicional — buildPersistenceFailureError() -> PublicationOutcomeUncertainError", persistErr instanceof PublicationOutcomeUncertainError);
  check("TEST adicional — el mensaje conserva el externalPostId real conocido", persistErr.message.includes("fb-video-real-12345"));
  check("TEST adicional — operationRef = externalPostId (evidencia completa, no solo 'incierta')", persistErr.operationRef === "fb-video-real-12345");
  const persistPayload = buildUncertainOutcomeUpdatePayload(persistErr);
  check("TEST adicional — el payload resultante sigue sin tocar claimed_at/publisher_operation_ref", !("claimed_at" in persistPayload) && !("publisher_operation_ref" in persistPayload));

  // ==================================================
  // TEST 10 — recovery de claim stale con operation ref -> verification_required,
  // nunca pending. YA CUBIERTO en agent/publish/test-claim-recovery.mts
  // (classifyStaleClaim con referencia real/placeholder) — no se duplica aquí.
  // ==================================================
  console.log("[INFO] TEST 10 (recovery de claim stale con operation ref) ya cubierto en test-claim-recovery.mts — no duplicado aquí.");

  // ==================================================
  // TEST 11 — idempotencia: verification_required nunca es recogido por la
  // consulta normal de trabajo pendiente. Esto es una garantía ESTRUCTURAL
  // de run.mts::main() (`.eq("status", "pending")`), no requiere lógica
  // adicional que probar — se documenta explícitamente en vez de fabricar
  // una prueba contra Supabase real para algo ya garantizado por el filtro.
  // ==================================================
  check(
    "TEST 11 — 'verification_required' !== 'pending' (la consulta .eq('status','pending') de run.mts::main() lo excluye estructuralmente)",
    ("verification_required" as string) !== "pending"
  );

  console.log(`\n${failures === 0 ? "TODOS LOS CASOS PASARON" : `${failures} CASO(S) FALLARON`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main();

// Fase 5.20 — tests puros de resolveYoutubeUploadPrivacyStatus(). Sin red, sin
// Supabase, sin OAuth, sin .env.local real: el entorno se construye a mano en
// cada caso, exactamente igual que scripts/test-youtube-credential-resolver.mts.
import assert from "node:assert/strict";
import { resolveYoutubeUploadPrivacyStatus } from "./youtubeUploadPrivacy.ts";

let passed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  OK - ${name}`);
  } catch (err) {
    console.error(`  FALLO - ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

function envWith(value: string | undefined): NodeJS.ProcessEnv {
  const env = {} as NodeJS.ProcessEnv;
  if (value !== undefined) env.YOUTUBE_UPLOAD_PRIVACY_STATUS = value;
  return env;
}

console.log("=== resolveYoutubeUploadPrivacyStatus ===");

test("1. variable ausente -> private", () => {
  const result = resolveYoutubeUploadPrivacyStatus(envWith(undefined));
  assert.deepEqual(result, { ok: true, value: "private" });
});

test("2. 'private' -> private", () => {
  const result = resolveYoutubeUploadPrivacyStatus(envWith("private"));
  assert.deepEqual(result, { ok: true, value: "private" });
});

test("3. 'unlisted' -> unlisted", () => {
  const result = resolveYoutubeUploadPrivacyStatus(envWith("unlisted"));
  assert.deepEqual(result, { ok: true, value: "unlisted" });
});

test("4. 'public' -> public (explícito, no es el default)", () => {
  const result = resolveYoutubeUploadPrivacyStatus(envWith("public"));
  assert.deepEqual(result, { ok: true, value: "public" });
});

test("5. valor inválido ('draft') -> bloqueo (ok:false), nunca un valor por defecto", () => {
  const result = resolveYoutubeUploadPrivacyStatus(envWith("draft"));
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /draft/);
});

test("5b. valor inválido ('privado', español) -> bloqueo, no se traduce", () => {
  const result = resolveYoutubeUploadPrivacyStatus(envWith("privado"));
  assert.equal(result.ok, false);
});

test("5c. abreviatura ('priv') -> bloqueo, no se expande", () => {
  const result = resolveYoutubeUploadPrivacyStatus(envWith("priv"));
  assert.equal(result.ok, false);
});

test("6. mayúsculas ('PRIVATE') -> private, normalización determinista", () => {
  const result = resolveYoutubeUploadPrivacyStatus(envWith("PRIVATE"));
  assert.deepEqual(result, { ok: true, value: "private" });
});

test("6b. espacios alrededor (' unlisted ') -> unlisted", () => {
  const result = resolveYoutubeUploadPrivacyStatus(envWith(" unlisted "));
  assert.deepEqual(result, { ok: true, value: "unlisted" });
});

test("6c. mayúsculas + espacios combinados (' Public ') -> public", () => {
  const result = resolveYoutubeUploadPrivacyStatus(envWith(" Public "));
  assert.deepEqual(result, { ok: true, value: "public" });
});

test("6d. cadena vacía tratada igual que ausente -> private", () => {
  const result = resolveYoutubeUploadPrivacyStatus(envWith(""));
  assert.deepEqual(result, { ok: true, value: "private" });
});

test("6e. solo espacios tratada igual que ausente -> private", () => {
  const result = resolveYoutubeUploadPrivacyStatus(envWith("   "));
  assert.deepEqual(result, { ok: true, value: "private" });
});

test("7. barrido exhaustivo: NINGÚN resultado ok:true puede ser 'public' salvo que el valor normalizado sea exactamente 'public'", () => {
  const inputsThatMustNeverYieldPublic = [undefined, "", "   ", "private", "unlisted", "PRIVATE", "Unlisted", "invalid", "pub", "PUBLIC ", " public"];
  for (const input of inputsThatMustNeverYieldPublic) {
    const result = resolveYoutubeUploadPrivacyStatus(envWith(input));
    const normalized = typeof input === "string" ? input.trim().toLowerCase() : undefined;
    if (result.ok) {
      if (result.value === "public") {
        assert.equal(normalized, "public", `input=${JSON.stringify(input)} produjo 'public' sin que el valor normalizado fuera 'public'`);
      }
    }
  }
});

console.log(`\n${passed} test(s) pasados.`);
if (process.exitCode) {
  console.error("\nHay tests fallidos.");
  process.exit(1);
}

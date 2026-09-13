// Fase 5.20 (Phase A1) — tests puros de resolveYoutubeTags(). Sin red.
import assert from "node:assert/strict";
import { resolveYoutubeTags } from "./youtubeHashtags.ts";

let passed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`[PASS] ${name}`);
  } catch (err) {
    console.error(`[FALLO] ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

test("1. hashtags ausentes -> []", () => {
  assert.deepEqual(resolveYoutubeTags(undefined, "algo"), []);
  assert.deepEqual(resolveYoutubeTags(null, "algo"), []);
});

test("2. hashtags vacio -> []", () => {
  assert.deepEqual(resolveYoutubeTags([], "algo"), []);
});

test("3. quita el '#' inicial", () => {
  assert.deepEqual(resolveYoutubeTags(["#Roanoke"], ""), ["Roanoke"]);
});

test("4. sin '#' tambien funciona", () => {
  assert.deepEqual(resolveYoutubeTags(["Roanoke"], ""), ["Roanoke"]);
});

test("5. deduplica dentro de la misma lista (case-insensitive), conserva la primera aparicion", () => {
  assert.deepEqual(resolveYoutubeTags(["#Roanoke", "#roanoke", "#ROANOKE"], ""), ["Roanoke"]);
});

test("6. no duplica un hashtag ya presente en la descripcion", () => {
  assert.deepEqual(resolveYoutubeTags(["#Roanoke", "#Misterio"], "Un video sobre #Roanoke y su historia"), ["Misterio"]);
});

test("6b. la comparacion contra la descripcion es case-insensitive", () => {
  assert.deepEqual(resolveYoutubeTags(["#ROANOKE"], "sobre #roanoke"), []);
});

test("7. descripcion ausente/null no rompe nada", () => {
  assert.deepEqual(resolveYoutubeTags(["#A"], null), ["A"]);
  assert.deepEqual(resolveYoutubeTags(["#A"], undefined), ["A"]);
});

test("8. entradas vacias/solo '#'/no-string se descartan sin lanzar", () => {
  assert.deepEqual(resolveYoutubeTags(["", "   ", "#", "##"], ""), []);
});

test("9. respeta el limite total de 500 caracteres combinados, sin truncar un tag a la mitad", () => {
  const longTags = Array.from({ length: 60 }, (_, i) => `#EtiquetaBastanteLargaNumero${i}`);
  const result = resolveYoutubeTags(longTags, "");
  const totalLength = result.reduce((sum, t, i) => sum + t.length + (i > 0 ? 1 : 0), 0);
  assert.ok(totalLength <= 500, `totalLength=${totalLength} debe ser <= 500`);
  assert.ok(result.length < longTags.length, "debio detenerse antes de agotar la lista de 60 tags");
  // Ningun tag del resultado quedo cortado - cada uno coincide EXACTO con uno original (sin '#').
  for (const t of result) {
    assert.ok(longTags.some((orig) => orig.replace(/^#/, "") === t), `'${t}' debe coincidir exacto con un tag original, nunca truncado`);
  }
});

test("10. preserva el orden de aparicion", () => {
  assert.deepEqual(resolveYoutubeTags(["#Z", "#A", "#M"], ""), ["Z", "A", "M"]);
});

console.log(`\n${passed} test(s) pasados.`);
if (process.exitCode) {
  console.error("\nHay tests fallidos.");
  process.exit(1);
}

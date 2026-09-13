// Fase 5.20 (Phase A1) — tests puros de composeCaptionWithHashtags().
// Compartida por Instagram y Facebook. Sin red.
import assert from "node:assert/strict";
import { composeCaptionWithHashtags } from "./captionComposition.ts";

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

test("1. caption + hashtags -> se agregan al final, separados por linea en blanco", () => {
  assert.equal(composeCaptionWithHashtags("Un video interesante", ["#Roanoke", "#Misterio"]), "Un video interesante\n\n#Roanoke #Misterio");
});

test("2. caption vacio + hashtags -> solo los hashtags, sin separador sobrante", () => {
  assert.equal(composeCaptionWithHashtags("", ["#Roanoke"]), "#Roanoke");
  assert.equal(composeCaptionWithHashtags(null, ["#Roanoke"]), "#Roanoke");
  assert.equal(composeCaptionWithHashtags(undefined, ["#Roanoke"]), "#Roanoke");
});

test("3. hashtags vacios/ausentes -> caption tal cual, sin tocar", () => {
  assert.equal(composeCaptionWithHashtags("Un caption", []), "Un caption");
  assert.equal(composeCaptionWithHashtags("Un caption", undefined), "Un caption");
  assert.equal(composeCaptionWithHashtags("Un caption", null), "Un caption");
});

test("4. caption Y hashtags vacios -> string vacio", () => {
  assert.equal(composeCaptionWithHashtags("", []), "");
  assert.equal(composeCaptionWithHashtags(null, null), "");
});

test("5. no duplica un hashtag ya presente en el caption original", () => {
  assert.equal(composeCaptionWithHashtags("Video sobre #Roanoke y su misterio", ["#Roanoke", "#Misterio2"]), "Video sobre #Roanoke y su misterio\n\n#Misterio2");
});

test("5b. la comparacion contra el caption es case-insensitive", () => {
  assert.equal(composeCaptionWithHashtags("sobre #ROANOKE", ["#roanoke"]), "sobre #ROANOKE");
});

test("6. agrega '#' si el hashtag no lo trae", () => {
  assert.equal(composeCaptionWithHashtags("caption", ["Roanoke"]), "caption\n\n#Roanoke");
});

test("7. deduplica dentro de la misma lista de hashtags (case-insensitive)", () => {
  assert.equal(composeCaptionWithHashtags("caption", ["#Roanoke", "#roanoke", "#ROANOKE"]), "caption\n\n#Roanoke");
});

test("8. preserva el orden de aparicion de los hashtags", () => {
  assert.equal(composeCaptionWithHashtags("c", ["#Z", "#A", "#M"]), "c\n\n#Z #A #M");
});

test("9. no modifica caracteres especiales/acentos/emojis del caption original", () => {
  const caption = "¡Increíble! 🎬 Misterio sin resolver — parte 2";
  assert.equal(composeCaptionWithHashtags(caption, ["#Misterio"]), `${caption}\n\n#Misterio`);
});

test("10. recorta espacios sobrantes del caption y de cada hashtag", () => {
  assert.equal(composeCaptionWithHashtags("  caption con espacios  ", ["  #Roanoke  "]), "caption con espacios\n\n#Roanoke");
});

test("11. entradas de hashtag vacias/no-string se descartan sin lanzar", () => {
  assert.equal(composeCaptionWithHashtags("c", ["", "   ", "#Roanoke"]), "c\n\n#Roanoke");
});

console.log(`\n${passed} test(s) pasados.`);
if (process.exitCode) {
  console.error("\nHay tests fallidos.");
  process.exit(1);
}

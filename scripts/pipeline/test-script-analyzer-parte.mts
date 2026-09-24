// Bloque 4 (post-6.5) — regresión de scriptAnalyzer.mts::CHAPTER_HEADING_RE.
// Prueba con guiones REALES (lectura, nunca escritura, de D:\MATERIAL VIDEOS)
// en vez de fixtures inventados: (1) "CAPÍTULO N" sigue funcionando exacto
// para SIN EXPLICACIÓN/ENCIENDE EL CAOS, (2) "N PARTE" ahora se reconoce para
// LUNA VERDE. Si D:\MATERIAL VIDEOS no está disponible en la máquina que
// corre esto, cada bloque se salta con un aviso en vez de fallar (mismo
// criterio que otras pruebas de este proyecto que dependen de material real).
import { existsSync } from "node:fs";
import { analyzeScript } from "./scriptAnalyzer.mts";

let failures = 0;
const check = (label: string, cond: boolean, extra = "") => {
  const mark = cond ? "PASS" : "FAIL";
  if (!cond) failures++;
  console.log(`[${mark}] ${label}${extra ? " — " + extra : ""}`);
};

// --- Regresión: CAPÍTULO sigue exacto (ENCIENDE EL CAOS, guion real ya auditado en Bloque 3) ---
const capituloScript = "D:/MATERIAL VIDEOS/ENCIENDE EL CAOS/004/Guion - La Dama de Honor (ficticio).md";
if (existsSync(capituloScript)) {
  const a = analyzeScript(capituloScript);
  check('"CAPÍTULO N" — sigue reconociendo 9 capítulos + Hook (sin regresión)', a.chapters.length === 10, `${a.chapters.length} capítulos: ${a.chapters.map((c) => c.title).join(" | ")}`);
  check('"CAPÍTULO N" — ningún capítulo se llama "N PARTE" por error', !a.chapters.some((c) => /parte/i.test(c.title)));
} else {
  console.log("[SKIP] guion real de ENCIENDE EL CAOS no disponible en esta máquina — regresión de CAPÍTULO no verificada aquí (cubierta también por el resto de la batería).");
}

// --- Nuevo: "N PARTE" se reconoce (LUNA VERDE, guion real) ---
const parteScript = "D:/MATERIAL VIDEOS/LUNA VERDE/001/Guion - El Bosque de Luna Verde.md";
if (existsSync(parteScript)) {
  const a = analyzeScript(parteScript);
  check('"N PARTE" — reconoce las 5 partes reales + Hook', a.chapters.length === 6, `${a.chapters.length} secciones: ${a.chapters.map((c) => c.title).join(" | ")}`);
  check('"N PARTE" — los títulos son PRIMERA/SEGUNDA/TERCERA/CUARTA/QUINTA PARTE, en orden', JSON.stringify(a.chapters.map((c) => c.title)) === JSON.stringify(["Hook", "PRIMERA PARTE", "SEGUNDA PARTE", "TERCERA PARTE", "CUARTA PARTE", "QUINTA PARTE"]));
  check("las oraciones de la Segunda Parte en adelante ya NO quedan todas en chapterIndex=0", new Set(a.sentences.map((s) => s.chapterIndex)).size > 1, `chapterIndex únicos: ${[...new Set(a.sentences.map((s) => s.chapterIndex))].join(",")}`);
} else {
  console.log("[SKIP] guion real de LUNA VERDE no disponible en esta máquina — el hallazgo de esta fase no se puede re-verificar aquí.");
}

console.log(`\n${failures === 0 ? "TODOS LOS CASOS PASARON" : `${failures} CASO(S) FALLARON`}`);
process.exit(failures === 0 ? 0 : 1);

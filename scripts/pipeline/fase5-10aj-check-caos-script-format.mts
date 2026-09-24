// FASE 5.10-AJ — verificacion READ-ONLY de que el guion real de ENCIENDE EL
// CAOS (D:\MATERIAL VIDEOS, nunca modificado) es compatible con
// scriptAnalyzer.mts (misma convención que SIN EXPLICACIÓN ya usa en
// producción real). Solo lectura y parseo en memoria, cero escritura.
import { analyzeScript } from "./scriptAnalyzer.mts";

const path = "D:\\MATERIAL VIDEOS\\ENCIENDE EL CAOS\\003\\Voz y Guion\\Guion - Tini Stoessel.md";

try {
  const r = analyzeScript(path);
  console.log(
    JSON.stringify(
      {
        title: r.title,
        chapters: r.chapters.map((c) => c.title),
        sentenceCount: r.sentences.length,
        firstSentence: r.sentences[0]?.text,
        lastChapterIndex: r.sentences[r.sentences.length - 1]?.chapterIndex,
      },
      null,
      2
    )
  );
} catch (err) {
  console.error("FALLÓ el parseo:", err instanceof Error ? err.message : err);
  process.exit(1);
}

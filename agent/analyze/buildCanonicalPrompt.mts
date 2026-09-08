// Arma el prompt del "analisis canonico" - la UNICA responsabilidad de Ollama en
// esta arquitectura (Opcion C, decidida tras observar que pedirle las 4 plataformas
// completas en una sola llamada fallaba de forma sistematica: el modelo repetia
// contenido entre plataformas y mezclaba hashtags de cuenta sin relacion real).
//
// A proposito NO recibe identidad de cuenta - el analisis debe ser 100% fiel al
// contenido real, sin que el tono/tema de la cuenta lo contamine. La identidad de
// cuenta se aplica despues, deterministicamente, en generateMetadata.mts.
//
// Mismo aprendizaje de placeholders que en el prompt anterior: nunca usar "..." -
// se usan tokens en MAYUSCULAS_CON_GUION_BAJO, que siguen siendo JSON valido pero
// son claramente instrucciones, no contenido real que el modelo pueda copiar.
export function buildCanonicalPrompt(transcript: string): string {
  return `Analiza la siguiente transcripcion de un video y devuelve UNICAMENTE un analisis del contenido. No generes titulos, descripciones, hashtags ni metadata de ninguna plataforma - eso lo hace otro sistema despues.

TRANSCRIPCION REAL DEL VIDEO (unica fuente de verdad):
"""
${transcript}
"""

REGLAS OBLIGATORIAS:
1. Usa UNICAMENTE informacion presente en la transcripcion de arriba. No inventes nombres, lugares, fechas, cifras ni datos que no aparezcan ahi.
2. No agregues informacion externa ni de tu propio conocimiento, aunque creas que es relevante.
3. No generes hashtags. No generes titulos ni descripciones de plataformas. Eso no es tu tarea.
4. No expliques tu razonamiento. No agregues texto antes ni despues del JSON. No uses markdown.
5. Los textos en MAYUSCULAS_CON_GUION_BAJO del ejemplo de abajo son SOLO instrucciones de que va en cada campo - nunca los copies literalmente ni uses "..." en tu respuesta. Reemplaza cada uno por el contenido real que generes.

Responde EXCLUSIVAMENTE con este JSON, con las etiquetas ya reemplazadas por contenido real:
{
  "topic": "TEMA_CENTRAL_EN_UNA_FRASE_CORTA",
  "summary": "RESUMEN_FACTUAL_DE_2_A_3_FRASES_BASADO_SOLO_EN_LA_TRANSCRIPCION",
  "hook": "GANCHO_BASADO_UNICAMENTE_EN_EL_CONTENIDO_REAL",
  "content_keywords": ["PALABRA_CLAVE_REAL_1", "PALABRA_CLAVE_REAL_2", "PALABRA_CLAVE_REAL_3", "PALABRA_CLAVE_REAL_4", "PALABRA_CLAVE_REAL_5"]
}`;
}

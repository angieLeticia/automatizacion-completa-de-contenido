// FASE 5.10-AI — namespace de episodios particionado por canal, para la capa
// de producción de Agente 2 en remotion/ (remotion/lib/episodes.ts,
// remotion/data/{captions,clips,shots}-*.json, public/assets/{video,images}/*,
// public/assets/audio/narracion-*.mp3, IDs de composición Remotion
// "MainDocumentary-*"/"Short-*-N"). Auditoría FASE 5.10-AC/AD/5.10-AI
// (mapeo exhaustivo) confirmó que esta es la ÚNICA capa donde episode_id se
// usa como clave GLOBAL sin canal — Supabase (content_files.episode_id,
// nunca UNIQUE por sí solo, siempre junto a content_account_id),
// scripts/pipeline/state/ (stateStore.mts::projectFilePath, ya namespaced),
// scripts/pipeline/queue.mts/agent.mts (claves compuestas account+episodeId
// en memoria) y D:\MATERIAL VIDEOS\<canal>\... (el directorio YA namespacea
// por canal físicamente) NO tienen este problema — no se tocan aquí.
//
// El episode_id CRUDO (nombre real de la carpeta bajo MATERIAL_ROOT, siempre
// puramente numérico — ver config.mts::EPISODE_FOLDER_RE) NUNCA cambia en
// ningún lado — scanEpisode(), exportMainVideo()/exportClip() (nombre final
// entregado en D:\MATERIAL VIDEOS) y todo lo que ya vive dentro de una
// carpeta por canal siguen usándolo tal cual, sin pasar por este módulo.
// namespacedEpisodeId() se usa EXCLUSIVAMENTE para el identificador INTERNO
// que entra a remotion/lib/episodes.ts y derivados.
//
// FASE 5.10-AI — DOS correcciones reales, ambas encontradas por
// test-sandbox-e2e-fase155.mts con Remotion/esbuild reales (nunca supuestas):
//
// 1) Remotion rechaza cualquier id de composición que no sea EXACTAMENTE
//    `[a-zA-Z0-9CJK-]+` (remotion/dist/esm/index.mjs::validateCompositionId)
//    — "_" (guion bajo) NO está permitido.
// 2) episodeRegistrar.mts usa este mismo id como parte de un IDENTIFICADOR
//    de TypeScript real (`const rawCaptions${id}`, `const episode${id}` en
//    el episodes.ts generado) — un identificador TS NO admite "-" (esbuild
//    lo rompe con "Expected 'from' but found '-'" al parsear el import
//    generado).
//
// La INTERSECCIÓN de ambas restricciones es "solo a-z/A-Z/0-9, sin ningún
// separador" — no existe ningún carácter válido a la vez como separador de
// composition-id Y de identificador TS. Por eso namespacedEpisodeId() NO usa
// separador: concatena slug alfabético (nunca termina en dígito, siempre
// vive en un conjunto cerrado y conocido de nombres de canal) + episode_id
// puramente numérico (garantizado por EPISODE_FOLDER_RE) — la combinación es
// libre de colisión porque letras y dígitos nunca se mezclan de forma
// ambigua entre canal y episodio (ver test-episode-namespace.mts para la
// prueba explícita de esta invariante). Este valor NUNCA se parsea de
// vuelta a (canal, episodeId) en ningún punto del código — solo se genera y
// se usa como clave opaca, así que no necesita ser reversible, solo
// determinista y libre de colisión.
const sanitizeForIdentifier = (name: string): string =>
  name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // quita acentos/diacríticos
    .replace(/[^a-zA-Z0-9]/g, ""); // cualquier carácter no alfanumérico se ELIMINA (sin reemplazo, sin separador)

// Único canal con episodios reales ya registrados en remotion/lib/episodes.ts
// bajo id plano (ej. "002", "014", ver auditoría FASE 5.10-AI) — se preserva
// EXACTO para no renombrar contenido histórico sin necesidad (instrucción
// explícita de la auditoría). Su id siempre es puramente numérico, así que
// nunca puede colisionar con el prefijo alfabético de otro canal.
export const LEGACY_UNPREFIXED_CHANNEL = "SIN EXPLICACIÓN";

// Namespace estable por canal, seguro a la vez como id de composición
// Remotion y como identificador TypeScript (ver nota arriba).
export function channelNamespaceSlug(account: string): string {
  return sanitizeForIdentifier(account);
}

// Identificador INTERNO namespaced por canal para la capa de Remotion. Dos
// canales distintos con el mismo episode_id físico (ej. "OBJETOS
// MALDITOS/001" y "ENCIENDE EL CAOS/001") producen SIEMPRE valores distintos
// aquí ("OBJETOSMALDITOS001" vs "ENCIENDEELCAOS001") — nunca pueden pisarse
// la misma clave en episodes.ts ni el mismo archivo de datos/assets, y el
// resultado es válido tanto como id de composición Remotion como
// identificador TypeScript.
export function namespacedEpisodeId(account: string, episodeId: string): string {
  if (account === LEGACY_UNPREFIXED_CHANNEL) return episodeId;
  return `${channelNamespaceSlug(account)}${episodeId}`;
}

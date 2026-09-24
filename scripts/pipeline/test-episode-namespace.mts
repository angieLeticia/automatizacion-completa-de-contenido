// FASE 5.10-AI — pruebas del namespace de episodios particionado por canal
// (episodeNamespace.mts). Objetivo central de esta fase: los 4 canales
// reales deben poder tener un episodio "001" cada uno sin que ninguno pise
// al otro en remotion/lib/episodes.ts, remotion/data/*.json, public/assets/*
// ni en los IDs de composición Remotion — y el resultado debe ser válido a
// la vez como id de composición Remotion Y como identificador TypeScript
// (episodeRegistrar.mts lo usa como `const episode${id}`/`rawCaptions${id}`
// en el episodes.ts generado). Dos restricciones reales, ambas encontradas
// por test-sandbox-e2e-fase155.mts con Remotion/esbuild reales, nunca
// supuestas — ver el comentario de cabecera de episodeNamespace.mts para el
// detalle completo de cada una.
import { namespacedEpisodeId, channelNamespaceSlug, LEGACY_UNPREFIXED_CHANNEL } from "./episodeNamespace.mts";

let failures = 0;
const check = (label: string, cond: boolean, extra = "") => {
  const mark = cond ? "PASS" : "FAIL";
  if (!cond) failures++;
  console.log(`[${mark}] ${label}${extra ? " — " + extra : ""}`);
};

const REAL_CHANNELS = ["SIN EXPLICACIÓN", "ENCIENDE EL CAOS", "LUNA VERDE", "OBJETOS MALDITOS"];

// ---- 1. Los 4 canales reales con episode_id="001" NUNCA colisionan ----
const idsFor001 = REAL_CHANNELS.map((c) => namespacedEpisodeId(c, "001"));
console.log("IDs namespaced para episode_id='001', un canal por línea:");
REAL_CHANNELS.forEach((c, i) => console.log(`  ${c} -> "${idsFor001[i]}"`));
check("Los 4 canales producen exactamente 4 ids DISTINTOS para el mismo episode_id físico '001'", new Set(idsFor001).size === 4);

// Caso concreto pedido explícitamente en el encargo: SIN EXPLICACIÓN/001 vs ENCIENDE EL CAOS/001
check(
  'SIN EXPLICACIÓN/001 y ENCIENDE EL CAOS/001 producen ids distintos',
  namespacedEpisodeId("SIN EXPLICACIÓN", "001") !== namespacedEpisodeId("ENCIENDE EL CAOS", "001")
);

// ---- 2. Compatibilidad histórica: SIN EXPLICACIÓN nunca se renombra ----
check(
  'namespacedEpisodeId("SIN EXPLICACIÓN", id) === id siempre (sin prefijo, preserva episodios históricos ya registrados)',
  ["001", "002", "014", "998"].every((id) => namespacedEpisodeId(LEGACY_UNPREFIXED_CHANNEL, id) === id)
);

// ---- 3. Los otros 3 canales SIEMPRE llevan el slug del canal como prefijo, nunca un id plano ----
for (const channel of ["ENCIENDE EL CAOS", "LUNA VERDE", "OBJETOS MALDITOS"]) {
  const ns = namespacedEpisodeId(channel, "001");
  check(`namespacedEpisodeId("${channel}", "001") empieza con el slug del canal, nunca es un id plano`, ns.startsWith(channelNamespaceSlug(channel)) && ns !== "001", ns);
}

// ---- 3b. Válido a la vez como id de composición Remotion Y como identificador TypeScript ----
// (remotion/dist/esm/index.mjs::validateCompositionId exige "a-z, A-Z, 0-9,
// CJK, -"; un identificador TS válido exige empezar con letra/_/$ y no
// contener "-". La intersección real (sin separador) es solo [a-zA-Z0-9],
// empezando siempre con letra porque el slug del canal nunca empieza con
// dígito.)
const REMOTION_COMPOSITION_ID_RE = /^[0-9a-zA-Z぀-ヿ㐀-鿿-]+$/;
const VALID_TS_IDENTIFIER_SUFFIX_RE = /^[a-zA-Z0-9]+$/; // sin "-" ni "_" — el prefijo "episode"/"rawCaptions" ya lo pone episodeRegistrar.mts
for (const channel of REAL_CHANNELS) {
  const ns = namespacedEpisodeId(channel, "001");
  check(`namespacedEpisodeId("${channel}", "001") es válido como id de composición Remotion`, REMOTION_COMPOSITION_ID_RE.test(ns), ns);
  check(`namespacedEpisodeId("${channel}", "001") es válido como sufijo de identificador TypeScript (rawCaptions\${id}, const episode\${id})`, VALID_TS_IDENTIFIER_SUFFIX_RE.test(ns), ns);
}
check("channelNamespaceSlug nunca contiene guion bajo '_' ni guion '-' (inválidos para Remotion e identificador TS respectivamente)", !/[-_]/.test(channelNamespaceSlug("OBJETOS MALDITOS")) && !/[-_]/.test(channelNamespaceSlug("ENCIENDE EL CAOS")));

// ---- 4. El prefijo NUNCA puede coincidir por accidente con el id plano de SIN EXPLICACIÓN ----
check(
  "Ningún namespacedEpisodeId de los 3 canales nuevos puede ser igual a un id plano típico ('001'..'999')",
  ["ENCIENDE EL CAOS", "LUNA VERDE", "OBJETOS MALDITOS"].every((c) => !/^\d+$/.test(namespacedEpisodeId(c, "001")))
);

// ---- 5. Sanitización estable, determinista y sin colisión entre canales conocidos ----
check("channelNamespaceSlug es determinista (mismo canal -> mismo slug siempre)", channelNamespaceSlug("OBJETOS MALDITOS") === channelNamespaceSlug("OBJETOS MALDITOS"));
check('channelNamespaceSlug("OBJETOS MALDITOS") no tiene espacios', !channelNamespaceSlug("OBJETOS MALDITOS").includes(" "));
check('channelNamespaceSlug("ENCIENDE EL CAOS") no tiene espacios', !channelNamespaceSlug("ENCIENDE EL CAOS").includes(" "));
check('channelNamespaceSlug("LUNA VERDE") no tiene espacios', !channelNamespaceSlug("LUNA VERDE").includes(" "));

// Sin separador, la única forma de colisionar es que el slug de un canal sea
// prefijo de otro Y el resto sea puramente numérico — imposible mientras
// ningún slug termine en dígito (episode_id siempre es puramente numérico,
// EPISODE_FOLDER_RE). Se verifica la invariante explícitamente para TODO el
// registro conocido, no solo los 4 canales reales.
import { listKnownChannels } from "./channelRegistry.mts";
const allSlugs = listKnownChannels().map((c) => channelNamespaceSlug(c.folderName));
check("Ningún slug de canal conocido termina en dígito (invariante que garantiza cero colisión sin separador)", allSlugs.every((s) => s.length === 0 || !/\d$/.test(s)));
check("Ningún slug de canal conocido está vacío", allSlugs.every((s) => s.length > 0));
const uniqueSlugsForReal = new Set(REAL_CHANNELS.map((c) => channelNamespaceSlug(c)));
check("Los slugs de los 4 canales reales son todos distintos entre sí", uniqueSlugsForReal.size === REAL_CHANNELS.length);

// ---- 6. channelNamespaceSlug es DELIBERADAMENTE distinto de la sanitización
// de stateStore.mts::projectFilePath (que usa "_", inválido para Remotion) —
// son dos sanitizaciones DISTINTAS a propósito (ver cabecera de
// episodeNamespace.mts para el porqué exacto).
import { projectFilePath } from "./stateStore.mts";
import path from "node:path";
const stateStoreSlug = path.basename(projectFilePath("OBJETOS MALDITOS", "001"), ".json").replace(/_001$/, "");
check(
  'channelNamespaceSlug NO reutiliza la sanitización de stateStore.mts (esa usa "_", inválido para Remotion/TS) — son dos sanitizaciones DISTINTAS a propósito',
  channelNamespaceSlug("OBJETOS MALDITOS") !== stateStoreSlug,
  `channelNamespaceSlug="${channelNamespaceSlug("OBJETOS MALDITOS")}" vs stateStoreSlug="${stateStoreSlug}"`
);

console.log(failures === 0 ? "\nTODAS LAS PRUEBAS PASARON" : `\n${failures} CASO(S) FALLARON`);
if (failures > 0) process.exit(1);

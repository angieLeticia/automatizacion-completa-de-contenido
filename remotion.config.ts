import { Config } from "@remotion/cli/config";

Config.setVideoImageFormat("jpeg");

// Fase 1.4 (Agente 2 multiproceso) — desactiva el caché filesystem compartido
// de webpack (node_modules/.cache/webpack/remotion-production-*/<hash>/) que
// usan TODAS las invocaciones de "npx remotion render" sobre este proyecto.
// Necesario porque la nueva arquitectura permite varios workers-proceso
// invocando renders en paralelo, y ese caché no tiene ningún locking propio
// entre procesos (ver auditoría Fase 1.3 §3) — cada render vuelve a bundlear
// desde cero (más lento) a cambio de eliminar ese recurso compartido.
Config.setCachingEnabled(false);

// Fase 1.5.3 (sandbox aislado de pruebas) — ÚNICAMENTE si el proceso de
// "npx remotion render" recibe la variable de entorno REMOTION_TEST_EPISODES_CATALOG
// (puesta por renderer.mts::renderComposition SOLO cuando se le pasa un
// PipelineExecutionContext explícito — ver scripts/pipeline/renderer.mts), se
// agrega un alias de webpack que redirige el import "./lib/episodes" (usado,
// con ese texto literal exacto, por remotion/Root.tsx, remotion/MainDocumentary.tsx
// y remotion/ShortClip.tsx — ninguno de los tres se modifica) hacia el
// catálogo del sandbox. El "$" final hace el match EXACTO de esa cadena, no
// un prefijo — nunca captura ningún otro módulo del proyecto.
// Sin esa variable de entorno (cualquier render real de producción), este
// bloque completo es un no-op: NO se llama a overrideWebpackConfig ni a
// setPublicDir, y el comportamiento es idéntico al de antes de esta fase.
const testEpisodesCatalog = process.env.REMOTION_TEST_EPISODES_CATALOG;
if (testEpisodesCatalog) {
  Config.overrideWebpackConfig((currentConfig) => ({
    ...currentConfig,
    resolve: {
      ...currentConfig.resolve,
      alias: {
        ...currentConfig.resolve?.alias,
        "./lib/episodes$": testEpisodesCatalog,
      },
    },
  }));
}

const testPublicDir = process.env.REMOTION_TEST_PUBLIC_DIR;
if (testPublicDir) {
  Config.setPublicDir(testPublicDir);
}

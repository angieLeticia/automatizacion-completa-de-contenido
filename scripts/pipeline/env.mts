// Carga .env.local ANTES de que se evalue cualquier otro modulo del pipeline.
// Critico: en ES modules, todos los "import" de un archivo se resuelven y
// evaluan ANTES que el propio codigo de ese archivo corra. Si .env.local se
// cargaba dentro de agent.mts/processOne.mts (despues de sus imports),
// config.mts ya habia leido process.env.* con el .env.local todavia sin
// cargar - cualquier variable ahi (EPISODE_FILTER, MATERIAL_ROOT, etc.)
// quedaba con su valor por defecto sin que nadie lo notara. La correccion es
// que este archivo, sin ninguna dependencia propia, se importe PRIMERO (antes
// que "./config.mts") en cada entry point - así su efecto secundario ya
// corrio para cuando config.mts se evalua.
import path from "node:path";

try {
  process.loadEnvFile(path.join(import.meta.dirname, "..", "..", ".env.local"));
} catch {
  // .env.local no existe o ya esta cargado por el shell — seguimos sin frenar.
}

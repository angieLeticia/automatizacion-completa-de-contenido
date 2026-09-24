// "Día 1.1" — mutex asíncrono EN MEMORIA, dentro del mismo proceso, para la
// ÚNICA sección crítica real encontrada en la auditoría de concurrencia:
// nextChapterNumber() (processOne.mts) + registerEpisode() (episodeRegistrar.mts)
// leen y escriben remotion/lib/episodes.ts con un patrón read-modify-write
// sin ninguna atomicidad propia. Si dos workers ejecutaran esa sección a la
// vez, podrían calcular el mismo chapterNumber o pisarse la escritura del
// archivo.
//
// Deliberadamente NO es un lock de archivo ni cruza procesos: el lock de
// instancia única (agentLock.mts) ya garantiza que solo existe UN proceso
// agent.mts corriendo — la concurrencia que hay que serializar es
// INTRA-proceso (varios workerSlot() del mismo proceso), así que una cola de
// promesas en memoria alcanza y es lo más simple posible. No se creó base de
// datos, archivo de lock adicional, Redis, ni ningún servicio externo.
//
// Uso: SOLO alrededor de la sección mínima que toca episodes.ts - nunca
// alrededor de processProject() completo (eso serializaría todo el pipeline,
// exactamente lo que esta fase busca evitar).
let queue: Promise<unknown> = Promise.resolve();

export function withEpisodesRegistryLock<T>(fn: () => Promise<T>): Promise<T> {
  const runAfterPrevious = queue.then(fn, fn); // corre `fn` tanto si la anterior resolvió como si falló - un fallo previo nunca debe bloquear las siguientes
  // `queue` se actualiza a una versión de runAfterPrevious que nunca rechaza,
  // para que un throw dentro de `fn` no deje la cola entera en un estado
  // "rechazado" que rompería el `.then` de la SIGUIENTE llamada (una promesa
  // rechazada sin manejar en `queue` haría que la próxima espera se salte
  // igual, pero es más claro y más seguro neutralizar el error acá).
  queue = runAfterPrevious.catch(() => undefined);
  return runAfterPrevious;
}

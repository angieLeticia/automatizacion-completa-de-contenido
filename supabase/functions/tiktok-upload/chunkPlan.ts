// Puerto EXACTO (mismo algoritmo, mismos limites) de
// scripts/social/tiktok-upload-draft.mts::planUploadChunks/validateUploadPlan
// (commit bf941c3, ya probado 13/13 tests + una subida real exitosa de
// 172,649,788 bytes / 17 chunks) y de website/tiktok-chunking.js (la copia
// del browser). Las 3 copias deben producir EXACTAMENTE el mismo plan para
// el mismo videoSize - ver
// scripts/social/test-tiktok-chunk-plan-deno-port.mts para la comparacion
// cruzada de ESTA copia contra el CLI (corrida con Node/tsx, no con Deno -
// no hay `deno` instalado en esta maquina, ver el commit).
//
// Sin ningun Deno.*/Node.* especifico - solo JS puro, para poder importarse
// tanto desde index.ts (Deno) como desde un test en Node.

export const MIN_CHUNK_SIZE = 5_000_000; // 5 MB
export const MAX_CHUNK_SIZE = 64_000_000; // 64 MB
export const MAX_FINAL_CHUNK_SIZE = 128_000_000; // 128 MB
export const MAX_CHUNK_COUNT = 1000;
export const DEFAULT_CHUNK_SIZE = 10_000_000;

export interface ChunkPlanItem {
  index: number;
  start: number;
  end: number;
  length: number;
}

export interface UploadPlan {
  videoSize: number;
  chunkSize: number;
  totalChunkCount: number;
  chunks: ChunkPlanItem[];
}

export function planUploadChunks(videoSize: number, chunkSize: number = DEFAULT_CHUNK_SIZE): UploadPlan {
  if (!Number.isInteger(videoSize) || videoSize <= 0) {
    throw new Error(`videoSize inválido: ${videoSize} (debe ser un entero positivo).`);
  }
  if (!Number.isInteger(chunkSize) || chunkSize <= 0) {
    throw new Error(`chunkSize inválido: ${chunkSize} (debe ser un entero positivo).`);
  }

  if (videoSize <= MAX_CHUNK_SIZE) {
    return {
      videoSize,
      chunkSize: videoSize,
      totalChunkCount: 1,
      chunks: [{ index: 0, start: 0, end: videoSize - 1, length: videoSize }],
    };
  }

  const totalChunkCount = Math.floor(videoSize / chunkSize);
  const chunks: ChunkPlanItem[] = [];
  for (let i = 0; i < totalChunkCount; i++) {
    const start = i * chunkSize;
    const isLast = i === totalChunkCount - 1;
    const end = isLast ? videoSize - 1 : start + chunkSize - 1;
    chunks.push({ index: i, start, end, length: end - start + 1 });
  }
  return { videoSize, chunkSize, totalChunkCount, chunks };
}

export function validateUploadPlan(plan: UploadPlan): { ok: true } | { ok: false; reason: string } {
  if (!Number.isInteger(plan.videoSize) || plan.videoSize <= 0) {
    return { ok: false, reason: `videoSize inválido: ${plan.videoSize}.` };
  }
  if (plan.totalChunkCount < 1 || plan.totalChunkCount > MAX_CHUNK_COUNT) {
    return { ok: false, reason: `totalChunkCount=${plan.totalChunkCount} fuera de rango [1, ${MAX_CHUNK_COUNT}].` };
  }
  if (plan.chunks.length !== plan.totalChunkCount) {
    return { ok: false, reason: `plan.chunks.length=${plan.chunks.length} no coincide con totalChunkCount=${plan.totalChunkCount}.` };
  }

  if (plan.totalChunkCount === 1) {
    const only = plan.chunks[0];
    if (plan.chunkSize !== plan.videoSize || only.length !== plan.videoSize) {
      return { ok: false, reason: "con totalChunkCount=1, chunkSize y el length del único chunk deben ser exactamente videoSize." };
    }
  } else {
    if (plan.chunkSize < MIN_CHUNK_SIZE || plan.chunkSize > MAX_CHUNK_SIZE) {
      return { ok: false, reason: `chunkSize=${plan.chunkSize} fuera de [${MIN_CHUNK_SIZE}, ${MAX_CHUNK_SIZE}] bytes.` };
    }
    for (let i = 0; i < plan.chunks.length - 1; i++) {
      if (plan.chunks[i].length !== plan.chunkSize) {
        return { ok: false, reason: `chunk[${i}].length=${plan.chunks[i].length} debe ser exactamente chunkSize=${plan.chunkSize} (no es el último chunk).` };
      }
    }
    const last = plan.chunks[plan.chunks.length - 1];
    if (last.length <= 0 || last.length > MAX_FINAL_CHUNK_SIZE) {
      return { ok: false, reason: `el último chunk (length=${last.length}) debe ser >0 y <= ${MAX_FINAL_CHUNK_SIZE} bytes.` };
    }
    if (last.length < MIN_CHUNK_SIZE) {
      return { ok: false, reason: `el último chunk (length=${last.length}) quedó por debajo del mínimo de ${MIN_CHUNK_SIZE} bytes.` };
    }
  }

  let expectedStart = 0;
  let sum = 0;
  for (const c of plan.chunks) {
    if (c.start !== expectedStart) {
      return { ok: false, reason: `chunk[${c.index}].start=${c.start} esperado=${expectedStart} (hueco u overlap).` };
    }
    if (c.end !== c.start + c.length - 1) {
      return { ok: false, reason: `chunk[${c.index}] inconsistente: end=${c.end}, start=${c.start}, length=${c.length}.` };
    }
    sum += c.length;
    expectedStart = c.end + 1;
  }
  if (sum !== plan.videoSize) {
    return { ok: false, reason: `la suma de los length de todos los chunks (${sum}) no coincide con videoSize (${plan.videoSize}).` };
  }
  const lastChunk = plan.chunks[plan.chunks.length - 1];
  if (lastChunk.end !== plan.videoSize - 1) {
    return { ok: false, reason: `el último chunk termina en end=${lastChunk.end}, esperado videoSize-1=${plan.videoSize - 1}.` };
  }

  return { ok: true };
}

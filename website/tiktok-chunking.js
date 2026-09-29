// Puerto EXACTO (mismos limites, mismo algoritmo) de
// scripts/social/tiktok-upload-draft.mts::planUploadChunks/validateUploadPlan
// (commit bf941c3, ya probado 13/13 tests + una subida real exitosa de
// 172,649,788 bytes / 17 chunks). Sin esto, el browser y el backend podrian
// calcular planes de chunk distintos para el mismo archivo.
//
// UMD minimo, sin build step: en el browser se usa via <script src=...>,
// que define window.TikTokChunking. En Node (para el test) se exporta via
// module.exports si CommonJS esta disponible. Nunca usa nada especifico de
// un runtime (sin fetch, sin fs, sin Deno.*) - es matematica pura.
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.TikTokChunking = api;
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Limites EXACTOS citados de developers.tiktok.com/doc/content-posting-api-media-transfer-guide
  // (mismos que scripts/social/tiktok-upload-draft.mts - ver ese archivo
  // para las citas textuales completas de la documentacion oficial).
  var MIN_CHUNK_SIZE = 5000000; // 5 MB
  var MAX_CHUNK_SIZE = 64000000; // 64 MB
  var MAX_FINAL_CHUNK_SIZE = 128000000; // 128 MB
  var MAX_CHUNK_COUNT = 1000;
  var DEFAULT_CHUNK_SIZE = 10000000; // mismo tamaño que el ejemplo oficial de TikTok

  function planUploadChunks(videoSize, chunkSize) {
    chunkSize = chunkSize || DEFAULT_CHUNK_SIZE;
    if (!Number.isInteger(videoSize) || videoSize <= 0) {
      throw new Error("videoSize invalido: " + videoSize + " (debe ser un entero positivo).");
    }
    if (!Number.isInteger(chunkSize) || chunkSize <= 0) {
      throw new Error("chunkSize invalido: " + chunkSize + " (debe ser un entero positivo).");
    }

    if (videoSize <= MAX_CHUNK_SIZE) {
      return {
        videoSize: videoSize,
        chunkSize: videoSize,
        totalChunkCount: 1,
        chunks: [{ index: 0, start: 0, end: videoSize - 1, length: videoSize }],
      };
    }

    var totalChunkCount = Math.floor(videoSize / chunkSize);
    var chunks = [];
    for (var i = 0; i < totalChunkCount; i++) {
      var start = i * chunkSize;
      var isLast = i === totalChunkCount - 1;
      var end = isLast ? videoSize - 1 : start + chunkSize - 1;
      chunks.push({ index: i, start: start, end: end, length: end - start + 1 });
    }
    return { videoSize: videoSize, chunkSize: chunkSize, totalChunkCount: totalChunkCount, chunks: chunks };
  }

  function validateUploadPlan(plan) {
    if (!Number.isInteger(plan.videoSize) || plan.videoSize <= 0) {
      return { ok: false, reason: "videoSize invalido: " + plan.videoSize + "." };
    }
    if (plan.totalChunkCount < 1 || plan.totalChunkCount > MAX_CHUNK_COUNT) {
      return { ok: false, reason: "totalChunkCount=" + plan.totalChunkCount + " fuera de rango [1, " + MAX_CHUNK_COUNT + "]." };
    }
    if (plan.chunks.length !== plan.totalChunkCount) {
      return { ok: false, reason: "plan.chunks.length no coincide con totalChunkCount." };
    }

    if (plan.totalChunkCount === 1) {
      var only = plan.chunks[0];
      if (plan.chunkSize !== plan.videoSize || only.length !== plan.videoSize) {
        return { ok: false, reason: "con totalChunkCount=1, chunkSize y el length del unico chunk deben ser exactamente videoSize." };
      }
    } else {
      if (plan.chunkSize < MIN_CHUNK_SIZE || plan.chunkSize > MAX_CHUNK_SIZE) {
        return { ok: false, reason: "chunkSize=" + plan.chunkSize + " fuera de [" + MIN_CHUNK_SIZE + ", " + MAX_CHUNK_SIZE + "] bytes." };
      }
      for (var j = 0; j < plan.chunks.length - 1; j++) {
        if (plan.chunks[j].length !== plan.chunkSize) {
          return { ok: false, reason: "chunk[" + j + "].length debe ser exactamente chunkSize (no es el ultimo chunk)." };
        }
      }
      var last = plan.chunks[plan.chunks.length - 1];
      if (last.length <= 0 || last.length > MAX_FINAL_CHUNK_SIZE) {
        return { ok: false, reason: "el ultimo chunk debe ser >0 y <= " + MAX_FINAL_CHUNK_SIZE + " bytes." };
      }
      if (last.length < MIN_CHUNK_SIZE) {
        return { ok: false, reason: "el ultimo chunk quedo por debajo del minimo de " + MIN_CHUNK_SIZE + " bytes." };
      }
    }

    var expectedStart = 0;
    var sum = 0;
    for (var k = 0; k < plan.chunks.length; k++) {
      var c = plan.chunks[k];
      if (c.start !== expectedStart) {
        return { ok: false, reason: "chunk[" + c.index + "].start=" + c.start + " esperado=" + expectedStart + " (hueco u overlap)." };
      }
      if (c.end !== c.start + c.length - 1) {
        return { ok: false, reason: "chunk[" + c.index + "] inconsistente: end/start/length." };
      }
      sum += c.length;
      expectedStart = c.end + 1;
    }
    if (sum !== plan.videoSize) {
      return { ok: false, reason: "la suma de los length de todos los chunks no coincide con videoSize." };
    }
    var lastChunk = plan.chunks[plan.chunks.length - 1];
    if (lastChunk.end !== plan.videoSize - 1) {
      return { ok: false, reason: "el ultimo chunk no termina en videoSize-1." };
    }

    return { ok: true };
  }

  return {
    MIN_CHUNK_SIZE: MIN_CHUNK_SIZE,
    MAX_CHUNK_SIZE: MAX_CHUNK_SIZE,
    MAX_FINAL_CHUNK_SIZE: MAX_FINAL_CHUNK_SIZE,
    MAX_CHUNK_COUNT: MAX_CHUNK_COUNT,
    DEFAULT_CHUNK_SIZE: DEFAULT_CHUNK_SIZE,
    planUploadChunks: planUploadChunks,
    validateUploadPlan: validateUploadPlan,
  };
});

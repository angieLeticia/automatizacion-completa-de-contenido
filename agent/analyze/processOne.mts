// Orquesta el pipeline completo para UN archivo ya reclamado (Opcion C - decision
// de arquitectura de Fase 3):
//
//   probeMedia -> Whisper (si hace falta) -> GUARDAR TRANSCRIPT
//     -> Ollama: ANALISIS CANONICO (unica responsabilidad: entender el contenido)
//     -> GUARDAR ANALISIS CANONICO
//     -> generateMetadata.mts: GENERACION DETERMINISTA (TypeScript, sin Ollama)
//     -> validateMetadata.mts (SIN MODIFICAR - autoridad final)
//     -> guardar / status=ready
//
// Whisper y Ollama corren en SERIE, nunca simultaneos. Cada etapa cara (Whisper,
// Ollama) se guarda en cuanto termina con exito, ANTES de intentar la siguiente -
// asi un reintento nunca repite una etapa cara que ya se completo:
//   - fallo en Ollama/generacion/validacion -> NO repite Whisper
//   - fallo en generacion determinista o validacion final -> NO repite Ollama
//
// Si el video NO tiene voz util, se BLOQUEA explicitamente (status='error', no
// reintentable) en vez de inventar de que trata - la vision esta desactivada en
// esta version (no viable en este hardware, ver decision de Fase 3).
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { supabaseAdmin } from "../supabaseClient.mts";
import { log } from "../logger.mts";
import { probeMedia } from "./probeMedia.mts";
import { extractAudioToWav } from "./extractAudio.mts";
import { transcribeAudio } from "./transcribe.mts";
import { buildCanonicalPrompt } from "./buildCanonicalPrompt.mts";
import { validateCanonical, type CanonicalAnalysis } from "./validateCanonical.mts";
import { generateMetadata } from "./generateMetadata.mts";
import { getLlmProvider } from "./llm/index.mts";
import { validateMetadata } from "./validateMetadata.mts";
import { METADATA_SCHEMA_VERSION, OLLAMA_MODEL, MAX_RETRIES } from "./config.mts";
import type { WorkItem } from "./claimWork.mts";

async function markFailed(item: WorkItem, reason: string, extra?: { transcript?: string }): Promise<void> {
  log.error("[ERROR] Analisis de contenido fallo - se registra como intento", {
    contentFileId: item.contentFileId,
    filePath: item.filePath,
    reason,
    intentoNumero: item.retryCountAtClaim + 1,
  });
  await supabaseAdmin
    .from("content_metadata")
    .update({
      status: "error",
      error_message: reason,
      retry_count: item.retryCountAtClaim + 1,
      ...(extra?.transcript !== undefined ? { transcript: extra.transcript, has_speech: true } : {}),
    })
    .eq("id", item.metadataRowId);
}

// Bloqueo explicito y NO reintentable: no hay informacion textual suficiente y no
// se va a inventar el tema del video (vision desactivada en esta version).
async function markBlockedNoSpeech(
  item: WorkItem,
  media: { durationSeconds: number; width: number; height: number }
): Promise<void> {
  const reason =
    "Sin voz/transcripcion util detectada. La vision esta desactivada en esta version (no viable en este hardware), " +
    "por lo que no hay suficiente informacion segura para generar metadata sin inventar contenido. " +
    "Requiere revision manual o una version futura con analisis visual.";
  log.warn("[ANALYSIS] Bloqueado - sin informacion suficiente, no se inventa contenido", {
    contentFileId: item.contentFileId,
    filePath: item.filePath,
  });
  await supabaseAdmin
    .from("content_metadata")
    .update({
      status: "error",
      has_speech: false,
      duration_seconds: media.durationSeconds,
      width: media.width,
      height: media.height,
      error_message: reason,
      retry_count: MAX_RETRIES,
    })
    .eq("id", item.metadataRowId);
}

// Llama a Ollama para el analisis canonico UNICAMENTE (1 llamada), lo valida, y si
// es exitoso lo GUARDA de inmediato (antes de la generacion determinista) - un
// fallo posterior (generacion o validacion final) nunca vuelve a llamar a Ollama.
// Devuelve null si algo fallo (y ya dejo la fila en 'error'); el llamador solo
// necesita hacer `return` en ese caso.
async function runCanonicalAnalysis(item: WorkItem, transcript: string): Promise<CanonicalAnalysis | null> {
  const prompt = buildCanonicalPrompt(transcript);
  await supabaseAdmin.from("content_metadata").update({ status: "generating_metadata" }).eq("id", item.metadataRowId);

  let rawResponse: string;
  try {
    log.info("[OLLAMA] iniciando analisis canonico", { filePath: item.filePath });
    log.info(`[OLLAMA] modelo: ${OLLAMA_MODEL}`, { filePath: item.filePath });
    const result = await getLlmProvider().generateMetadata(prompt);
    rawResponse = result.content;
    log.info("[OLLAMA] respuesta recibida", { filePath: item.filePath, caracteres: rawResponse.length });
    if (result.thinkingDetected) {
      log.warn("[OLLAMA] se detecto contenido de 'thinking' en la respuesta (inesperado con think:false)", {
        filePath: item.filePath,
      });
    }
  } catch (err) {
    await markFailed(item, `ollama: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }

  const validation = validateCanonical(rawResponse);
  if (!validation.ok) {
    await markFailed(item, `canonical: ${validation.reason}`);
    return null;
  }
  log.info("[VALIDATOR] analisis canonico valido", { filePath: item.filePath });

  // Reutiliza la columna claude_raw_response: ya no almacena "las 4 plataformas",
  // ahora almacena el analisis canonico crudo (ver informe de arquitectura).
  await supabaseAdmin
    .from("content_metadata")
    .update({ claude_raw_response: rawResponse, topic_summary: validation.data.summary })
    .eq("id", item.metadataRowId);
  log.info("[OLLAMA] analisis canonico guardado en content_metadata", { filePath: item.filePath });

  return validation.data;
}

export async function processOne(item: WorkItem): Promise<void> {
  log.info("[ANALYSIS] archivo detectado", {
    filePath: item.filePath,
    cuenta: item.accountFolderName,
    folderType: item.folderType,
  });

  const tmpDir = mkdtempSync(path.join(tmpdir(), "agent-analyze-"));
  try {
    let media;
    try {
      media = probeMedia(item.filePath);
    } catch (err) {
      await markFailed(item, `probeMedia: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }

    // ================== ETAPA 1: WHISPER (transcripcion) ==================
    let transcript = "";
    let hasSpeech = false;

    if (item.cachedTranscript) {
      transcript = item.cachedTranscript;
      hasSpeech = true;
      log.info("[WHISPER] transcripcion reutilizada de un intento anterior - se omite Whisper", {
        filePath: item.filePath,
        caracteres: transcript.length,
      });
    } else if (media.hasAudioStream) {
      log.info("[ANALYSIS] audio detectado", { filePath: item.filePath });
      try {
        const wavPath = extractAudioToWav(item.filePath, tmpDir);
        log.info("[WHISPER] iniciando", { filePath: item.filePath, modelo: process.env.WHISPER_MODEL || "medium" });
        const result = transcribeAudio(wavPath, tmpDir);
        transcript = result.transcript;
        hasSpeech = result.hasSpeech;
        log.info("[WHISPER] terminado", { filePath: item.filePath, hasSpeech });
        log.info(`[WHISPER] transcript length: ${transcript.length}`, { filePath: item.filePath });

        if (hasSpeech) {
          // Se guarda AQUI, antes de intentar Ollama - un fallo despues de este
          // punto (Ollama, generacion, validacion) nunca vuelve a ejecutar Whisper.
          await supabaseAdmin
            .from("content_metadata")
            .update({
              has_speech: true,
              transcript,
              duration_seconds: media.durationSeconds,
              width: media.width,
              height: media.height,
            })
            .eq("id", item.metadataRowId);
          log.info("[WHISPER] transcript guardado en content_metadata", { filePath: item.filePath });
        }
      } catch (err) {
        await markFailed(item, `whisper: ${err instanceof Error ? err.message : String(err)}`);
        return;
      }
    } else {
      log.info("[ANALYSIS] sin stream de audio en el archivo", { filePath: item.filePath });
    }

    if (!hasSpeech) {
      await markBlockedNoSpeech(item, media);
      return;
    }

    // ============ ETAPA 2: OLLAMA - ANALISIS CANONICO (1 llamada) ============
    // Unica responsabilidad de Ollama: entender el transcript. NO genera
    // plataformas, NO genera hashtags - eso es TypeScript determinista (etapa 3).
    let canonical: CanonicalAnalysis;

    if (item.cachedCanonicalRaw) {
      const cachedValidation = validateCanonical(item.cachedCanonicalRaw);
      if (cachedValidation.ok) {
        canonical = cachedValidation.data;
        log.info("[OLLAMA] analisis canonico reutilizado de un intento anterior - se omite Ollama", {
          filePath: item.filePath,
        });
      } else {
        // No deberia pasar nunca (ya se valido antes de guardarlo), pero por
        // seguridad no se deja al pipeline sin salida: se re-consulta a Ollama.
        log.warn("[OLLAMA] el analisis canonico cacheado ya no es valido - se vuelve a consultar Ollama", {
          filePath: item.filePath,
          motivo: cachedValidation.reason,
        });
        const fresh = await runCanonicalAnalysis(item, transcript);
        if (!fresh) return;
        canonical = fresh;
      }
    } else {
      const fresh = await runCanonicalAnalysis(item, transcript);
      if (!fresh) return;
      canonical = fresh;
    }

    // ================ ETAPA 3: GENERACION DETERMINISTA (TypeScript) ================
    let generated;
    try {
      generated = generateMetadata(canonical, item.accountStyle, item.folderType);
      log.info("[GENERATOR] metadata generada deterministicamente (sin llamar a Ollama)", {
        filePath: item.filePath,
        plataformas: Object.keys(generated.platforms).join(", "),
      });
    } catch (err) {
      // Fallo de generacion deterministica: NO se repite Whisper NI Ollama - el
      // siguiente intento reutiliza el analisis canonico ya guardado.
      await markFailed(item, `generacion-deterministica: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }

    // ================ ETAPA 4: VALIDACION FINAL (sin modificar) ================
    const rawForValidator = JSON.stringify(generated);
    const validation = validateMetadata(rawForValidator, item.folderType, item.accountStyle, transcript);
    if (!validation.ok) {
      await markFailed(item, `validacion: ${validation.reason}`);
      return;
    }
    log.info("[VALIDATOR] metadata final valida", { filePath: item.filePath });
    for (const warning of validation.warnings) {
      log.warn(warning, { filePath: item.filePath });
    }

    await supabaseAdmin
      .from("content_metadata")
      .update({
        status: "ready",
        has_speech: true,
        transcript,
        duration_seconds: media.durationSeconds,
        width: media.width,
        height: media.height,
        topic_summary: validation.data.topic_summary,
        platform_metadata: validation.data.platforms,
        claude_model: `ollama:${OLLAMA_MODEL}`, // columna heredada; documenta que modelo genero el analisis canonico
        metadata_version: METADATA_SCHEMA_VERSION,
        error_message: null,
      })
      .eq("id", item.metadataRowId);

    log.info("[ANALYSIS] metadata lista", {
      filePath: item.filePath,
      resumen: validation.data.topic_summary,
    });
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

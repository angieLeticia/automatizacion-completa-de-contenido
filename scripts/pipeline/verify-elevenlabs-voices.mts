// Verificación READ-ONLY de que los patrones de voz configurados en
// channelRegistry.mts realmente resuelven una voz en la cuenta de
// ElevenLabs — usa ÚNICAMENTE GET /v1/voices (elevenLabsClient.mts::listVoices()),
// NUNCA textToSpeech() — cero créditos consumidos, sin importar el resultado.
// Nunca imprime la API key ni ningún otro secreto — solo nombre/voice_id de
// voces (no son credenciales, son metadata de la cuenta ya visible en el
// dashboard de ElevenLabs).
import "./env.mts";
import { listVoices } from "./elevenLabsClient.mts";
import { listKnownChannels } from "./channelRegistry.mts";

async function main() {
  console.log(`ELEVENLABS_API_KEY: ${process.env.ELEVENLABS_API_KEY ? "configurada (presente en el entorno)" : "AUSENTE"}`);
  if (!process.env.ELEVENLABS_API_KEY) {
    console.error("Falta ELEVENLABS_API_KEY — no se puede continuar.");
    process.exit(1);
  }

  console.log("\nConsultando GET /v1/voices (solo lectura, cero créditos)...");
  const voices = await listVoices();
  console.log(`  ${voices.length} voces visibles en esta cuenta.\n`);

  const channelsWithVoice = listKnownChannels().filter((c) => c.voice?.narratorVoicePattern);
  let allMatched = true;
  for (const channel of channelsWithVoice) {
    const pattern = channel.voice!.narratorVoicePattern;
    const match = voices.find((v) => pattern.test(v.name));
    if (match) {
      console.log(`${channel.folderName} → MATCH — nombre="${match.name}" voice_id=${match.voice_id}`);
    } else {
      allMatched = false;
      console.log(`${channel.folderName} → NO MATCH (patrón: ${pattern})`);
    }
  }

  console.log(`\n${allMatched ? "TODOS LOS PATRONES CONFIGURADOS ENCONTRARON UNA VOZ REAL." : "AL MENOS UN PATRÓN NO ENCONTRÓ NINGUNA VOZ — revisar arriba."}`);
  console.log("Ninguna llamada a textToSpeech() se realizó — cero créditos consumidos.");
  process.exit(allMatched ? 0 : 1);
}

main().catch((err) => {
  console.error("Error verificando voces de ElevenLabs:", err instanceof Error ? err.message : err);
  process.exit(1);
});

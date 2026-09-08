const API_BASE = "https://api.elevenlabs.io/v1";

const apiKey = (): string => {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error("Falta ELEVENLABS_API_KEY en el entorno (agregalo a .env.local, ver .env.local.example)");
  return key;
};

export type Voice = { voice_id: string; name: string };

export const listVoices = async (): Promise<Voice[]> => {
  const res = await fetch(`${API_BASE}/voices`, { headers: { "xi-api-key": apiKey() } });
  if (!res.ok) throw new Error(`ElevenLabs GET /voices falló (${res.status}): ${await res.text()}`);
  const data = (await res.json()) as { voices: Voice[] };
  return data.voices;
};

// Busca por nombre en vez de pedir el voice_id a mano — así el pipeline no
// depende de un ID hardcodeado que puede diferir entre cuentas de ElevenLabs.
export const findVoiceByName = async (pattern: RegExp): Promise<Voice> => {
  const voices = await listVoices();
  const match = voices.find((v) => pattern.test(v.name));
  if (!match) {
    throw new Error(
      `No se encontró ninguna voz que matchee ${pattern} en tu cuenta de ElevenLabs. Voces disponibles: ${voices
        .map((v) => v.name)
        .join(", ")}`
    );
  }
  return match;
};

export type VoiceSettings = {
  stability: number;
  similarity_boost: number;
  style: number;
  use_speaker_boost: boolean;
};

// Valores tomados de D:\MATERIAL VIDEOS\SIN EXPLICACIÓN\005\Prompt de Voz - ElevenLabs.md
// (punto medio de los rangos recomendados ahí).
export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  stability: 0.6,
  similarity_boost: 0.85,
  style: 0.2,
  use_speaker_boost: true,
};

export const DEFAULT_MODEL_ID = "eleven_multilingual_v2";

export type TtsContext = {
  // Texto (no audio) del fragmento anterior/siguiente — ElevenLabs lo usa
  // para que la prosodia no se corte en el límite del fragmento, aunque cada
  // fragmento se siga generando y facturando por separado. No confundir con
  // previous_request_ids (requiere encadenar IDs de respuestas anteriores;
  // más preciso pero depende de un header de respuesta que la documentación
  // pública no confirma con certeza, así que por ahora usamos la variante de
  // texto, que es igual de efectiva y no depende de adivinar ningún header).
  previousText?: string;
  nextText?: string;
};

export const textToSpeech = async (
  voiceId: string,
  text: string,
  settings: VoiceSettings = DEFAULT_VOICE_SETTINGS,
  modelId: string = DEFAULT_MODEL_ID,
  context: TtsContext = {}
): Promise<Buffer> => {
  const res = await fetch(`${API_BASE}/text-to-speech/${voiceId}`, {
    method: "POST",
    headers: { "xi-api-key": apiKey(), "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({
      text,
      model_id: modelId,
      voice_settings: settings,
      ...(context.previousText ? { previous_text: context.previousText } : {}),
      ...(context.nextText ? { next_text: context.nextText } : {}),
    }),
  });
  if (!res.ok) throw new Error(`ElevenLabs TTS falló (${res.status}): ${await res.text()}`);
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
};

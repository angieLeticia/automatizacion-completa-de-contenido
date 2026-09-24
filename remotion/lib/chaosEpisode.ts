// FASE 5.10-AQ (Fase 4 — composiciones de ENCIENDE EL CAOS) — contrato de
// datos para ChaosNewsMain/ChaosNewsClip. Deliberadamente NO es
// `EpisodeConfig` (remotion/lib/episodes.ts) ni depende de él: ese tipo está
// atado al patrón de registro ESTÁTICO por episodio de Root.tsx
// (`{episodes.map(ep => <Composition defaultProps={{episodeId: ep.id}} .../>)}`,
// un objeto `Composition` por episodio YA conocido al momento de compilar
// Root.tsx) — ENCIENDE EL CAOS todavía no tiene ningún episodio real
// registrado (Agente 2 no está conectado, fuera de alcance de esta fase) y
// no debe necesitar uno para poder registrar y validar sus composiciones.
//
// En su lugar, ChaosNewsMain/ChaosNewsClip se registran en Root.tsx UNA sola
// vez cada una, con un id fijo y alfanumérico (sin episode_id embebido, así
// que el namespace de episodios — episodeNamespace.mts — no aplica al ID de
// composición en este diseño; sigue aplicando a cualquier archivo/asset que
// un futuro RenderProvider genere por episodio real, fuera de alcance
// aquí). Los datos completos de un episodio real (o, en esta fase, de un
// fixture sintético) llegan vía `defaultProps`/`calculateMetadata`, con
// `durationInFrames` calculado dinámicamente a partir de esos props — mismo
// mecanismo que remotion/Root.tsx YA usa para cada `Short-{id}-{n}`.
//
// Reutiliza (nunca duplica) los tipos genéricos ya existentes: `Caption`
// (lib/captions.ts), `SourceVideo`/`SourceImage`/`Shot`/`ReelOptions`
// (lib/broll.ts), `ChannelVisualTheme` (theme.ts), `AmbientAudioConfig`
// (lib/musicBed.ts). Solo define lo que es genuinamente nuevo: la
// configuración de los 6 componentes de Fase 3.
import type { ChannelVisualTheme } from "../theme";
import type { AmbientAudioConfig } from "./musicBed";
import type { Caption } from "./captions";
import type { ReelOptions, Shot, SourceImage, SourceVideo } from "./broll";
import type { BreakingTagPosition, BreakingTagVariant } from "../components/BreakingTag";
import type { TwistCardDisplayMode, TwistCardVariant } from "../components/TwistCard";

export type ChaosHookConfig = {
  text: string;
  durationInFrames: number;
  imageSrc?: string;
};

export type ChaosBumperConfig = {
  channelName: string;
  durationInFrames: number;
  logoSrc?: string; // opcional — sin logo real, el bumper funciona solo con texto (ver ChannelBumper.tsx)
};

// Una aparición puntual de BreakingTag, posicionada en el tiempo por quien
// arma los datos del episodio (nunca calculada automáticamente a partir de
// texto real, porque en esta fase no existe ningún texto real).
export type ChaosBreakingTagCue = {
  text: string;
  startFrame: number;
  durationInFrames?: number;
  position?: BreakingTagPosition;
  variant?: BreakingTagVariant;
  color?: string;
  backgroundColor?: string;
};

export type ChaosTwistCue = {
  title: string;
  text?: string;
  startFrame: number;
  durationInFrames: number;
  displayMode?: TwistCardDisplayMode;
  variant?: TwistCardVariant;
};

// Estructura de cierre CONFIGURABLE (pedida explícitamente, "dejar
// preparada una estructura de cierre configurable") — sin ningún CTA/copy
// por defecto. Si se omite en ChaosEpisodeConfig, no se renderiza nada al
// final (nunca se inventa un cierre).
export type ChaosClosingConfig = {
  title: string;
  text?: string;
  durationInFrames: number;
};

export type ChaosWatermarkConfig = {
  imageSrc?: string; // sin logo real, Watermark.tsx cae a su propio default histórico de SIN EXPLICACIÓN — ver nota en ChaosNewsMain.tsx sobre por qué esto NO es aceptable para este canal y cómo se evita
  size?: number;
  opacity?: number;
  margin?: number;
};

export type ChaosEpisodeConfig = {
  theme: ChannelVisualTheme;
  // Colores aprobados que ChannelVisualTheme no representa (ver Fase 2/3,
  // decisión "Opción A") — genérico, nunca acoplado a un nombre de canal.
  extraColors?: Record<string, string>;
  audio?: AmbientAudioConfig; // omitido = sin cama de música/textura (nunca hereda la de SIN EXPLICACIÓN)
  hook: ChaosHookConfig;
  bumper: ChaosBumperConfig;
  breakingTags?: ChaosBreakingTagCue[];
  twists?: ChaosTwistCue[];
  closing?: ChaosClosingConfig;
  captions: Caption[];
  videoPool: SourceVideo[];
  imagePool: SourceImage[];
  reelOptions?: ReelOptions;
  shots?: Shot[]; // línea de tiempo pre-calculada, mismo campo opcional que EpisodeConfig — si se omite, se calcula con buildReel()
  narrationFile?: string; // relativo a public/assets/audio/ — OPCIONAL: sin voz real todavía, puede omitirse (ver ChaosNewsMain.tsx)
  narrationDurationSeconds: number;
  watermark?: ChaosWatermarkConfig;
};

// Config de un clip vertical — subconjunto de un ChaosEpisodeConfig más un
// rango [startFrame, endFrame) dentro de esa misma línea de tiempo, mismo
// principio que ClipMark (lib/clips.ts) ya usa para ShortClip.
export type ChaosClipConfig = Omit<ChaosEpisodeConfig, "hook" | "bumper" | "closing" | "narrationDurationSeconds"> & {
  startFrame: number;
  endFrame: number;
  hookText: string;
  objectPosition?: string;
};

const FPS = 30; // mismo valor global que theme.ts::FPS — evita importar theme.ts (SIN EXPLICACIÓN) desde un archivo puramente de tipos/helpers genérico
const secToFrames = (sec: number) => Math.round(sec * FPS);

// Duración total de ChaosNewsMain: el máximo entre la narración y las
// captions (mismo criterio que mainDurationInFrames de episodes.ts), más el
// hook y el bumper (que anteceden al desarrollo), más el cierre si existe.
export const chaosMainDurationInFrames = (config: ChaosEpisodeConfig): number => {
  const captionsEnd = config.captions.length === 0 ? 0 : Math.max(...config.captions.map((c) => secToFrames(c.end)));
  const developmentFrames = Math.max(secToFrames(config.narrationDurationSeconds), captionsEnd);
  const closingFrames = config.closing?.durationInFrames ?? 0;
  return config.hook.durationInFrames + config.bumper.durationInFrames + developmentFrames + closingFrames;
};

export const chaosClipDurationInFrames = (config: ChaosClipConfig): number => Math.max(config.endFrame - config.startFrame, 1);

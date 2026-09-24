// Fase 4.8 — registro de canales. Espejo LOCAL del diseño ya decidido en
// docs/architecture-unified.md §3/§4 (`content_accounts.channel_status`,
// definido en supabase/schema.sql pero "no aplicado aún en producción", y sin
// credenciales de Supabase disponibles en este worktree para leerlo en vivo).
// La clasificación de cada canal es la misma evidencia real ya documentada en
// docs/operational-status.md — no se inventa ningún estado nuevo acá.
//
// Migrar esto a leer content_accounts real (mismo patrón que
// agent/discoverAccounts.mts, que ya lo hace para Agente 3) es un cambio de
// la IMPLEMENTACIÓN de resolveChannelConfig() — quien la consume (config.mts,
// processOne.mts) no cambia.
export type ChannelStatus = "ACTIVE" | "READY" | "TEST" | "BLOCKED" | "HISTORICAL";

// Fase 4.9 — campos añadidos según la Sección 5 del encargo. Todos opcionales
// y en `undefined` salvo que exista evidencia real ya documentada (Fase 1.2/
// 2.1: SIN EXPLICACIÓN y LUNA VERDE tienen `style` real en content_accounts).
// NO se fabrica ningún valor para los canales que no lo tienen todavía — un
// canal sin `theme`/`language`/`researchPolicy` simplemente no puede pasar
// por buildResearchRequest() (ver researchRequest.mts), con un error
// explícito, no un valor inventado.
export type ChannelStyle = {
  tono?: string;
  temas?: string[];
  hashtagsBase?: string[];
  palabrasProhibidas?: string[];
};

// FASE 5.10-AI — configuración de voz ElevenLabs POR CANAL. Antes de esta
// fase, voiceGenerator.mts tenía un único patrón hardcodeado
// (NARRATOR_VOICE_PATTERN, "kate|velvet.?midnight") usado para CUALQUIER
// canal, sin parámetro — auditado (FASE 5.10-AC/AI) y confirmado: solo SIN
// EXPLICACIÓN tiene una voz real documentada en el proyecto; ENCIENDE EL
// CAOS/LUNA VERDE/OBJETOS MALDITOS no tienen ninguna voz definida en ningún
// archivo, variable de entorno, ni comentario (ver informe de auditoría
// FASE 5.10-AI, Parte A) — así que NO se les asigna ninguna aquí, ni
// siquiera la de SIN EXPLICACIÓN (eso sería "heredar por accidente" la voz
// de otro canal, exactamente lo que esta fase debe evitar). `voice` queda
// `undefined` para los 3 hasta que una persona provea el patrón/nombre real.
export type ChannelVoiceConfig = {
  // Regex contra el nombre de la voz en la cuenta ElevenLabs real (mismo
  // mecanismo que ya usa findVoiceByName() en elevenLabsClient.mts — nunca
  // un voice_id fijo, para no depender de un ID que puede diferir entre
  // cuentas).
  narratorVoicePattern: RegExp;
  // Opcionales — si se omiten, generateNarration() sigue usando
  // DEFAULT_VOICE_SETTINGS/DEFAULT_MODEL_ID de elevenLabsClient.mts (sin
  // cambio de comportamiento para SIN EXPLICACIÓN).
  voiceSettings?: import("./elevenLabsClient.mts").VoiceSettings;
  modelId?: string;
};

// FASE 5.10-AI — igual que `voice`, pero para identidad visual Remotion
// (colores/fuentes/logo/intro/outro). "PENDING" es un marcador EXPLÍCITO
// (nunca `undefined` silencioso) de que el canal todavía no tiene ninguna
// identidad visual real definida — ver remotion/theme.ts (tipo
// ChannelVisualTheme) para el contrato que una futura identidad real debe
// cumplir. Ningún canal recibe la identidad de SIN EXPLICACIÓN por defecto.
export type ChannelVisualIdentityStatus = "PENDING" | "CONFIGURED";

export type ChannelConfig = {
  folderName: string;
  channelStatus: ChannelStatus;
  // null = ningún RenderProvider disponible todavía en este repositorio.
  renderProviderId: string | null;
  notes: string;
  // --- Opcionales, solo con evidencia real (ver notes de cada canal) ---
  timezone?: string;
  language?: string;
  theme?: string;
  style?: ChannelStyle;
  platforms?: readonly string[];
  voice?: ChannelVoiceConfig;
  visualIdentityStatus: ChannelVisualIdentityStatus;
};

const CHANNEL_REGISTRY: Record<string, ChannelConfig> = {
  "SIN EXPLICACIÓN": {
    folderName: "SIN EXPLICACIÓN",
    channelStatus: "ACTIVE",
    renderProviderId: "documentary-remotion",
    notes: "Único canal con composición Remotion propia y pipeline de producción real (Fases 1-4.7).",
    // Evidencia directa y repetida (no inferida): guiones/episodios reales
    // vistos en D:\MATERIAL VIDEOS\SIN EXPLICACIÓN — Roanoke, Faro de Flannan,
    // Mary Celeste, Vuelo 19, Paso Dyatlov, D.B. Cooper, hermanos Sodder,
    // Tamam Shud, Georgia Guidestones, puente Overtoun, manuscrito Voynich,
    // mujer de Isdal. `tono`/`hashtagsBase`/`palabrasProhibidas` reales existen
    // en content_accounts.style (Fase 2.1) pero sus VALORES no son legibles
    // sin credenciales de Supabase en este worktree — no se fabrican acá.
    language: "es",
    theme: "misterios reales sin resolver — desapariciones, casos paranormales e históricos sin explicación oficial",
    // FASE 5.10-AI — patrón EXACTO ya hardcodeado antes en
    // voiceGenerator.mts::NARRATOR_VOICE_PATTERN (movido aquí, mismo valor,
    // cero cambio de comportamiento) — "Kate — Velvet Midnight Narrator",
    // ver Prompt de Voz - ElevenLabs.md citado en voiceGenerator.mts.
    voice: { narratorVoicePattern: /kate|velvet.?midnight/i },
    // theme.ts (remotion/) es la identidad visual real y completa de este canal.
    visualIdentityStatus: "CONFIGURED",
  },
  "OBJETOS MALDITOS": {
    folderName: "OBJETOS MALDITOS",
    // FASE 5.10-AD/AH — corregido de "TEST" a "HISTORICAL": verificado
    // directamente contra Supabase real, channel_status='HISTORICAL' hoy (no
    // 'TEST' como asumía este archivo). Ver test-channel-registry-drift.mts,
    // que falla si este valor vuelve a desincronizarse de Supabase sin que
    // nadie lo note — mismo problema que causó esta corrección.
    channelStatus: "HISTORICAL",
    // FASE 9 — mismo criterio exacto que LUNA VERDE arriba.
    renderProviderId: "objetos-malditos-remotion",
    notes: "content_accounts existe (Fase 1.2) con social_accounts reales (facebook/instagram/youtube, credenciales OK). channel_status real en Supabase es HISTORICAL, no TEST. FASE 9: provider técnico 'objetos-malditos-remotion' registrado (arquitectura documental genérica, identidad placeholder) — canal sigue sin activar operativamente (sin voz/logo/identidad visual real).",
    // Evidencia directa (Fase 5.0, auditoría física real):
    // D:\MATERIAL VIDEOS\OBJETOS MALDITOS\001\Guion - Annabelle.md — Annabelle
    // es un objeto maldito real del folclore de terror. Confirma el nombre del
    // canal, no es una suposición.
    language: "es",
    theme: "objetos malditos — historias reales de objetos con reputación de estar embrujados/maldecidos",
    // Post-Fase 11 — voz real provista por el usuario: renombró la voz en su
    // cuenta de ElevenLabs a exactamente "OBJETOS MALDITOS" para poder
    // identificarla por canal (no se conoce ni se necesita el nombre
    // original). Coincidencia EXACTA y case-insensitive (^...$) — nunca un
    // substring suelto, para no matchear por accidente ninguna otra voz.
    voice: { narratorVoicePattern: /^OBJETOS MALDITOS$/i },
    visualIdentityStatus: "PENDING",
  },
  "LUNA VERDE": {
    folderName: "LUNA VERDE",
    // FASE 5.10-AD/AH — corregido de "TEST" a "HISTORICAL" (ver nota idéntica
    // en OBJETOS MALDITOS arriba).
    channelStatus: "HISTORICAL",
    // FASE 9 — igual que ENCIENDE EL CAOS (Fase 5.10-AR): renderProviderId
    // técnico registrado (lunaVerdeRemotionProvider.mts, arquitectura
    // documental genérica provisional). channelStatus se mantiene
    // EXACTAMENTE en "HISTORICAL" a propósito — esto NO activa el canal
    // (resolveScannableChannels() sigue excluyéndolo, verificado en tests).
    renderProviderId: "luna-verde-remotion",
    notes: "content_accounts existe, style parcialmente poblado (Fase 2.1), social_accounts reales (facebook/instagram/youtube, credenciales OK). channel_status real en Supabase es HISTORICAL, no TEST. FASE 9: provider técnico 'luna-verde-remotion' registrado (arquitectura documental genérica, identidad placeholder) — canal sigue sin activar operativamente (sin voz/logo/identidad visual real).",
    // [SIN CONFIRMAR] Único dato real visto: "Guion - El Bosque de Luna Verde.md"
    // (Fase 5.0) — sugiere temática de naturaleza/atmósfera, pero no alcanza
    // para confirmar "espiritualidad/energía/conexión" (ejemplo ilustrativo del
    // encargo, no evidencia verificada). theme queda sin configurar a propósito.
    // Post-Fase 11 — voz real provista por el usuario (mismo criterio que
    // OBJETOS MALDITOS arriba): voz renombrada en ElevenLabs a exactamente
    // "LUNA VERDE".
    voice: { narratorVoicePattern: /^LUNA VERDE$/i },
    visualIdentityStatus: "PENDING",
  },
  "ENCIENDE EL CAOS": {
    folderName: "ENCIENDE EL CAOS",
    // FASE 5.10-AD/AH — corregido de "BLOCKED" a "HISTORICAL" (ver nota
    // idéntica en OBJETOS MALDITOS arriba). RENDER_PROVIDER=UNKNOWN seguía
    // siendo cierto (sin provider), pero el channelStatus asumido no
    // coincidía con Supabase real tampoco.
    //
    // Cambio explícito autorizado por el usuario para habilitar UNA prueba
    // real controlada de Agent 2 (episodio 009, narración real vía
    // ElevenLabs) — "HISTORICAL" -> "TEST", nunca "ACTIVE". "TEST" desbloquea
    // resolveRenderProvider() (que solo rechaza BLOCKED/HISTORICAL) y hace
    // escaneable el canal, pero NUNCA autoriza publicación real:
    // evaluateChannelAuthorization() (agent/publish/channelAuthorization.mts)
    // trata "TEST" igual que antes — authorizedForRealPublication=false,
    // independientemente de DRY_RUN. Revertir a "HISTORICAL" cuando la
    // prueba termine si no se decide activar el canal de verdad.
    channelStatus: "TEST",
    renderProviderId: "chaos-news-remotion",
    notes: "RENDER_PROVIDER=UNKNOWN (Fase 1.2/2) — sin ningún archivo final renderizado verificado en disco. social_accounts reales existen (facebook/instagram/youtube, credenciales OK, verificado FASE 5.10-AC). channel_status real en Supabase es HISTORICAL, no BLOCKED. FASE 5.10-AR: provider técnico 'chaos-news-remotion' registrado (ChaosNewsMain/ChaosNewsClip) — canal sigue sin activar operativamente (channel_status HISTORICAL, sin voz/logo/watermark reales).",
    // [SIN CONFIRMAR] No se leyó ningún guion/script real de este canal en
    // ninguna fase — solo se vio Audios/+Sonidos/ genéricos (Fase 5.0). "chismes"
    // es el ejemplo ilustrativo del encargo, no evidencia verificada. Sin theme.
    // Post-Fase 11 — voz real provista por el usuario (mismo criterio que
    // OBJETOS MALDITOS/LUNA VERDE arriba): voz renombrada en ElevenLabs a
    // exactamente "ENCIENDE EL CAOS".
    voice: { narratorVoicePattern: /^ENCIENDE EL CAOS$/i },
    visualIdentityStatus: "PENDING",
  },
  "ALZA LA VOZ": {
    folderName: "ALZA LA VOZ",
    channelStatus: "BLOCKED",
    renderProviderId: "quote-video-remotion",
    notes:
      "Fase 5.1: template y datos MIGRADOS a este repositorio (remotion/QuoteVideo.tsx + " +
      "channels/alza-la-voz/videos.ts) desde el repositorio externo (que tenía 0 commits reales, " +
      "todo el código vivía sin respaldo en D:\\MATERIAL VIDEOS\\ALZA LA VOZ\\Alza-la-Voz). " +
      "Provider real, integrado y probado con render exitoso (ver informe de Fase 5.1) — canal " +
      "permanece BLOCKED de todos modos: técnicamente PRODUCTION-READY no implica activación " +
      "automática, requiere decisión humana explícita para pasar a ACTIVE/TEST.",
    // No usa narración (formato de cita/texto, sin voz), y su identidad
    // visual (QuoteVideo.tsx + channels/alza-la-voz/videos.ts) ya es real y
    // parametrizada por video (accentColor, etc. — ver auditoría FASE 5.10-AI
    // Parte B, patrón a imitar para futuros canales).
    visualIdentityStatus: "CONFIGURED",
  },
  ASMR: {
    folderName: "ASMR",
    channelStatus: "BLOCKED",
    renderProviderId: null,
    notes: "Sin archivo final renderizado en ningún episodio (verificado Fase 1.2/2.1).",
    // Evidencia directa (Fase 5.0): carpetas reales Fuego_Chimenea, Agua_y_Cascadas,
    // Lluvia_en_la_Ventana, Nieve_en_Silencio, etc. — contenido ASMR genuino, no supuesto.
    language: "es",
    theme: "ASMR — sonidos ambientales relajantes (fuego, agua, lluvia, naturaleza) sin narración",
    // Sin narración hablada (por diseño del formato) y sin identidad visual
    // Remotion propia todavía.
    visualIdentityStatus: "PENDING",
  },
  PELICULAS: {
    folderName: "PELICULAS",
    channelStatus: "BLOCKED",
    renderProviderId: null,
    notes: "Bloqueo de copyright ya documentado (docs/agente-1-motor.md §5) — no debe automatizarse.",
    visualIdentityStatus: "PENDING",
  },
  MUSICA: {
    folderName: "MUSICA",
    channelStatus: "BLOCKED",
    renderProviderId: null,
    notes: "Bloqueo de copyright ya documentado (docs/agente-1-motor.md §5) — no debe automatizarse.",
    visualIdentityStatus: "PENDING",
  },
  CHISMES: {
    folderName: "CHISMES",
    channelStatus: "HISTORICAL",
    renderProviderId: null,
    notes: "gestionado_por_radar_central=false — exclusión deliberada, gestión manual.",
    visualIdentityStatus: "PENDING",
  },
};

export function resolveChannelConfig(folderName: string): ChannelConfig | null {
  return CHANNEL_REGISTRY[folderName] ?? null;
}

export function listKnownChannels(): ChannelConfig[] {
  return Object.values(CHANNEL_REGISTRY);
}

// Sustituye al array literal ACCOUNTS de config.mts. Un canal es "escaneable"
// hoy solo si su estado permite producción (ACTIVE/READY/TEST, nunca
// BLOCKED/HISTORICAL) Y tiene un render provider real resuelto — hoy resuelve
// exactamente a ["SIN EXPLICACIÓN"] porque es el único canal que cumple
// ambas condiciones, pero es una RESOLUCIÓN real, no un literal fijo: agregar
// un provider nuevo para otro canal alcanza para que empiece a escanearse,
// sin tocar agent.mts/materialScanner.mts.
export function resolveScannableChannels(): string[] {
  return listKnownChannels()
    .filter(
      (c) =>
        (c.channelStatus === "ACTIVE" || c.channelStatus === "READY" || c.channelStatus === "TEST") &&
        c.renderProviderId !== null
    )
    .map((c) => c.folderName);
}

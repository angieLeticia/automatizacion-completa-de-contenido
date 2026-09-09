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
  },
  "OBJETOS MALDITOS": {
    folderName: "OBJETOS MALDITOS",
    channelStatus: "TEST",
    renderProviderId: null,
    notes: "content_accounts existe (Fase 1.2), sin social_accounts ni render provider — no producible todavía.",
    // Evidencia directa (Fase 5.0, auditoría física real):
    // D:\MATERIAL VIDEOS\OBJETOS MALDITOS\001\Guion - Annabelle.md — Annabelle
    // es un objeto maldito real del folclore de terror. Confirma el nombre del
    // canal, no es una suposición.
    language: "es",
    theme: "objetos malditos — historias reales de objetos con reputación de estar embrujados/maldecidos",
  },
  "LUNA VERDE": {
    folderName: "LUNA VERDE",
    channelStatus: "TEST",
    renderProviderId: null,
    notes: "content_accounts existe, style parcialmente poblado (Fase 2.1) — sin render provider.",
    // [SIN CONFIRMAR] Único dato real visto: "Guion - El Bosque de Luna Verde.md"
    // (Fase 5.0) — sugiere temática de naturaleza/atmósfera, pero no alcanza
    // para confirmar "espiritualidad/energía/conexión" (ejemplo ilustrativo del
    // encargo, no evidencia verificada). theme queda sin configurar a propósito.
  },
  "ENCIENDE EL CAOS": {
    folderName: "ENCIENDE EL CAOS",
    channelStatus: "BLOCKED",
    renderProviderId: null,
    notes: "RENDER_PROVIDER=UNKNOWN (Fase 1.2/2) — sin ningún archivo final renderizado verificado en disco.",
    // [SIN CONFIRMAR] No se leyó ningún guion/script real de este canal en
    // ninguna fase — solo se vio Audios/+Sonidos/ genéricos (Fase 5.0). "chismes"
    // es el ejemplo ilustrativo del encargo, no evidencia verificada. Sin theme.
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
  },
  PELICULAS: {
    folderName: "PELICULAS",
    channelStatus: "BLOCKED",
    renderProviderId: null,
    notes: "Bloqueo de copyright ya documentado (docs/agente-1-motor.md §5) — no debe automatizarse.",
  },
  MUSICA: {
    folderName: "MUSICA",
    channelStatus: "BLOCKED",
    renderProviderId: null,
    notes: "Bloqueo de copyright ya documentado (docs/agente-1-motor.md §5) — no debe automatizarse.",
  },
  CHISMES: {
    folderName: "CHISMES",
    channelStatus: "HISTORICAL",
    renderProviderId: null,
    notes: "gestionado_por_radar_central=false — exclusión deliberada, gestión manual.",
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

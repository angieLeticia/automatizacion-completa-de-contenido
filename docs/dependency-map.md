# Mapa de dependencias — Fase 5.1

Quién llama a quién, en qué orden, y en qué etapa se toca disco/red real.
Estados: `IMPLEMENTADO` (código existe y corre), `VERIFICADO` (además probado con evidencia real
en esta Fase 5.1 o anteriores), `PARCIAL`, `LEGACY`, `FUTURO`.

## 1. Flujo principal (canal producible, ej. SIN EXPLICACIÓN)

```
Persona / Agent 1
  -> ResearchRequest (scripts/pipeline/researchRequest.mts)               [VERIFICADO: contrato+tests]
  -> Material crudo en D:\MATERIAL VIDEOS\<canal>\<episodio>\

Ingestion (agent/ingestion/contentProvider.mts)
  -> lee ContentSubmission real
  -> destinationFor() clasifica cada archivo (script/narración/imágenes/sfx)  [VERIFICADO: bug narración corregido F5.1]
  -> materializa ContentPackage en MATERIAL_ROOT/<canal>/<episodio>/

Agent 2 — watcher (scripts/pipeline/agent.mts)
  -> materialScanner.mts detecta episodio nuevo/completo                    [VERIFICADO]
  -> agentLock.mts adquiere lock por episodio                               [VERIFICADO: test concurrencia real]
  -> queue.mts encola processOne

processOne.mts (scripts/pipeline/processOne.mts)
  -> resolveRenderProvider(canal)  [renderProviderRegistry.mts]             [VERIFICADO]
       -> resolveChannelConfig(canal)  [channelRegistry.mts]                [VERIFICADO]
       -> si BLOCKED/HISTORICAL -> ChannelNotProducibleError (nunca produce)
       -> si sin provider -> ChannelProviderNotFoundError
  -> MachineBridge.media (agent/machine/mediaBridge.mts)
       -> probeMedia / extractAudioToWav / detectSilences / concatAudioFiles / transcribe  [VERIFICADO]
       -> ffmpeg / ffprobe / whisper (binarios reales del sistema)          [VERIFICADO]
  -> provider.renderMain() / renderClip()  (ej. documentaryRemotionProvider.mts)  [VERIFICADO]
       -> MachineBridge.render (agent/machine/renderBridge.mts)
            -> assertCompositionExists() contra remotion/lib/episodes.ts (lectura fresca, no cacheada)  [VERIFICADO: bug caché ESM corregido F5.1]
            -> Remotion CLI (renderComposition)                             [VERIFICADO]
  -> qualityChecker.mts (Quality Gate)                                      [VERIFICADO]
       -> ffprobe: existencia/tamaño/streams/duración reales
  -> exportMainVideo / exportClip -> MATERIAL_ROOT (o real, si no hay sandbox)  [VERIFICADO en sandbox F5.1]
  -> registerEpisode() escribe remotion/lib/episodes.ts + data/clips-*.json  [VERIFICADO, revertido tras cada prueba]

Derivados (post-render, mismo proceso)
  -> DerivedContent (scripts/pipeline/derivedContent.mts)                   [VERIFICADO: contrato+tests]
       -> clipMarkToDerivedContent()  (adapta ClipMark ya existente)         [VERIFICADO]
       -> highlightSelector.mts (heurística hook/reveal, independiente de clipSelector.mts)  [VERIFICADO, NO conectado aún al render real]
  -> verticalAsset.mts valida 1080x1920/9:16 vía MachineBridge.media.probe  [VERIFICADO: contrato+tests]

Agent 3 — Flow B (agent/publish/run.mts)
  -> claimPost.mts (claim atómico, evita doble publicación)                 [IMPLEMENTADO, NOT VERIFIED en vivo]
  -> resolveContentFile.mts / resolveIdentity.mts                          [IMPLEMENTADO, NOT VERIFIED en vivo]
  -> PublicationCandidate (agent/publish/publicationCandidate.mts)          [VERIFICADO: contrato+construcción real]
       -> assertPlatformTextsDiffer() (anti copy-paste entre plataformas)
  -> DRY_RUN por defecto -> NO publica de verdad                            [VERIFICADO: DRY_RUN corre sin credenciales]
  -> (si no DRY_RUN) storageBridge.mts -> Supabase Storage -> plataformas   [NOT VERIFIED: sin credenciales en este worktree]
  -> cleanupVideoIfDone() tras publicación exitosa (no-YouTube)             [IMPLEMENTADO F5.0, NOT VERIFIED en vivo]
  -> retryPolicy.mts (fail isolation por plataforma)                       [IMPLEMENTADO, NOT VERIFIED en vivo]
```

## 2. Flujo de canal ALZA LA VOZ (quote-video, migrado F5.1)

```
channels/alza-la-voz/videos.ts (datos reales, 4 videos)
  -> remotion/Root.tsx registra 8 composiciones (4 videos x 2 formatos)     [VERIFICADO: `remotion compositions`]
  -> remotion/QuoteVideo.tsx (template genérico, channelBrand como prop)   [VERIFICADO]

quoteVideoProvider.mts
  -> renderVideo(videoId, format) -> MachineBridge.render.renderComposition [VERIFICADO: render real 74.6MB]
  -> renderMain()/renderClip() -> error explícito (no aplica a este canal)  [VERIFICADO]

renderProviderRegistry.mts registra "quote-video-remotion" -> quoteVideoProvider  [VERIFICADO]
channelRegistry.mts: ALZA LA VOZ.renderProviderId = "quote-video-remotion", channelStatus = BLOCKED  [VERIFICADO — provider real, canal NO promovido]
```

## 3. Agent 1 multicanal (contrato, no motor nuevo)

```
researchRequest.mts
  -> buildResearchRequest(canal) lee channelRegistry.mts
       -> si falta theme/language -> ChannelResearchNotConfiguredError (explícito, no fabricado)
       -> si existe -> {channel, theme, language, style?, constraints}
  -> (futuro) Agent 1 real consume este contrato en vez de config hardcodeada por canal
```
Canales con `theme`/`language` reales hoy: SIN EXPLICACIÓN, OBJETOS MALDITOS, ASMR.
Canales deliberadamente sin configurar (evidencia insuficiente): LUNA VERDE, ENCIENDE EL CAOS.
Canales bloqueados por copyright, nunca configurables así: PELICULAS, MUSICA.

## 4. Puntos de red/disco reales (dónde el sistema sale de su propio proceso)

| Punto | Qué toca | Verificado en este worktree |
|---|---|---|
| `ffmpeg`/`ffprobe`/`whisper` | Procesos hijos locales | Sí |
| Remotion CLI | Proceso hijo local (Node) | Sí |
| Filesystem (`MATERIAL_ROOT`, `INBOX_ROOT`, `public/assets`, `out/`) | Disco local, con `requireSafeMediaPath()` | Sí |
| Supabase (tablas) | Red — Postgres remoto | No (sin credenciales) |
| Supabase Storage | Red — bucket `social-videos` | No (sin credenciales) |
| YouTube/Instagram/Facebook/TikTok APIs | Red — OAuth + upload | No (DRY_RUN siempre en este worktree) |
| Anthropic API (Agent 1 real) | Red | No verificado en esta fase (motor original, fuera del alcance de F5.1) |

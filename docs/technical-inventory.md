# Inventario técnico — Fase 5.1

Estado real del sistema, componente por componente. Categorías usadas: `IMPLEMENTADO`,
`VALIDADO` (implementado + probado con evidencia real), `PARCIAL`, `LEGACY`, `FUTURO`,
`DESCONOCIDO`, `NOT VERIFIED` (requiere algo que este entorno no tiene — credenciales, tiempo).

| Componente | Ubicación | Responsabilidad | Dependencias | Consumidores | Estado |
|---|---|---|---|---|---|
| Agent 1 (motor de investigación) | `_agente/` (fuera de este repo, en D:\), `docs/agente-1-motor.md` | Investiga tema, produce guion+material | Anthropic API, reglas de copyright propias | Material crudo en D:\MATERIAL VIDEOS | `IMPLEMENTADO` (motor original) / `PARCIAL` (contrato multicanal nuevo) |
| `ResearchRequest` | `scripts/pipeline/researchRequest.mts` | Contrato canal→tema→investigación | `channelRegistry.mts` | Agent 1 (futuro, no conectado aún) | `VALIDADO` (contrato + tests reales) |
| `channelRegistry.mts` | `scripts/pipeline/channelRegistry.mts` | Fuente de verdad LOCAL de canal→estado→provider→theme | ninguna (datos estáticos) | `config.mts`, `renderProviderRegistry.mts`, `researchRequest.mts` | `VALIDADO` |
| `renderProviderRegistry.mts` | `scripts/pipeline/renderProviderRegistry.mts` | Resuelve canal→RenderProvider con errores tipados | `channelRegistry.mts`, providers | `processOne.mts` | `VALIDADO` |
| `documentaryRemotionProvider` | `scripts/pipeline/documentaryRemotionProvider.mts` | RenderProvider real: documental largo/clip | `MachineBridge.render` | `renderProviderRegistry.mts` | `VALIDADO` (E2E real, Fase 5.1) |
| `quoteVideoProvider` | `scripts/pipeline/quoteVideoProvider.mts` | RenderProvider real: video de frases/quotes | `MachineBridge.render` | `renderProviderRegistry.mts` | `VALIDADO` (render real probado, Fase 5.1) |
| `remotion/MainDocumentary.tsx` + soporte | `remotion/*.tsx`, `remotion/lib/*` | Template documental largo/clip | Remotion, `remotion/lib/episodes.ts` | `documentaryRemotionProvider` | `VALIDADO` |
| `remotion/QuoteVideo.tsx` | `remotion/QuoteVideo.tsx` | Template genérico de frases con Ken Burns | Remotion, `channels/alza-la-voz/videos.ts` | `quoteVideoProvider` | `VALIDADO` (migrado Fase 5.1, render real probado) |
| `channels/alza-la-voz/videos.ts` | `channels/alza-la-voz/` | Datos de contenido del canal (4 videos reales) | ninguna | `QuoteVideo.tsx`, `Root.tsx`, `quoteVideoProvider.mts` | `VALIDADO` |
| MachineBridge — filesystem/health | `agent/machine/machineBridge.mts` | Acceso seguro a disco + salud de herramientas | pathSafety.mts | Todo Agent 2 | `VALIDADO` |
| MachineBridge — media | `agent/machine/mediaBridge.mts` | probe/silencios/concat/transcribe reales | ffmpeg, ffprobe, whisper | `processOne.mts` | `VALIDADO` (incl. cold-cache real, Fase 5.1) |
| MachineBridge — render | `agent/machine/renderBridge.mts` | Render validado (composición real, output seguro) | Remotion CLI, `episodes.ts`, `channels/*/videos.ts` | RenderProviders | `VALIDADO` |
| MachineBridge — localAI | `agent/machine/types.mts` (solo tipo) | Chat con Ollama local | Ollama HTTP | ninguno todavía | `FUTURO` |
| FFmpeg / FFprobe | binarios del sistema | Probe/render/concat/silencios | — | MachineBridge.media/render | `VALIDADO` |
| Whisper | binario del sistema (PATH) | Transcripción | — | MachineBridge.media | `VALIDADO` |
| Ollama | proceso local HTTP | LLM local (futuro) | — | `localAI` (no implementado) | `FUTURO` |
| Ingestion (`ContentSubmission`→`ContentPackage`) | `agent/ingestion/*` | Materializa un manifest real en `MATERIAL_ROOT` | `scripts/pipeline/materialScanner.mts` (reusado) | Agent 2 (watcher) | `VALIDADO` (E2E real, Fase 5.1) |
| Quality Gate (video largo/clips) | `scripts/pipeline/qualityChecker.mts` | Valida render real (existencia/tamaño/streams/duración) | ffprobe | `processOne.mts` | `VALIDADO` |
| `DerivedContent` | `scripts/pipeline/derivedContent.mts` | Contrato CLIP/HIGHLIGHT/VERTICAL | `clipSelector`/`highlightSelector` | tests, futuro Agent 3 | `VALIDADO` |
| `highlightSelector.mts` | `scripts/pipeline/highlightSelector.mts` | Heurística real de highlights (hook/reveal) | captions reales | tests, diagnóstico Fase 5.0/5.1 | `VALIDADO`, **no integrado al render real de `processOne.mts` todavía** |
| `verticalAsset.mts` | `scripts/pipeline/verticalAsset.mts` | Contrato + validación 1080x1920/9:16 | `MachineBridge.media.probe` | tests | `VALIDADO` |
| Agent 2 — watcher/queue/lock | `scripts/pipeline/{agent,queue,agentLock}.mts` | Orquestación real, sin cambios de arquitectura | chokidar, filesystem | — | `VALIDADO` |
| Agent 2 — `processOne.mts` | `scripts/pipeline/processOne.mts` | Pipeline real de un episodio | MachineBridge, RenderProvider | `agent.mts` | `VALIDADO` (COMPLETED real, Fase 5.1) |
| `PublicationCandidate` | `agent/publish/publicationCandidate.mts` | Contrato metadata multiplataforma | ninguna | Agent 3 (futuro) | `VALIDADO` (contrato + construcción real con contenido real) |
| Agent 3 — Flow B unificado | `agent/publish/{run,claimPost,resolveContentFile,resolveIdentity,channelAuthorization,storageBridge,retryPolicy}.mts` | Publicación real endurecida, DRY_RUN por defecto, autorización por `channel_status` (Fase 5.2.1) | Supabase | — | `IMPLEMENTADO`, `VERIFIED AGAINST REAL SUPABASE` (Fase 5.2.2 — identidad/channel_status/scheduling verificados contra datos reales de `angieLeticia's Project`; ver [phase-5.2-supabase-verification.md](phase-5.2-supabase-verification.md) §5/§10 y [phase-5.2.1-identity-channel-status.md](phase-5.2.1-identity-channel-status.md)) |
| Agent 3 — recuperación de claims (`verification_required`) | `agent/publish/{staleClaimClassification,reconciliation}.mts`, claimPost.mts (`markPublishAttemptStarted`/`persistOperationRef`/`recoverStaleClaims`) | Distingue "publisher nunca se llamó" (retry seguro) de "pudo haberse llamado" (verificación humana/reconciliación, nunca retry automático) | `publisher_operation_ref` (propuesto, no aplicado) | `run.mts::main()` | `IMPLEMENTADO`, lógica pura `VERIFIED` (21 casos sin Supabase, ver [phase-5.4-claim-recovery.md](phase-5.4-claim-recovery.md)); `NOT VERIFIED AGAINST REAL SUPABASE` (requiere la migración de schema, no aplicada); reconciliación real por plataforma `NOT VERIFIED AGAINST REAL PLATFORM` (sin OAuth real) |
| Agent 3 — Flow A (legacy) | `scripts/publish-due-social-posts.mts` | Publicación simple, sin claim atómico | Supabase | — | `LEGACY` (sin funciones que Flow B no cubra ya, desde Fase 5.0) |
| `scheduleOptimization.mts` | `agent/schedule/scheduleOptimization.mts` | Contrato Etapa 2 (métricas→horario) | `post_metrics` (vacía) | ninguno | `FUTURO`, deliberadamente `NOT_IMPLEMENTED` |
| `findNextAvailableWindow` | `agent/schedule/findNextWindow.mts` | Resolución real de horario por canal/plataforma/día | `posting_schedule_rules` (Supabase) | `scheduleContent.mts` | `IMPLEMENTADO`, `NOT VERIFIED` en vivo aquí |
| Supabase (schema) | `supabase/schema.sql` | Definición de tablas | — | todo Agent 3, parte de Agent 2 (ninguna) | `VERIFIED AGAINST REAL SUPABASE` (Fase 5.2.2 — las 8 tablas del contrato confirmadas contra `angieLeticia's Project` [`xbwbwzehnbofargskxyb`]; `content_accounts.channel_status` aplicado y verificado vía `pg_constraint`; `content_files.file_hash` UNIQUE y `social_posts(content_file_id,account_id)` UNIQUE PARTIAL INDEX ambos confirmados vía `pg_indexes` real) |
| Storage (Supabase bucket `social-videos`) | `agent/publish/storageBridge.mts` | Upload idempotente + cleanup | Supabase Storage | Agent 3 | `IMPLEMENTADO`, `NOT VERIFIED` en vivo |
| `storageMapping.mts` | `scripts/pipeline/storageMapping.mts` | Mapping lógico de rutas (documental) | — | documentación | `IMPLEMENTADO` (diseño, sin migración física) |

## Repositorios externos (Sección 1-6 de Fase 5.1)

| Repositorio | Estado en GitHub | Código real | Decisión |
|---|---|---|---|
| `angieLeticia/Alza-la-Voz` | Vacío (`git ls-remote` = 0 refs, reconfirmado Fase 5.2) | Sí, local en D:\, 0 commits reales | **Migrado** a este repo (`remotion/QuoteVideo.tsx` + `channels/alza-la-voz/`). `EXTERNAL_REPO_RETIREMENT_PENDING_HUMAN_ACTION` — sin `gh` CLI ni token de GitHub en este entorno, el borrado del repositorio vacío en GitHub debe hacerlo una persona (Settings → Danger Zone → Delete this repository) |
| PELICULAS | No existe evidencia | No existe `.git` ni `package.json` bajo `D:\MATERIAL VIDEOS\PELICULAS` | Ninguna acción — no hay repositorio que migrar ni eliminar |
| MUSICA | No existe evidencia | No existe `.git` ni `package.json` bajo `D:\MATERIAL VIDEOS\MUSICA` | Ninguna acción — no hay repositorio que migrar ni eliminar |

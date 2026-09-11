# Fase 5.13 — Auditoría integral final de Agent 3

> Fotografía objetiva del estado real, no una lista de aspiraciones. Ningún
> código nuevo, ninguna migración, ninguna publicación real en esta fase.

## Matriz de madurez

| COMPONENTE | ESTADO | EVIDENCIA | BLOQUEADOR | ACCIÓN NECESARIA |
|---|---|---|---|---|
| Identity (channel↔account) | 🟢 IMPLEMENTADO Y VERIFICADO | `resolveIdentity.mts` (Fase 5.2.1/5.4.2), `channel_id !== account.channel_id` bloquea explícito, `VERIFIED AGAINST REAL SUPABASE` | — | Ninguna |
| Authorization (`channel_status`/DRY_RUN) | 🟢 IMPLEMENTADO Y VERIFICADO | 8/8 `publish-authorization:test`, confirmado independiente entre sí (Fase 5.7) | — | Ninguna |
| Claim atómico | 🟢 IMPLEMENTADO Y VERIFICADO | `claimPost.mts`, `VERIFIED AGAINST REAL SUPABASE` (Fase 5.3, concurrencia real) | — | Ninguna |
| Recovery (`recoverStaleClaims`) | 🟢 IMPLEMENTADO Y VERIFICADO | `VERIFIED AGAINST REAL SUPABASE` en vivo (Fase 5.6), activo de forma persistente (Fase 5.8) | — | Ninguna |
| Uncertain outcome | 🟢 IMPLEMENTADO Y VERIFICADO | `PublicationOutcomeUncertainError`, 24/24 `uncertain-outcome:test`, 3 gaps encontrados y corregidos (Fase 5.4.1/5.4.3) | — | Ninguna |
| Reconciliation (lógica) | 🟢 IMPLEMENTADO Y VERIFICADO (con test) | 20/20 `reconciliation:test`, endurecido Fase 5.10 | — | Ninguna |
| Reconciliation (API real) | 🟡 IMPLEMENTADO PERO NO VERIFICADO REALMENTE | Sin OAuth real disponible | Credenciales OAuth reales | Obtenerlas y probar cuando se autorice |
| Scheduling | 🟢 IMPLEMENTADO Y VERIFICADO | `findNextAvailableWindow`, `posting_schedule_rules` como única fuente, `VERIFIED AGAINST REAL SUPABASE` (Fase 5.2.2) | — | Ninguna |
| Human review (aprobación por post) | ⚪ NO IMPLEMENTADO | `publication_authorized_at`/`publication_authorized_by` existen en `schema.sql:165-166` pero **cero referencias en código** (`grep` confirmado) — es un requisito documentado (`system-contracts.md §4`), nunca construido | Decisión de producto (§ abajo) | Diseñar e implementar el gate si se quiere ese flujo granular |
| Metadata (generación) | 🟢 IMPLEMENTADO Y VERIFICADO | `generateMetadata.mts`, `assertPlatformTextsDiffer` probado (Fase 4.9) | — | Ninguna |
| Metadata (llega al publisher) | 🟢 IMPLEMENTADO Y VERIFICADO | `PublicationCandidate`→`social_posts`→`postForPublisher` en `run.mts`, sin transformación perdida | — | Ninguna |
| YouTube | 🟡 IMPLEMENTADO PERO NO VERIFICADO REALMENTE | Ver matriz por plataforma | OAuth real | — |
| Instagram | 🟡 IMPLEMENTADO PERO NO VERIFICADO REALMENTE | Ver matriz por plataforma | OAuth real | — |
| Facebook | 🔴 BLOQUEADO (para reconciliación) | Fase 5.11 — sin operation_ref previo posible con el método actual | Decisión técnica: migrar a subida por fases | Ver §17 |
| TikTok | ⚪ NO IMPLEMENTADO (arquitectura 🟡 compatible) | Fase 5.12 — publisher no existe, protocolo compatible | Aprobación/auditoría de TikTok | Ver §17 |
| Supabase (schema) | 🟢 IMPLEMENTADO Y VERIFICADO | Migración Fase 5.5 aplicada y verificada; 4/4 posts y 3/3 accounts intactos hoy | — | Ninguna |
| Observability (logs) | 🟢 IMPLEMENTADO Y VERIFICADO | `agent/logger.mts` — consola + archivo (`agent/logs/`), usado en todos los checkpoints | — | Ninguna |
| Flow A (legacy) | 🔴 RETIRADO (deliberado) | Fase 5.4.3 — `.yml.retired`, sin ejecución automática, script conservado | — | Ninguna (decisión ya tomada) |
| Flow B (motor unificado) | 🟢 IMPLEMENTADO Y VERIFICADO | Único flujo autorizado desde Fase 5.4.3 | — | Ninguna |
| Security (grep exhaustivo) | 🟢 VERIFICADO | Ver §9 — sin secretos en logs, sin bypass de DRY_RUN/channel_status encontrado | — | Ninguna |
| Tests | 🟢 VERIFICADO | 83/83 (Agent 3) + suites de Agent 1/2 en verde — ver §11 | — | Ninguna |

## 1. Pipeline completo — transición por transición

```
social_posts(pending) --claimPost()[atómico]--> publishing
  --resolveAndVerifyContentFile()--> [archivo local válido]
  --resolveAndValidateIdentity()--> [channel_id coincide + channel_status autoriza]
  --DRY_RUN check--> [si DRY_RUN o no autorizado: revertToPending(), FIN]
  --markPublishAttemptStarted()[checkpoint]--> publisher_operation_ref='pending:<platform>'
  --publish()--> [llamada real a la plataforma]
  --onOperationRef()--> publisher_operation_ref=<ref real> (solo YouTube/Instagram)
  --resultado:
      éxito + persistido -> published
      éxito + PublicationOutcomeUncertainError -> verification_required (preserva operation_ref)
      fallo normal -> pending (retry) | error (agotado/permanente)
  --recoverStaleClaims() [si el proceso murió]:
      operation_ref=NULL -> pending (retry)
      operation_ref≠NULL -> verification_required
  --reconcileUnknownPublication() [MANUAL, nunca automático]:
      CONFIRMED_PUBLISHED/CONFIRMED_NOT_PUBLISHED/CANNOT_VERIFY -> sin acción automática en Supabase
```

**Cada flecha de este diagrama está implementada en código real** (no es aspiracional) — la única pieza sin conectar a ningún llamador es `reconcileUnknownPublication()`, deliberadamente (Fase 5.4: decisión de diseño, no un olvido).

## 2. Matriz por plataforma

| | Publisher | Identity | Credentials | Metadata | Scheduling | Claim | Operation ref | Checkpoint | Uncertain outcome | Reconciliation | Recovery | Tests | API real | Bloqueadores externos | Production readiness |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **YouTube** | 🟢 | 🟢 | 🟢 (campos definidos) | 🟢 | 🟢 | 🟢 | 🟢 (`uploadUrl`) | 🟢 | 🟢 | 🟢 (lógica) / 🟡 (API real) | 🟢 | 🟢 | 🟡 | Ninguno de código — solo cuenta/OAuth real | 🟡 — falta verificación real |
| **Instagram** | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 (`creationId`) | 🟢 | 🟢 | 🟢 (lógica) / 🟡 (API real) | 🟢 | 🟢 | 🟡 | Ninguno de código — solo cuenta/OAuth real | 🟡 — falta verificación real |
| **Facebook** | 🟠 (una sola llamada, sin fase intermedia) | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | 🔴 (no existe) | 🟢 (placeholder universal, no una ref real) | 🟠 (parcial — cubre parseo, no cubre fallo de red pre-respuesta) | 🔴 | 🟢 (genérico, pero sin nada real que reconciliar) | 🟢 | ⚪ | Decisión técnica (migrar protocolo) | 🔴 — bloqueado para paridad de seguridad |
| **TikTok** | ⚪ | 🟢 (mecanismo genérico ya protege) | ⚪ | 🟢 (Agent 1/2 ya genera) | ⚪ (bloqueado por falta de publisher) | 🟢 (genérico, funcionaría sin cambios) | ⚪ (`publish_id`, diseñado no implementado) | ⚪ | ⚪ | ⚪ | 🟢 (genérico) | ⚪ | ⚪ | Aprobación/auditoría de TikTok + dominio verificado | ⚪ — no implementado |

**"No considerar código como verificado"** — respetado explícitamente: YouTube/Instagram están en 🟡 (no 🟢) en la columna API real precisamente por esto.

## 3. Identidad

Cadena verificada: `content_file → content_account (channel_id) → social_account (channel_id, platform)`. **Imposible publicar Canal A → cuenta de Canal B** — confirmado en 2 lugares independientes: `agent/publish/resolveIdentity.mts` (chequeo explícito `channel_id !== account.channel_id`, Fase 5.2.1) y `agent/schedule/resolveIdentity.mts` (filtra `social_accounts` por `channel_id` antes de crear la fila, nunca llega a crearse una fila cruzada). **TikTok no necesita cambios de esquema** — `schema.sql:33` ya incluye `'tiktok'` en el `CHECK` de `platform` desde el diseño original. **Facebook no necesita cambios de esquema** para identidad (el problema de Facebook es de reconciliación, no de identidad).

## 4. Scheduling

Reglas: `posting_schedule_rules` (Supabase), sin horarios hardcodeados. `findNextAvailableWindow()` calcula la ventana respetando `max_posts_per_day` y huso horario por cuenta. Duplicación evitada en 2 niveles: conteo previo (defensa suave, con ventana de carrera teórica) + `social_posts_content_file_account_idx` UNIQUE PARTIAL INDEX (defensa real, a nivel de Postgres, `VERIFIED AGAINST REAL SUPABASE` desde Fase 5.2.2) — el índice es lo que realmente importa: dos scheduler runs concurrentes NUNCA pueden crear 2 filas para el mismo `(content_file_id, account_id)`, aunque ambos "ganen" la carrera del conteo. Interacción con claim: ninguna directa — scheduling solo crea la fila en `pending`; el claim (`claimPost.mts`) es un paso completamente posterior e independiente. **Cron/worker activo:** Flow A retirado (confirmado, Fase 5.4.3/5.4.4). Windows Task Scheduler local: **NO VERIFICABLE desde esta sesión** (`schtasks /query` no devolvió ninguna tarea — resultado inconcluso, no una confirmación de ausencia; es el mismo estado "DESCONOCIDO" documentado desde Fase 1.2, nunca resuelto). **Flow B es el único flujo de publicación con código de producción activo conocido.**

## 5. Human review

**Requisito documentado** (`docs/system-contracts.md §4`, `docs/content-ingestion.md`): material → edición → quality gate → revisión humana → approve/edit/cancel → scheduling → publication. **Lo que existe realmente:**
- Quality gate: 🟢 implementado (`scripts/pipeline/qualityChecker.mts`, `VALIDADO`).
- Revisión humana granular (aprobar/editar/cancelar por post): ⚪ **no implementada** — las columnas `publication_authorized_at`/`publication_authorized_by` existen en el schema pero ningún código las lee ni las escribe.
- Lo que SÍ actúa como gate humano hoy, de forma más gruesa: `channel_status` (decisión manual de promover TEST→ACTIVE) y `DRY_RUN` (flag manual) — ambos a nivel de CANAL/GLOBAL, no a nivel de POST individual.

**Esto es una brecha real entre el requisito documentado y el código**, no una contradicción oculta — ya estaba anotado en `database-contract.md:220` ("`publication_authorized_at` no fue verificado en esta fase").

## 6. Metadata

`PublicationCandidate`/`PlatformMetadata` (Fase 4.9) llegan a `social_posts.title`/`caption`/`hashtags` vía `scheduleContent.mts`, y de ahí a `postForPublisher` en `run.mts` sin transformación adicional — confirmado por lectura directa, cada publisher usa `post.title`/`post.caption`/`post.hashtags` tal cual. `assertPlatformTextsDiffer()` garantiza que dos plataformas del mismo contenido nunca comparten texto literal (probado). TikTok tiene límites de texto ya definidos pero le falta el campo `privacy_level` en el contrato (Fase 5.12, no implementado).

## 7. Idempotencia

| Nivel | Mecanismo | Protege contra duplicación... |
|---|---|---|
| Generación | `content_files.file_hash` UNIQUE | interna (mismo archivo registrado dos veces) |
| Scheduling | `social_posts_content_file_account_idx` UNIQUE PARTIAL INDEX | interna (misma fila programada dos veces) |
| Claim | `UPDATE ... WHERE status='pending'` atómico | interna (dos workers reclamando la misma fila) |
| Recovery | `publisher_operation_ref` (NULL vs no-nulo) | interna (decide si es seguro reintentar) — **no** protege la llamada externa en sí |
| Resultado incierto | `PublicationOutcomeUncertainError` → `verification_required` | interna (nunca reintenta automáticamente algo incierto) |
| **Externa (la plataforma en sí)** | **Ninguno propio** — depende de si YouTube/Instagram/Facebook/TikTok deduplican por su cuenta | — |

Explícitamente: ninguna UNIQUE de Supabase hace idempotente una llamada HTTP a una API externa — eso solo se logra NO reintentando automáticamente ante incertidumbre, que es exactamente la política ya implementada.

## 8. Estados — máquina real

Confirmada sin cambios desde Fase 5.9: `pending → publishing → {published | error | verification_required}`; recovery: stale+ref→`verification_required`, stale sin ref→`pending`. **Grep repetido en esta fase**: cero transiciones automáticas `verification_required → pending/publishing`.

## 9. Seguridad (grep exhaustivo, esta fase)

- Llamadas `fetch()` a APIs externas: únicamente en los 3 publishers + `reconciliation.mts` + `storageBridge.mts` (un `HEAD` de verificación, no publica nada) + clientes de Agent 1/2 (ElevenLabs/Ollama/Anthropic, sin relación con publicación) + `get-youtube-refresh-token.mts` (script manual de setup único, fuera del flujo automático). **Ninguna llamada oculta a una API de publicación fuera de `lib/social/publishers.ts`.**
- Secretos en logs: `agent/logger.mts` nunca recibe objetos de credenciales completos en los call-sites auditados (se pasan IDs/labels/mensajes, no `credentials`/`access_token`).
- Bypass de `DRY_RUN`/`channel_status`: ninguno encontrado — ambos se evalúan en el mismo punto (`run.mts:87`), antes de cualquier código que dependa de plataforma.
- Cron activo: Flow A retirado y confirmado (Fase 5.4.3/5.4.4/5.9); Windows Task Scheduler **no verificable** desde este entorno (ver §4).
- Scripts que puedan publicar fuera de Flow B: `scripts/publish-due-social-posts.mts` (Flow A) sigue existiendo pero sin disparador automático — solo ejecutable manualmente por un humano con `npm run social:publish`.

## 10. Supabase (solo lectura, esta fase)

4/4 `social_posts` reales: `pending`/`retry_count=0`/resto `null`. 3/3 `content_accounts`: `HISTORICAL`. Cero escrituras.

## 11. Tests

`tsc --noEmit` limpio. Suite Agent 3 — **83/83**: `uncertain-outcome` 24, `claim-recovery` 18, `publish-authorization` 8, `gap-closure-5.4.3` 13, `reconciliation` 20. Suite Agent 1/2 (no Agent 3, pero parte de la regresión "segura" solicitada) — todas 🟢: `ingestion` 12, `machine`, `provider` 13, `derived-content` 13.

## 12. Documentación — contradicciones detectadas

- `docs/database-contract.md`/`docs/phase-5.2-supabase-verification.md` describen `CLAIMED_AT_MIGRATION_APPLIED=false`/`claimed_at` no usado — **correctos para su fecha** (Fase 5.2/5.2.2), **no se reescriben** (informes históricos, ya resuelto así desde Fase 5.9 §8).
- Ninguna contradicción NUEVA encontrada en esta fase — las correcciones de estado ("NOT VERIFIED"→"VERIFIED") ya se aplicaron en Fase 5.9 (`technical-inventory.md`, `schema.sql`).
- **Brecha documentada pero no marcada como bug**: `publication_authorized_at` (§5 arriba) — el diseño lo documenta como requisito, el código nunca lo construyó; esto ya estaba anotado honestamente en `database-contract.md`, no es una afirmación falsa de "implementado".

## 13-16. (integradas arriba: matriz, pipeline, identity, authorization ya cubiertos)

## 17. Decisiones separadas por tipo

**Facebook:**
- TÉCNICO → migrar el publisher al protocolo de subida por fases de Meta (único camino real a un operation_ref previo).
- PRODUCTO → decidir si vale la pena esa migración vs. aceptar el riesgo residual documentado permanentemente.
- EXTERNO → ninguna dependencia nueva de Meta más allá de lo ya usado (el protocolo por fases ya es parte de la Graph API pública).
- OAUTH → sigue usando la misma cuenta/token ya en uso, sin cambios de permisos conocidos.
- IMPLEMENTACIÓN → posterior a la decisión de producto.

**TikTok:**
- TÉCNICO → publisher basado en `publish_id` (patrón ya usado 2 veces, réplica de Instagram).
- PRODUCTO → decidir si se invierte tiempo/proceso en solicitar la aprobación de TikTok antes de tener código.
- EXTERNO → aprobación/auditoría de la app de TikTok; verificación de dominio si se usa `PULL_FROM_URL`.
- OAUTH → cuenta de TikTok real, credenciales nuevas.
- IMPLEMENTACIÓN → posterior a resolver EXTERNO.

**Human review (§5):**
- TÉCNICO → diseñar el gate de `publication_authorized_at` (columna ya existe).
- PRODUCTO → decidir si el nivel de granularidad actual (`channel_status`+`DRY_RUN`, por canal/global) es suficiente para el lanzamiento, o si se requiere aprobación por post individual antes de la primera publicación real.
- EXTERNO → ninguno.
- OAUTH → ninguno.
- IMPLEMENTACIÓN → pendiente de la decisión de producto.

## 18. Trabajo necesario antes de la primera publicación real (con al menos 1 cuenta)

1. Decisión de producto: ¿se requiere el gate de `publication_authorized_at` por post, o basta `channel_status`+`DRY_RUN`?
2. Obtener credenciales OAuth reales de al menos una cuenta (YouTube o Instagram, las únicas con reconciliación real posible) y verificar `reconcileYouTube()`/`reconcileInstagram()` contra la API real.
3. Promover explícitamente el `channel_status` de esa cuenta a `ACTIVE` (decisión humana, ya con el mecanismo probado).
4. Cambiar `DRY_RUN=false` (única vez, con autorización explícita, después de 1-3).

## 19. Trabajo que NO es necesario

- Ninguna migración adicional de esquema (identity/claim/recovery ya completas).
- Ningún cambio en `claimPost.mts`/`run.mts`/`resolveIdentity.mts` — el pipeline central está terminado.
- Ninguna corrección de código pendiente en YouTube/Instagram — solo verificación externa.
- No implementar Facebook/TikTok para la primera publicación real — pueden quedar fuera del lanzamiento inicial sin bloquear a YouTube/Instagram.

## 20. Orden recomendado de las siguientes fases

1. Decisión de producto sobre `publication_authorized_at` (§17).
2. Obtención de credenciales OAuth reales (1 cuenta, YouTube o Instagram).
3. Verificación de `reconcileYouTube()`/`reconcileInstagram()` contra API real (fase de auditoría, no de implementación).
4. Activación controlada: `channel_status=ACTIVE` + `DRY_RUN=false` para esa única cuenta, con autorización explícita y plan de rollback.
5. Solo después de una publicación real exitosa y verificada: decidir sobre Facebook (migración vs. aceptar riesgo) y TikTok (solicitar aprobación).

```
git status --short / git diff --check / HEAD → ver reporte final.
```

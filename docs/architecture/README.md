# Documentación visual de arquitectura

> **Última auditoría:** 2026-09-12
> **Commit base:** `e1dca94ac357e7abc66c35ed6cad8f6030b3d6d7` (rama `agents-main` / `agents-origin/main`)
> **Alcance:** exclusivamente `automatizacion-completa-de-contenido`. Visteapy (`visteapy-web.git`) es un proyecto independiente y no aparece en ningún diagrama de esta carpeta.

Estos 15 diagramas se generaron a partir de una auditoría real del código, los contratos TypeScript, `supabase/schema.sql`, `docs/database-contract.md`, `docs/technical-inventory.md` y el registro de canales (`scripts/pipeline/channelRegistry.mts`) — no son una arquitectura idealizada. Cada componente está clasificado según evidencia real, con la misma leyenda de colores en los 15 archivos.

## Cómo abrirlos

1. Ve a [app.diagrams.net](https://app.diagrams.net) (o abre la app de escritorio Draw.io).
2. **Archivo → Abrir de...** → selecciona el `.drawio` correspondiente de esta carpeta.
3. Todos son archivos XML estándar de diagrams.net — no requieren ningún plugin.

## Diagrama principal

**`01-arquitectura-general.drawio`** — punto de entrada recomendado. Muestra el sistema completo de extremo a extremo y remite a cada diagrama especializado para el detalle.

## Índice de diagramas

| # | Archivo | Qué muestra |
|---|---|---|
| 01 | `01-arquitectura-general.drawio` | Sistema completo: Persona → Agent 1 → Ingestión → Validación → Agent 2 → Render → Quality Gate → Agent 3 → Plataformas, con Local PC / Supabase / GitHub / APIs externas diferenciados |
| 02 | `02-agent-1-investigacion-ingestion.drawio` | Motor de investigación (histórico, fuera del repo) + contrato multicanal (`ResearchRequest`, `ChannelRegistry`) + ingestión real (`ContentSubmission` → `ContentPackage` → `MATERIAL_ROOT`) |
| 03 | `03-agent-2-produccion.drawio` | Scanner → completeness → autorización humana → queue/lock → `processOne.mts` → render providers → MachineBridge → Quality Gate → DerivedContent (clips/highlights/vertical) → estados `COMPLETED`/`ERROR`/`HELD` |
| 04 | `04-machinebridge.drawio` | Los 5 módulos de MachineBridge (`filesystem`, `health`, `media`, `render`, `localAI`) con sus operaciones reales nombradas — explícitamente **no** es un shell executor |
| 05 | `05-agent-3-publicacion.drawio` | Cadena completa de `processPost()`: target selection (`POST_ID`) → claim → hash → identidad → gates → publisher → plataforma externa → persistencia → reconciliación |
| 06 | `06-seguridad-y-gates.drawio` | Las 12 barreras de seguridad antes de publicar, con su nivel real de evidencia (probado vs. solo cubierto por tests) |
| 07 | `07-modelo-datos-supabase.drawio` | ER real de las 9 tablas del proyecto y sus relaciones |
| 08 | `08-maquina-estados.drawio` | 4 máquinas de estado **distintas** (producción/episodio, archivo, metadata, publicación) — nunca mezcladas |
| 09 | `09-identidad-y-aislamiento.drawio` | Cómo `D:\MATERIAL VIDEOS\<canal>` se traduce en una identidad única hasta la plataforma externa, y el gate MISMATCH que ya detectó un incidente real |
| 10 | `10-plataformas-publicacion.drawio` | Comparativa YouTube / Instagram / Facebook / TikTok por capacidad real |
| 11 | `11-piloto-publicacion.drawio` | El procedimiento real ejecutado en el primer piloto de YouTube (Fase 5.20), paso a paso |
| 12 | `12-almacenamiento.drawio` | Qué vive en Local PC, qué en Supabase y qué en GitHub — multimedia vs. metadata |
| 13 | `13-credenciales.drawio` | OAuth → tokens → entorno seguro → credential resolver → publisher, y la separación CREDENTIAL / ACCOUNT IDENTITY / CHANNEL IDENTITY / CONTENT IDENTITY |
| 14 | `14-actual-vs-futuro.drawio` | Comparativa de 3 columnas: actual / siguiente fase / futuro |
| 15 | `15-roadmap.drawio` | Vista de roadmap sin fechas: completado → siguiente → después → futuro |

`autonomous-content-system.drawio` (preexistente, Fase 5.1, 2026-09-09) queda **sin modificar** — es un diagrama histórico de una fase muy anterior (antes de Human Review, identidad real de YouTube, el piloto real y Phase A/B) y ya no refleja el estado actual. Se conserva por trazabilidad, no se referencia desde el resto del set.

## Leyenda de estado (consistente en los 15 diagramas)

| Símbolo | Significado |
|---|---|
| 🟢 | IMPLEMENTADO Y PROBADO (evidencia real de ejecución) |
| 🔵 | IMPLEMENTADO (código real, sin evidencia de ejecución real citada en este diagrama) |
| 🟡 | IMPLEMENTADO PERO NO PROBADO EN PRODUCCIÓN (solo tests/mocks) |
| 🟠 | PLANIFICADO (contrato/diseño existe, sin implementación) |
| 🔴 | BLOQUEADO (por decisión humana o por un factor externo) |
| ⚫ | RETIRADO / LEGACY |

Forma del nodo: **rombo** = gate/decisión de seguridad · **óvalo** = acción humana · **rectángulo punteado con título** = agrupador (Local PC / Supabase / GitHub / APIs externas / conjunto de componentes).

## Qué está implementado (resumen)

- Ingestión, validación y el pipeline de producción de **SIN EXPLICACIÓN** (único canal con render provider real integrado y probado end-to-end).
- MachineBridge: `filesystem`, `health`, `media`, `render` — todos con evidencia real de ejecución.
- Agent 3 (Flow B): claim atómico, verificación de hash, identidad de cuenta, `channel_status`, Human Review, `DRY_RUN`, retry policy explícita, `POST_ID` con gate de `scheduled_at` — todo verificado contra Supabase real.
- **YouTube**: OAuth real, identidad de canal verificada contra la API real, upload real, privacidad fail-safe, hashtags → tags, y un **piloto real publicado y verificado** (`videoId PawU4OS5lbk`, privado, canal `UCHtU7U5zZ1gndN5o-C2eeFQ`).

## Qué está pendiente

- Identidad externa real para Instagram y Facebook (hoy solo hay consistencia interna de Supabase, nunca verificación contra la cuenta real de Meta).
- Piloto real controlado de Instagram y de Facebook.
- Reconciliación real de Facebook: estructuralmente imposible con el método de subida actual (decisión técnica documentada en `lib/social/facebook.ts`, Fase 5.20 Phase A3).
- TikTok: sin publisher, bloqueado por aprobación externa de la app en TikTok Developer Portal (no es un bloqueador de código).
- Un runner real de reconciliación (hoy `reconciliation.mts` es una librería sin CLI/cron que la invoque).
- ALZA LA VOZ: render provider real e integrado, canal permanece `BLOCKED` por decisión humana pendiente (no técnica).
- Operación semiautomática y automática: ninguna de las dos tiene fecha ni implementación — dependen de que Instagram/Facebook cierren su brecha de identidad primero.

## Notas de fidelidad

- Ningún componente se dibujó como "funcionando" sin evidencia — donde el código o los tests no lo confirman, el nodo queda en 🟡/🟠/🔴 explícitamente.
- Los nombres de tablas, estados, agentes y canales son **exactamente** los que usa el código real — se mantienen idénticos en los 15 diagramas.
- No se incluye ningún valor de credencial, token o secreto en ningún diagrama.

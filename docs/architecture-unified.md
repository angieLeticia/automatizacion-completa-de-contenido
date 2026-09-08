# Arquitectura unificada — Fase 2

> Complementa `docs/system-contracts.md` (contratos/eventos/estados), `docs/content-ingestion.md`
> (Inbox/Ingesta/ContentSubmission — el nuevo punto de entrada), `docs/storage-strategy.md`
> (dónde vive el material) y `docs/agente-1-motor.md` + `docs/database-contract.md` +
> `docs/operational-status.md` (evidencia de las Fases 0-1.2). Todo lo aquí descrito es DISEÑO —
> nada de esto se implementa en esta fase.
>
> **[ACTUALIZADO — cambio metodológico]** La versión anterior de este documento asumía que
> Agente 1 (investigación web autónoma) era la entrada primaria del sistema. Ya no lo es: la
> entrada primaria es una **persona que busca y entrega material a través de una Inbox**. El
> diagrama, la estructura de GitHub y la sección de storage de abajo quedan actualizados; el
> resto (orquestador, modelo multicanal, seguridad, despliegue, costos) no cambia en su lógica,
> solo en qué componente ocupa el primer lugar del flujo.

## 1. Orquestador — función delgada, no proceso ni mega-script

> **[ACTUALIZADO — Fase 2.1, aprobado]** Se descarta el orquestador como proceso independiente
> y la tabla `episodes` separada. Reemplazado por lo siguiente, ya adoptado como decisión oficial:

**[DECISIÓN]** `recalculateEpisodeStatus(channel, episodeId)` — una **función**, no un servicio
corriendo en background. Cada agente la invoca al terminar su propio paso (Agente 2 al final de
`processProject()`, el motor único de Agente 3 al resolver una publicación, etc.). La función:

1. Lee el estado existente relevante: `content_files` (con `episode_id`, ver contratos §1) +
   `content_metadata` + `social_posts` asociados + `episode_log`.
2. Escribe una fila en `episode_log` (insert-only) con el resultado del paso.
3. Recalcula y devuelve el estado agregado del episodio (§9) — no lo persiste en una tabla
   `episodes` nueva (no existe); el estado agregado se **deriva**, no se **almacena**, salvo la
   bitácora misma.
4. No ejecuta lógica de ningún agente — solo lee lo que otros ya escribieron y agrega.

**[DECISIÓN]** Sin infraestructura nueva (sin Kafka/Redis/colas externas, sin servidor HTTP, sin
proceso con su propia tarea programada). Se promueve a proceso independiente con polling **solo
si** la evidencia futura demuestra que invocar la función al final de cada paso es insuficiente
(ej. si algo necesita reaccionar sin que ningún agente lo dispare) — no antes, y no por
anticipación.

## 2. Diagrama de arquitectura propuesta

```
      PERSONA                    (opcional, por canal)
   busca y selecciona          AGENTE DE INVESTIGACIÓN
      material                  (docs/agente-1-motor.md,
        │                        mismo contrato de salida)
        │                              │
        └───────────┬──────────────────┘
                     ▼
            ┌─────────────────┐
            │      INBOX       │   ContentSubmission (docs/content-ingestion.md)
            └────────┬─────────┘
                     ▼
            ┌─────────────────┐
            │     INGESTA      │   valida, identifica canal+episodio, organiza
            │  (NUEVO)         │   automáticamente, genera manifest.json
            └────────┬─────────┘
                     │ submission.validated
                     ▼
                         ┌───────────────────────────┐
                         │ recalculateEpisodeStatus()  │
                         │  (función, no proceso —    │
                         │   la invoca cada agente al  │
                         │   terminar su paso)         │
                         └────────────┬───────────────┘
                                      │ lee episode_log + content_files/
                                      │ content_metadata/social_posts
                          ┌───────────┴────────────┐
                          │                        │
               ┌──────────▼─────────┐   ┌──────────▼─────────┐
               │      AGENT 2         │   │      AGENT 3        │
               │  VERIFY/EDIT/RENDER  │   │      PUBLISH        │
               │  (YA EXISTE — no se  │   │ (motor único, YA    │
               │   reconstruye)        │   │  EXISTE como Flujo  │
               │  decideEnqueue()      │   │  B — se generaliza) │
               │  completenessChecker  │   │  claimPost()         │
               │  RenderProvider        │   │  resolveIdentity()   │
               │   (Remotion=conocido,  │   │  retryPolicy()        │
               │    3 canales=UNKNOWN)  │   │  storageBridge()      │
               └──────────┬────────────┘   └──────┬───┬───┬───────┘
                    render.completed                │   │   │
                    metadata.ready                  YT  IG  FB
                          │
              GATE 1──────┴───────────GATE 2──────────┘
        (manifest válido:              (video+QA+metadata+
         guion+material+                autorización humana
         copyright OK)                  explícita)

Persistencia compartida: Supabase (content_files [+episode_id], episode_log,
content_metadata, social_posts, social_accounts, posting_schedule_rules) —
sin tabla `episodes` separada (Fase 2.1: content_files.episode_id es la fuente
de verdad de la agrupación por episodio).
Almacenamiento: ver docs/storage-strategy.md — D:\MATERIAL VIDEOS pasa a ser
caché/trabajo LOCAL, no el centro del sistema.
```

## 3. Modelo multicanal

**[DECISIÓN]** El modelo de 5 estados propuesto en el encargo (`ACTIVE/READY/TEST/BLOCKED/
HISTORICAL`) es adecuado — se adopta con una definición operativa precisa por estado, y con la
clasificación real de los 8 canales según la evidencia de Fase 1.2:

| Estado | Significa | Canal(es) real(es) hoy |
|---|---|---|
| `ACTIVE` | Extremo a extremo automático, incl. publicación real | **Ninguno todavía** (ni SIN EXPLICACIÓN llegó a publicar) |
| `READY` | Infraestructura de datos lista, publicación aún no autorizada/probada | SIN EXPLICACIÓN (una vez unificado el motor de publicación) |
| `TEST` | Infraestructura parcial, en validación antes de promover | OBJETOS MALDITOS, LUNA VERDE (tienen `content_accounts`, falta `social_accounts`) |
| `BLOCKED` | No puede automatizarse hasta resolver una condición explícita | ENCIENDE EL CAOS, ALZA LA VOZ, ASMR (`RENDER_PROVIDER=UNKNOWN`); PELICULAS, MUSICA (bloqueo de copyright ya documentado — Whisper+audio de película / licencia de audio comercial) |
| `HISTORICAL` | Contenido manual/legado, nunca entra al pipeline automático | CHISMES (ya excluido deliberadamente por el propio Agente 1) |

**[DECISIÓN]** Este estado vive en una columna nueva `content_accounts.channel_status` (enum),
**no** en código — resuelve directamente el problema de `ACCOUNTS` (§4).

## 4. Resolución de `ACCOUNTS` (sin tocarlo todavía)

**[RECOMENDACIÓN — combinación BD + configuración, no una sola fuente]**

- **BD (`content_accounts`, ya existe):** fuente de verdad de **qué canales existen y su
  `channel_status`**. `scripts/pipeline` debe leer de aquí (mismo patrón que
  `agent/discoverAccounts.mts` ya usa) los canales con `channel_status IN ('ACTIVE','READY')`,
  cacheado igual que ya se hace, en vez del array hardcodeado.
- **Configuración versionada (`content_accounts.style` jsonb, YA EXISTE en el esquema):**
  comportamiento por canal — tono, formato de guion, límites de duración, taxonomía de
  clasificación. **Corrección (verificado con datos reales en Fase 2.1):** esta columna **ya
  está parcialmente en uso** — SIN EXPLICACIÓN y LUNA VERDE tienen `style` real poblado
  (`tono`, `temas`, `hashtags_base`, `palabras_prohibidas`); OBJETOS MALDITOS lo tiene vacío
  (`{}`). Es un subconjunto mucho más pobre que `D:\MATERIAL VIDEOS\_agente\proyectos.json`
  (que además tiene `formato_guion`, `estructura_carpetas`, `fuentes_preferidas`,
  `tipo_material_buscado`, `reglas_especiales`, `limites_produccion`). **Recomendación
  ajustada:** extender el `style` ya existente con esos campos adicionales, no "migrar desde
  cero" — ya hay un patrón validado en producción esperando ser completado.
- **Por qué no "solo Supabase" ni "solo config versionada":** Supabase sola no es auditable por
  diff de PR; config versionada sola no puede reflejar cambios operativos rápidos (activar/
  desactivar un canal sin desplegar código). La combinación ya es, de hecho, el patrón que
  `content_accounts` fue diseñado para cumplir — solo falta usarlo para esto también.

## 5. Seguridad

**[EVIDENCIA — ya se hace bien, preservar]** Credenciales de plataformas viven en
`social_accounts.credentials` (jsonb, nunca en código); `.env.local` gitignored;
`.env.local.example` con placeholders reales; GitHub Actions ya usa `${{ secrets.* }}`
correctamente.

**[DECISIÓN — nuevo, no existe hoy]**
- Nunca loguear el objeto `credentials` completo — auditar cada `log.info`/`log.error` que
  reciba un objeto `account` y asegurar que solo se logueen `id`/`label`/`platform`, nunca
  `credentials`.
- `DRY_RUN=true` como default **por entorno**, no solo por variable global — al introducir
  `channel_status`, ningún canal fuera de `ACTIVE` debe poder publicar real aunque alguien
  cambie `DRY_RUN` a mano; el motor único debe verificar `channel_status='ACTIVE'` como
  segunda condición independiente antes de publicar real, no solo `DRY_RUN=false`.
- La verificación de consistencia de canal ya existente en `resolveIdentity.mts`
  (`contentAccount.channel_id !== account.channel_id → NO PUBLICAR`) se conserva como
  obligatoria en el motor único — es exactamente la protección contra "publicar contenido
  equivocado por confusión de canal" que pide el encargo.

## 6. Observabilidad

**[DECISIÓN]** `(channel, episode_id)` es el correlation ID primario. `content_file_id` y
`social_posts.id` son sub-claves derivadas. La tabla `episode_log` (contratos §6) es la
fuente única para reconstruir la historia completa de un episodio — la pregunta *"¿qué ocurrió
con el episodio 023 de SIN EXPLICACIÓN?"* se responde con una sola query:
`SELECT * FROM episode_log WHERE channel='SIN EXPLICACIÓN' AND episode_id='023' ORDER BY created_at`,
sin tener que cruzar manualmente `_agente/estado.json` + logs de archivo + Supabase como hoy.

## 7. Estructura de GitHub (evolución, no reescritura)

**[DECISIÓN]** Mantener la estructura real actual y solo llenar los huecos — no renombrar lo
que ya funciona:

```
agent/
  ingestion/        ← NUEVO (Inbox + Ingesta — el nuevo punto de entrada primario)
  research/         ← NUEVO, pero OPCIONAL (antiguo Agente 1; produce ContentSubmission
                       igual que un humano, ver docs/content-ingestion.md — no bloquea nada
                       si nunca se implementa o se deshabilita por canal)
  analyze/          (ya existe)
  schedule/         (ya existe)
  publish/          (ya existe — se generaliza como motor único, no se reescribe desde cero)
  orchestrator/     ← NUEVO, pero es una LIBRERÍA de funciones (recalculateEpisodeStatus),
                       no un proceso con su propia tarea programada (Fase 2.1)
lib/
  social/           (ya existe)
  admin/            (ya existe)
scripts/
  pipeline/         (ya existe — Agente 2, se conserva intacto)
supabase/
  schema.sql        (ya existe)
  migrations/       ← NUEVO — a partir de aquí, cambios de esquema como archivos versionados,
                       no SQL suelto ejecutado a mano en el Dashboard (así se evita otro
                       `claimed_at` no documentado)
docs/               ← NUEVO (esta auditoría)
.github/
  workflows/        (ya existe el archivo, falta comitearlo — ver Despliegue)
```

**VERSIONADO:** todo el código anterior + `docs/` + `supabase/migrations/` + workflows +
`.env.*.example`.
**EXTERNO (nunca en git):** `D:\MATERIAL VIDEOS` completo, `agent/logs/`, `scripts/pipeline/
state/`, cualquier `.env.local` real, `_agente/*.bak-*`.

## 8. Despliegue — el primer commit real

**[DECISIÓN — orden seguro, sin ejecutar todavía]**

1. **Auditoría final de secretos** — ya hecha en Fase 1.1/1.2: sin secretos reales detectados en
   ningún archivo a versionar. Repetir con `git diff --stat` justo antes del commit, no confiar
   en la auditoría de hace días.
2. **Limpieza**: confirmar `.gitignore` cubre `agent/logs/`, `scripts/pipeline/state/`,
   `.claude/worktrees/` (ya detectado como contenido ajeno a esta rama de trabajo).
3. **Exclusiones**: nada de `D:\MATERIAL VIDEOS` se toca — vive fuera del repo por diseño.
4. **Snapshot**: etiqueta git (`pre-agents-v0`) del estado justo antes del primer commit grande,
   para poder comparar/revertir sin ambigüedad.
5. **Primer commit**: uno solo, explícito ("versiona por primera vez agent/, lib/social,
   scripts/pipeline, app/admin, .github — código ya en producción local, nunca antes
   versionado"), no dividido en commits falsos que sugieran historia incremental que no existió.
6. **Revisión**: PR contra una rama, no contra `main` directo — aunque sea el propio usuario
   quien lo revise.
7. **Push** a la rama.
8. **Staging**: el propio GitHub Actions con `DRY_RUN=true` forzado es el "staging" — no hace
   falta un entorno Supabase separado todavía, dado que el motor único ya respeta `DRY_RUN`.
9. **Pruebas**: confirmar que el workflow corre en verde en modo dry-run antes de tocar nada.
10. **Producción**: solo después de (9), y solo para canales en `channel_status='ACTIVE'`.
11. **Nada de esto se ejecuta en esta fase** — es la secuencia a aprobar antes de la Fase 4.

## 9. Migración del sistema actual

**[DECISIÓN]** No hay "migración de datos" real que hacer — Supabase y `D:\MATERIAL VIDEOS` no
se mueven ni se restructuran. Lo único que migra es **código, de "nunca versionado" a
"versionado"**, y el comportamiento de publicación, de "dos flujos" a "un motor". Pasos:

```
Estado actual                          Arquitectura unificada
──────────────                         ───────────────────────
Código solo en disco local      →      Código en GitHub (Despliegue §8)
Flujo A + Flujo B paralelos      →      Motor único (contratos §5)
ACCOUNTS hardcodeado             →      content_accounts.channel_status (§4)
_agente/proyectos.json (externo) →      content_accounts.style jsonb (§4)
3 trackers de estado divergentes →      content_files.episode_id + episode_log (contratos §2,
  (D:\_agente, scripts/pipeline/state,     sin tabla episodes nueva — Fase 2.1)
  Supabase parcial)
Sin gate de autorización de      →      publication_authorized_at explícito (contratos §4)
  publicación (solo de render)
```

Nada de esto requiere tocar Supabase de forma destructiva — todo es aditivo (`ALTER TABLE ADD
COLUMN`, tablas nuevas), consistente con el patrón que `schema.sql` ya sigue ("columnas nuevas,
aditivas").

## 10. Costos y límites arquitectónicos (sin cifras exactas)

| Componente | Límite relevante | Nota |
|---|---|---|
| Anthropic API (Agente 1 research + Agente 2 metadata) | Rate limit + costo por episodio | Cada episodio implica varias llamadas (candidatos, investigación profunda, guion) — el propio `config.json.limites` ya pone topes (`max_candidatos_por_proyecto`, `tiempo_maximo_investigacion_min_por_proyecto`) |
| ElevenLabs | Cuota de caracteres/mes | Ya hay caché de voz (`processOne.mts` reusa narración cacheada en recovery) |
| Whisper | Local (CPU), sin costo de API | Confirmado por el propio código — no es un límite de costo, sí de tiempo de proceso |
| Remotion | CPU/tiempo local | Escala 1:1 con episodios concurrentes — el lock actual (`agentLock.mts`) es de proceso único, no por canal |
| Supabase | Filas/almacenamiento del plan | Bucket `social-videos` ya minimizado (YouTube evita Storage subiendo directo desde disco) |
| GitHub Actions | Minutos/mes del plan | Cron de 10 min ≈ 4320 ejecuciones/mes; cada una corta (segundos si no hay pendientes) — dentro de rango gratuito típico, a confirmar cuando se active |
| APIs sociales (YouTube/Meta) | Rate limit + cuota diaria | `posting_schedule_rules.max_posts_per_day` ya existe para esto — falta que el motor único lo respete activamente (hoy no se verifica en el código de publicación) |
| Concurrencia | Lock de proceso único en Agente 2 | Al escalar de 1 a 8 canales activos simultáneos, este lock puede volverse cuello de botella — evaluar lock por canal en fase posterior, no ahora |

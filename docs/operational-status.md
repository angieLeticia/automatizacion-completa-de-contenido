# Estado operativo real — Fase 1.2

> Evidencia de solo lectura: filesystem (`D:\MATERIAL VIDEOS`), git (`git log`, `git status`,
> `git remote`), y Supabase (vía el mismo método de introspección de Fase 1.1). Ninguna acción
> modificó código, base de datos, ni el repositorio.

## Hallazgo raíz de esta fase

**Ninguno de los tres agentes está desplegado en GitHub.** `git status --porcelain` muestra
`.github/`, `agent/`, `lib/social/`, `scripts/`, `app/admin/`, `docs/` como **completamente
untracked** (`??`). `git log --all -- .github/workflows/publish-social.yml` no devuelve nada:
ese archivo nunca existió en ningún commit. `origin/main` (GitHub) está exactamente en los mismos
5 commits que `main` local, todos anteriores a la existencia de cualquier código de los 3 agentes.

**Consecuencia directa:** GitHub Actions nunca ha tenido la oportunidad de ejecutar
`publish-social.yml`, ni una sola vez, en ningún momento. No es un cron que falla — es un cron
que GitHub no conoce.

## PRODUCCIÓN REAL

- **Windows Task Scheduler** ejecutando localmente `scripts/pipeline/agent.mts` (tarea
  `VisteapyAgentProduccion`) y `agent/run.mts` (tarea `VisteapyAgentPublicacion`, solo
  detección) — esto SÍ corre de verdad, porque las tareas de Windows ejecutan archivos locales
  directamente y no dependen de git.
- El canal **SIN EXPLICACIÓN**: tiene `content_account`, 3 `social_accounts` activas, 57
  `content_files`, 3 `content_metadata` en `ready`, y 4 `social_posts` reales creadas por
  `agent/schedule/scheduleContent.mts`. Es lo más cercano a un flujo de producción real que
  existe hoy.

## PREPARACIÓN (infraestructura creada, sin conectar)

- **OBJETOS MALDITOS** y **LUNA VERDE**: tienen fila en `content_accounts` pero cero
  `social_accounts` — el scheduler los "saltaría" (`status: "skipped"`) si algún día llegaran a
  tener `content_metadata.status='ready'`. LUNA VERDE ya tiene un `content_file` real bloqueado
  por conflicto de hash (`account_conflict`), evidencia de que el mecanismo de
  `content_file_conflicts` funciona de verdad.
- El código de publicación endurecida (`agent/publish/*`, Flujo B): existe, nunca fue
  programado, corre en `DRY_RUN` por defecto.
- El propio repositorio maestro `automatizacion-completa-de-contenido`: aún no existe ninguna
  migración hacia él.

## PRUEBAS / MATERIAL SIN CONECTAR

- **ALZA LA VOZ, ASMR, ENCIENDE EL CAOS**: el Agente 1 (motor reconstruido) SÍ generó episodios
  reales marcados `PRODUCIDO` en `_agente/registro/*.json` (3, 3 y 4 respectivamente). **Corrección
  respecto a la primera versión de este documento** (verificado con evidencia directa en Fase
  2.1, no en esta fase): solo **ALZA LA VOZ** tiene video final renderizado real
  (`001_VIDEO_CUADRADO.mp4`, etc.), producido por un mini-repo Remotion independiente
  (`D:\MATERIAL VIDEOS\ALZA LA VOZ\Alza-la-Voz\`, con su propio `.git`, `package.json` y
  `scripts/render-all.mjs`) — RENDER_PROVIDER **CONOCIDO**, no desconocido. **ASMR y ENCIENDE EL
  CAOS no tienen ningún archivo final renderizado en ningún episodio** (verificado con búsqueda
  exhaustiva en los dos canales completos) — "PRODUCIDO" en su registro significa que Agente 1
  terminó de recopilar material (guion/imágenes/sonidos), no que exista un video terminado.
  Ninguno de los tres es procesado por `scripts/pipeline/config.mts` (solo escanea
  `["SIN EXPLICACIÓN"]`), consistente con lo ya documentado.
- **PELICULAS, MUSICA**: el Agente 1 (motor) **nunca produjo nada exitosamente** para estos dos
  — sus 2 intentos cada uno terminaron en `VALIDACION_FALLIDA` por bloqueo de copyright (ver
  `docs/agente-1-motor.md` sección 5). Los episodios reales que sí existen en disco
  (`001_Destin`, `001_GRUPO_FIRME_...`) son anteriores al motor — origen: **DESCONOCIDO**
  (probablemente curados a mano antes de que el Agente 1 existiera).
- **CHISMES**: deliberadamente excluido del radar central (`gestionado_por_radar_central: false`
  en `proyectos.json`); su registro está vacío (`[]`). Gestión: manual, fuera del alcance de los
  3 agentes automatizados.

## DESCONOCIDO

- Mecanismo exacto de renderizado para ALZA LA VOZ/ASMR/ENCIENDE EL CAOS/OBJETOS MALDITOS.
- Si alguna vez alguien ejecutó `npm run social:publish` o `npm run agent:publish` manualmente en
  local contra estas 4 filas (no hay log persistente de esos scripts — usan `console.log`, no
  archivo).
- Por qué `.github/`, `agent/`, `lib/social/`, `scripts/`, `app/admin/` nunca se comitearon —
  pudo ser deliberado (trabajo en curso, no listo para compartir) o un descuido.

## Corrección a `docs/agente-1-motor.md`

Nueva evidencia no reflejada en ese documento: `_agente/registro/SIN_EXPLICACION.json` solo
tiene 6 entradas, pero el disco tiene 19 carpetas de episodio — los episodios más antiguos
(aprox. 001-008) preceden al sistema de registro del motor y no quedaron documentados en él. No
se modifica el documento todavía; se señala aquí como hallazgo pendiente de incorporar.

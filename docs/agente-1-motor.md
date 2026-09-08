# Agente 1 — Motor de Investigación y Descubrimiento de Contenido

> **[ACTUALIZADO — Fase 2, cambio metodológico]** Este documento sigue siendo válido como
> reconstrucción evidencial de lo que el proceso *fue e hizo* — no se reescribe nada de abajo.
> Pero su rol en la arquitectura cambió: la entrada primaria del sistema ya no es este agente,
> es una persona que entrega material a través de una Inbox (`docs/content-ingestion.md`). Este
> agente pasa a ser un **productor opcional e independiente**, que alimenta esa misma Inbox con
> el mismo contrato (`ContentSubmission`) que usaría un humano — conservando íntegras las
> políticas documentadas abajo (fuentes mínimas, jerarquía, copyright, deduplicación) para el
> día que se decida implementarlo. Ver `docs/content-ingestion.md` §2 para la decisión completa
> y su justificación.
>
> **Naturaleza de este documento (sin cambios): RECONSTRUCCIÓN, no el original.**
> El "motor" real fue ejecutado por un agente conversacional (con altísima probabilidad, una
> sesión de Claude con acceso a herramientas de búsqueda web) siguiendo instrucciones que no se
> guardaron como archivo en ningún equipo/repositorio accesible. Este documento se reconstruye
> **exclusivamente** a partir de evidencia verificable: `D:\MATERIAL VIDEOS\_agente\{config.json,
> estado.json, proyectos.json, registro\*.json}`, los `Guion*.md`, `fuentes-material.md` y
> `ENLACE_DE_REFERENCIA*.txt` de los episodios producidos, y el código de
> `scripts/pipeline/*.mts` que consume estas salidas.
>
> Cada afirmación está marcada como:
> - **[EVIDENCIA]** — demostrable directamente con un archivo/registro/resultado real citado.
> - **[RECONSTRUCCIÓN]** — inferencia razonable a partir de la evidencia, no confirmada literalmente.
> - **[DESCONOCIDO]** — no se puede determinar con la evidencia disponible.
>
> Fecha de reconstrucción: 2026-09-07. Fuentes primarias citadas por ruta relativa a
> `D:\MATERIAL VIDEOS\` salvo que se indique lo contrario.

---

## 1. Propósito

**[EVIDENCIA]** Descubre, investiga, verifica y prepara el material fuente (tema, guion,
fuentes citadas, imágenes, sonidos, referencia de video) para un episodio de uno de 8 canales
de contenido gestionados por "el radar central" (`_agente/config.json → cola.orden_proyectos`,
excluye CHISMES). Deja ese material en `D:\MATERIAL VIDEOS\<Canal>\<Episodio>\` para que el
Agente 2 (`scripts/pipeline/agent.mts`) lo detecte y produzca el video final.

**[RECONSTRUCCIÓN]** No genera el video ni publica nada — su alcance termina cuando el
material está completo y verificado; el resto del pipeline (voz, render, QA, publicación) es
responsabilidad de otros agentes con código propio.

**Lugar en el pipeline:** `IDEA/TEMA → [AGENTE 1: este documento] → material completo en disco
→ [AGENTE 2: scripts/pipeline/agent.mts] → video renderizado → [AGENTE 3: agent/publish +
lib/social] → publicado`.

---

## 2. Entradas

**[EVIDENCIA]**
- `_agente/config.json`: política y límites (fuentes por tema, tamaño máximo, duración objetivo
  por canal desde `proyectos.json`, orden de la cola, `modo_continuo`).
- `_agente/proyectos.json`: definición de los 9 canales (temática, tono, taxonomía de
  clasificación, fuentes preferidas, formato de guion, reglas especiales — ver tabla completa
  en la sección 4).
- `_agente/registro/<CANAL>.json`: historial de todo lo ya investigado/producido en ese canal,
  usado como base de comparación para deduplicación.
- `_agente/estado.json`: punto de reanudación (ciclo actual, índice de cola, proyecto en curso).

**[RECONSTRUCCIÓN]** El disparador de un ciclo es una instrucción humana que arranca la sesión
(no hay tarea programada de Windows para este proceso, a diferencia de los otros dos agentes —
confirmado por ausencia en `Get-ScheduledTask`). No hay evidencia de que reciba un "tema"
explícito del usuario en cada corrida — más bien descubre sus propios candidatos por canal.

**[DESCONOCIDO]** Si existe algún input adicional (ej. una lista de temas prohibidos, una API
de tendencias) fuera de lo que ya está en `proyectos.json`.

---

## 3. Proceso de investigación

**[EVIDENCIA]** `estado.json.etapas_posibles` enumera las etapas reales por las que pasa cada
proyecto: `BUSCANDO_CANDIDATOS → FILTRANDO → DEDUPLICANDO → PUNTUANDO → TOP5 →
INVESTIGACION_PROFUNDA → TOP1 → VERIFICACION → GUION → ELEVENLABS → IMAGENES →
VIDEOS_REFERENCIA → AUDIO → FUENTES → VALIDACION_FINAL → COMPLETADO`. Estos nombres de etapa
aparecen literalmente en el campo `etapa_actual`, así que son reales, no inventados aquí.

**[EVIDENCIA]** El resultado de "investigación profunda" incluye URLs reales verificables
(ej. Wikipedia, CNN, Smithsonian Magazine, Billboard, IMDb — ver `registro/SIN_EXPLICACION.json`,
`registro/ENCIENDE_EL_CAOS.json`, `registro/MUSICA.json`) y una lista de fuentes por nombre
(`fuentes: [...]`), no solo enlaces sueltos.

**[RECONSTRUCCIÓN]** El orden real parece ser: generar varios candidatos de tema por canal
("BUSCANDO_CANDIDATOS"), descartar los que no cumplen la temática/reglas del canal
("FILTRANDO"), comparar contra `registro/<CANAL>.json` para no repetir historia
("DEDUPLICANDO"), rankear ("PUNTUANDO"), quedarse con un TOP 5 y luego investigar a fondo el
mejor candidato ("INVESTIGACION_PROFUNDA" → "TOP1"), verificar cruzando fuentes
("VERIFICACION") y solo entonces escribir el guion.

**[DESCONOCIDO]** El criterio de puntuación exacto ("PUNTUANDO") — no hay ningún registro que
muestre puntajes numéricos, solo el resultado final (top1 elegido). Tampoco hay evidencia de
*cuántos* candidatos se generan por ciclo en la práctica (el límite configurado es
`max_candidatos_por_proyecto: 50`, pero no hay registro de que se hayan generado 50 alguna vez).

---

## 4. Política de fuentes

**[EVIDENCIA — regla transversal]** `config.json.limites.max_fuentes_por_tema: 4` y la nota de
`00_investigacion.md` (plantilla manual de `Canales_IA`, mismo espíritu): *"ningún dato pasa al
guion sin estar verificado en mínimo 2 fuentes independientes"*. En la práctica, los episodios
reales citan entre 3 y 6 fuentes (`registro/SIN_EXPLICACION.json` #009: 6 fuentes; #011: 5;
#012: 6), consistente con "mínimo 2, preferible más".

**[EVIDENCIA — jerarquía y preferencia por canal]**, de `proyectos.json`:

| Canal | Fuentes preferidas | Taxonomía de veracidad exigida |
|---|---|---|
| SIN EXPLICACIÓN | archivos históricos, Wikipedia/Wikimedia, documentales, prensa de época | REAL / LEYENDA / ESPECULACIÓN, etiqueta obligatoria |
| OBJETOS MALDITOS | archivos de museos, reportajes de investigación, Wikipedia | REAL / LEYENDA / ESPECULACIÓN |
| ENCIENDE EL CAOS | noticias virales, redes sociales, medios de entretenimiento | REAL / FICCIÓN, disclaimer obligatorio si es ficción |
| LUNA VERDE | tradición popular, astrología divulgativa, mitología comparada | separar explícitamente ciencia de creencia |
| ALZA LA VOZ | biografías, entrevistas, bases de citas verificadas | citas deben ser verificables |
| PELICULAS | IMDb, sitios de cine, entrevistas | REAL, prohibido spoiler temprano |
| MUSICA | plataformas de streaming, medios musicales, canales oficiales | REAL |
| CHISMES (no gestionado por el radar) | Infobae, ¡HOLA!, Univision, Publimetro, El Universal | HECHO CONFIRMADO / DECLARACIÓN / REPORTADO POR MEDIOS / RUMOR / ESPECULACIÓN — nunca presentar rumor como hecho |

**[EVIDENCIA — tratamiento de discrepancia/incertidumbre]** El caso Tamám Shud (#009) presenta
la identificación de 2022 con "lenguaje atribuido" ("según Abbott...") porque no hubo
confirmación oficial policial — la fuente conflictiva no se descarta, se marca explícitamente
como no confirmada tanto en el registro como en el guion final (`Guion...Tamam Shud.md`, sección
"⚠️ LO QUE NO CIERRA DEL TODO").

**[RECONSTRUCCIÓN]** "Cuándo detenerse": cuando no hay al menos 2 fuentes independientes que
coincidan en un hecho, ese hecho se degrada a "teoría"/"especulación" en vez de bloquear todo el
episodio — no hay evidencia de que la investigación se detenga por completo salvo por el
problema de *copyright de material* (sección 5), nunca por falta de fuentes textuales.

**[DESCONOCIDO]** Qué pasa si ni siquiera 1 fuente confiable existe para un candidato — no hay
ningún registro de ese escenario (todos los `VALIDACION_FALLIDA` documentados fallan por
material/licencia, no por falta de fuentes).

---

## 5. Copyright y material

**[EVIDENCIA — regla explícita y no negociable]** `config.json.politica_video`:
`descarga_automatica_video_completo: false`, `solo_enlace_referencia: true`,
`prohibido_saltar_captcha_login_paywall_drm: true`. Confirmado en la práctica en **dos casos
reales de bloqueo documentado**:
- `registro/PELICULAS.json`: candidato verificado (*Project Hail Mary*, *Sorda*) pero **nunca
  se creó carpeta de episodio** porque el formato de PELICULAS exige transcribir el audio
  original del film vía Whisper, y "no se descargan películas completas — política no
  negociable" ni hay Whisper disponible en ese entorno. *"No se creó ninguna carpeta de
  episodio ni se fabricó ningún timestamp falso."*
- `registro/MUSICA.json`: candidato verificado (*Dichávate*, *Ayer Hablé con Dios*) pero
  bloqueado porque "no existe una fuente de licencia libre para audio comercial completo... y
  descargarlo sin licencia no es una acción autorizada."

**[EVIDENCIA — material sí permitido]** Imágenes de dominio público/Wikimedia Commons (ver
`fuentes-material.md` de #009: 5 imágenes, todas con URL de Wikimedia Commons documentada);
audio de Mixkit "licencia gratuita para uso comercial"; video de referencia **solo como enlace
en un `.txt`**, nunca descargado (`Videos_Referencia/ENLACE_DE_REFERENCIA_*.txt`, formato:
TÍTULO/PLATAFORMA/CREADOR/URL/PROYECTO/UTILIDAD/SEGMENTO/FECHA — nota explícita: *"No se
descarga ni se reutiliza el video, solo sirve como referencia de investigación"*).

**[RECONSTRUCCIÓN]** La regla real, generalizada: *material generado o con licencia libre
verificable → se descarga y usa; material con copyright comercial (película completa, canción
comercial completa) → nunca se descarga, y si es estructuralmente indispensable, el episodio se
marca VALIDACION_FALLIDA en vez de buscar un atajo.* No hay ninguna evidencia de un intento de
sortear esta regla en los ~15 episodios revisados.

**[DESCONOCIDO]** Umbral exacto de "licencia libre verificable" para imágenes fuera de
Wikimedia/Mixkit — no hay evidencia de qué pasaría con, por ejemplo, una foto de stock de pago.

---

## 6. Deduplicación

**[EVIDENCIA — identificadores]** Cada entrada en `registro/<CANAL>.json` tiene: `id` (slug
legible: `sinexplicacion-009-tamam-shud`), `titulo_normalizado` (variante en minúsculas sin
tildes, con sinónimos/entidades clave), `hash` (slug determinístico de título+entidades — **no
es un hash criptográfico**, es una clave de comparación textual), `entidades_principales[]`.

**[EVIDENCIA — mecanismo real de comparación]** El campo `clasificacion_deduplicacion`
(`CONTENIDO_NUEVO` / `NUEVO_ENFOQUE`) y `motivo_clasificacion` muestran que la comparación es
**narrativa/semántica, hecha por el propio agente al momento de investigar** — no un diff de
hash. Ejemplos textuales:
- *"Se comparó contra el único intento anterior... Sin relación de tema/entidades — películas y
  directores completamente distintos"* (`PELICULAS.json`).
- *"NUEVO_ENFOQUE (comparado con #009 Tamám Shud/Somerton Man)"* para #012 Mujer de Isdal —
  mismo *tipo* de caso (persona no identificada) pero enfoque distinto, no se descarta, se
  etiqueta como relacionado (`relacionado_con: [...]`).

**[RECONSTRUCCIÓN]** El identificador real de "misma historia" no es el `hash` (que es solo una
clave legible derivada del título) sino la comparación de **entidades principales + tema** que
hace el agente contra todo el registro histórico del canal antes de comprometerse con un TOP1 —
es decir, la deduplicación ocurre en la etapa `DEDUPLICANDO` de la sección 3, usando
`registro/<CANAL>.json` completo como contexto de comparación.

**[DESCONOCIDO]** Si existe un umbral de similitud formal (%, embedding, etc.) o si la decisión
es enteramente cualitativa caso por caso — la evidencia solo muestra el resultado y una
justificación en prosa, no un cálculo.

---

## 7. Estructura de salida

**[EVIDENCIA — generado por el Agente 1]**, por episodio en `<Canal>\<NNN>\`:

| Archivo/carpeta | Contenido |
|---|---|
| `Guion - *.md` (o `Frases.md`/`Concepto.md`/`Guion.txt` según canal, ver tabla §4) | Guion final con formato específico del canal (`<break time="X.Xs" />` para narración SSML) |
| `fuentes-material.md` | Tabla de fuentes de cada imagen/audio con URL y licencia, nota de veracidad |
| `Imagenes/` | Imágenes descargadas (dominio público/licencia libre) |
| `Sonidos/` | Audio ambiental/SFX (Mixkit) |
| `Videos_Referencia/ENLACE_DE_REFERENCIA_*.txt` | Referencia de video externo, NUNCA el archivo de video |
| (actualización de) `_agente/registro/<CANAL>.json` | Nueva entrada con id/fuentes/estado |
| (actualización de) `_agente/estado.json` | Avance de ciclo, historial, errores |

**[EVIDENCIA — NO generado por el Agente 1, sino por otros procesos]**
- Narración de audio (`Narracion.mp3` o similar): **generada por `scripts/pipeline/voiceGenerator.mts`
  vía API de ElevenLabs dentro de `processProject()` — código real, confirmado en
  `scripts/pipeline/completenessChecker.mts:6-7`** ("si falta, se genera vía ElevenLabs dentro de
  processProject(), pero solo después de que el proyecto fue autorizado"). El archivo
  `Prompt de Voz - ElevenLabs.md` que aparece en algunos episodios (ej. SIN EXPLICACIÓN/005,
  LUNA VERDE) es una guía para selección manual de voz — **no está claro si es la vía real usada
  o un artefacto de un flujo manual anterior** (ver DESCONOCIDO abajo).
- Video final renderizado: generado por Remotion vía `scripts/pipeline` (Agente 2).
- Publicación en redes: generada por `agent/publish` + `lib/social` (Agente 3).

**[DESCONOCIDO]** Si `Prompt de Voz - ElevenLabs.md` sigue siendo necesario/usado, o es
redundante ahora que `voiceGenerator.mts` automatiza la llamada a ElevenLabs directamente desde
el guion.

---

## 8. Contrato de datos (Agente 1 → Agente 2)

```
INPUT (Agente 1)
  _agente/config.json (política/límites)
  _agente/proyectos.json (config por canal)
  _agente/registro/<CANAL>.json (historial para deduplicar)
        ↓
PROCESAMIENTO (Agente 1 — sin código propio, ejecutado conversacionalmente)
  BUSCANDO_CANDIDATOS → FILTRANDO → DEDUPLICANDO → PUNTUANDO → TOP5
  → INVESTIGACION_PROFUNDA → TOP1 → VERIFICACION → GUION → IMAGENES
  → VIDEOS_REFERENCIA → AUDIO → FUENTES → VALIDACION_FINAL
        ↓
OUTPUT (mínimo demostrado para que el Agente 2 arranque)
  D:\MATERIAL VIDEOS\<Canal>\<Episodio>\Guion*.md   ← obligatorio (completenessChecker lo exige)
  D:\MATERIAL VIDEOS\<Canal>\<Episodio>\Imagenes|Videos\*  ← obligatorio (al menos uno de los dos)
  D:\MATERIAL VIDEOS\<Canal>\<Episodio>\Sonidos\* (opcional en la práctica)
  D:\MATERIAL VIDEOS\<Canal>\<Episodio>\fuentes-material.md (evidencia, no exigido por código)
  D:\MATERIAL VIDEOS\<Canal>\<Episodio>\Videos_Referencia\ENLACE_DE_REFERENCIA*.txt (evidencia)
        ↓
SIGUIENTE AGENTE: scripts/pipeline/agent.mts (chokidar watch) detecta el episodio,
  checkCompleteness() → READY si hay Guion + (Videos o Imagenes) → requiere AUTHORIZED
  explícito (npm run pipeline:authorize) antes de encolar → processProject() genera narración
  faltante vía ElevenLabs, transcribe, arma clips, renderiza, corre QA.
```

**[EVIDENCIA — el contrato mínimo real que exige el código, no el que documenta el registro]**
`scripts/pipeline/completenessChecker.mts:8-14`: el único requisito **técnico y verificado por
código** para que el Agente 2 considere un episodio `READY` es: `Guion*.md` presente, y al menos
un archivo en `Videos/` o `Imagenes/`. Todo lo demás (fuentes-material.md, sonidos, referencias
de video) es evidencia de buenas prácticas del Agente 1, **no una validación que el código
exija**.

**[RECONSTRUCCIÓN]** Esto significa que el "contrato" real entre Agente 1 y Agente 2 es más
flaco que las políticas documentadas en `proyectos.json`/`config.json` — el código no verifica
número mínimo de fuentes, ni la taxonomía de veracidad, ni que exista `fuentes-material.md`. Esa
disciplina depende enteramente de que el ejecutor del Agente 1 la siga — no hay gate de código
que la haga cumplir.

---

## 9. Máquina de estados (por proyecto/episodio, según `estado.json`)

| Estado | Propósito | Entra desde | Sale hacia | Evidencia |
|---|---|---|---|---|
| `BUSCANDO_CANDIDATOS` | generar posibles temas del canal | inicio de turno del proyecto en la cola | `FILTRANDO` | `estado.json.etapas_posibles` |
| `FILTRANDO` | descartar candidatos fuera de temática/reglas del canal | `BUSCANDO_CANDIDATOS` | `DEDUPLICANDO` | idem |
| `DEDUPLICANDO` | comparar contra `registro/<CANAL>.json` | `FILTRANDO` | `PUNTUANDO` | idem + `clasificacion_deduplicacion` en registros |
| `PUNTUANDO` | rankear candidatos | `DEDUPLICANDO` | `TOP5` | idem (criterio exacto: DESCONOCIDO) |
| `TOP5` | quedarse con 5 mejores | `PUNTUANDO` | `INVESTIGACION_PROFUNDA` | idem |
| `INVESTIGACION_PROFUNDA` | investigar a fondo el mejor candidato | `TOP5` | `TOP1` | URLs/fuentes reales en `registro/*.json` |
| `TOP1` | fijar el candidato ganador | `INVESTIGACION_PROFUNDA` | `VERIFICACION` | idem |
| `VERIFICACION` | cruzar fuentes, marcar discrepancias | `TOP1` | `GUION` | caso Tamám Shud (lenguaje atribuido) |
| `GUION` | escribir el guion final | `VERIFICACION` | `ELEVENLABS` o `VALIDACION_FALLIDA` | `Guion*.md` reales; fallos de PELICULAS/MUSICA ocurren aquí |
| `ELEVENLABS` | narración (¿manual o automática? ver §7/§8) | `GUION` | `IMAGENES` | `Prompt de Voz*.md` + `voiceGenerator.mts` (código) |
| `IMAGENES` | descarga de imágenes con licencia libre | `ELEVENLABS` | `VIDEOS_REFERENCIA` | `Imagenes/` + `fuentes-material.md` |
| `VIDEOS_REFERENCIA` | registrar enlace de referencia (nunca descarga) | `IMAGENES` | `AUDIO` | `ENLACE_DE_REFERENCIA*.txt` |
| `AUDIO` | sonidos ambientales/SFX con licencia libre | `VIDEOS_REFERENCIA` | `FUENTES` | `Sonidos/` + Mixkit en `fuentes-material.md`; punto de bloqueo real en MUSICA |
| `FUENTES` | consolidar `fuentes-material.md` | `AUDIO` | `VALIDACION_FINAL` | archivo real por episodio |
| `VALIDACION_FINAL` | chequeo de duración/calidad antes de cerrar | `FUENTES` | `COMPLETADO` | `control_calidad` en `config.json` (tolerancia de duración, reintentos de guion) |
| `COMPLETADO` | episodio listo para el Agente 2 | `VALIDACION_FINAL` | fin de turno de este proyecto | `registro/*.json: "estado": "PRODUCIDO"` |
| `VALIDACION_FALLIDA` | episodio no se pudo completar (bloqueo estructural/copyright) | típicamente desde `GUION` o `AUDIO` | siguiente proyecto de la cola (si `modo_continuo=true`) | PELICULAS/MUSICA, ver §5 |

**[DESCONOCIDO]** Si `ELEVENLABS` como etapa del "motor" implica que el propio agente
conversacional interactúa con la web de ElevenLabs Studio (manual) o si delega esa etapa al
código de `scripts/pipeline`. Es la ambigüedad más importante sin resolver de todo este
documento.

---

## 10. Recovery

**[EVIDENCIA]**
- **Interrupción a mitad de ciclo**: 3 casos reales documentados de interrupción controlada
  ("interrupción real controlada tras ELEVENLABS", "tras GUION+ELEVENLABS", "durante
  INVESTIGACION_PROFUNDA") — todos "recuperados correctamente" retomando desde
  `estado.json.etapa_actual` sin repetir trabajo ya hecho ("no repite esas llamadas" es la
  filosofía también en `scripts/pipeline/agent.mts` para su propio recovery, no confirmado
  textualmente para el Agente 1 pero consistente con el patrón).
- **VALIDACION_FALLIDA no detiene la cola**: `modo_continuo=true` permite pasar al siguiente
  proyecto aunque el actual haya fallado ("sección 6 del motor" — ver siguiente punto).
- **Backups de estado**: cada cambio de `config.json`/`estado.json`/`proyectos.json` deja un
  `.bak-<timestamp>` antes de sobrescribir (11 backups de `config.json` observados) —
  mecanismo de recovery manual ante corrupción, aunque **no versionado en Git**.
- **Reintentos de guion**: `control_calidad.max_reintentos_duracion_guion: 2` — confirmado en
  la práctica ("2 intentos de guion (6.11min→8.35min)" en varios episodios).

**[RECONSTRUCCIÓN — "sección 6 del motor"]** La frase original ("sección 6 del motor permite
continuar tras VALIDACION_FALLIDA") demuestra que existe una sección numerada 6 en el documento
fuente que trata sobre continuación de cola tras fallo — pero el *contenido exacto* de esa
sección (¿qué otros casos cubre? ¿hay una sección para reintentos, otra para dedupe?) es
**desconocido**; solo se puede confirmar el comportamiento que produjo (avanzar al siguiente
proyecto sin detener el ciclo), no el texto original de la regla.

**[DESCONOCIDO]** Qué pasa ante "fuentes insuficientes" propiamente (nunca ocurrió en los
ciclos observados) o ante un error de red/timeout de una fuente — no hay ningún caso registrado.

---

## 11. Modo continuo

**[EVIDENCIA]**
- `modo_continuo`: booleano en `config.json.cola`. Cuando es `true`, el proceso avanza de un
  proyecto de la cola al siguiente **sin pausa humana entre ellos**, tanto si el proyecto
  anterior se `COMPLETÓ` como si terminó en `VALIDACION_FALLIDA`.
- Se activó **temporalmente** para un solo ciclo controlado (v10: *"'modo_continuo' activado
  temporalmente a true, 'max_ciclos' fijado en 1 — ambos deben revertirse... al cerrar el
  ciclo"*) y efectivamente se revirtió a `false` al cerrar (v11).
- `max_ciclos: 1` es el límite duro que impide que ese "modo continuo" se convierta en un bucle
  infinito de ciclos — agotado el máximo, el proceso se detiene (`estado_agente: "DETENIDO"` en
  el `estado.json` actual).
- `max_horas_continuas: 4` es otro límite explícito no relacionado con el número de ciclos sino
  con duración de pared.

**[RECONSTRUCCIÓN]** "Modo continuo" es una bandera de alcance de una sola sesión/ejecución
(encadenar los N proyectos de la cola sin pedir confirmación entre cada uno), **no un
scheduler**: no hay ningún mecanismo que reactive `modo_continuo` automáticamente en el futuro
— cada activación fue manual y se documentó como reversión obligatoria al terminar. Confirma
formalmente lo que pediste no confundir: no existe encadenamiento automático *entre sesiones*,
solo *dentro de* una sesión ya iniciada por un humano.

---

## 12. Autonomía real del Agente 1

## 🟠 AUTOMATIZADO PERO DEPENDIENTE

**Por qué no es 🟢 Autónomo:** no hay ningún disparador automático (cron, tarea programada,
webhook) que inicie un ciclo sin que un humano abra la sesión — confirmado por la ausencia de
una tarea de Windows equivalente a `VisteapyAgentProduccion`/`VisteapyAgentPublicacion` para
este proceso.

**Por qué no es 🔴 Manual puro:** dentro de una sesión ya iniciada, demuestra decisiones
encadenadas reales sin intervención humana en cada paso (`modo_continuo=true` procesó 8
proyectos consecutivos, incluida recuperación de 2 interrupciones simuladas, en una sola
corrida) — hay autonomía real *de alcance acotado*.

**Por qué no es 🟡 Semiautónomo puro ni ⚫ Incompleto:** el flujo end-to-end (candidatos →
investigación → guion → material → validación) está demostrado funcionando en producción real
9 veces (5 ciclos, ~24 episodios entre completados y fallidos documentados), no es un prototipo
ni una simulación.

**Conclusión:** automatizado *dentro de una corrida*, pero estructuralmente dependiente de que
un humano decida cuándo empieza cada corrida y de que ese humano sea, en la práctica, quien
"es" el motor (una sesión de Claude). No cumple la barra de autonomía real (iniciar, decidir,
ejecutar, recuperarse Y reanudarse **sin disparador humano**) que sí satisfacen parcialmente
Agente 2 y Agente 3 vía tareas programadas de Windows / GitHub Actions.

---

## 13. Puntos desconocidos (resumen)

1. Contenido literal del documento "el motor" (solo se conocen fragmentos citados indirectamente).
2. Criterio numérico de `PUNTUANDO` (ranking de candidatos).
3. Si `ELEVENLABS` (etapa del motor) es una interacción manual con ElevenLabs Studio o delega en
   `voiceGenerator.mts`.
4. Umbral de similitud/criterio formal de deduplicación narrativa (hoy es juicio cualitativo
   documentado en prosa).
5. Mecanismo de disparo — ¿siempre Claude Code interactivo? ¿API? ¿otra herramienta con
   WebSearch? No hay artefacto que lo confirme.
6. Comportamiento ante fuentes insuficientes o error de red (nunca ocurrido en los registros).

---

## 14. Matriz de certeza

| Regla/Comportamiento | Evidencia | Reconstrucción | Desconocido |
|---|---|---|---|
| Mínimo de fuentes independientes por hecho | — | ✔ (2, por convención observada en `00_investigacion.md` + conteo real 3-6 por episodio) | — |
| Prohibición de descargar video/audio con copyright completo | ✔ (2 bloqueos reales documentados) | — | — |
| Video de referencia solo como enlace `.txt` | ✔ (formato real en 15+ episodios) | — | — |
| Imágenes de dominio público/Wikimedia preferidas | ✔ (`fuentes-material.md` real) | — | — |
| Deduplicación es narrativa/semántica, no solo hash | ✔ (`motivo_clasificacion` en prosa) | ✔ (mecanismo exacto interno) | umbral formal |
| Etapas de la máquina de estados (15 nombradas) | ✔ (`etapas_posibles`) | — | contenido exacto de cada etapa más allá del nombre |
| "Sección 6 del motor" permite continuar tras fallo | ✔ (comportamiento resultante) | — | texto original de la sección |
| `modo_continuo` no es un scheduler | ✔ (activado/revertido manualmente, documentado) | — | — |
| Narración: manual vs. automática (ElevenLabs) | parcial (código automático existe) | ✔ (probablemente redundante con el prompt manual) | cuál vía se usa realmente para episodios del radar |
| Disparador de cada ciclo es una sesión de Claude | — | ✔ (estilo narrativo de `estado.json`, ausencia de cron) | confirmación directa |
| Criterio de puntuación de candidatos | — | — | ✔ totalmente desconocido |
| Comportamiento ante fuentes insuficientes | — | — | ✔ (nunca ocurrió) |

---

## 15. Próxima decisión (no tomada en este documento)

Con esta especificación recuperada, la implementación real del Agente 1 puede evaluarse entre:
**A)** Claude Code / Agent SDK con este documento como system prompt + herramientas de
WebSearch/WebFetch, ejecutado bajo un scheduler propio; **B)** API de Claude directamente
integrada en un servicio; **C)** servicio independiente con su propia lógica de scraping; **D)**
otra arquitectura. Esa decisión se toma después de la auditoría conjunta de los 3 agentes, no
aquí.

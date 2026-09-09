# Acceso controlado a la máquina local — evaluación de "Visteapy como Gateway"

> Encargo recibido durante la Fase 4.3: evaluar si Visteapy debe actuar como Gateway/Hub de
> acceso controlado a la PC para los agentes. Este documento es la respuesta, con evidencia
> verificada en ambos worktrees (`visteapy-web` en modo solo lectura, `automatizacion-completa-de-contenido`
> en el que se trabaja). Es DISEÑO — nada de esto se implementó como código en esta fase.

## 1. Hallazgo de evidencia (no se asumió nada)

**[EVIDENCIA]** Verificado en `visteapy-web` (rama `main`, solo lectura, cero modificaciones):

- `.gitignore` de Visteapy incluye `/.vercel` — indicador estándar e inequívoco de que el sitio
  está pensado para desplegarse en Vercel (hosting en la nube), no para correr como proceso
  persistente en la PC de la usuaria.
- Búsqueda exhaustiva de `child_process|execFile|exec(|spawn(|ffmpeg|ollama|11434` en todo el
  código de la aplicación (`app/`, `components/`, `lib/*.ts` no-social/admin, `utils/`):
  **cero coincidencias.**
- El único código de este ecosistema que efectivamente controla recursos locales de la PC
  (filesystem, procesos hijos, Remotion, FFmpeg vía `ffprobe`, llamadas HTTP a Ollama) vive
  **exclusivamente** en `agent/` y `scripts/pipeline/` — es decir, ya está en el repositorio de
  agentes, no en Visteapy.

**Conclusión de hecho, no de preferencia: Visteapy no tiene hoy ningún mecanismo de acceso o
control sobre la computadora que se pueda reutilizar como Gateway.** El panel `/admin/social` es
una interfaz de gestión de datos de Supabase (canales, cuentas, posts) — no ejecuta procesos
locales, no toca FFmpeg, no toca Remotion, no habla con Ollama.

## 2. Por qué "Visteapy como Gateway" no es arquitectónicamente coherente tal como está

Visteapy está diseñado para ejecutarse en un servidor en la nube (Vercel), potencialmente en una
máquina física distinta a la que tiene `D:\MATERIAL VIDEOS`, FFmpeg, Ollama y Remotion instalados
localmente. Un Gateway de "acceso a recursos de la PC" solo puede mediar el acceso a una PC en la
que efectivamente se está ejecutando — si Visteapy corre en Vercel, no hay ninguna ruta de red
entre ese proceso en la nube y los procesos locales de esta máquina Windows, salvo que se
construya infraestructura nueva (un agente local que exponga una API, un túnel, etc.) — que es
exactamente el tipo de "segunda vía" que el propio encargo pide no crear sin justificar.

**Esto no descarta la idea subyacente (control centralizado, límites, auditoría, sin acceso
arbitrario al SO) — descarta específicamente que Visteapy (el sitio Next.js de e-commerce,
desplegado en la nube) sea el lugar correcto para implementarla.**

## 3. Qué sí se puede reutilizar

No de Visteapy, pero sí del propio ecosistema ya auditado:

- El patrón de **ejecución local de confianza** que `agent/` y `scripts/pipeline/` ya usan: procesos
  Node corridos directamente en la máquina (vía `tsx`, vía Tarea Programada de Windows), con
  acceso directo pero **acotado por convención de código** (siempre dentro de `MATERIAL_ROOT`,
  nunca rutas arbitrarias) — no es un gateway formal, pero ya demuestra la disciplina de límites
  que se pide.
- Los mecanismos de seguridad ya existentes y verificados en fases previas: el lock de proceso
  único (`agentLock.mts`), la verificación de consistencia de canal en `resolveIdentity.mts`, la
  restricción de `OLLAMA_BASE_URL` a localhost únicamente (`agent/analyze/config.mts:64-68`) —
  este último es, de hecho, **el ejemplo más cercano que ya existe en el código real de "acceso
  controlado, no arbitrario"**: rechaza explícitamente cualquier URL de Ollama que no sea
  localhost/127.0.0.1, por seguridad.
- `agent/ingestion/pathSafety.mts` (Fase 4.3, recién implementado): ya es, en miniatura, exactamente
  el tipo de control de acceso que un Gateway más amplio necesitaría — resuelve toda ruta
  declarada externamente contra una raíz permitida, rechaza absolutas y traversal.

## 4. Recomendación: `MachineBridge` local, no `VisteapyGateway`

**[RECOMENDACIÓN — no implementada en esta fase]** Un mediador de acceso a recursos locales debe
vivir **dentro del repositorio de agentes** (`automatizacion-completa-de-contenido`), no en
Visteapy, precisamente porque los agentes son lo único en este ecosistema que corre
consistentemente en la máquina local. Nombre propuesto: **`MachineBridge`** (no `VisteapyGateway`
— sería engañoso nombrarlo por un proyecto que no lo aloja; no `LocalMachineProvider` — es más
que un simple *provider* de datos, media operaciones con efectos).

Diseño de la interfaz (forma, no implementación):

```ts
// agent/machine/machineBridge.mts — DISEÑO, no implementado en Fase 4.3.
// Ninguna operación es genérica. Cada método es una operación NOMBRADA y
// ACOTADA — nunca existe execute(cualquier_comando), tal como exige el encargo.
export interface MachineBridge {
  // Filesystem — SIEMPRE acotado a una raíz permitida (MATERIAL_ROOT, INBOX_ROOT,
  // o el directorio de estado del propio módulo llamante). Reutiliza exactamente
  // la lógica ya escrita en agent/ingestion/pathSafety.mts, no la duplica.
  readFileWithinRoot(root: string, relPath: string): Promise<Buffer>;
  writeFileWithinRoot(root: string, relPath: string, data: Buffer): Promise<void>;
  hashFileWithinRoot(root: string, relPath: string): Promise<string>;

  // Render — invoca el CLI de Remotion con argumentos ya validados por quien
  // llama (composición, props), nunca un comando de shell arbitrario.
  renderComposition(compositionId: string, outputPath: string, props: Record<string, unknown>): Promise<void>;

  // Whisper/FFmpeg — operaciones nombradas (transcribir, sondear metadata),
  // no "ejecutar ffmpeg con estos argumentos que me pasen".
  probeMedia(filePath: string): Promise<{ durationSec: number; width: number; height: number }>;
  transcribeAudio(filePath: string): Promise<string>;

  // Ollama — solo localhost, ya validado hoy en agent/analyze/config.mts;
  // MachineBridge heredaría exactamente esa misma restricción, no la relaja.
  callLocalOllama(prompt: string, model: string): Promise<string>;
}
```

**[ACTUALIZACIÓN — Fase 4.4/4.5]** El diseño de arriba es el boceto original de la interrupción de
Fase 4.3 y se dejó tal cual como registro histórico — la interfaz real terminó siendo distinta
(nombres de métodos, agrupación en `filesystem`/`health`/`media`/`render`/`localAI`, forma exacta
de cada firma) y vive, ya implementada, en `agent/machine/types.mts` (contrato completo) y
`agent/machine/machineBridge.mts` + `agent/machine/mediaBridge.mts` + `agent/machine/renderBridge.mts`
(implementación). Estado real por área, a la fecha de la Fase 4.5:
- `filesystem`, `health`: IMPLEMENTADO (Fase 4.4).
- `media` (`probe`/`extractAudioToWav`/`detectSilences`/`concatAudio`/`transcribe`), `render`
  (`renderComposition`, con `reuseIfExists`/`timeoutMs`): IMPLEMENTADO (Fase 4.5) — envuelven
  exactamente `scripts/pipeline/{mediaCatalog,silenceDetector,transcriber,voiceGenerator,renderer}.mts`
  y `agent/analyze/{probeMedia,extractAudio,transcribe}.mts`, sin reescribirlos. `compositionId` se
  valida contra los episodios/clips reales de `remotion/lib/episodes.ts`, nunca contra una lista
  inventada ni de forma arbitraria.
- `localAI`: sigue sin implementar, fuera de alcance explícito de la Fase 4.5.
- Agent 2 (`scripts/pipeline/*`) y Agent 3 (`agent/publish/*`) **todavía NO consumen** el Bridge —
  siguen llamando ffmpeg/ffprobe/whisper/Remotion directamente, como siempre. Esa migración es
  trabajo de una fase posterior, explícitamente no pedida aún.

**Explícitamente ausente, a propósito:** `execute(command: string)`, `runShell(...)`, o cualquier
método que acepte un comando arbitrario. Cada capacidad que un agente necesita se agrega como un
método nuevo, nombrado, con su propia validación — nunca como un parámetro de texto libre.

## 5. Aislamiento entre agentes

Cada agente seguiría recibiendo su propia instancia de `MachineBridge` **acotada a su propia raíz
permitida** — Agente 1/Ingesta solo puede leer/escribir dentro de `INBOX_ROOT` y el episodio que
está materializando; Agente 2 solo dentro de `MATERIAL_ROOT`; Agente 3 no necesita filesystem
general en absoluto (ya usa `content_files.file_path`, resuelto y verificado por hash antes de
tocarlo — ver `agent/publish/resolveContentFile.mts`, sin cambios). Esto es una extensión natural
del principio que `agent/ingestion/pathSafety.mts` ya aplica a un solo caso.

## 6. Riesgos si se construyera mal

- Un `MachineBridge` con un método genérico de ejecución sería exactamente el riesgo que el
  encargo prohíbe explícitamente (punto 9) — un agente con capacidad de investigación (LLM)
  podría, en teoría, ser inducido a ejecutar algo no previsto si el diseño lo permitiera.
- Si se intentara igual usar Visteapy como intermediario de red hacia la PC local, se introduciría
  una superficie de ataque nueva (un endpoint público en internet con capacidad de disparar
  operaciones en una PC doméstica) sin ningún beneficio real, dado que ya existe ejecución local
  directa y de confianza.
- Compartir un único `MachineBridge` sin raíces acotadas por agente reintroduciría el mismo tipo
  de riesgo de "un agente pisa el trabajo de otro" que `content_file_conflicts` ya existe para
  detectar en otro contexto (hash cruzado entre cuentas).

## 7. Pendiente antes de implementar Inbox/ContentSubmission con `MachineBridge` de por medio

**Nada** — el `ContentProvider`/`FsInboxContentProvider` implementado en esta misma Fase 4.3 ya
usa exactamente el patrón acotado que `MachineBridge` formalizaría (`pathSafety.mts`, operaciones
de archivo nombradas, ninguna ejecución arbitraria). `MachineBridge` sería una **refactorización
futura** que generalice ese patrón para que Agente 2/3 también lo usen explícitamente, no un
requisito bloqueante para que la Ingesta ya implementada funcione — de hecho, ya funciona (tests
pasando) sin él.

## Respuestas directas a las 8 preguntas del encargo

1. **¿Cómo puede Visteapy funcionar como Gateway?** No puede, con la arquitectura actual (deploy
   en la nube, cero código de acceso local) — sin construir infraestructura nueva no
   justificada.
2. **¿Qué mecanismos existentes podemos reutilizar?** Ninguno de Visteapy; sí el patrón ya
   validado en `agent/`/`scripts/pipeline/` (ejecución local acotada, restricción a localhost en
   Ollama, `pathSafety.mts` de esta misma fase).
3. **¿Qué componentes nuevos serían necesarios?** `MachineBridge` (diseñado arriba, no
   implementado), como generalización futura de patrones que ya existen.
4. **¿Cómo accederán los agentes a los recursos de la PC?** Como ya lo hacen — procesos Node
   locales con acceso directo pero acotado por convención de código; `MachineBridge` formalizaría
   esa acotación sin cambiar dónde corre nada.
5. **¿Cómo se aislarán entre sí?** Por raíz permitida acotada por instancia (sección 5).
6. **¿Cómo se controlarán las operaciones?** Métodos nombrados y validados, nunca ejecución
   arbitraria (sección 4/6).
7. **¿Qué riesgos existen?** Sección 6.
8. **¿Qué queda pendiente antes de Inbox/ContentSubmission?** Nada — ya implementado y probado en
   esta misma fase, de forma independiente de si `MachineBridge` llega a construirse después.

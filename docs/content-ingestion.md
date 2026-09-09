# Ingesta de contenido — Fase 2 (cambio metodológico) / Fase 4.3 (implementación)

> Este documento reemplaza la premisa de que Agente 1 = investigación web autónoma como entrada
> primaria. La entrada primaria ahora es una persona que busca y selecciona material fuera del
> sistema, y lo entrega a través de una Inbox.
>
> **[ACTUALIZADO — Fase 4.3]** La Inbox como carpeta observada, `ContentSubmission`,
> `manifest.json`, `ContentProvider`/`ContentPackage` y la idempotencia por `submission_checksum`
> **ya están implementados** como código real en `agent/ingestion/` — ver
> `docs/system-contracts.md` §3/§7 para el detalle exacto de qué pasó de DISEÑO a IMPLEMENTADO.
> Sigue siendo diseño (no implementado): el formulario web de Inbox, el Agente de investigación
> opcional, y cualquier disparo automático (hoy es invocación manual vía `npm run agent:ingest`,
> sin watcher ni scheduler).

## 1. Por qué cambia el diseño, no solo el diagrama

**[EVIDENCIA, Fase 1.2]** El "Agente 1" nunca fue código — era un proceso ejecutado
conversacionalmente. Reemplazar la entrada primaria por una persona no es un downgrade: es
reconocer que la pieza más frágil del sistema (una sesión manual de Claude que alguien debe
recordar abrir) deja de ser una dependencia dura del pipeline. La investigación automática se
conserva como capacidad, no como requisito.

## 2. Disposición del antiguo Agente 1 (investigación) — decisión

El encargo pide elegir entre: (A) módulo opcional, (B) agente independiente que alimenta la
misma Inbox, (C) eliminado del flujo principal pero conservado como herramienta, (D) otra
arquitectura.

**[DECISIÓN — Opción B, con elementos de A]** El agente de investigación se convierte en un
**productor independiente y opcional** de `ContentSubmission` — exactamente el mismo contrato
que usa una persona. Razones:

- **No bloquea la nueva metodología**: si nunca se implementa, el sistema funciona igual con
  entrada humana únicamente.
- **No se pierde el trabajo ya validado**: las reglas de `docs/agente-1-motor.md` (mínimo de
  fuentes, jerarquía, no descargar material con copyright, deduplicación narrativa) siguen
  siendo la especificación correcta *el día que se decida implementarlo* — no se descartan,
  se re-empaquetan como un productor más.
- **Satisface la compatibilidad pedida (punto 17)**: como ambos (persona y agente) hablan
  `ContentSubmission`, activar o desactivar el agente de investigación en el futuro no toca
  Agente 2 ni Agente 3 en absoluto.
- **Por qué no C (eliminarlo del flujo principal)**: "eliminarlo del flujo principal" es
  literalmente lo que ya logra la Opción B — no hace falta demotarlo a "herramienta externa
  desconectada"; sigue siendo un agente real del sistema, solo que opcional y con el mismo
  contrato de entrada que cualquier otra fuente.
- **Por qué no A puro (solo "módulo opcional")**: un módulo no tiene identidad propia frente al
  sistema; como **agente independiente** puede tener su propio ciclo de vida, scheduler y
  configuración por canal (`content_accounts.style.research_agent_enabled: true/false`) sin
  acoplarse a la Ingesta.

## 3. La Inbox

**[DECISIÓN]** La Inbox es la única superficie que una persona necesita conocer. No requiere
saber sobre `D:\MATERIAL VIDEOS`, canales como carpetas, IDs de Supabase, ni JSON internos.

**[RECOMENDACIÓN — no reconstruir, reusar patrón existente]** `app/admin/social/actions.ts` ya
implementa exactamente el mecanismo de subida que la Inbox necesita:
`createUploadTarget()` (URL firmada de subida a Supabase Storage) + un formulario
(`NewPostForm.tsx`) que ya sube archivos sin que la persona toque rutas de disco. **Recomiendo
extender ese mismo patrón** con un nuevo formulario `/admin/content/nuevo` en vez de diseñar un
mecanismo de subida distinto:

```
Formulario "Nuevo contenido" (extiende el patrón ya validado de /admin/social):
  - Canal (select — poblado desde content_accounts, no hardcodeado)
  - Archivos (video/imágenes/audio — drag & drop, múltiples)
  - Guion (textarea o subida de archivo .md/.docx/.txt)
  - Fuentes (opcional, campo libre — requerido u opcional según el canal, ver contrato §3
    de system-contracts.md)
  - Plataformas previstas (checkboxes, default = las activas del canal)
  - Botón "Entregar al sistema"
```

**[RECOMENDACIÓN — segunda vía, para el usuario avanzado]** Una carpeta observada
(`INBOX/<lo que sea>/`, sin estructura obligatoria de subcarpetas) que un proceso de Ingesta
escanea igual que hoy `agent/run.mts` escanea `MATERIAL_ROOT` — para quien prefiera simplemente
arrastrar archivos a una carpeta en vez de usar un formulario web. **Ambas vías producen el
mismo `ContentSubmission`** — no son dos sistemas, son dos productores del mismo contrato.

**[DESCONOCIDO]** Si el formulario web o la carpeta observada debe ser la vía principal desde el
día uno — depende de cuánto use la persona el panel `/admin` hoy (no medido en esta auditoría).
Recomiendo empezar por la carpeta observada (mínimo esfuerzo de implementación, cero UI nueva)
y añadir el formulario web cuando el volumen lo justifique.

## 4. Contrato `ContentSubmission`

**[DECISIÓN]** Campos mínimos:

```ts
interface ContentSubmission {
  submission_id: string;        // UUID, generado al recibir — idempotencia de la propia entrega
  channel: string;               // debe existir en content_accounts.folder_name
  episode_id?: string;           // si se omite, la Ingesta asigna el siguiente número libre del canal
  submitted_by: string;          // "user:<uuid>" (humano autenticado en /admin) o
                                  // "agent:research-v1" (agente de investigación opcional)
  submitted_at: string;          // ISO timestamp
  files: Array<{
    kind: "video" | "image" | "audio" | "script" | "reference";
    original_filename: string;
    storage_ref: string;         // ruta o URL donde ya quedó guardado (Storage o carpeta Inbox)
    checksum: string;            // sha256 — para detectar el mismo archivo re-entregado
  }>;
  script_text?: string;          // guion inline, alternativa a files[kind="script"]
  sources?: Array<{ name: string; url?: string; tier: "primary" | "secondary" | "tertiary" }>;
  intended_platforms?: string[]; // si se omite, se usan las plataformas activas del canal
  metadata_hints?: { title?: string; classification?: string; tags?: string[] };
  status: "RECEIVED" | "VALIDATING" | "VALIDATED" | "REJECTED" | "CONVERTED";
  submission_checksum: string;   // hash del conjunto completo de archivos — idempotencia de
                                  // "esta misma entrega ya fue procesada", independiente del
                                  // checksum por archivo individual
  schema_version: number;        // para poder evolucionar el contrato sin romper productores viejos
}
```

**[DECISIÓN]** `submission_checksum` (hash del set completo, no solo de un archivo) es la clave
de idempotencia de la Inbox — si la misma persona sube por error el mismo lote dos veces, la
Ingesta lo detecta y responde `REJECTED` con razón `"submission_duplicada"`, sin crear un
segundo episodio.

## 5. Ingesta — qué hace exactamente

```
ContentSubmission (status=RECEIVED)
       ↓
1. VALIDACIÓN DE FORMATO
   - archivos legibles, extensiones soportadas, tamaño dentro de límites del canal
       ↓
2. IDENTIFICACIÓN DE CANAL Y EPISODIO
   - channel debe existir en content_accounts (si no existe: REJECTED, no se inventa un canal)
   - episode_id: si vino explícito, se valida que no exista ya (idempotencia de episodio,
     ver system-contracts.md §1); si no vino, la Ingesta asigna el siguiente número libre
       ↓
3. ORGANIZACIÓN AUTOMÁTICA (esto es lo que hoy tendría que hacer la persona a mano)
   - crea D:\MATERIAL VIDEOS\<Canal>\<NNN>\ y las subcarpetas del canal (según el patrón ya
     documentado por canal en _agente/proyectos.json / futuro content_accounts.style)
   - mueve/copia cada archivo de files[] a su subcarpeta correcta según su `kind`
   - si vino script_text en vez de archivo, escribe Guion*.md con el formato del canal
       ↓
4. METADATA Y MANIFEST
   - genera manifest.json (contrato exacto en system-contracts.md §3)
   - `sources`/`min_sources_met` se copian de la submission si vinieron, o quedan
     explícitamente vacíos/false si la persona no los proveyó (nunca se inventan fuentes)
       ↓
5. GATE
   - aplica las reglas de system-contracts.md §3 (copyright_check, classification, etc.)
   - VALIDATED → dispara `submission.validated` → Agente 2 lo detecta exactamente como hoy
     detecta un episodio completo (mismo `completenessChecker`, sin cambios)
   - REJECTED → notifica al `submitted_by` con la razón exacta, la persona corrige y reenvía
```

**[DECISIÓN]** La Ingesta **nunca** inventa fuentes, clasificación, ni copyright-check que la
submission no proveyó — si el canal los exige y no vinieron, el resultado es `REJECTED`, no una
suposición.

## 6. `ContentPackage` y `ContentProvider` (para que Agente 2 no le importe el origen)

**[DECISIÓN — responde directamente el punto 9 del encargo]**

```ts
interface ContentPackage {
  channel: string;
  episodeId: string;
  scriptPath: string;
  materialFiles: MaterialFile[];
  manifest: EpisodeManifest;      // el mismo manifest.json de system-contracts.md §3
  sourceOrigin: "human" | "research-agent";  // trazabilidad, no una bifurcación de lógica
}

interface ContentProvider {
  listReadyPackages(): Promise<ContentPackage[]>;
}
```

Agente 2 (`scripts/pipeline/agent.mts`) pasa a consultar `ContentProvider.listReadyPackages()`
en vez de escanear `MATERIAL_ROOT` directamente con `chokidar` — **pero la implementación
inicial de ese `ContentProvider` es literalmente el mismo `materialScanner.mts` +
`completenessChecker.mts` de hoy**, envuelto detrás de la interfaz. No se reescribe Agente 2;
se le da una fachada estable para que, si en el futuro hay tres fuentes de contenido en vez de
una, Agente 2 no cambie ni una línea.

## 7. Human-in-the-loop — exactamente qué hace y qué no hace la persona

| SÍ hace la persona | NO hace la persona |
|---|---|
| Busca y selecciona el material fuera del sistema | Mover archivos entre carpetas internas |
| Entrega archivos + guion (opcional) a la Inbox | Editar `manifest.json`, `estado.json`, etc. |
| Decide el canal (o lo deja vacío si hay un canal único configurado por defecto) | Ejecutar scripts de Node/PowerShell |
| Puede decidir plataformas de destino | Conocer `content_file_id`, hashes, UUIDs |
| Autoriza render (`decideEnqueue`, ya existe) | Administrar el estado de la máquina de estados |
| Autoriza publicación real por episodio (`publication_authorized_at`, nuevo) | Ejecutar el motor de publicación a mano |

## 8. Migración de material antiguo — clasificación, sin ejecutar nada

**[DECISIÓN — usa la evidencia ya recogida en Fase 1.2, no se re-investiga]**

| Categoría | Contenido real | Acción propuesta (futura, no ahora) |
|---|---|---|
| **Histórico** | CHISMES completo; carpetas `001-00X` de PELICULAS/MUSICA anteriores al motor; episodios `001-008` de SIN EXPLICACIÓN anteriores al `_agente/registro` | Queda donde está, referenciado por metadatos si algún día se cataloga — nunca entra al pipeline automático |
| **Ya procesado** | Episodios de SIN EXPLICACIÓN con `content_files`/`content_metadata` reales | Se re-envuelve como `ContentPackage` vía el `ContentProvider` existente, sin re-ingestión |
| **Pendiente** | Episodios `PRODUCIDO` de OBJETOS MALDITOS/LUNA VERDE sin `social_accounts` | Esperan a que el canal pase a `READY`/`ACTIVE` (arquitectura §3) |
| **Prueba** | Episodios `PRODUCIDO` de ENCIENDE EL CAOS/ALZA LA VOZ/ASMR con video final de `RENDER_PROVIDER=UNKNOWN` | Bloqueados hasta identificar el proveedor de render real — no se les asigna uno inventado |
| **Bloqueado** | Los 4 intentos `VALIDACION_FALLIDA` de PELICULAS/MUSICA | Permanecen bloqueados por la misma razón de copyright ya documentada — la nueva metodología (persona entrega el material) en realidad **resuelve** este bloqueo de forma natural: una persona sí puede aportar el audio con licencia o la transcripción que el agente automático no podía obtener |

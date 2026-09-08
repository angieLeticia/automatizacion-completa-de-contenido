# Estrategia de almacenamiento — Fase 2

> Responde directamente: ¿debe `D:\MATERIAL VIDEOS` seguir siendo el centro del sistema? Y si
> el material debe quedar "respaldado", ¿cómo, exactamente, sin convertir Git en un almacén de
> binarios? Todo DISEÑO, nada ejecutado — no se mueve ni un archivo en esta fase.

## 1. Decisión de fondo

**[EVIDENCIA, Fase 1.2]** `D:\MATERIAL VIDEOS` pesa ~35.4 GB reales hoy (medido: SIN EXPLICACIÓN
20 GB, ENCIENDE EL CAOS 3.2 GB, CHISMES 2.9 GB, ASMR 2.7 GB, ALZA LA VOZ 2.1 GB, OBJETOS MALDITOS
1.3 GB, PELICULAS 1 GB, LUNA VERDE 1.9 GB, MUSICA 289 MB) y crece con cada episodio. Es un disco
local de una sola máquina, sin redundancia, sin backup automático conocido.

**[DECISIÓN]** `D:\MATERIAL VIDEOS` deja de ser el "centro" conceptual del sistema y pasa a ser
la implementación **local de trabajo/caché** de `StorageProvider` — sigue existiendo, sigue
siendo donde Agente 2 renderiza y donde Whisper/ElevenLabs cachean, pero **no es la única copia
que decide si algo "existe"**. Esa responsabilidad pasa a un almacenamiento central.

## 2. `StorageProvider` — tres capas, no una sustitución 1:1

```ts
interface StorageProvider {
  put(ref: ObjectRef, stream: ReadableStream): Promise<{ hash: string; url?: string }>;
  get(ref: ObjectRef): Promise<ReadableStream>;
  exists(ref: ObjectRef): Promise<boolean>;
  delete(ref: ObjectRef): Promise<void>;
}

// Capa 1 — trabajo local, ya existe, no se toca:
class LocalStorage implements StorageProvider { /* envuelve D:\MATERIAL VIDEOS tal cual */ }

// Capa 2 — almacenamiento central de multimedia (nuevo, ver evaluación abajo):
class CloudStorage implements StorageProvider { /* Supabase Storage u otro objeto-storage */ }

// Capa 3 — NO es un StorageProvider de archivos; es el repositorio de código/config/contratos:
// RepositoryStorage = GitHub. No implementa esta interfaz — vive en un nivel distinto
// (ver §5, "qué va en GitHub" vs "qué va en Storage").
```

**[DECISIÓN]** `LocalStorage` sigue siendo donde Agente 2 trabaja en caliente (lee guion,
escribe frames intermedios, cachea Whisper/voz). Cuando un episodio llega a `VIDEO_READY`
(render terminado), el archivo final se sube a `CloudStorage` y **esa copia, no la de disco, es
la que las siguientes etapas (Agente 3) referencian por `content_files.file_hash`** — el disco
local puede perderse sin perder el sistema.

## 3. Evaluación de respaldo de multimedia — A vs B vs C

| Criterio | A. Git normal | B. Git + Git LFS | C. Git (código) + Object Storage (media) |
|---|---|---|---|
| Costo a 35GB+ y creciendo | Alto — cada clon descarga todo el historial binario | Medio-alto — LFS tiene cuotas de storage/bandwidth de pago por encima de ~1GB/mes en GitHub | Bajo — Storage cobra por GB real, sin duplicar en cada clon |
| Rendimiento de clonado/CI | Pésimo — GitHub Actions clonaría 35GB+ en cada run | Mejor, pero sigue bajando LFS por defecto salvo config fina | Óptimo — el repo de código pesa MB, no GB |
| Recuperación ante pérdida de disco | Total (todo en git) pero impráctico de operar | Total, con fricción de cuotas | Total — Storage es la copia durable, independiente del repo |
| Versionado real de binarios | Sí, pero sin sentido práctico (un video no se "diffea") | Sí, con puntero por versión — tampoco aporta un diff útil | No versiona el binario en sí (no lo necesita); versiona la referencia (`file_hash`) desde el código/BD |
| Facilidad de automatización (Agente 2/3 ya lo hacen) | Ninguna — nada del código actual sube nada a git | Requiere tooling adicional (`git-lfs` en cada entorno de ejecución) | **Ya implementado y probado en producción**: `agent/publish/storageBridge.mts` ya sube a Supabase Storage con idempotencia por hash |
| Seguridad | Repo privado protege el contenido, pero mezcla secretos de acceso de código con binarios de negocio | Igual que A | Separación limpia: permisos de Storage independientes de permisos de código |
| Escalabilidad a 8 canales × episodios recurrentes | Se degrada rápido | Se degrada, más lento que A | Escala igual que cualquier object storage (probado: ya sirve los videos que YouTube/IG/FB consumen hoy) |

**[DECISIÓN]** **Opción C**, confirmada tras evaluar — no aceptada por defecto. La razón decisiva
no es teórica: **el sistema ya implementa exactamente el patrón C, con éxito, para la mitad del
problema** (`storageBridge.mts` sube a Supabase Storage de forma idempotente por hash para
Instagram/Facebook; YouTube evita incluso esa subida leyendo directo de disco). Extender ese
mismo patrón a *todo* el material final (no solo el que ya va a Instagram/Facebook) es una
generalización de algo probado, no una tecnología nueva.

**[MATIZ sobre la expectativa inicial del usuario]** "GitHub = source of truth del sistema,
Storage = source of truth de multimedia" es correcto **si se entiende "GitHub" como código +
contratos + referencias**, no como el lugar donde vive el bit del video. La referencia (hash,
ruta, metadata) sí puede — y debe — quedar trazada desde el código/BD versionado; el byte del
video no.

## 4. Qué proveedor de `CloudStorage` — recomendación y lo que queda abierto

**[RECOMENDACIÓN, no decisión cerrada]** Continuar con **Supabase Storage** en el corto plazo:
ya está integrado, ya tiene el bucket `social-videos`, ya tiene RLS/service-role resuelto, y ya
es la vía real para 2 de 3 plataformas. **[DESCONOCIDO]** el costo real a 35GB+ y creciendo bajo
el plan actual de Supabase no se calculó en esta auditoría (el encargo no pidió cifras exactas)
— si el volumen sigue creciendo al ritmo observado (varios GB por semana en ciclos activos),
recomiendo una revisión de costos antes de comprometer esto como estrategia definitiva a 12
meses. Alternativas a evaluar en ese momento, no ahora: S3, Cloudflare R2, Backblaze B2 —
todas compatibles con la misma interfaz `StorageProvider`, sin cambiar el resto del sistema.

## 5. Qué va en GitHub vs qué va en Storage vs qué nunca va en ningún repositorio

| Categoría | Ejemplos | Ubicación |
|---|---|---|
| **GitHub (versionado)** | código de los 3 agentes + orquestador, `docs/`, `supabase/schema.sql` + `migrations/`, `.github/workflows/`, `.env.*.example`, definiciones de canal (una vez migradas a `content_accounts.style`), definiciones de estado, pruebas | Repositorio `automatizacion-completa-de-contenido` |
| **Storage (multimedia)** | video final renderizado, imágenes/audio del episodio una vez validado, renders intermedios que se decida conservar | Supabase Storage (u otro `CloudStorage`), referenciado por `file_hash` desde `content_files` |
| **Nunca en ningún repositorio ni Storage compartido** | API keys, tokens OAuth, `.env.local` real, credenciales de `social_accounts` (ya correctamente en BD con RLS, no en archivo) | Variables de entorno / GitHub Secrets / columna `credentials` jsonb con RLS |
| **Local, transitorio, nunca respaldado** | `agent/logs/`, `scripts/pipeline/state/`, caché de Whisper/voz, frames intermedios de Remotion | `D:\MATERIAL VIDEOS` / disco local — se puede borrar y regenerar |

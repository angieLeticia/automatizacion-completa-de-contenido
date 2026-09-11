# Fase 5.11 — Auditoría y diseño seguro de Facebook

> Alcance: exclusivamente `lib/social/facebook.ts` y su interacción con
> `agent/publish/*`. Ninguna publicación real, ningún cambio de flags/
> `channel_status`/credenciales. No se construyó un orquestador automático.

## 1. Implementación actual (auditoría A-M)

| Punto | Hallazgo | Clasificación |
|---|---|---|
| A. Cómo se crea | `POST /{page_id}/videos` con `file_url` (URL pública en Supabase Storage) + `description` + `access_token` — **una única llamada**, sin fase de "crear contenedor" separada como Instagram | IMPLEMENTADO |
| B. Qué devuelve la API | JSON `{id: string}` en éxito | IMPLEMENTADO |
| C. Identificador devuelto | `data.id` — el ID real del video de la Page | IMPLEMENTADO |
| D/E. ¿Se conserva? ¿Cuándo? | Solo se conoce DESPUÉS de que la respuesta completa ya fue parseada con éxito — a diferencia de YouTube/Instagram, **no existe ningún handle intermedio disponible ANTES de la acción irreversible** (`publishers.ts` confirma: Facebook nunca recibe `onOperationRef`) | VERIFICADO POR CÓDIGO |
| F. ¿Sirve para consultar después? | En teoría sí (`GET /{video_id}` es una lectura genérica de Graph API), pero solo si ya tenemos el ID — que es precisamente lo que falta en el escenario de incertidumbre | NO VERIFICADO (nunca se prueba porque nunca hay ID disponible cuando hace falta) |
| G. Endpoint de reconciliación posible | Ninguno directo con el ID (no lo tenemos). La única alternativa (listar `/{page_id}/videos` y correlacionar por descripción/hora) es débil, propensa a falsos positivos/negativos — **no se implementa** | BLOQUEADO |
| H. Permisos OAuth | Los mismos ya usados para publicar (`pages_manage_posts`/similares) — no es un problema de permisos, es de **diseño de la API actual** | N/A |
| I/J. Respuestas confirmatorias/ambiguas | No aplican de forma útil sin un ID previo que consultar | BLOQUEADO |
| K. Timeout DESPUÉS del envío (antes de cualquier respuesta) | **Hallazgo crítico** — ver §4 abajo | NO VERIFICADO / riesgo residual documentado |
| L. HTTP éxito + JSON falla | Ya cubierto desde Fase 5.4.1: `PublicationOutcomeUncertainError` | VERIFICADO CON TEST |
| M. Proceso muere justo después del envío | Cubierto por el checkpoint universal (`markPublishAttemptStarted` escribe `"pending:facebook"` ANTES de esta llamada, para TODAS las plataformas) — `recoverStaleClaims()` lo trata como CASO B/C → `verification_required`, nunca retry automático | VERIFICADO CON TEST (Fase 5.6, en vivo) |

## 2. Comparación con YouTube/Instagram

| | YouTube | Instagram | Facebook |
|---|---|---|---|
| Operation ref intermedio | `uploadUrl` (antes del PUT de bytes) | `creationId` (antes de `media_publish`) | **No existe ninguno** — la única llamada ES la acción irreversible, y su resultado (el ID) solo se conoce al final |
| Reconciliable con el método actual | Sí (`reconcileYouTube`, protocolo resumible con garantía de "incompleta = nunca produce video") | Sí (`reconcileInstagram`, `GET status_code` documentado por Meta para este caso exacto) | **No** |

**Facebook no tiene, con el método actual, ningún equivalente seguro a `uploadUrl`/`creationId`.**

## 3. No se inventó semántica

No se asumió "404=nunca publicó" ni "200=confirmado" para ningún endpoint hipotético de Facebook — de hecho, no se implementó ningún `reconcileFacebook()` en absoluto, precisamente porque no hay una base real sobre la cual construir esa semántica sin adivinar.

## 4. Hallazgo crítico (K) — corregido parcialmente, riesgo residual documentado

**Encontrado y corregido en esta fase:** `publishToFacebook()` aceptaba un JSON válido `{}` (sin `id`, o con `id=""`) como **éxito pleno**, devolviendo un `externalPostId` inválido/vacío que `run.mts` habría escrito tal cual como `published`. Corregido: ahora valida que `id` sea un string no vacío; si no, lanza `PublicationOutcomeUncertainError` (mismo tratamiento que un JSON malformado). Ver `lib/social/facebook.ts`.

**Encontrado y NO corregido en esta fase (fuera de alcance, es una convención cross-plataforma deliberada):** si el propio `fetch()` de la llamada a Facebook lanza ANTES de recibir cualquier respuesta (timeout, conexión perdida), el error cae en el camino genérico de `retryPolicy.mts` → **retryable → vuelve a `pending`**, borrando el placeholder de checkpoint. Esto es la misma convención ya probada deliberadamente para YouTube (`TEST 9`, "fallo de red antes de respuesta -> NUNCA `PublicationOutcomeUncertainError`") — pero para YouTube esa convención es **segura por diseño del protocolo** (una subida resumible interrumpida jamás produce un video completo, garantía documentada del propio protocolo de Google). **Facebook no tiene esa garantía**: es una única llamada POST no idempotente, sin protocolo por fases — un fallo de red justo cuando Facebook ya procesó la petición server-side pero antes de que la respuesta llegue al cliente es indistinguible, con el código actual, de "la petición nunca llegó". Esto es un **riesgo residual real**, caracterizado y probado explícitamente (`TEST 13` en `test-uncertain-outcome.mts`), pero **no corregido**, porque arreglarlo unilateralmente para Facebook (tratando cualquier fallo de red como incierto) no resolvería nada — no hay forma de reconciliar esa incertidumbre después (§1.G) — y cambiar la convención cross-plataforma está fuera del alcance de una auditoría específica de Facebook.

## 5. Solución técnica: NO existe una segura con el método actual

Siguiendo la instrucción de no forzar una implementación: **no se construyó `reconcileFacebook()`**. Lo que se necesitaría para que Facebook alcance el mismo nivel que YouTube/Instagram:

- **Opción real, documentada por Meta**: migrar de la subida simple (`file_url` en una sola llamada) al protocolo de subida por fases (`upload_phase=start` → devuelve un `upload_session_id` ANTES de transferir bytes → `upload_phase=transfer` → `upload_phase=finish`) — arquitectónicamente análogo al protocolo resumible de YouTube, con un handle intermedio real que sí permitiría checkpoint+reconciliación. **Esto es una reescritura del publisher de Facebook**, no un ajuste — requiere autorización explícita en una fase futura (ya estaba anotado como pendiente desde el informe original de Fase 5.4).
- Sin esa migración, no existe ninguna base segura para construir una reconciliación real de Facebook.

## 6. Tests

`agent/publish/test-uncertain-outcome.mts` — 3 casos nuevos (24 totales en el archivo, todos 🟢):
- **TEST 12/12b** — JSON válido sin `id`/con `id` vacío → `PublicationOutcomeUncertainError` (corrige el gap real).
- **TEST 13** — caracterización explícita del riesgo residual (fallo de red antes de respuesta → sigue sin ser tratado como incierto, documentado como no corregido).

No se creó ningún `reconcileFacebook()` de prueba porque no existe una base segura que probar (instrucción explícita: no fabricar una implementación).

Regresión completa: `uncertain-outcome` 24/24, `claim-recovery` 18/18, `publish-authorization` 8/8, `gap-closure-5.4.3` 13/13, `reconciliation` 20/20, `tsc --noEmit` limpio. **Total: 83/83.**

## 7. Supabase (solo lectura)

4/4 `social_posts` reales intactas (`pending`/`retry_count=0`/resto `null`). Cero escrituras.

## 8. Cambios realizados

- `lib/social/facebook.ts` — validación de `id` no vacío antes de declarar éxito (nuevo caso de `PublicationOutcomeUncertainError`).
- `agent/publish/test-uncertain-outcome.mts` — 3 tests nuevos (12/12b/13).
- `docs/phase-5.11-facebook-reconciliation.md` (este archivo).
- Ningún cambio en `reconciliation.mts`, `claimPost.mts`, `run.mts`, flags, `channel_status` ni credenciales.

## 9. Qué NO fue verificado

- Reconciliación real de Facebook contra la API — **BLOQUEADO**, no existe base segura con el método actual (no un simple "no verificado todavía", sino "no verificable con esta arquitectura").
- El riesgo residual de §4 (fallo de red antes de respuesta) permanece sin corregir, documentado explícitamente.

## 10. Recomendación para Fase 5.12

No intentar "parchear" la reconciliación de Facebook sin antes decidir, explícitamente y con autorización, si se migra el publisher al protocolo de subida por fases de Meta (única vía real conocida para darle a Facebook un operation_ref intermedio) — o si se acepta el riesgo residual de forma permanente y documentada (opción ya contemplada desde Fase 5.4: "aceptar riesgo residual vs. migrar a chunked-upload API"). Cualquiera de las dos es una decisión de producto/riesgo, no una corrección de código.

```
git status --short / git diff --check / HEAD → ver reporte final.
```

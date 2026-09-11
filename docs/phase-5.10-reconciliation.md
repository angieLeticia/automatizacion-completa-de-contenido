# Fase 5.10 — Reconciliación real de YouTube e Instagram (sin publicación real)

> Alcance: auditar y endurecer `agent/publish/reconciliation.mts` (las
> funciones que consultan el estado real de una operación incierta). Ninguna
> publicación real se ejecutó en esta fase — `reconcileYouTube()`/
> `reconcileInstagram()` son funciones de **solo consulta** (status-check),
> nunca de creación de contenido nuevo.

## 1. Auditoría de la implementación actual

| Punto | YouTube | Instagram | Clasificación |
|---|---|---|---|
| A/B. Valor usado como `publisher_operation_ref` | `uploadUrl` (header `Location` de la sesión resumible) | `creationId` (id del contenedor de media) | VERIFICADO POR CÓDIGO (`lib/social/youtube.ts:87`, `instagram.ts:35`) |
| C. Momento de persistencia | ANTES del PUT de bytes (vía `onOperationRef`) | ANTES del polling y de `media_publish` (vía `onOperationRef`) | VERIFICADO POR CÓDIGO + CON TEST (`test-uncertain-outcome.mts`) |
| D. Función que reconcilia | `reconcileYouTube(uploadUrl, contentLength)` | `reconcileInstagram(creationId, accessToken)` | VERIFICADO POR CÓDIGO + CON TEST (nuevo, esta fase) |
| E. Respuesta esperada | PUT vacío con `Content-Range: bytes */TOTAL` → código HTTP (201/308/404/otro) | `GET /{creation_id}?fields=status_code` → JSON `{status_code}` | VERIFICADO POR CÓDIGO, semántica citada de documentación oficial (heredado de Fase 5.4 — no se re-consultó la documentación en esta sesión) |
| F. Estados posibles | `CONFIRMED_PUBLISHED` / `CONFIRMED_NOT_PUBLISHED` / `CANNOT_VERIFY` (≡ UNKNOWN) | mismos 3 | VERIFICADO CON TEST |
| G. API de reconciliación no disponible (timeout/red) | **Antes de esta fase: lanzaba sin capturar.** Corregido: `CANNOT_VERIFY` | igual, corregido | VERIFICADO CON TEST (nuevo) |
| H. La operación no existe | `404` → `CANNOT_VERIFY` (nunca `CONFIRMED_NOT_PUBLISHED` — sesión expirada no es evidencia de "no publicado") | HTTP no-ok con "no existe" → `CANNOT_VERIFY` | VERIFICADO CON TEST |
| I. La operación sí existe | `201` → `CONFIRMED_PUBLISHED`; `308` → `CONFIRMED_NOT_PUBLISHED` (incompleta) | `status_code='PUBLISHED'` → `CONFIRMED_PUBLISHED`; `'ERROR'` → `CONFIRMED_NOT_PUBLISHED` | VERIFICADO CON TEST |
| J. Respuesta ambigua (429/500/JSON malformado/campo ausente) | `CANNOT_VERIFY` | `CANNOT_VERIFY` | VERIFICADO CON TEST (nuevo) |

**Ninguno de los 10 puntos está VERIFICADO CONTRA API REAL** — no hay credenciales OAuth reales disponibles ni autorizadas en este entorno. Esto no cambió en esta fase y no se intentó cambiar (regla explícita de la Fase 5.10: no ejecutar publishers reales).

## 2. YouTube

- **Implementación:** `reconcileYouTube()` hace un PUT vacío al mismo `uploadUrl` con `Content-Range: bytes */TOTAL`, exactamente el protocolo de status-check documentado por Google para subidas resumibles — no requiere `Authorization` de nuevo porque la propia URL de sesión ya está autenticada (diseño heredado de Fase 5.4, verificado por lectura del código, no re-confirmado contra la documentación en esta sesión).
- **Tests:** `test-claim-recovery.mts` (mapeo puro 201/308/404/500) + `test-reconciliation.mts` (nuevo, esta fase: 201/404/429/500/timeout contra `reconcileYouTube()` real, con `fetch` stubbeado).
- **API real:** **NO VERIFICADO.** Requeriría una sesión de subida resumible real y en curso — no se fabricó ninguna (regla explícita: no hacer upload real).
- **Limitaciones conocidas:** la duración exacta antes de que una sesión expire (que produce el 404) no está confirmada en la documentación consultada en Fase 5.4; comportamiento ante un `uploadUrl` sintácticamente inválido no probado (edge case de bajo valor, no bloqueante).

## 3. Instagram

- **Implementación:** `reconcileInstagram()` hace `GET /{creation_id}?fields=status_code` contra la Graph API — el mecanismo que Meta documenta explícitamente para este escenario (`media_publish` no devolvió el ID final).
- **Tests:** `test-claim-recovery.mts` (mapeo puro PUBLISHED/ERROR/EXPIRED/FINISHED/IN_PROGRESS) + `test-reconciliation.mts` (nuevo: PUBLISHED/ERROR/400/429/500/timeout/JSON malformado/campo ausente/401 contra `reconcileInstagram()` real, con `fetch` stubbeado).
- **API real:** **NO VERIFICADO.** Requeriría un `creationId` real de un contenedor de media existente — no se fabricó ninguno (regla explícita: no ejecutar `media_publish` real ni crear un contenedor real).
- **Limitaciones conocidas:** ninguna adicional a lo ya documentado en Fase 5.4.

## 4. Modelo de resultados

`ReconciliationResult = "CONFIRMED_PUBLISHED" | "CONFIRMED_NOT_PUBLISHED" | "CANNOT_VERIFY"` — el nombre `CANNOT_VERIFY` (elegido en Fase 5.4) es semánticamente idéntico al `UNKNOWN` que pide esta fase; no se renombró (evitar refactor innecesario sobre un tipo ya usado en 4 archivos y 40+ tests). Ninguna de las 3 clasificaciones dispara automáticamente ninguna escritura en Supabase — `reconcileUnknownPublication()` **no está conectada a ningún llamador automático** (confirmado por grep: cero referencias fuera de sus propios tests), es una función pura de consulta que un futuro proceso/admin humano invocaría manualmente y decidiría qué hacer con el resultado. Por construcción, `CANNOT_VERIFY`/`UNKNOWN` no puede "volver a pending" porque **nada llama a esta función automáticamente para empezar**.

## 5. Pruebas adversariales

20/20 nuevos casos en `agent/publish/test-reconciliation.mts` (`npm run reconciliation:test`), cubriendo los 12 escenarios pedidos: operación encontrada (1), HTTP ambiguo tratado como incierto y no como negativo (3), 429→UNKNOWN (4), 500→UNKNOWN (5), timeout→UNKNOWN (6, antes lanzaba — corregido en esta fase), respuesta malformada→UNKNOWN (7/7b, antes lanzaba en Instagram — corregido), credenciales inválidas→UNKNOWN (8), `operation_ref` vacío/null→no reconcilia (9/9b/9c), plataforma incorrecta→bloqueada (10/10b), y el camino positivo real por el dispatcher completo (12). Punto 11 del pedido ("channel/account incorrectos → bloquear") no aplica a este módulo — `reconciliation.mts` no recibe ni channel ni account, esa validación es responsabilidad de `resolveIdentity.mts`/`channelAuthorization.mts` (ya cubierta, `publish-authorization:test`) y `reconcileUnknownPublication()` no tiene ningún código que pudiera saltársela porque nunca la consulta.

## 6. Supabase (solo lectura)

4/4 `social_posts` reales intactas: `pending`/`retry_count=0`/`error_message=null`/`external_post_id=null`/`published_at=null`/`claimed_at=null`/`publisher_operation_ref=null`. Cero escrituras.

## 7. Seguridad

Confirmado por lectura de código (sin cambios en esta fase salvo el try/catch ya descrito):
- `reconcileUnknownPublication()`/`reconcileYouTube()`/`reconcileInstagram()` **no importan `PUBLISHERS`**, no llaman a ningún `publish()`, no tienen ningún código que escriba en `social_posts` — son funciones puras de consulta/clasificación, sin efectos secundarios en Supabase.
- No leen ni escriben `DRY_RUN`, `channel_status`, ni resuelven identidad — no pueden saltarse `resolveIdentity`/`channelAuthorization` porque nunca las invocan ni son invocadas por ellas.
- No existe ningún endpoint/función de reconciliación que, como efecto colateral, cree o modifique una publicación: el PUT de YouTube es un status-check idempotente sobre una sesión ya existente (no sube bytes nuevos), y el GET de Instagram es una lectura pura.

## 8. Documentación

Separada explícitamente por plataforma en §2/§3 arriba, sin marcar como "REAL VERIFIED" nada que solo se probó con `fetch` stubbeado.

## 9. Cambios realizados

- `agent/publish/reconciliation.mts` — `reconcileYouTube()`/`reconcileInstagram()` envueltos en try/catch (fallo de red/parseo → `CANNOT_VERIFY` en vez de lanzar); `reconcileInstagram()` además valida que `status_code` sea un string antes de mapearlo.
- `agent/publish/test-reconciliation.mts` (nuevo) — 20 casos adversariales reales contra las funciones de fetch, no solo los mapeadores puros.
- `package.json` — nuevo script `reconciliation:test`.
- `docs/phase-5.10-reconciliation.md` (este archivo).

## 10. Qué queda sin verificar

- `reconcileYouTube()`/`reconcileInstagram()` contra la API real de la plataforma (requiere OAuth real + una operación en curso genuina).
- El comportamiento exacto de YouTube ante un `uploadUrl` sintácticamente inválido.
- Cualquier orquestador que, en el futuro, tome el resultado de `reconcileUnknownPublication()` y decida escribir `published`/mantener `verification_required` en Supabase — **no existe todavía tal orquestador**; esta fase deja la función de consulta endurecida, no construye el flujo de decisión automática (deliberado — construirlo sería introducir publicación/transición automática, fuera del alcance explícito de esta fase).

## Recomendación para Fase 5.11

No construir un orquestador automático de reconciliación sin antes tener credenciales OAuth reales de al menos una cuenta de prueba para validar `reconcileYouTube()`/`reconcileInstagram()` contra la plataforma real — de lo contrario, cualquier lógica de "qué hacer con `CONFIRMED_PUBLISHED`" se estaría construyendo sobre una premisa nunca confirmada en la práctica.

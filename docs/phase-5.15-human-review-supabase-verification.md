# Fase 5.15 — Migración y verificación real de Human Review

> Migración aplicada por el usuario en el SQL Editor de Supabase (sin capacidad
> DDL de mi lado). Verificación completa contra Supabase real con 1 fila
> temporal aislada, eliminada al finalizar. Ninguna de las 4 `social_posts`
> reales fue tocada. Sin publicación real, sin cambios de `DRY_RUN`/
> `CLAIMED_AT_MIGRATION_APPLIED`/`channel_status`/credenciales.

## 1. Estado antes de la migración

Confirmado por sondeo directo (Fase 5.14 y re-confirmado al abrir esta fase): `social_posts.publication_authorized_at`/`publication_authorized_by` **no existían** en Supabase real (`"column ... does not exist"`).

## 2. SQL aplicado

Ejecutado por el usuario en el SQL Editor, dentro de una transacción:

```sql
BEGIN;
ALTER TABLE public.social_posts ADD COLUMN publication_authorized_at TIMESTAMPTZ NULL;
ALTER TABLE public.social_posts ADD COLUMN publication_authorized_by TEXT NULL;
COMMIT;
```

Exactamente el SQL ya documentado en `supabase/schema.sql` — ninguna otra estructura, ningún otro cambio.

## 3. Resultado de la migración

`Success. No rows returned` (reportado por el usuario). No re-ejecutado.

## 4. Estructura real de columnas (verificado, no asumido)

Confirmado por `SELECT` directo tras la migración: ambas columnas **existen** y aceptan lectura/escritura (probado en el paso 7-10 abajo con datos reales, incluyendo valores no-nulos). Nullability confirmada por comportamiento observado: las 4 filas reales preexistentes quedaron con ambos campos en `NULL` automáticamente tras el `ADD COLUMN` (comportamiento esperado de una columna nullable sin `DEFAULT`). Tipo (`TIMESTAMPTZ`/`TEXT`) no re-verificado vía `information_schema` (sigue sin ser accesible por PostgREST, mismo límite de siempre) — se infiere consistente con el propio SQL ejecutado, que es el único que pudo haberse aplicado (`Success` en una única sentencia `ADD COLUMN <tipo>`).

## 5. Snapshot antes/después — 4 `social_posts` reales

Idénticas en todos los campos preexistentes; nuevas columnas en `NULL`:

```json
[{"id":"296ec9b7-...","status":"pending","retry_count":0,"error_message":null,"external_post_id":null,"published_at":null,"claimed_at":null,"publisher_operation_ref":null,"publication_authorized_at":null,"publication_authorized_by":null}, ... (4 filas)]
```

Verificado por comparación programática exacta (no visual) contra el snapshot pre-migración de Fase 5.15 — **coincidencia total**.

## 6-10. Pruebas reales con registro temporal (creado, probado, eliminado)

UUID temporal: `beb2ec5a-d106-4921-9e42-037105fb2cf6` (eliminado al finalizar, confirmado 0 restantes).

| Test | Resultado |
|---|---|
| A — sin autorización | `publication_authorized_at/_by = NULL` por defecto; `isPublicationAuthorized() = false` |
| B(A) — `at` presente, `by` ausente | `isPublicationAuthorized() = false` |
| B(B) — `by` presente, `at` ausente | `isPublicationAuthorized() = false` |
| C — `authorizePublication()` real | `ok:true, alreadyAuthorized:false`; Supabase real confirma ambos campos no-nulos; `isPublicationAuthorized() = true` |
| D — idempotencia (2ª llamada, OTRO autor) | `ok:true, alreadyAuthorized:true`; **conserva** el autor/timestamp ORIGINAL — Supabase real confirma que NO se sobreescribió con el segundo autor |
| E — revocación | `revokePublicationAuthorization()` → `ok:true`; Supabase real confirma ambos campos vueltos a `NULL`; `isPublicationAuthorized() = false` |

## 11. DRY_RUN

Con el registro temporal **completamente autorizado** (Human Review = true), se evaluó la expresión REAL del gate combinado de `run.mts` con el valor REAL de `DRY_RUN` (importado de `config.mts`, no simulado): `DRY_RUN(true) || !channelAuthorized || !humanAuthorized` → **`true` (bloqueado)**. `DRY_RUN` no se tocó.

## 12. channel_status

Misma expresión, usando el valor REAL de las 3 `content_accounts` (`HISTORICAL`) vía `evaluateChannelAuthorization("HISTORICAL")` real: `authorizedForRealPublication = false` → el gate combinado sigue bloqueado aunque Human Review sea `true`. Ninguna `content_account` fue modificada.

## 13. Identity

No se replicó un escenario cruzado canal A/cuenta B en esta fase (evaluado como complejidad innecesaria para lo que esta fase debía verificar — ver §17 "Alcance deliberado"). La garantía de que Human Review no sustituye a identity sigue siendo la misma ya verificada por código y tests en Fases 5.2.1/5.4.2/5.14 (`resolveIdentity.mts`, chequeo explícito de `channel_id`), sin cambios en esta fase.

## 14. Limpieza

Registro temporal eliminado y confirmado (`SELECT` posterior → 0 filas). Las 4 `social_posts` reales y las 3 `content_accounts` reales re-verificadas **idénticas** al estado post-migración (antes de crear el temporal). Ningún archivo temporal de auditoría quedó en el repo (`.tmp-audit-515-*` creados y eliminados en el mismo turno cada vez).

## 15. Regresión completa

`tsc --noEmit` limpio. `human-review:test` (archivo de test permanente, sin cambios en esta fase) 24/24 🟢. Script de auditoría temporal de esta fase (27 casos contra Supabase real con la columna ya migrada, no persistido — ver nota abajo) también 27/27 🟢. Resto de Agent 3: `uncertain-outcome` 24/24, `claim-recovery` 18/18, `publish-authorization` 8/8, `gap-closure-5.4.3` 13/13, `reconciliation` 20/20. Agent 1/2 sin regresiones: `ingestion` 12/12, `machine`, `provider` 13/13, `derived-content` 13/13.

**Nota sobre el script de verificación de esta fase:** el script de 27 casos que ejercitó `authorizePublication()`/`revokePublicationAuthorization()` contra Supabase real con el registro temporal fue una prueba de **auditoría** (`.tmp-audit-515-live-test.mts`), no un archivo de test permanente — se creó, ejecutó y eliminó en este turno, siguiendo la misma convención ya usada en Fases 5.5/5.6/5.8/5.9/5.10/5.11/5.12/5.13/5.14 para pruebas que requieren datos reales de Supabase. `agent/publish/test-human-review.mts` (el archivo de test permanente, 24 casos) no se modificó en esta fase — sigue siendo válido y ya cubre toda la lógica pura; la parte que solo podía probarse una vez migrada la columna quedó demostrada aquí, en el informe, con evidencia real.

## 16. Riesgos residuales

Ninguno nuevo. Human Review es ahora una capacidad completamente real y verificada de punta a punta (columnas + lectura + escritura + idempotencia + revocación + composición con `DRY_RUN`/`channel_status`), sin ningún camino de bypass encontrado.

## 17. Alcance deliberado — qué NO se hizo y por qué

- No se ejecutó el pipeline completo de `processPost()` contra el registro temporal (resolución de `content_file`/Storage/identidad real) — habría requerido fabricar un `content_file` sintético, un archivo de video real en disco, y una `content_account` de prueba: complejidad desproporcionada para lo que esta fase necesitaba demostrar. La ubicación estructural del gate (antes del checkpoint/publisher) ya está verificada por código y tests desde Fase 5.14 y no cambió.
- No se probó un escenario de identidad cruzada (canal A → cuenta de canal B) — cubierto ya, sin cambios, por `resolveIdentity.mts` y sus tests existentes.

## Cambios realizados en esta fase

Ningún archivo de código modificado — esta fase fue exclusivamente migración (ejecutada por el usuario) + verificación real + regresión + documentación (`docs/phase-5.15-human-review-supabase-verification.md`, este archivo).

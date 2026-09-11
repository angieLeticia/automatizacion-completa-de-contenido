# Fase 5.14 — Cierre del gate de Human Review de Agent 3

> Alcance: cerrar exclusivamente la brecha de revisión humana encontrada en
> Fase 5.13. Ningún publisher nuevo, ninguna publicación real, sin cambios de
> `DRY_RUN`/`CLAIMED_AT_MIGRATION_APPLIED`/`channel_status`/credenciales, sin
> tocar las 4 `social_posts` reales, sin nueva tabla `episodes`.

## 1. Problema encontrado en Fase 5.13

`social_posts.publication_authorized_at`/`publication_authorized_by` existían en `supabase/schema.sql` (propuestas desde Fase 2.1/4.1) pero **ningún código las leía ni las escribía** — confirmado por grep exhaustivo. El gate efectivo de publicación real era únicamente `DRY_RUN` + `channel_status` (por canal/global), sin ninguna autorización explícita por publicación/post individual, contradiciendo el requisito documentado en `docs/system-contracts.md §4`.

## 2. Estado anterior (auditoría previa, esta fase)

- **Tipo exacto:** `publication_authorized_at TIMESTAMPTZ`, `publication_authorized_by TEXT` — ambas **nullable**, sin `DEFAULT`, sin `CHECK`, sin `FK`, sin `UNIQUE` (`supabase/schema.sql:165-166`, confirmado por lectura directa).
- **¿Existen ya en producción real?** **NO** — confirmado por sondeo directo de columna (`SELECT publication_authorized_at` → `"column social_posts.publication_authorized_at does not exist"`). A diferencia de `claimed_at` (que sorprendió existiendo ya en Fase 5.5), aquí el comentario "no aplicado aún" del schema **es correcto**.
- **Estados actuales de `social_posts`:** `pending | publishing | published | error | verification_required` (sin cambios en esta fase).
- **Cómo se crea un `social_post`:** `agent/schedule/scheduleContent.mts::scheduleReadyContent()` inserta directamente en `social_posts` cuando `content_metadata.status='ready'` — sin ningún gate de autorización humana hoy (confirmado, sin cambios en esta fase).
- **Dónde se decide "este post puede publicarse":** `agent/publish/run.mts::processPost()`, línea ~87 — la condición combinada `DRY_RUN || !identityOutcome.authorizedForRealPublication`.
- **¿Función de autorización parcial ya implementada?** No — cero referencias a `publication_authorized_at`/`_by` en código antes de esta fase.
- **¿UI/admin en este repositorio?** No existe ningún panel `/admin` dentro de `automatizacion-completa-de-contenido` — el panel `/admin/social` mencionado en `system-contracts.md` vive en el repositorio **Visteapy-web** (otra app), fuera del alcance de este repo y de esta fase (regla vigente: nunca tocar Visteapy).

## 3. Diseño elegido

Servicio central de autorización, con la lógica separada en 2 archivos (mismo patrón ya establecido 4 veces en este proyecto — `channelAuthorization.mts`, `staleClaimClassification.mts`, `uncertainOutcome.mts`):

- **`agent/publish/humanReviewGate.mts`** (puro, sin `supabaseClient.mts`): `isPublicationAuthorized(post)` (¿tiene AMBOS campos, no vacíos?), `describeAuthorizationGap(post)` (mensaje de log), `evaluateAuthorizationEligibility(status)` (¿tiene sentido autorizar este post? — solo bloquea `'published'`).
- **`agent/publish/publicationAuthorization.mts`** (toca Supabase real): `authorizePublication(postId, authorizedBy)`, `revokePublicationAuthorization(postId)`.

**Filosofía deliberadamente distinta a `CLAIMED_AT_MIGRATION_APPLIED`:** aquella bandera hace que el código nuevo sea inerte (no-op) mientras la migración no está aplicada — seguro porque su ausencia no desbloqueaba nada. Aquí es al revés: la ausencia de la migración/autorización debe **bloquear activamente**. Por eso no existe ninguna bandera "aplicado/no aplicado" — `isPublicationAuthorized()` trata "el campo no existe todavía" (columna ausente, migración no aplicada) exactamente igual que "el campo existe pero es `null`": **nunca autorizado por defecto**, con o sin la migración.

**No se usó `content_metadata.publication_authorized_at`** (como proponía el diseño original de `system-contracts.md §4`) sino `social_posts.publication_authorized_at`/`_by` — la columna que realmente quedó en `schema.sql`. Es una autorización MÁS granular (por plataforma/publicación, no por episodio+canal), coherente con que un mismo episodio genera varias `social_posts` (una por plataforma) con calendarios independientes. Anotado en `docs/system-contracts.md` como `[ACTUALIZADO — Fase 5.14]`, sin reescribir el párrafo original.

## 4. Punto exacto donde se aplica el gate

`agent/publish/run.mts::processPost()`, en la MISMA condición que ya evaluaba `DRY_RUN`/`channel_status` (línea ~87-113):

```ts
const humanAuthorized = isPublicationAuthorized(post);
if (DRY_RUN || !identityOutcome.authorizedForRealPublication || !humanAuthorized) {
  // ... log con el motivo exacto (DRY_RUN / channel_status / describeAuthorizationGap) ...
  await revertToPending(post.id);
  return;
}
```

**Por qué DESPUÉS del claim (no antes, no en la consulta de `main()`):**
1. Filtrar por `publication_authorized_at`/`_by` en la consulta de `main()` (`.eq("status","pending").lte(...)`) sería una referencia explícita a esas columnas — **lanzaría hoy** ("column does not exist") porque a diferencia de `SELECT *`, un filtro sí valida la columna en tiempo de planificación, exista o no una fila que la use. Filtrar ahí rompería `main()` por completo, incluso el modo DRY_RUN.
2. `claimPost()` usa `.select("*")` — Postgres simplemente omite columnas inexistentes de un `SELECT *` (no es un error) — así que el `post` que llega al gate siempre trae `publication_authorized_at`/`_by` como `undefined` hoy, o como su valor real una vez migrado. Ningún cambio de comportamiento entre "columna no existe" y "columna existe pero es null".
3. Reclamar y revertir un post sin autorización tiene exactamente el mismo costo, ya aceptado desde Fase 4B.1, que reclamar y revertir uno en `DRY_RUN` o `channel_status=TEST` — no es un desperdicio nuevo.
4. Colocarlo DESPUÉS de identity/channel_status (no antes) es necesario porque el mensaje de log distingue los 3 motivos con prioridad (`DRY_RUN` > `channel_status` > autorización humana) — y porque no tiene sentido evaluar autorización humana de un post cuya identidad ya está mal (channel_id mismatch, cuenta inactiva) antes de descartarlo por esas razones más fundamentales.

## 5. Comportamiento de autorización (`authorizePublication`)

1. Rechaza `authorizedBy` vacío/solo espacios sin tocar Supabase.
2. Consulta el post usando **solo columnas ya existentes** (`id, status`) — permite detectar "post inexistente" y "ya publicado" **sin depender de la migración**.
3. Bloquea si `status==='published'` (único caso — autorizar algo que ya ocurrió no tiene efecto útil).
4. Consulta el estado real de autorización (`publication_authorized_at`/`_by`) — **este paso SÍ requiere la migración aplicada**; si no lo está, devuelve un error claro que menciona explícitamente la posibilidad ("¿la migración de Fase 5.14 ya está aplicada?").
5. **Idempotente**: si ya está autorizado, devuelve la autorización EXISTENTE sin sobreescribirla — una re-autorización (accidental o de otra persona) nunca borra el registro de quién autorizó primero.
6. Si no está autorizado, escribe `publication_authorized_at=now()` + `publication_authorized_by`.

## 6. Comportamiento ante revocación

`revokePublicationAuthorization(postId)` — mismas comprobaciones de elegibilidad (bloqueada para `'published'`), pone ambos campos a `null`. Revocar **nunca despublica nada** — solo previene una publicación futura que aún no ocurrió.

## 7. Relación con claim/recovery

Ninguna interacción nueva. `claimPost()`/`recoverStaleClaims()`/`classifyStaleClaim()` no se modificaron — el gate de autorización se evalúa DESPUÉS de un claim ya exitoso, con las mismas consecuencias de "no autorizado para publicar ahora" que ya existían (`revertToPending()`). Un post en `verification_required` con una autorización previa (de antes de que algo saliera mal) **no se reactiva automáticamente** — la garantía es estructural: `main()` solo consulta `status='pending'`, así que `verification_required` nunca vuelve a evaluarse, con o sin autorización.

## 8. Relación con `channel_status`

Condición completamente independiente y adicional — ninguna autorización humana puede compensar un `channel_status` que no autoriza (`HISTORICAL`/`BLOCKED`/`TEST`/`READY`), verificado por la prueba de composición pura (`test-human-review.mts`, casos 12-14).

## 9. Relación con `DRY_RUN`

Igual — `DRY_RUN=true` sigue interceptando antes que cualquier otra cosa, autorización humana incluida.

## 10. Relación con identity

`resolveIdentity.mts` no se tocó — el gate de autorización se evalúa DESPUÉS de que la identidad (channel_id match, cuenta activa) ya fue validada. Un mismatch de identidad bloquea antes de que la autorización humana siquiera se consulte.

## 11. Tests

`agent/publish/test-human-review.mts` (`npm run human-review:test`) — **24/24 🟢**:
- 1-4, 7-8: lógica pura de `humanReviewGate.mts` (sin autorización, autorización parcial en ambas direcciones, autorización completa, elegibilidad por status, no-reactivación de `verification_required`).
- 9-11: verificado por inspección de código (ningún import de `publishers.ts`/`./config.mts` en los 2 archivos nuevos).
- 12-14: composición pura del gate combinado (`DRY_RUN || !channelAuthorized || !humanAuthorized`) — prueba que ninguna combinación de 2 de 3 condiciones basta.
- 5: **`authorizePublication()` contra Supabase REAL** — post inexistente, `VERIFIED AGAINST REAL SUPABASE` (no requiere la migración, usa solo `id`/`status`).
- 6 (idempotencia) y el resto del camino de escritura real: **NOT VERIFIED AGAINST REAL SUPABASE** — requieren la migración de las 2 columnas nuevas, no aplicada (ver §13).

Regresión completa ejecutada tras los cambios: `tsc --noEmit` limpio; `uncertain-outcome` 24/24, `claim-recovery` 18/18, `publish-authorization` 8/8, `gap-closure-5.4.3` 13/13, `reconciliation` 20/20 (Agent 3, **107/107** incluyendo `human-review`); `ingestion` 12/12, `machine`, `provider` 13/13, `derived-content` 13/13 (Agent 1/2, sin regresiones).

## 12. Supabase verification

Solo lectura antes y después de implementar: las 4 `social_posts` reales — `pending`/`retry_count=0`/`error_message=null`/`external_post_id=null`/`published_at=null`/`claimed_at=null`/`publisher_operation_ref=null` — **byte-a-byte idénticas** en ambos momentos. Cero `UPDATE`/`INSERT`/`DELETE` sobre las 4 filas reales o sobre `content_accounts`. Ninguna de ellas fue autorizada.

## 13. Limitaciones

- El camino de escritura completo de `authorizePublication()` (autorizar de verdad, idempotencia sobre una autorización ya existente) **no se puede probar contra Supabase real** hasta que se aplique la migración de las 2 columnas — exactamente la misma limitación, ya aceptada, que tuvieron `claimed_at`/`publisher_operation_ref` antes de Fase 5.5. No se fabricó ninguna prueba fingiendo esa migración.
- No se agregó ningún estado de "cancelado/rechazado" a `social_posts.status` — evaluado explícitamente y descartado por innecesario para el objetivo mínimo de esta fase ("un post no autorizado no puede publicarse", ya logrado sin ese estado). Un rechazo explícito, si se necesita en el futuro, es una decisión de producto separada (¿nuevo valor de `status` vía migración, o simplemente dejarlo sin autorizar indefinidamente?).
- No se protege contra "autorizar el post equivocado por error humano" a nivel de código — `authorizePublication()` confía en el `postId` exacto que reciba, igual que toda otra función de este código confía en sus IDs de entrada. La protección real contra publicar en el canal/cuenta equivocados sigue siendo `resolveIdentity.mts` (independiente, ya verificado), no la autorización.

## 14. Qué queda para la futura UI/admin

No existe ninguna interfaz para llamar `authorizePublication()`/`revokePublicationAuthorization()` — deliberadamente fuera de esta fase (regla explícita: no construir UI). Cuando se autorice: (a) aplicar la migración de las 2 columnas (SQL exacto en `supabase/schema.sql`), (b) conectar estas 2 funciones desde donde corresponda (`/admin/social` en Visteapy-web, o una CLI local) — ninguna requiere cambios adicionales en `agent/publish/*`, el punto de integración ya está completo y probado en el lado de Agent 3.

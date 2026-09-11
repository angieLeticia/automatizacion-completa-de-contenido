# Fase 5.9 — Auditoría de cierre del bloque claim/recovery

> Alcance: cerrar y documentar todo el trabajo acumulado desde el commit local
> `2caad92` (Fase 5.4) hasta la activación persistente de
> `CLAIMED_AT_MIGRATION_APPLIED=true` (Fase 5.8), dejar el repositorio limpio
> y trazable, y preparar el terreno para la siguiente fase (reconciliación de
> plataformas). Ningún cambio de código en esta fase — solo documentación y
> verificación read-only.

## 1. Estado Git (antes y después — sin cambios funcionales en esta fase)

```
RM .github/workflows/publish-social.yml -> .github/workflows/publish-social.yml.retired
 M agent/publish/claimPost.mts
 M agent/publish/run.mts
 M docs/phase-5.4-claim-recovery.md   (esta fase — cierre añadido)
 M docs/system-contracts.md
 M docs/technical-inventory.md        (esta fase — fila de recovery actualizada)
 M lib/social/facebook.ts
 M lib/social/instagram.ts
 M lib/social/types.ts
 M lib/social/youtube.ts
 M package.json
 M supabase/schema.sql                (esta fase — comentarios "no aplicado" corregidos)
?? agent/publish/test-gap-closure-5.4.3.mts
?? agent/publish/test-uncertain-outcome.mts
?? agent/publish/uncertainOutcome.mts
?? docs/phase-5.4.3-gap-closure.md
?? docs/phase-5.9-closure.md
```

`git diff --check`: limpio (solo avisos benignos de LF→CRLF, preexistentes). `HEAD`: `2caad92`, sin cambios. Sin commit, sin push.

## 2. Temporales de Fase 5.8

`.tmp-audit-58-config-load-check.mts` y `.tmp-audit-58-postactivation-check.mts` — confirmado que **ya no existían** al iniciar esta fase (se crearon y borraron en el mismo turno de Fase 5.8, patrón usado consistentemente desde Fase 5.4.2). `Glob(".tmp-*")` sobre todo el repo: sin resultados.

## 3. Archivos funcionales — clasificación

| Archivo | Clasificación | Motivo |
|---|---|---|
| `.github/workflows/publish-social.yml` → `.yml.retired` | E — legacy/retired | Fase 5.4.3, GAP 1 |
| `agent/publish/claimPost.mts` | A — funcional | Fase 5.4 (checkpoint/recovery) + 5.4.1 (verificación de errores) + 5.4.3 (GAP 2) |
| `agent/publish/run.mts` | A — funcional | Fase 5.4.1 (manejo de resultado incierto) + 5.4.3 (GAP 3) |
| `lib/social/{youtube,instagram,facebook}.ts` | A — funcional | Fase 5.4.1 — `PublicationOutcomeUncertainError` |
| `lib/social/types.ts` | A — funcional | Fase 5.4.1 — nueva clase de error |
| `agent/publish/uncertainOutcome.mts` | A — funcional (nuevo) | Fase 5.4.1/5.4.3 — lógica pura extraída |
| `agent/publish/test-uncertain-outcome.mts` | C — test (nuevo) | Fase 5.4.1 |
| `agent/publish/test-gap-closure-5.4.3.mts` | C — test (nuevo) | Fase 5.4.3 |
| `package.json` | A/C — funcional (scripts de test) | Fase 5.4.1/5.4.3 |
| `docs/phase-5.4-claim-recovery.md` | B — documentación | Fase 5.4/5.4.1, cierre añadido en esta fase |
| `docs/system-contracts.md` | B — documentación | Fase 5.0/5.4.3 |
| `docs/technical-inventory.md` | B — documentación | actualizada en 5.4.3 y en esta fase |
| `docs/phase-5.4.3-gap-closure.md` | B — documentación (nuevo) | Fase 5.4.3 |
| `docs/phase-5.9-closure.md` | B — documentación (nuevo) | esta fase |
| `supabase/schema.sql` | B — documentación (comentarios) | corregido en esta fase, ver §8 |
| `.env.local` | D — configuración local ignorada | Fase 5.8, nunca aparece en `git status` |

**Ningún archivo se clasificó como F (cambio accidental).**

## 4. Bloque claim/recovery — 10 garantías reverificadas por inspección de código

1. **Claim atómico `pending→publishing`** — `claimPost.mts`: `UPDATE ... WHERE id=$1 AND status='pending'`, sin cambios. `VERIFIED AGAINST REAL SUPABASE` desde Fase 5.3.
2. **`claimed_at` con la bandera activa** — `claimPost.mts` línea ~25: `if (CLAIMED_AT_MIGRATION_APPLIED) { updatePayload.claimed_at = new Date().toISOString(); }`. Confirmado en vivo, Fase 5.6.
3. **Checkpoint `publisher_operation_ref`** — `markPublishAttemptStarted()` (placeholder, antes de `publish()`) + `persistOperationRef()` (referencia real, vía `onOperationRef`, llamado por YouTube/Instagram ANTES de su acción irreversible — confirmado línea por línea en Fase 5.4.2/5.4.4).
4. **Resultado incierto nunca se convierte en retry seguro** — `run.mts`: `PublicationOutcomeUncertainError` se intercepta con `instanceof` ANTES de cualquier clasificación por string, y llama a `finishWithUncertainOutcome()` (nunca `finishWithFailure()`/`decideRetry()`).
5. **Stale claim** — `classifyStaleClaim()`: `publisher_operation_ref=NULL` → `retry`/`pending`; presente → `verification_required`. Confirmado en vivo, Fase 5.6.
6. **`verification_required` sin transición automática** — grep repetido de `status\s*[:=]\s*["'](pending|publishing|...)["']` en todo el repo: cero escrituras que muevan una fila desde `verification_required`. `recoverStaleClaims()` solo consulta `status='publishing'`; `main()` solo consulta `status='pending'`.
7. **`DRY_RUN` bloquea antes del publisher** — `run.mts` línea 87, evaluado ANTES de `markPublishAttemptStarted`/`publish()`.
8. **`channel_status` es barrera independiente** — `evaluateChannelAuthorization()`, no depende de `DRY_RUN` ni de `CLAIMED_AT_MIGRATION_APPLIED` (grep confirma cero referencias cruzadas).
9. **`channel_id` mismatch bloquea** — `resolveIdentity.mts`: compara `contentAccount.channel_id !== account.channel_id` explícitamente, retorna `ok:false` si no coincide.
10. **`social_account.is_active=false` bloquea** — `resolveIdentity.mts`: chequeo explícito antes de continuar.

Las 10 garantías se sostienen sin cambios de código en esta fase.

## 5. Supabase (solo lectura)

4/4 `social_posts` reales: `status=pending`, `retry_count=0`, `error_message=null`, `external_post_id=null`, `published_at=null`, `claimed_at=null`, `publisher_operation_ref=null`. 3/3 `content_accounts` reales: `channel_status='HISTORICAL'`. Cero escrituras.

## 6. Flow A

`.github/workflows/publish-social.yml` no existe; `.github/workflows/publish-social.yml.retired` sí existe (único archivo en el directorio). `scripts/publish-due-social-posts.mts` conservado, sin ejecución automática posible.

## 7. Tests

`uncertain-outcome:test` (20/20 🟢), `claim-recovery:test` (18/18 🟢), `publish-authorization:test` (8/8 🟢), `gap-closure-5.4.3:test` (13/13 🟢) — 59/59 casos, todos con `CLAIMED_AT_MIGRATION_APPLIED=true` ya activo en `.env.local`.

## 8. Documentación corregida en esta fase

- `supabase/schema.sql` — los comentarios `[NUEVO/MODIFICADO — Fase 5.4, no aplicado aún en producción]` sobre `publisher_operation_ref` y el `CHECK` de `status` estaban desactualizados desde Fase 5.5; corregidos a `[APLICADO — Fase 5.5, VERIFIED AGAINST REAL SUPABASE]`, con nota adicional sobre la activación persistente de Fase 5.8.
- `docs/technical-inventory.md` — la fila de "Agent 3 — recuperación de claims" decía `NOT VERIFIED AGAINST REAL SUPABASE`; corregida a `VERIFIED AGAINST REAL SUPABASE` con referencia a Fases 5.5/5.6/5.8.
- `docs/phase-5.4-claim-recovery.md` — se añadió una sección de cierre (§"Cierre — Fases 5.5/5.6/5.8/5.9") sin reescribir el contenido original de diseño.
- **Deliberadamente NO se reescribieron** `docs/database-contract.md` ni `docs/phase-5.2-supabase-verification.md`: son informes fechados de fases anteriores que describen correctamente el estado **de ese momento** (Fase 5.2/5.2.2) — reescribirlos retroactivamente rompería la trazabilidad histórica que este proyecto ha mantenido consistentemente (siempre se anota "[ACTUALIZADO — Fase X]" en vez de editar el hallazgo original).
- La reconciliación real por plataforma (`reconcileUnknownPublication()`) sigue correctamente marcada `NOT VERIFIED AGAINST REAL PLATFORM` — no se infló esa verificación, ya que sigue siendo cierta (sin OAuth real).

## 9. Riesgos encontrados

Ninguno.

## 10. Cambios realizados en esta fase

Solo documentación: `supabase/schema.sql` (comentarios), `docs/technical-inventory.md` (1 fila), `docs/phase-5.4-claim-recovery.md` (sección de cierre añadida), `docs/phase-5.9-closure.md` (nuevo, este archivo). Ningún archivo de código (`*.mts`/`*.ts`) modificado. Ninguna prueba nueva creada (no era necesaria). Sin commit, sin push.

## Veredicto

🟢 **BLOQUE CLAIM/RECOVERY CERRADO Y REPOSITORIO LISTO PARA RECONCILIACIÓN.**

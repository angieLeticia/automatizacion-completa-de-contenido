# Fase 5.19 — Aprovisionamiento seguro de credenciales OAuth de YouTube por canal

> Alcance: exclusivamente la herramienta de setup manual
> (`scripts/get-youtube-refresh-token.mts`). Cero cambios en `agent/publish/*`,
> `lib/social/*`, `supabase/schema.sql`, Supabase, o Visteapy. Sin publicación,
> sin OAuth ejecutado en esta fase, sin commit.

## 1. Problema encontrado (Fase 5.18)

`scripts/get-youtube-refresh-token.mts` solo leía las variables **genéricas**
(`YOUTUBE_CLIENT_ID`/`YOUTUBE_CLIENT_SECRET`, sin canal). En algún momento esas
variables genéricas contenían las credenciales de **Enciende El Caos**; al
correr el script creyendo configurar **Sin Explicación**, se generó (y estuvo
a punto de usarse) un `refresh_token` de la cuenta equivocada. El nuevo gate
de identidad estructural (Fase 5.18) lo detectó correctamente en producción,
pero el error debería haber sido imposible desde el origen.

## 2. Causa raíz

Ningún código de Agent 3 lee `.env.local` para OAuth — confirmado por
auditoría exhaustiva (Fase 5.19, paso previo): `lib/social/youtube.ts` recibe
credenciales por parámetro, siempre desde `social_accounts.credentials`
(Supabase). El **único** consumidor de código de esas variables de entorno
es este script de setup, y hasta esta fase no tenía ninguna noción de "para
qué canal estoy generando este token" — dependía enteramente de que el
humano copiara manualmente el valor correcto a la variable genérica antes de
correrlo.

## 3. Arquitectura actual (sin cambios en esta fase)

```
content_account.channel_id (FK) === social_account.channel_id (FK)
  → social_account.credentials (JSONB, 1:1 con la fila) [Supabase, fuente de verdad real]
  → lib/social/youtube.ts / youtubeChannelIdentity.mts [Fase 5.18, sin tocar]
```

Esta cadena ya era segura por diseño (FK + `UNIQUE(channel_id, platform)`) —
el riesgo nunca estuvo aquí.

## 4. Solución implementada

**Nuevo:** `scripts/youtubeCredentialResolver.mts` — función pura
`resolveYoutubeChannelCredentials(canalArgumento, env)`:
- Resuelve por **nombre de variable** (`YOUTUBE_CLIENT_ID_<CANAL>`/
  `YOUTUBE_CLIENT_SECRET_<CANAL>`) — registro basado en qué existe en el
  entorno, **no** una lista fija de canales ni un `if/else` por canal. Agregar
  un canal nuevo = agregar sus 2 variables en `.env.local`, cero cambios de
  código.
- **Nunca** consulta `YOUTUBE_CLIENT_ID`/`YOUTUBE_CLIENT_SECRET` (genéricas)
  — ni como resultado, ni como fallback ante cualquier error.
- Distingue explícitamente "canal desconocido" (ninguna de las 2 variables
  existe) de "credenciales incompletas" (existe una, falta la otra) — mensajes
  de error distintos y específicos.
- `normalizeChannelArgument()` — mayúsculas + espacios/guiones → `_`,
  colapsa repetidos, recorta bordes. Deliberadamente **sin** plegado de
  acentos: un nombre con tilde que no coincide exactamente falla como
  "desconocido" (fail-closed), nunca adivina una equivalencia ambigua.

**Modificado:** `scripts/get-youtube-refresh-token.mts`:
- Exige `process.argv[2]` (el canal) — sin argumento, canal desconocido, o
  credenciales incompletas → error claro, **el flujo OAuth nunca se inicia**
  (no se construye la URL de autorización, no se levanta el servidor local).
- Tras obtener el `access_token`, hace una llamada real de solo lectura
  (`channels.list?part=snippet&mine=true`) **antes** de mostrar el
  `refresh_token`, e imprime `channelId`/`title`/`customUrl` (información
  pública) junto al canal solicitado.
- Nunca imprime `access_token`/`refresh_token`/`client_secret`/`client_id`
  completo en ningún paso previo a la confirmación de identidad.

## 4b. Corrección post-auditoría — identidad esperada por REGISTRO, no por argumento opcional

**Gap encontrado en la auditoría final de esta misma fase:** el segundo
argumento (channel ID esperado) era puramente opcional para **todos** los
canales, incluso uno cuya identidad real **ya se conoce** (SIN EXPLICACIÓN,
`UCHtU7U5zZ1gndN5o-C2eeFQ`, Fase 5.18). Si alguien corría
`npm run social:youtube-token -- SIN_EXPLICACION` **sin** el segundo
argumento, el script caía en modo "solo reporta" — mostraría el
`refresh_token` de cualquier cuenta con la que se autorizara, sin bloquear un
mismatch. Era la misma clase de riesgo que esta fase existe para eliminar,
reintroducida por un argumento fácil de olvidar.

**Corrección implementada:** nueva variable de registro, opcional, por
canal — `YOUTUBE_CHANNEL_ID_<CANAL>` (mismo patrón de nombre que las
credenciales, sin `if/else`). Regla exacta
(`scripts/youtubeCredentialResolver.mts::resolveExpectedChannelId`):

1. **Si `YOUTUBE_CHANNEL_ID_<CANAL>` existe** → la verificación pasa a ser
   **obligatoria automáticamente**, usando ese valor. Si además se pasa un
   segundo argumento y **coincide** con el registro, no cambia nada. Si
   **difiere**, el script bloquea inmediatamente por *"configuración
   inconsistente"* — **antes de abrir el navegador** (no hace perder tiempo
   con un OAuth que de todos modos no se podría usar). El registro **nunca**
   se sobreescribe silenciosamente por el argumento.
2. **Si `YOUTUBE_CHANNEL_ID_<CANAL>` NO existe** → modo **bootstrap**: si se
   pasó un argumento, se usa como valor a verificar (comportamiento heredado,
   sin cambios); si tampoco hay argumento, solo se reporta la identidad real
   para revisión humana — pensado **exclusivamente** para la primera vez que
   se configura un canal cuyo channel ID real todavía no se conoce.

**Función que protege el `refresh_token`:**
`decideProvisioningIdentityOutcome(resolution, realChannelId, evaluateChannelIdentityMatch)`
— pura, reutiliza `evaluateChannelIdentityMatch()` (Fase 5.18, **sin
modificar**) solo cuando hace falta comparar. Devuelve un único campo
`canShowRefreshToken: boolean`; el script solo imprime el `refresh_token`
dentro del `if (outcome.canShowRefreshToken)` — es estructuralmente
imposible llegar a esa línea con una configuración inconsistente, un
mismatch, o un canal real no determinable (`null`), en **ningún** modo,
incluido bootstrap (si `channels.list` no devuelve nada, bootstrap también
bloquea).

## 5. Uso correcto

**Recomendado (canal ya registrado — verificación automática, no depende de recordar nada):**
```bash
# Con YOUTUBE_CHANNEL_ID_SIN_EXPLICACION=UCHtU7U5zZ1gndN5o-C2eeFQ ya en .env.local:
npm run social:youtube-token -- SIN_EXPLICACION
```

**Bootstrap (canal nuevo, identidad real todavía no registrada):**
```bash
npm run social:youtube-token -- ENCIENDE_EL_CAOS
npm run social:youtube-token -- LUNA_VERDE
npm run social:youtube-token -- OBJETOS_MALDITOS
```
Tras confirmar visualmente la identidad reportada, agregar
`YOUTUBE_CHANNEL_ID_<CANAL>=<id real>` a `.env.local` para que las próximas
ejecuciones de ese canal ya la verifiquen siempre.

Ningún ejemplo contiene secretos — solo channel IDs, que son información
pública (visibles en la propia URL del canal en YouTube).

## 6. Comportamiento fail-closed (confirmado por test)

| Situación | Resultado |
|---|---|
| Sin argumento de canal | Error, OAuth nunca se inicia |
| Canal desconocido (cero variables configuradas) | Error, OAuth nunca se inicia |
| `client_id` presente, `client_secret` ausente (o viceversa) | Error, OAuth nunca se inicia |
| `channels.list` falla o responde vacío/malformado | Error, `refresh_token` **no se muestra** (en cualquier modo, incluido bootstrap) |
| `YOUTUBE_CHANNEL_ID_<CANAL>` presente + canal real distinto | Error (`mismatch`), `refresh_token` **no se muestra** |
| Registro y argumento presentes pero **distintos** | Error (`inconsistent`) — bloquea **antes** de abrir OAuth |
| Solo argumento (bootstrap con valor) + canal real distinto | Error (`mismatch`), `refresh_token` **no se muestra** |
| Todo correcto (verificado o bootstrap con canal real válido) | Se muestra el `refresh_token`, junto a la identidad confirmada |

## 7. Tests

`scripts/test-youtube-credential-resolver.mts` (`npm run youtube-credential-resolver:test`) — **37/37 🟢**, 100% puro (entorno sintético, nunca `.env.local` real, nunca red):
- Los 23 originales: 4 canales reales con credenciales completas, canal desconocido, argumento ausente/vacío, credenciales incompletas (ambos sentidos), confirmación de que nunca cae en las variables genéricas, 6 casos de normalización.
- 14 nuevos (corrección post-auditoría): `resolveExpectedChannelId` (bootstrap sin nada, registro solo, argumento solo, inconsistencia registro-vs-argumento, consistencia registro-vs-argumento) y `decideProvisioningIdentityOutcome` (verificado por registro, mismatch por registro, verificado por argumento, mismatch por argumento, bloqueo por inconsistencia sin mirar el canal real, bootstrap con canal real válido, bootstrap/verify con canal real `null`, y un barrido exhaustivo confirmando que **toda** combinación inválida da `canShowRefreshToken=false` y **toda** combinación válida da `true`).

No duplica los tests de identidad de Agent 3 (`test-youtube-identity.mts`, Fase 5.18 — 18/18, sin cambios) — reutiliza directamente `evaluateChannelIdentityMatch()` importándola, en vez de reimplementar su lógica.

Regresión completa: `tsc --noEmit` limpio; `youtube-identity` 18/18, `human-review` 24/24, `uncertain-outcome` 24/24, `claim-recovery` 18/18, `publish-authorization` 8/8, `gap-closure-5.4.3` 13/13, `reconciliation` 20/20 — sin regresiones.

## 8. No se ejecutó OAuth real en esta fase

El único código genuinamente nuevo (resolución de credenciales, normalización) está cubierto por 23 tests puros. La verificación de identidad reutiliza `evaluateChannelIdentityMatch()`, ya probada exhaustivamente en Fase 5.18 (incluida su verificación en vivo contra la API real). Regenerar un `refresh_token` real solo para probar este cambio habría sido innecesario — no se hizo.

## 9. Límites

- Las variables genéricas (`YOUTUBE_CLIENT_ID`/`YOUTUBE_CLIENT_SECRET`/`YOUTUBE_REFRESH_TOKEN`, sin sufijo) siguen existiendo en `.env.local` por compatibilidad histórica — no se eliminan ni se renombran, pero ningún código las consulta ya como parte de este flujo.
- `YOUTUBE_CHANNEL_ID_<CANAL>` es opcional por diseño (permite el bootstrap de un canal nuevo) — un canal sin ese registro sigue pudiendo operar en modo bootstrap; es responsabilidad humana agregarlo una vez confirmada la identidad, para que deje de depender de un argumento opcional.
- La copia del `refresh_token` resultante hacia Supabase (`social_accounts.credentials`) sigue siendo manual — fuera del alcance de esta fase (no se pidió automatizarla, y hacerlo tocaría Supabase, explícitamente prohibido aquí).
- La normalización no hace plegado de acentos — un canal escrito con tilde que no coincide con la variable configurada se reporta como "desconocido", no como un error de tipeo específico.

## 10. Relación con Fase 5.18

Esta fase cierra el punto de origen del incidente encontrado y corregido en Fase 5.18 (identidad estructural de YouTube) — reutiliza su lógica pura sin duplicarla, y no modifica nada de lo que esa fase ya dejó verificado y en producción (commit `002baa3`, pusheado a `agents-origin/main`).

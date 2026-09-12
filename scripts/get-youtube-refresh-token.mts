// Fase 5.19 — cierra el riesgo real encontrado en Fase 5.18: este script
// leía las variables GENÉRICAS (YOUTUBE_CLIENT_ID/SECRET, sin canal), lo que
// permitió generar por error un refresh_token de "Enciende El Caos" creyendo
// que era el de "Sin Explicación". Ahora exige el canal como argumento
// explícito y resuelve sus credenciales POR NOMBRE (scripts/youtubeCredentialResolver.mts),
// nunca cae en las genéricas como fallback. Fail-closed: sin argumento, canal
// desconocido, o credenciales incompletas -> error claro, el flujo OAuth
// nunca llega a iniciarse.
//
// Corrección post-auditoría de Fase 5.19: la verificación de identidad ya
// NO depende de que el humano recuerde escribir un segundo argumento. Si
// existe YOUTUBE_CHANNEL_ID_<CANAL> en el entorno, la verificación es
// OBLIGATORIA automáticamente (ver youtubeCredentialResolver.mts::resolveExpectedChannelId).
// El segundo argumento sigue existiendo, pero ahora es (a) redundante si ya
// coincide con el registro, (b) motivo de bloqueo si lo contradice, o (c)
// el único valor considerado SOLO cuando el canal todavía no tiene registro
// (modo bootstrap explícito, para la primera vez).
//
// Uso:
//   npm run social:youtube-token -- SIN_EXPLICACION
//   npm run social:youtube-token -- SIN_EXPLICACION UCHtU7U5zZ1gndN5o-C2eeFQ
import { createServer } from "node:http";
import { resolveYoutubeChannelCredentials, resolveExpectedChannelId, decideProvisioningIdentityOutcome } from "./youtubeCredentialResolver.mts";
import { evaluateChannelIdentityMatch } from "../agent/publish/youtubeChannelIdentity.mts";

const PORT = 8787;
const REDIRECT_URI = `http://localhost:${PORT}`;

const channelArgument = process.argv[2];
const expectedChannelIdArg = process.argv[3]; // opcional

const resolution = resolveYoutubeChannelCredentials(channelArgument, process.env);
if (!resolution.ok) {
  console.error(`\n❌ ${resolution.reason}\n`);
  console.error(
    "Las credenciales por canal se sacan de Google Cloud Console → APIs & Services → Credentials\n" +
      "→ el OAuth client ID correspondiente a ese canal, tipo 'Desktop app' - y deben existir en\n" +
      ".env.local como YOUTUBE_CLIENT_ID_<CANAL> / YOUTUBE_CLIENT_SECRET_<CANAL>."
  );
  process.exit(1);
}
const { channel, clientId, clientSecret } = resolution;

// Fase 5.19 (corrección) — se resuelve la identidad esperada ANTES de abrir
// el flujo de OAuth: una configuración inconsistente (registro y argumento
// presentes pero distintos) bloquea aquí mismo, sin hacer perder tiempo al
// humano con un consentimiento de Google que de todos modos no se podría usar.
const identityResolution = resolveExpectedChannelId(channel, process.env, expectedChannelIdArg);
if (identityResolution.mode === "inconsistent") {
  console.error(`\n❌ ${identityResolution.reason}\n`);
  process.exit(1);
}

console.log(`Canal solicitado: ${channel}`);
if (identityResolution.mode === "verify") {
  console.log(
    `Channel ID esperado (verificación OBLIGATORIA — fuente: ${identityResolution.source === "registry" ? `YOUTUBE_CHANNEL_ID_${channel}` : "argumento"}): ${identityResolution.expectedChannelId}`
  );
} else {
  console.log(
    `Sin YOUTUBE_CHANNEL_ID_${channel} configurado y sin argumento — modo BOOTSTRAP: se reportará la identidad real para revisión manual, sin comparación automática. ` +
      `Una vez confirmada, agrega YOUTUBE_CHANNEL_ID_${channel} a .env.local para que futuras ejecuciones la verifiquen siempre.`
  );
}

const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
authUrl.searchParams.set("client_id", clientId);
authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
authUrl.searchParams.set("response_type", "code");
// Fase 5.17 — youtube.readonly es necesario para la verificación de
// identidad de esta misma fase (channels.list), además del ya existente
// youtube.upload que necesita el publisher real.
authUrl.searchParams.set("scope", "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly");
authUrl.searchParams.set("access_type", "offline");
authUrl.searchParams.set("prompt", "consent");

console.log(`\nAbre esta URL en tu navegador, inicia sesión con la cuenta de Google dueña del canal '${channel}' y acepta el permiso:\n`);
console.log(authUrl.toString());
console.log(`\nEsperando la autorización en ${REDIRECT_URI} ...`);

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", REDIRECT_URI);
  const code = url.searchParams.get("code");
  if (!code) {
    res.writeHead(400).end("Falta el parámetro 'code'.");
    return;
  }

  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end("<h1>Listo</h1><p>Ya puedes cerrar esta pestaña y volver a la terminal.</p>");
  server.close();

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: REDIRECT_URI,
      grant_type: "authorization_code",
    }),
  });

  if (!tokenRes.ok) {
    console.error("Error intercambiando el código por tokens:", tokenRes.status, await tokenRes.text());
    process.exit(1);
  }

  const data = (await tokenRes.json()) as { refresh_token?: string; access_token: string };
  if (!data.refresh_token) {
    console.error(
      "Google no devolvió refresh_token. Es probable que ya hayas autorizado esta app antes.\n" +
        "Ve a https://myaccount.google.com/permissions, revoca el acceso a esta app y vuelve a correr el script."
    );
    process.exit(1);
  }

  // Fase 5.19 — verificación INMEDIATA de identidad, ANTES de mostrar el
  // refresh_token como utilizable. Solo información pública (channelId/
  // title/customUrl) - nunca tokens/secrets.
  console.log("\n=== Verificando identidad real del canal autorizado (solo lectura) ===");
  const channelRes = await fetch("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", {
    headers: { Authorization: `Bearer ${data.access_token}` },
  });
  if (!channelRes.ok) {
    console.error("No se pudo verificar la identidad del canal (channels.list falló):", channelRes.status, await channelRes.text());
    console.error("No se muestra el refresh_token - no se puede confirmar que el OAuth haya sido exitoso.");
    process.exit(1);
  }
  const channelData = (await channelRes.json()) as { items?: Array<{ id: string; snippet: { title: string; customUrl?: string } }> };
  const realChannel = channelData.items?.[0];
  if (!realChannel) {
    console.error("channels.list respondió sin ningún canal (respuesta vacía/malformada) - no se puede confirmar identidad.");
    console.error("No se muestra el refresh_token.");
    process.exit(1);
  }

  console.log(`Solicité: ${channel}`);
  console.log(`\nYouTube devolvió:`);
  console.log(`  Canal: ${realChannel.snippet.title}`);
  console.log(`  ID: ${realChannel.id}`);
  console.log(`  Custom URL: ${realChannel.snippet.customUrl ?? "(no configurado)"}`);

  // Fase 5.19 (corrección) — ÚNICO punto de decisión sobre si el
  // refresh_token puede mostrarse. `outcome` viene de una función pura
  // (youtubeCredentialResolver.mts::decideProvisioningIdentityOutcome, ya
  // probada con 100% de sus ramas sin red) - el resto de este bloque solo
  // imprime según lo que esa función ya decidió. Es estructuralmente
  // imposible llegar a `console.log(data.refresh_token)` sin pasar primero
  // por `outcome.canShowRefreshToken === true`.
  const outcome = decideProvisioningIdentityOutcome(identityResolution, realChannel.id, evaluateChannelIdentityMatch);
  console.log(`\nResultado: ${outcome.canShowRefreshToken ? (outcome.mode === "bootstrap" ? "BOOTSTRAP (sin verificar automáticamente)" : "MATCH") : "MISMATCH/BLOQUEADO"}`);

  if (!outcome.canShowRefreshToken) {
    console.error(`\n❌ ${outcome.reason}`);
    console.error("El OAuth NO se presenta como exitoso - revisa con qué cuenta de Google iniciaste sesión y vuelve a intentarlo.");
    console.error("El refresh_token obtenido NO se muestra.");
    process.exit(1);
  }
  if (outcome.mode === "bootstrap") {
    console.log(`\n(modo bootstrap - confirma tú mismo que este es el canal correcto antes de usar el refresh_token, y considera agregar YOUTUBE_CHANNEL_ID_${channel} a .env.local para que la próxima vez se verifique automáticamente)`);
  }

  console.log(`\n✅ Identidad confirmada. Pega este refresh token en YOUTUBE_REFRESH_TOKEN_${channel} en .env.local`);
  console.log("   (o en social_accounts.credentials.refresh_token de Supabase, si corresponde):\n");
  console.log(data.refresh_token);
  console.log(`\n(Client ID y Client Secret son los mismos ya configurados en YOUTUBE_CLIENT_ID_${channel}/YOUTUBE_CLIENT_SECRET_${channel} —`);
  console.log(" no hace falta volver a copiarlos.)");
});

server.listen(PORT);

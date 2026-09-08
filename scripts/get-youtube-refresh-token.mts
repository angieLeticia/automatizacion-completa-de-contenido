import { createServer } from "node:http";

const PORT = 8787;
const REDIRECT_URI = `http://localhost:${PORT}`;

const clientId = process.env.YOUTUBE_CLIENT_ID;
const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;

if (!clientId || !clientSecret) {
  console.error(
    "Define YOUTUBE_CLIENT_ID y YOUTUBE_CLIENT_SECRET en tu entorno antes de correr este script\n" +
      "(los sacas de Google Cloud Console → APIs & Services → Credentials → OAuth client ID, tipo 'Desktop app')."
  );
  process.exit(1);
}

const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
authUrl.searchParams.set("client_id", clientId);
authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
authUrl.searchParams.set("response_type", "code");
authUrl.searchParams.set("scope", "https://www.googleapis.com/auth/youtube.upload");
authUrl.searchParams.set("access_type", "offline");
authUrl.searchParams.set("prompt", "consent");

console.log("Abre esta URL en tu navegador, inicia sesión con la cuenta de YouTube que vas a usar y acepta el permiso:\n");
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
      client_id: clientId!,
      client_secret: clientSecret!,
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

  console.log("\n✅ Listo. Pega este refresh token en el campo correspondiente al conectar");
  console.log("   este canal de YouTube desde /admin/social/canales:\n");
  console.log(data.refresh_token);
  console.log("\n(Client ID y Client Secret son los mismos que ya usaste para generar este link —");
  console.log(" pégalos también en el formulario, junto con este refresh token.)");
});

server.listen(PORT);

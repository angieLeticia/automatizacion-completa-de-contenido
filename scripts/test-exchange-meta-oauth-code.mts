// Fase 18 — pruebas del intercambio OAuth de Meta. Sin red real, sin
// credenciales reales, SIN llamar nunca a Meta. Mismo patrón withStubbedFetch
// ya usado en test-facebook-identity.mts/test-instagram-identity.mts.
import {
  buildCodeExchangeParams,
  buildLongLivedExchangeParams,
  sanitizeMetaErrorBody,
  exchangeCodeForShortLivedToken,
  exchangeForLongLivedToken,
  MetaOAuthHttpError,
  type MetaOAuthConfig,
} from "./metaOAuthExchange.mts";

let failures = 0;
const check = (label: string, cond: boolean, extra = "") => {
  const mark = cond ? "PASS" : "FAIL";
  if (!cond) failures++;
  console.log(`[${mark}] ${label}${extra ? " — " + extra : ""}`);
};

type FetchHandler = (url: string, init?: RequestInit) => Promise<Response> | Response;
function stubFetch(handler: FetchHandler): typeof fetch {
  return (async (url: unknown, init?: RequestInit) => handler(String(url), init)) as typeof fetch;
}

// Interceptamos console.log durante ciertas pruebas para confirmar que NADA
// de lo registrado contiene el secreto/token reales - sin depender de que el
// propio script de producción sea "honesto"; se audita la salida real.
function captureLogs(fn: () => Promise<void>): Promise<{ lines: string[] }> {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  return fn()
    .then(() => ({ lines }))
    .finally(() => {
      console.log = original;
    });
}

const FAKE_SECRET = "super-secreto-de-prueba-nunca-real-9f8e7d6c5b4a";
const FAKE_CODE = "codigo-de-prueba-nunca-real-AQBx...";
const FAKE_SHORT_TOKEN = "short-lived-token-de-prueba-nunca-real";
const FAKE_LONG_TOKEN = "long-lived-token-de-prueba-nunca-real-mucho-mas-largo-1234567890";

const config: MetaOAuthConfig = {
  appId: "2731552637239161", // dato público (App ID), no es secreto
  appSecret: FAKE_SECRET,
  redirectUri: "https://angieleticia.github.io/automatizacion-completa-de-contenido/oauth/callback.html",
  graphVersion: "v19.0",
};

async function main() {
  // ==================================================
  // 1. Construcción de parámetros — comprobar que van donde corresponde
  // ==================================================
  const codeParams = buildCodeExchangeParams(config, FAKE_CODE);
  check("1a. buildCodeExchangeParams incluye client_id correcto", codeParams.get("client_id") === config.appId);
  check("1b. buildCodeExchangeParams incluye client_secret correcto", codeParams.get("client_secret") === FAKE_SECRET);
  check("1c. buildCodeExchangeParams incluye redirect_uri EXACTO", codeParams.get("redirect_uri") === config.redirectUri);
  check("1d. buildCodeExchangeParams incluye code correcto", codeParams.get("code") === FAKE_CODE);

  const longLivedParams = buildLongLivedExchangeParams(config, FAKE_SHORT_TOKEN);
  check("2a. buildLongLivedExchangeParams usa grant_type=fb_exchange_token", longLivedParams.get("grant_type") === "fb_exchange_token");
  check("2b. buildLongLivedExchangeParams incluye fb_exchange_token con el token corto", longLivedParams.get("fb_exchange_token") === FAKE_SHORT_TOKEN);
  check("2c. buildLongLivedExchangeParams incluye client_secret correcto", longLivedParams.get("client_secret") === FAKE_SECRET);

  // ==================================================
  // 3. Saneamiento de errores — nunca el cuerpo crudo completo
  // ==================================================
  check(
    "3a. sanitizeMetaErrorBody extrae message+type de un error real de Meta",
    sanitizeMetaErrorBody({ error: { message: "This authorization code has been used.", type: "OAuthException" } }) ===
      "OAuthException: This authorization code has been used."
  );
  check("3b. sanitizeMetaErrorBody sin campo error -> mensaje genérico, no lanza", sanitizeMetaErrorBody({ foo: "bar" }).length > 0);
  check("3c. sanitizeMetaErrorBody con body null -> mensaje genérico, no lanza", sanitizeMetaErrorBody(null).length > 0);

  // ==================================================
  // 4. exchangeCodeForShortLivedToken() — éxito
  // ==================================================
  await (async () => {
    let calledUrl = "";
    const result = await exchangeCodeForShortLivedToken(
      config,
      FAKE_CODE,
      stubFetch((url) => {
        calledUrl = url;
        return new Response(JSON.stringify({ access_token: FAKE_SHORT_TOKEN, token_type: "bearer", expires_in: 5183944 }), { status: 200 });
      })
    );
    check("4a. Llama al endpoint oficial /oauth/access_token con la version Graph correcta", calledUrl.includes(`/${config.graphVersion}/oauth/access_token`));
    check("4b. La URL llamada SÍ incluye el code (necesario para la petición real)", calledUrl.includes(FAKE_CODE));
    check("4c. Éxito -> devuelve access_token correcto", result.access_token === FAKE_SHORT_TOKEN);
    check("4d. Éxito -> devuelve expires_in correcto", result.expires_in === 5183944);
  })();

  // ==================================================
  // 5. exchangeForLongLivedToken() — éxito
  // ==================================================
  await (async () => {
    const result = await exchangeForLongLivedToken(
      config,
      FAKE_SHORT_TOKEN,
      stubFetch(() => new Response(JSON.stringify({ access_token: FAKE_LONG_TOKEN, token_type: "bearer", expires_in: 5184000 }), { status: 200 }))
    );
    check("5a. exchangeForLongLivedToken -> devuelve el token largo correcto", result.access_token === FAKE_LONG_TOKEN);
  })();

  // ==================================================
  // 6. Manejo de error HTTP (code expirado/ya usado, ejemplo real de Meta)
  // ==================================================
  await (async () => {
    let threw = false;
    let caughtStatus = 0;
    let caughtMessage = "";
    try {
      await exchangeCodeForShortLivedToken(
        config,
        FAKE_CODE,
        stubFetch(() => new Response(JSON.stringify({ error: { message: "This authorization code has been used.", type: "OAuthException", code: 100 } }), { status: 400 }))
      );
    } catch (err) {
      threw = true;
      if (err instanceof MetaOAuthHttpError) {
        caughtStatus = err.status;
        caughtMessage = err.sanitizedMessage;
      }
    }
    check("6a. HTTP 400 (code ya usado) -> lanza MetaOAuthHttpError, no un objeto genérico", threw);
    check("6b. El status se preserva correctamente", caughtStatus === 400);
    check("6c. El mensaje saneado es el declarado por Meta, sin el cuerpo crudo completo", caughtMessage === "OAuthException: This authorization code has been used.");
  })();

  // ==================================================
  // 7. Respuesta 200 sin access_token utilizable -> error controlado, no VERIFIED
  // ==================================================
  await (async () => {
    let threw = false;
    try {
      await exchangeCodeForShortLivedToken(config, FAKE_CODE, stubFetch(() => new Response(JSON.stringify({ foo: "bar" }), { status: 200 })));
    } catch {
      threw = true;
    }
    check("7. HTTP 200 sin access_token en el cuerpo -> lanza error controlado, nunca un resultado vacío silencioso", threw);
  })();

  // ==================================================
  // 8. Fallo de red (fetch lanza) -> error controlado, mensaje NUNCA incluye la URL
  // ==================================================
  await (async () => {
    let message = "";
    try {
      await exchangeCodeForShortLivedToken(
        config,
        FAKE_CODE,
        stubFetch(() => {
          throw new Error("simulated: fallo de red");
        })
      );
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    check("8a. Fallo de red -> error controlado, no lanza sin capturar", message.length > 0);
    check("8b. El mensaje de error de fallo de red NUNCA incluye client_secret", !message.includes(FAKE_SECRET));
  })();

  // ==================================================
  // 9. AUDITORÍA DE LOGS — capturar console.log real durante un ciclo
  // completo (éxito + error) y confirmar que el secreto/token JAMÁS aparecen
  // ==================================================
  const { lines: successLogLines } = await captureLogs(async () => {
    const short = await exchangeCodeForShortLivedToken(config, FAKE_CODE, stubFetch(() => new Response(JSON.stringify({ access_token: FAKE_SHORT_TOKEN, expires_in: 100 }), { status: 200 })));
    console.log(`token: PRESENT, length=${short.access_token.length}`); // patrón correcto que SÍ debe usarse
    const long = await exchangeForLongLivedToken(config, short.access_token, stubFetch(() => new Response(JSON.stringify({ access_token: FAKE_LONG_TOKEN, expires_in: 200 }), { status: 200 })));
    console.log(`token: PRESENT, length=${long.access_token.length}`);
  });
  const successOutput = successLogLines.join("\n");
  check("9a. client_secret JAMÁS aparece en los logs durante un ciclo de éxito completo", !successOutput.includes(FAKE_SECRET));
  check("9b. El access_token de corta duración JAMÁS aparece completo en los logs", !successOutput.includes(FAKE_SHORT_TOKEN));
  check("9c. El access_token de larga duración JAMÁS aparece completo en los logs", !successOutput.includes(FAKE_LONG_TOKEN));

  const { lines: errorLogLines } = await captureLogs(async () => {
    try {
      await exchangeCodeForShortLivedToken(config, FAKE_CODE, stubFetch(() => new Response(JSON.stringify({ error: { message: "Invalid verification code format.", type: "OAuthException" } }), { status: 400 })));
    } catch (err) {
      if (err instanceof MetaOAuthHttpError) {
        console.log(`ERROR — HTTP ${err.status}: ${err.sanitizedMessage}`); // patrón correcto
      }
    }
  });
  const errorOutput = errorLogLines.join("\n");
  check("9d. client_secret JAMÁS aparece en los logs durante el manejo de un error HTTP", !errorOutput.includes(FAKE_SECRET));
  check("9e. El code completo JAMÁS aparece en los logs de error", !errorOutput.includes(FAKE_CODE));
  check("9f. El log de error SÍ contiene el status y el mensaje saneado (información útil, sin secretos)", errorOutput.includes("400") && errorOutput.includes("Invalid verification code format"));

  console.log(`\n${failures === 0 ? "TODOS LOS CASOS PASARON" : `${failures} CASO(S) FALLARON`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main();

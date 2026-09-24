// Fase 18 — logica PURA/testable del intercambio OAuth code -> access_token
// de Meta. Sin ejecucion al importar, sin leer archivos, sin argv - solo
// construccion de parametros, llamadas HTTP explicitas (fetch inyectable
// para tests) y saneamiento de errores. El punto de entrada real
// (scripts/exchange-meta-oauth-code.mts) es quien carga credenciales/argv y
// llama a estas funciones.
//
// NUNCA debe registrarse en logs: client_secret, access_token, ni la URL
// completa de la peticion (que incluye client_secret como query param) -
// por eso ninguna funcion de este modulo devuelve ni construye un string de
// URL completo hacia el llamador; solo internamente, para el propio fetch().
export interface MetaOAuthConfig {
  appId: string;
  appSecret: string;
  redirectUri: string;
  graphVersion: string;
}

export interface MetaTokenResponse {
  access_token: string;
  token_type?: string;
  expires_in?: number;
}

export class MetaOAuthHttpError extends Error {
  status: number;
  sanitizedMessage: string;
  constructor(status: number, sanitizedMessage: string) {
    super(`Meta respondió HTTP ${status}: ${sanitizedMessage}`);
    this.status = status;
    this.sanitizedMessage = sanitizedMessage;
  }
}

export function buildCodeExchangeParams(config: MetaOAuthConfig, code: string): URLSearchParams {
  const params = new URLSearchParams();
  params.set("client_id", config.appId);
  params.set("client_secret", config.appSecret);
  params.set("redirect_uri", config.redirectUri);
  params.set("code", code);
  return params;
}

export function buildLongLivedExchangeParams(config: MetaOAuthConfig, shortLivedToken: string): URLSearchParams {
  const params = new URLSearchParams();
  params.set("grant_type", "fb_exchange_token");
  params.set("client_id", config.appId);
  params.set("client_secret", config.appSecret);
  params.set("fb_exchange_token", shortLivedToken);
  return params;
}

// Extrae SOLO el mensaje/tipo que Meta ya declara publicamente en su propio
// error (ej. "This authorization code has been used." o "Invalid
// verification code format.") - nunca el cuerpo crudo completo (que en
// teoria podria hacer eco de algun parametro de la peticion).
export function sanitizeMetaErrorBody(rawBody: unknown): string {
  if (rawBody && typeof rawBody === "object" && "error" in (rawBody as Record<string, unknown>)) {
    const err = (rawBody as { error?: { message?: unknown; type?: unknown } }).error;
    const msg = typeof err?.message === "string" ? err.message : null;
    const type = typeof err?.type === "string" ? err.type : null;
    if (msg) return type ? `${type}: ${msg}` : msg;
  }
  return "(respuesta de error no interpretable o sin mensaje declarado por Meta)";
}

async function callMetaOAuthEndpoint(
  config: MetaOAuthConfig,
  params: URLSearchParams,
  fetchImpl: typeof fetch
): Promise<MetaTokenResponse> {
  const url = `https://graph.facebook.com/${config.graphVersion}/oauth/access_token?${params.toString()}`;
  let res: Response;
  try {
    res = await fetchImpl(url);
  } catch (err) {
    // Nunca se incluye `url` en el mensaje - contiene client_secret.
    throw new Error(`Fallo de red al llamar al endpoint de OAuth de Meta: ${err instanceof Error ? err.message : String(err)}`);
  }

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }

  if (!res.ok) {
    throw new MetaOAuthHttpError(res.status, sanitizeMetaErrorBody(body));
  }

  const data = body as { access_token?: unknown; token_type?: unknown; expires_in?: unknown } | null;
  if (!data || typeof data.access_token !== "string" || data.access_token.length === 0) {
    throw new Error("Meta respondió HTTP 200 pero el cuerpo no trae un access_token utilizable.");
  }
  return {
    access_token: data.access_token,
    token_type: typeof data.token_type === "string" ? data.token_type : undefined,
    expires_in: typeof data.expires_in === "number" ? data.expires_in : undefined,
  };
}

// Paso 1 — intercambia el authorization `code` (de un solo uso, obtenido del
// redirect de Meta) por un token de USUARIO de corta duración. Requiere
// EXACTAMENTE el mismo redirect_uri configurado en la app de Meta y usado en
// el login real - si no coincide, Meta rechaza la petición.
export async function exchangeCodeForShortLivedToken(config: MetaOAuthConfig, code: string, fetchImpl: typeof fetch = fetch): Promise<MetaTokenResponse> {
  return callMetaOAuthEndpoint(config, buildCodeExchangeParams(config, code), fetchImpl);
}

// Paso 2 (Fase 18, punto 6 del encargo) — Meta SIEMPRE devuelve, en este
// flujo, un User Access Token de corta duración (documentación oficial:
// típicamente ~1-2 horas) tras el intercambio del `code`. Para que el token
// sea útil más allá de una prueba inmediata, se encadena automáticamente el
// intercambio oficial a token de larga duración
// (`grant_type=fb_exchange_token`, ~60 días) - mismo endpoint, mismo
// `client_id`/`client_secret`. El token FINAL que se persiste es SIEMPRE el
// de larga duración, nunca el de corta duración (documentado explícitamente
// en el archivo de salida, ver exchange-meta-oauth-code.mts).
export async function exchangeForLongLivedToken(config: MetaOAuthConfig, shortLivedToken: string, fetchImpl: typeof fetch = fetch): Promise<MetaTokenResponse> {
  return callMetaOAuthEndpoint(config, buildLongLivedExchangeParams(config, shortLivedToken), fetchImpl);
}

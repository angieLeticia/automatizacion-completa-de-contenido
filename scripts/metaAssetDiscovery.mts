// Fase 19 — logica PURA/testable del descubrimiento de activos Meta
// (paginas de Facebook + Instagram Business Account asociado). Sin
// ejecucion al importar, sin leer archivos, sin argv - solo parseo de
// nodos, paginacion via fetch inyectable, y saneamiento de errores.
//
// NUNCA debe registrarse en logs ningun token completo (User Access Token,
// Page Access Token) ni la URL completa de una peticion a Meta (contiene el
// access_token como query param, y paging.next tambien lo trae embebido).
import { sanitizeMetaErrorBody } from "./metaOAuthExchange.mts";

export class MetaGraphHttpError extends Error {
  status: number;
  sanitizedMessage: string;
  constructor(status: number, sanitizedMessage: string) {
    super(`Meta respondió HTTP ${status}: ${sanitizedMessage}`);
    this.status = status;
    this.sanitizedMessage = sanitizedMessage;
  }
}

export interface DiscoveredInstagramAccount {
  id: string;
  username?: string;
  name?: string;
}

export interface DiscoveredPage {
  id: string;
  name: string;
  pageAccessTokenPresent: boolean;
  pageAccessTokenLength: number;
  instagram: DiscoveredInstagramAccount | null;
  instagramError: string | null;
}

// Forma cruda de un nodo de /me/accounts (no confiar en tipos - viene de red).
export interface RawPageNode {
  id?: unknown;
  name?: unknown;
  access_token?: unknown;
  instagram_business_account?: unknown;
}

export type ParsePageResult = { ok: true; page: DiscoveredPage } | { ok: false; reason: string };

// Pura - sin red. Convierte un nodo crudo de la API en un resumen SEGURO
// (nunca conserva el valor real de access_token, solo PRESENT/length). Si el
// campo instagram_business_account viene con un objeto `error` anidado (caso
// real de Meta cuando el token no tiene permiso sobre esa Página en
// particular, o la Página no tiene Instagram vinculado de forma completa),
// se registra como instagramError sin descartar el resto de la pagina.
export function parsePageNode(raw: RawPageNode): ParsePageResult {
  if (typeof raw.id !== "string" || raw.id.length === 0) {
    return { ok: false, reason: "Nodo de página sin 'id' utilizable - se omite." };
  }
  if (typeof raw.name !== "string" || raw.name.length === 0) {
    return { ok: false, reason: `Página '${raw.id}' sin 'name' utilizable - se omite.` };
  }

  const pageAccessToken = typeof raw.access_token === "string" && raw.access_token.length > 0 ? raw.access_token : null;

  let instagram: DiscoveredInstagramAccount | null = null;
  let instagramError: string | null = null;
  const igRaw = raw.instagram_business_account;
  if (igRaw && typeof igRaw === "object") {
    const igObj = igRaw as Record<string, unknown>;
    if ("error" in igObj) {
      instagramError = sanitizeMetaErrorBody(igObj);
    } else if (typeof igObj.id === "string" && igObj.id.length > 0) {
      instagram = {
        id: igObj.id,
        username: typeof igObj.username === "string" ? igObj.username : undefined,
        name: typeof igObj.name === "string" ? igObj.name : undefined,
      };
    }
  }

  return {
    ok: true,
    page: {
      id: raw.id,
      name: raw.name,
      pageAccessTokenPresent: pageAccessToken !== null,
      pageAccessTokenLength: pageAccessToken?.length ?? 0,
      instagram,
      instagramError,
    },
  };
}

export interface FetchAccountsPageResult {
  pages: RawPageNode[];
  nextUrl: string | null;
}

// Llama a UNA pagina de resultados (la URL ya viene completa, incluido el
// access_token si es la primera llamada, o tal cual la dio Meta en
// paging.next para las siguientes). Nunca construye ni recibe el token por
// separado - no tiene forma de "loguearlo por accidente" porque nunca lo ve
// como variable independiente.
export async function fetchAccountsPage(url: string, fetchImpl: typeof fetch): Promise<FetchAccountsPageResult> {
  let res: Response;
  try {
    res = await fetchImpl(url);
  } catch (err) {
    throw new Error(`Fallo de red consultando páginas de Meta: ${err instanceof Error ? err.message : String(err)}`);
  }

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }

  if (!res.ok) {
    throw new MetaGraphHttpError(res.status, sanitizeMetaErrorBody(body));
  }

  const data = body as { data?: unknown; paging?: { next?: unknown } } | null;
  const pages = data && Array.isArray(data.data) ? (data.data as RawPageNode[]) : [];
  const nextUrl = typeof data?.paging?.next === "string" ? data.paging.next : null;
  return { pages, nextUrl };
}

export interface DiscoverAllPagesResult {
  pages: DiscoveredPage[];
  warnings: string[];
}

// Recorre TODA la paginación real de Meta (paging.next) hasta agotarla,
// hasta `maxIterations` (limite de seguridad contra un bucle infinito si
// Meta devolviera un paging.next que apunte a si misma), o hasta el primer
// fallo HTTP de la petición en sí (no de un campo individual - eso ya lo
// tolera parsePageNode). Un fallo de RED/HTTP detiene la paginación pero
// PRESERVA todo lo ya descubierto hasta ese punto - nunca se descarta el
// progreso parcial.
export async function discoverAllPages(initialUrl: string, fetchImpl: typeof fetch = fetch, maxIterations = 50): Promise<DiscoverAllPagesResult> {
  const pages: DiscoveredPage[] = [];
  const warnings: string[] = [];
  let url: string | null = initialUrl;
  let iterations = 0;

  while (url && iterations < maxIterations) {
    iterations++;
    let result: FetchAccountsPageResult;
    try {
      result = await fetchAccountsPage(url, fetchImpl);
    } catch (err) {
      const message = err instanceof MetaGraphHttpError ? `HTTP ${err.status}: ${err.sanitizedMessage}` : err instanceof Error ? err.message : String(err);
      warnings.push(`Paginación detenida en la iteración ${iterations}: ${message}`);
      url = null;
      break;
    }
    for (const raw of result.pages) {
      const parsed = parsePageNode(raw);
      if (parsed.ok) {
        pages.push(parsed.page);
      } else {
        warnings.push(parsed.reason);
      }
    }
    url = result.nextUrl;
  }

  if (url && iterations >= maxIterations) {
    warnings.push(`Se alcanzó el límite de seguridad de ${maxIterations} iteraciones de paginación - puede haber más páginas sin descubrir.`);
  }

  return { pages, warnings };
}

export interface SafeAssetInventory {
  generated_at: string;
  graph_api_version: string;
  pages_found: number;
  pages_with_instagram: number;
  pages: Array<{
    page_id: string;
    page_name: string;
    page_access_token_status: "PRESENT" | "MISSING";
    instagram_status: "PRESENT" | "ABSENT" | "ERROR";
    instagram_business_account_id: string | null;
    instagram_username: string | null;
    instagram_name: string | null;
    instagram_error: string | null;
  }>;
  discovery_warnings: string[];
}

// Construye el inventario SEGURO a persistir - por diseño, NUNCA incluye
// ningún valor de token, solo metadata pública/no-secreta.
export function buildSafeInventory(discovered: DiscoveredPage[], warnings: string[], graphApiVersion: string, now: Date = new Date()): SafeAssetInventory {
  return {
    generated_at: now.toISOString(),
    graph_api_version: graphApiVersion,
    pages_found: discovered.length,
    pages_with_instagram: discovered.filter((p) => p.instagram !== null).length,
    pages: discovered.map((p) => ({
      page_id: p.id,
      page_name: p.name,
      page_access_token_status: p.pageAccessTokenPresent ? "PRESENT" : "MISSING",
      instagram_status: p.instagram ? "PRESENT" : p.instagramError ? "ERROR" : "ABSENT",
      instagram_business_account_id: p.instagram?.id ?? null,
      instagram_username: p.instagram?.username ?? null,
      instagram_name: p.instagram?.name ?? null,
      instagram_error: p.instagramError,
    })),
    discovery_warnings: warnings,
  };
}

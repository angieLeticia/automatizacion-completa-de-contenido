// Carga las content_accounts activas (carpeta -> cuenta de contenido) desde Supabase.
// El nombre de carpeta es la ÚNICA forma de reconocer una cuenta — si una carpeta no
// aparece aquí, el agente jamás la procesa ni la adivina.
import { supabaseAdmin } from "./supabaseClient.mts";
import { ACCOUNTS_CACHE_TTL_MS } from "./config.mts";
import { log } from "./logger.mts";

export interface ContentAccount {
  id: string;
  folder_name: string;
  timezone: string;
}

let cache: Map<string, ContentAccount> | null = null;
let cachedAt = 0;

// Fase 5.10-B — allowedContentAccountIds es OBLIGATORIO (viene de
// resolveRunScope(), resuelto UNA SOLA VEZ al arrancar el proceso — ver
// agent/run.mts). Nunca hay modo "sin scope": quien quiera el
// comportamiento global de antes ya no puede pedirlo por accidente.
// Lista vacia (RUN_SCOPE=TEST sin cuentas TEST) devuelve un Map vacio SIN
// consultar Supabase (Decision K.2 - nunca `.in("id", [])`).
export async function getActiveContentAccounts(allowedContentAccountIds: string[], forceRefresh = false): Promise<Map<string, ContentAccount>> {
  if (!forceRefresh && cache && Date.now() - cachedAt < ACCOUNTS_CACHE_TTL_MS) {
    return cache;
  }

  if (allowedContentAccountIds.length === 0) {
    cache = new Map();
    cachedAt = Date.now();
    return cache;
  }

  const { data, error } = await supabaseAdmin
    .from("content_accounts")
    .select("id, folder_name, timezone")
    .eq("is_active", true)
    .in("id", allowedContentAccountIds);

  if (error) {
    log.error("No se pudo cargar content_accounts desde Supabase", { error: error.message });
    return cache ?? new Map();
  }

  cache = new Map((data ?? []).map((row) => [row.folder_name as string, row as ContentAccount]));
  cachedAt = Date.now();
  return cache;
}

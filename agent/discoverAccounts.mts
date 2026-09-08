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

export async function getActiveContentAccounts(forceRefresh = false): Promise<Map<string, ContentAccount>> {
  if (!forceRefresh && cache && Date.now() - cachedAt < ACCOUNTS_CACHE_TTL_MS) {
    return cache;
  }

  const { data, error } = await supabaseAdmin
    .from("content_accounts")
    .select("id, folder_name, timezone")
    .eq("is_active", true);

  if (error) {
    log.error("No se pudo cargar content_accounts desde Supabase", { error: error.message });
    return cache ?? new Map();
  }

  cache = new Map((data ?? []).map((row) => [row.folder_name as string, row as ContentAccount]));
  cachedAt = Date.now();
  return cache;
}

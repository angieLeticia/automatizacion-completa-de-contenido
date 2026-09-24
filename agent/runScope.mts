// FASE 5.10-A — nucleo de aislamiento de ejecucion (RUN_SCOPE=PRODUCTION|TEST).
// Vive en agent/ (junto a supabaseClient.mts/logger.mts, ya compartidos por
// todos los sub-agentes). scripts/pipeline/ (Agent 2) NO importa este archivo
// directamente - sigue el patron ya establecido en este repo de "copiado, no
// importado" para no crear una dependencia entre agent/ y scripts/pipeline/
// (mismo criterio que agentLock.mts::isAlive -> queue.mts::isProcessAlive).
//
// FAIL-CLOSED explicito y deliberado: RUN_SCOPE ausente o invalido DETIENE el
// proceso (throw), nunca degrada a "procesar todo". Ningun camino de este
// archivo devuelve un scope "sin filtro" - TEST sin cuentas devuelve listas
// vacias (trabajo cero), nunca cae de vuelta a PRODUCTION ni a global.
//
// Decision K.1 (autorizada) - channelRegistry.mts (scripts/pipeline/) NO es
// autoridad para este modulo: su `channelStatus` es un espejo LOCAL
// desincronizado de Supabase real (marca 2 de las 4 cuentas reales como
// "TEST"). PRODUCTION aqui es la lista CERRADA de folder_name reales, pero
// folder_name SOLO se usa para LOCALIZAR la fila - la seguridad real depende
// de validar la cadena completa content_account -> channel_id ->
// social_channels.name -> social_accounts.channel_id (ver
// validateProductionAccountSet/validateSocialAccountsConsistency). Cualquier
// inconsistencia en esa cadena es ERROR/STOP, nunca una reduccion silenciosa
// del scope.
//
// Decision K.2 (autorizada) - jamas se ejecuta `.in("col", [])`: cada
// funcion de fetch en RunScopeDeps devuelve [] sin consultar Supabase si la
// lista de ids de entrada esta vacia (ver defaultRunScopeDeps mas abajo).
//
// Decision K.3 (autorizada) - resolveRunScope() acepta `deps` inyectable
// (mismo patron ya usado por RecoverStaleClaimsDeps en
// agent/publish/claimPost.mts): un default que pega contra supabaseAdmin, y
// toda la logica de VALIDACION (fail-closed, consistencia) vive en funciones
// puras exportadas por separado (validateProductionAccountSet,
// validateSocialAccountsConsistency, parseRunScopeName,
// resolveMaterialRootFor) para poder probarlas sin ninguna conexion real,
// igual que targetSelection.mts/channelAuthorization.mts en este mismo repo.
//
// Decision K.4 (autorizada) - este modulo NO cachea ni reintenta por si
// mismo: quien lo llama (agent/run.mts, agent/analyze/run.mts, etc., FASE
// 5.10-B en adelante) debe invocar resolveRunScope() UNA SOLA VEZ al
// arrancar cada worker/pasada, nunca dentro de un bucle de polling - un
// cambio de RUN_SCOPE o de la composicion de cuentas exige reiniciar el
// proceso.
import path from "node:path";
import { supabaseAdmin } from "./supabaseClient.mts";

export type RunScopeName = "PRODUCTION" | "TEST";

export interface ResolvedRunScope {
  runScope: RunScopeName;
  allowedContentAccountIds: string[];
  allowedSocialAccountIds: string[];
  materialRoot: string;
}

export class RunScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunScopeError";
  }
}

// Lista CERRADA y explicita de los 4 canales reales - a proposito NUNCA
// "todo lo que no sea TEST/BLOCKED/HISTORICAL" (eso admitiria silenciosamente
// una quinta cuenta real futura sin que nadie lo decida a proposito), y a
// proposito NUNCA derivada de content_accounts.channel_status (que hoy es
// 'HISTORICAL' en las 4 y debe seguir siendolo sin afectar este scope).
export const PRODUCTION_FOLDER_NAMES = ["SIN EXPLICACIÓN", "ENCIENDE EL CAOS", "LUNA VERDE", "OBJETOS MALDITOS"] as const;

const REAL_MATERIAL_ROOT = "D:\\MATERIAL VIDEOS";

// ---------------------------------------------------------------------------
// Filas minimas leidas de Supabase - solo los campos que este modulo necesita.
// ---------------------------------------------------------------------------
export interface ContentAccountRow {
  id: string;
  folder_name: string;
  channel_id: string;
  channel_status: string;
}
export interface SocialChannelRow {
  id: string;
  name: string;
}
export interface SocialAccountRow {
  id: string;
  channel_id: string;
}

// ---------------------------------------------------------------------------
// Parsing de RUN_SCOPE - puro, sin I/O.
// ---------------------------------------------------------------------------
export function parseRunScopeName(raw: string | undefined): RunScopeName {
  if (raw === "PRODUCTION" || raw === "TEST") return raw;
  throw new RunScopeError(
    `RUN_SCOPE ${raw === undefined || raw === "" ? "ausente" : `invalido ('${raw}')`} - se requiere exactamente 'PRODUCTION' o 'TEST'. ` +
      `Un proceso autonomo NUNCA debe arrancar sin un scope explicito (fail-closed deliberado, Fase 5.10) - nunca se interpreta como "procesar todo".`
  );
}

// ---------------------------------------------------------------------------
// MATERIAL_ROOT por scope - puro, sin I/O. PRODUCTION puede usar el default
// real; TEST exige un valor explicito y DISTINTO del real, o falla.
// ---------------------------------------------------------------------------
// Hallazgo de revision (Fase 5.10-A, punto 7.3) - una comparacion por
// reemplazos de string improvisada no detectaba que "D:/MATERIAL VIDEOS" y
// "D:\MATERIAL VIDEOS" son la MISMA ruta en Windows (solo normalizaba la
// barra final, nunca unificaba separadores internos ni segmentos "."/"..").
// Correccion: se usa `path.win32.resolve()` (API estandar de Node, siempre
// en modo win32 sin importar el SO donde corra el proceso, ya que este
// proyecto solo corre en Windows) - es PURAMENTE sintactica (nunca toca el
// filesystem, nunca verifica que la ruta exista) y ya resuelve de forma
// canonica: unifica "/" y "\" a "\", colapsa segmentos "."/"..", y quita
// separadores finales redundantes. Se aplica ANTES de comparar, nunca antes
// de usar el valor real (el valor devuelto a los llamadores sigue siendo
// `raw.trim()`, sin canonicalizar - ver resolveMaterialRootFor).
function normalizePath(p: string): string {
  return path.win32.resolve(p.trim()).toLowerCase();
}

export function resolveMaterialRootFor(scope: RunScopeName, env: NodeJS.ProcessEnv): string {
  const raw = env.MATERIAL_ROOT;
  if (scope === "PRODUCTION") {
    return raw && raw.trim().length > 0 ? raw.trim() : REAL_MATERIAL_ROOT;
  }
  if (!raw || raw.trim().length === 0) {
    throw new RunScopeError("RUN_SCOPE=TEST requiere MATERIAL_ROOT explicito - ausente. Proceso detenido, NUNCA se usa D:\\MATERIAL VIDEOS como fallback para TEST.");
  }
  if (normalizePath(raw) === normalizePath(REAL_MATERIAL_ROOT)) {
    throw new RunScopeError(`RUN_SCOPE=TEST no puede usar MATERIAL_ROOT='${raw}' - coincide con la ruta real de produccion. Proceso detenido.`);
  }
  return raw.trim();
}

// ---------------------------------------------------------------------------
// Validacion de PRODUCTION - puro, sin I/O. Decision K.1: folder_name SOLO
// localiza la fila: aqui se valida la cadena completa antes de confiar en
// el resultado. Cualquier discrepancia es ERROR/STOP, nunca una reduccion
// silenciosa de la lista de 4 a menos.
// ---------------------------------------------------------------------------
export type ProductionValidationResult =
  | { ok: true; contentAccountIds: string[]; channelIds: string[] }
  | { ok: false; reason: string };

export function validateProductionAccountSet(accounts: ContentAccountRow[], channels: SocialChannelRow[]): ProductionValidationResult {
  const missing = PRODUCTION_FOLDER_NAMES.filter((name) => !accounts.some((a) => a.folder_name === name));
  if (missing.length > 0) {
    return { ok: false, reason: `Scope PRODUCTION inconsistente - falta(n) content_account(s) esperada(s): ${missing.join(", ")}. No se reduce el scope, se detiene.` };
  }

  const unexpected = accounts.filter((a) => !(PRODUCTION_FOLDER_NAMES as readonly string[]).includes(a.folder_name));
  if (unexpected.length > 0) {
    return {
      ok: false,
      reason: `Scope PRODUCTION inconsistente - aparecio(eron) cuenta(s) fuera de la lista cerrada de 4: ${unexpected.map((a) => `${a.folder_name} (${a.id})`).join(", ")}.`,
    };
  }

  if (accounts.length !== PRODUCTION_FOLDER_NAMES.length) {
    return {
      ok: false,
      reason: `Scope PRODUCTION inconsistente - se esperaban exactamente ${PRODUCTION_FOLDER_NAMES.length} content_accounts, se encontraron ${accounts.length} (posible folder_name duplicado).`,
    };
  }

  for (const account of accounts) {
    const channel = channels.find((c) => c.id === account.channel_id);
    if (!channel) {
      return {
        ok: false,
        reason: `Scope PRODUCTION inconsistente - content_account '${account.folder_name}' (${account.id}) referencia channel_id='${account.channel_id}' que no existe en social_channels.`,
      };
    }
    if (channel.name !== account.folder_name) {
      return {
        ok: false,
        reason: `Scope PRODUCTION inconsistente - content_account '${account.folder_name}' esta asociada al canal '${channel.name}' (channel equivocado) - NO autorizado.`,
      };
    }
  }

  return {
    ok: true,
    contentAccountIds: accounts.map((a) => a.id),
    channelIds: accounts.map((a) => a.channel_id),
  };
}

// ---------------------------------------------------------------------------
// Consistencia social_accounts <-> channel_ids permitidos - puro, sin I/O.
// Se aplica a PRODUCTION y a TEST por igual: ninguna social_account puede
// colarse en el scope si su channel_id no es uno de los ya validados.
// ---------------------------------------------------------------------------
export type SocialAccountsConsistencyResult = { ok: true } | { ok: false; reason: string };

export function validateSocialAccountsConsistency(socialAccounts: SocialAccountRow[], allowedChannelIds: string[]): SocialAccountsConsistencyResult {
  const inconsistent = socialAccounts.filter((sa) => !allowedChannelIds.includes(sa.channel_id));
  if (inconsistent.length > 0) {
    return {
      ok: false,
      reason: `Scope inconsistente - social_account(s) fuera de los channel_id esperados: ${inconsistent.map((s) => `${s.id} (channel_id=${s.channel_id})`).join(", ")}.`,
    };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Dependencias inyectables (Decision K.3) - el UNICO punto donde este modulo
// toca Supabase. Cada fetch de "por ids" devuelve [] sin consultar si la
// lista de entrada esta vacia (Decision K.2 - nunca `.in("col", [])`).
// ---------------------------------------------------------------------------
export interface RunScopeDeps {
  fetchContentAccountsByFolderNames: (folderNames: readonly string[]) => Promise<ContentAccountRow[]>;
  fetchContentAccountsByChannelStatus: (status: string) => Promise<ContentAccountRow[]>;
  fetchSocialChannelsByIds: (ids: string[]) => Promise<SocialChannelRow[]>;
  fetchSocialAccountsByChannelIds: (channelIds: string[]) => Promise<SocialAccountRow[]>;
}

export const defaultRunScopeDeps: RunScopeDeps = {
  async fetchContentAccountsByFolderNames(folderNames) {
    const { data, error } = await supabaseAdmin
      .from("content_accounts")
      .select("id, folder_name, channel_id, channel_status")
      .in("folder_name", folderNames as unknown as string[]);
    if (error) throw new RunScopeError(`No se pudo resolver scope PRODUCTION - error leyendo content_accounts: ${error.message}`);
    return (data ?? []) as ContentAccountRow[];
  },
  async fetchContentAccountsByChannelStatus(status) {
    const { data, error } = await supabaseAdmin
      .from("content_accounts")
      .select("id, folder_name, channel_id, channel_status")
      .eq("channel_status", status);
    if (error) throw new RunScopeError(`No se pudo resolver scope TEST - error leyendo content_accounts: ${error.message}`);
    return (data ?? []) as ContentAccountRow[];
  },
  async fetchSocialChannelsByIds(ids) {
    if (ids.length === 0) return []; // Decision K.2
    const { data, error } = await supabaseAdmin.from("social_channels").select("id, name").in("id", ids);
    if (error) throw new RunScopeError(`No se pudo resolver scope - error leyendo social_channels: ${error.message}`);
    return (data ?? []) as SocialChannelRow[];
  },
  async fetchSocialAccountsByChannelIds(channelIds) {
    if (channelIds.length === 0) return []; // Decision K.2
    const { data, error } = await supabaseAdmin.from("social_accounts").select("id, channel_id").in("channel_id", channelIds);
    if (error) throw new RunScopeError(`No se pudo resolver scope - error leyendo social_accounts: ${error.message}`);
    return (data ?? []) as SocialAccountRow[];
  },
};

// ---------------------------------------------------------------------------
// Punto de entrada unico. `env`/`deps` son inyectables para poder testear
// sin depender de process.env global ni de una conexion real a Supabase.
// ---------------------------------------------------------------------------
export async function resolveRunScope(env: NodeJS.ProcessEnv = process.env, deps: RunScopeDeps = defaultRunScopeDeps): Promise<ResolvedRunScope> {
  const runScope = parseRunScopeName(env.RUN_SCOPE);
  const materialRoot = resolveMaterialRootFor(runScope, env);

  if (runScope === "PRODUCTION") {
    const accounts = await deps.fetchContentAccountsByFolderNames(PRODUCTION_FOLDER_NAMES);
    const candidateChannelIds = [...new Set(accounts.map((a) => a.channel_id))];
    const channels = await deps.fetchSocialChannelsByIds(candidateChannelIds);

    const validation = validateProductionAccountSet(accounts, channels);
    if (!validation.ok) throw new RunScopeError(validation.reason);

    const socialAccounts = await deps.fetchSocialAccountsByChannelIds(validation.channelIds);
    const consistency = validateSocialAccountsConsistency(socialAccounts, validation.channelIds);
    if (!consistency.ok) throw new RunScopeError(consistency.reason);

    return {
      runScope,
      allowedContentAccountIds: validation.contentAccountIds,
      allowedSocialAccountIds: socialAccounts.map((s) => s.id),
      materialRoot,
    };
  }

  // TEST - Decision K.5: cero cuentas TEST hoy es un resultado VALIDO y
  // seguro (listas vacias, cero trabajo), nunca un fallback a PRODUCTION ni
  // a una consulta global.
  const testAccounts = await deps.fetchContentAccountsByChannelStatus("TEST");
  if (testAccounts.length === 0) {
    return { runScope, allowedContentAccountIds: [], allowedSocialAccountIds: [], materialRoot };
  }

  const testChannelIds = [...new Set(testAccounts.map((a) => a.channel_id))];
  const testSocialAccounts = await deps.fetchSocialAccountsByChannelIds(testChannelIds);
  const testConsistency = validateSocialAccountsConsistency(testSocialAccounts, testChannelIds);
  if (!testConsistency.ok) throw new RunScopeError(testConsistency.reason);

  return {
    runScope,
    allowedContentAccountIds: testAccounts.map((a) => a.id),
    allowedSocialAccountIds: testSocialAccounts.map((s) => s.id),
    materialRoot,
  };
}

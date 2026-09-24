// FASE 5.10-A — pruebas EJECUTABLES de agent/runScope.mts (la funcion real,
// no una copia). Mismo patron que agent/publish/test-recover-stale-claims.mts:
// ./config.mts se importa PRIMERO (carga .env.local) para que supabaseClient.mts
// pueda construirse sin lanzar "supabaseUrl is required" al importar
// runScope.mts - el cliente real SI se construye pero NUNCA se invoca: todas
// las pruebas de resolveRunScope() usan RunScopeDeps inyectados apuntando a
// datos en memoria, cero llamadas de red a Supabase real. Las unicas
// funciones que SI tocan supabaseAdmin (defaultRunScopeDeps) solo se prueban
// en su rama de cortocircuito (lista de ids vacia -> Decision K.2), que
// retorna ANTES de llamar a supabaseAdmin - tambien cero red real.
import "./config.mts";
import {
  parseRunScopeName,
  resolveMaterialRootFor,
  validateProductionAccountSet,
  validateSocialAccountsConsistency,
  resolveRunScope,
  defaultRunScopeDeps,
  PRODUCTION_FOLDER_NAMES,
  RunScopeError,
  type ContentAccountRow,
  type SocialChannelRow,
  type SocialAccountRow,
  type RunScopeDeps,
} from "./runScope.mts";

let failures = 0;
const check = (label: string, cond: boolean, extra = "") => {
  const mark = cond ? "PASS" : "FAIL";
  if (!cond) failures++;
  console.log(`[${mark}] ${label}${extra ? " — " + extra : ""}`);
};

async function expectThrows(label: string, fn: () => Promise<unknown> | unknown, reasonSubstring?: string) {
  try {
    await fn();
    check(label, false, "no lanzo (se esperaba RunScopeError)");
  } catch (err) {
    const isRunScopeError = err instanceof RunScopeError;
    const message = err instanceof Error ? err.message : String(err);
    const matchesReason = reasonSubstring ? message.includes(reasonSubstring) : true;
    check(label, isRunScopeError && matchesReason, isRunScopeError ? undefined : `error inesperado: ${message}`);
  }
}

// Fixtures - 4 cuentas de PRODUCTION validas, con channel_id/social_channels/
// social_accounts consistentes entre si.
const CH_SIN_EXPLICACION = "channel-sin-explicacion";
const CH_ENCIENDE = "channel-enciende-el-caos";
const CH_LUNA = "channel-luna-verde";
const CH_OBJETOS = "channel-objetos-malditos";

function validProductionAccounts(): ContentAccountRow[] {
  return [
    { id: "ca-sin-explicacion", folder_name: "SIN EXPLICACIÓN", channel_id: CH_SIN_EXPLICACION, channel_status: "HISTORICAL" },
    { id: "ca-enciende", folder_name: "ENCIENDE EL CAOS", channel_id: CH_ENCIENDE, channel_status: "HISTORICAL" },
    { id: "ca-luna", folder_name: "LUNA VERDE", channel_id: CH_LUNA, channel_status: "HISTORICAL" },
    { id: "ca-objetos", folder_name: "OBJETOS MALDITOS", channel_id: CH_OBJETOS, channel_status: "HISTORICAL" },
  ];
}
function validProductionChannels(): SocialChannelRow[] {
  return [
    { id: CH_SIN_EXPLICACION, name: "SIN EXPLICACIÓN" },
    { id: CH_ENCIENDE, name: "ENCIENDE EL CAOS" },
    { id: CH_LUNA, name: "LUNA VERDE" },
    { id: CH_OBJETOS, name: "OBJETOS MALDITOS" },
  ];
}
function validProductionSocialAccounts(): SocialAccountRow[] {
  return [
    { id: "sa-sin-explicacion-yt", channel_id: CH_SIN_EXPLICACION },
    { id: "sa-enciende-yt", channel_id: CH_ENCIENDE },
    { id: "sa-enciende-fb", channel_id: CH_ENCIENDE },
    { id: "sa-luna-yt", channel_id: CH_LUNA },
    { id: "sa-objetos-yt", channel_id: CH_OBJETOS },
  ];
}

function makeDeps(overrides: Partial<RunScopeDeps> & { calls?: Record<string, number> } = {}): RunScopeDeps & { calls: Record<string, number> } {
  const calls: Record<string, number> = {
    fetchContentAccountsByFolderNames: 0,
    fetchContentAccountsByChannelStatus: 0,
    fetchSocialChannelsByIds: 0,
    fetchSocialAccountsByChannelIds: 0,
  };
  const base: RunScopeDeps = {
    async fetchContentAccountsByFolderNames() {
      calls.fetchContentAccountsByFolderNames++;
      return [];
    },
    async fetchContentAccountsByChannelStatus() {
      calls.fetchContentAccountsByChannelStatus++;
      return [];
    },
    async fetchSocialChannelsByIds() {
      calls.fetchSocialChannelsByIds++;
      return [];
    },
    async fetchSocialAccountsByChannelIds() {
      calls.fetchSocialAccountsByChannelIds++;
      return [];
    },
  };
  return { ...base, ...overrides, calls };
}

async function main() {
  // ==================================================
  // parseRunScopeName — puro
  // ==================================================
  check("parseRunScopeName('PRODUCTION') = PRODUCTION", parseRunScopeName("PRODUCTION") === "PRODUCTION");
  check("parseRunScopeName('TEST') = TEST", parseRunScopeName("TEST") === "TEST");
  await expectThrows("parseRunScopeName(undefined) lanza RunScopeError", () => parseRunScopeName(undefined), "ausente");
  await expectThrows("parseRunScopeName('') lanza RunScopeError", () => parseRunScopeName(""), "ausente");
  await expectThrows("parseRunScopeName('production') (minusculas) lanza RunScopeError", () => parseRunScopeName("production"), "invalido");
  await expectThrows("parseRunScopeName('ALL') lanza RunScopeError", () => parseRunScopeName("ALL"), "invalido");

  // ==================================================
  // resolveMaterialRootFor — puro
  // ==================================================
  check(
    "PRODUCTION sin MATERIAL_ROOT -> default real D:\\MATERIAL VIDEOS",
    resolveMaterialRootFor("PRODUCTION", {}) === "D:\\MATERIAL VIDEOS"
  );
  check(
    "PRODUCTION con MATERIAL_ROOT explicito -> se respeta",
    resolveMaterialRootFor("PRODUCTION", { MATERIAL_ROOT: "D:\\Otra Ruta" }) === "D:\\Otra Ruta"
  );
  await expectThrows("TEST sin MATERIAL_ROOT lanza RunScopeError (nunca cae al real)", () => resolveMaterialRootFor("TEST", {}), "MATERIAL_ROOT explicito");
  await expectThrows(
    "TEST con MATERIAL_ROOT igual al real (distinto casing/espacios) lanza RunScopeError",
    () => resolveMaterialRootFor("TEST", { MATERIAL_ROOT: "d:\\material videos\\" }),
    "coincide con la ruta real"
  );
  check(
    "TEST con MATERIAL_ROOT explicito y distinto -> se respeta",
    resolveMaterialRootFor("TEST", { MATERIAL_ROOT: "C:\\Scratch\\TEST-MATERIAL" }) === "C:\\Scratch\\TEST-MATERIAL"
  );

  // --------------------------------------------------
  // Correccion del hallazgo 7.3 (revision Fase 5.10-A) — normalizePath() ahora
  // usa path.win32.resolve() (API estandar de Node, puramente sintactica,
  // nunca toca el filesystem) en vez de reemplazos de string improvisados.
  // Las 5 representaciones pedidas explicitamente deben rechazarse todas por
  // coincidir con la ruta real, y una ruta TEST genuinamente distinta debe
  // seguir aceptandose.
  // --------------------------------------------------
  await expectThrows(
    "TEST con 'D:\\MATERIAL VIDEOS' (backslash, mismo casing) lanza RunScopeError",
    () => resolveMaterialRootFor("TEST", { MATERIAL_ROOT: "D:\\MATERIAL VIDEOS" }),
    "coincide con la ruta real"
  );
  await expectThrows(
    "TEST con 'D:/MATERIAL VIDEOS' (forward slash) lanza RunScopeError",
    () => resolveMaterialRootFor("TEST", { MATERIAL_ROOT: "D:/MATERIAL VIDEOS" }),
    "coincide con la ruta real"
  );
  await expectThrows(
    "TEST con 'd:/material videos' (forward slash + minusculas) lanza RunScopeError",
    () => resolveMaterialRootFor("TEST", { MATERIAL_ROOT: "d:/material videos" }),
    "coincide con la ruta real"
  );
  await expectThrows(
    "TEST con 'D:\\MATERIAL VIDEOS\\' (backslash final, mismo casing) lanza RunScopeError",
    () => resolveMaterialRootFor("TEST", { MATERIAL_ROOT: "D:\\MATERIAL VIDEOS\\" }),
    "coincide con la ruta real"
  );
  await expectThrows(
    "TEST con segmento '..' que resuelve de vuelta a la ruta real lanza RunScopeError",
    () => resolveMaterialRootFor("TEST", { MATERIAL_ROOT: "D:\\MATERIAL VIDEOS\\Cualquier Subcarpeta\\.." }),
    "coincide con la ruta real"
  );
  await expectThrows(
    "TEST con segmento '.' que resuelve de vuelta a la ruta real lanza RunScopeError",
    () => resolveMaterialRootFor("TEST", { MATERIAL_ROOT: "D:\\.\\MATERIAL VIDEOS" }),
    "coincide con la ruta real"
  );
  check(
    "TEST con ruta realmente distinta usando forward slashes -> se acepta (no colisiona)",
    resolveMaterialRootFor("TEST", { MATERIAL_ROOT: "C:/Scratch/TEST-MATERIAL" }) === "C:/Scratch/TEST-MATERIAL"
  );

  // ==================================================
  // validateProductionAccountSet — puro
  // ==================================================
  {
    const result = validateProductionAccountSet(validProductionAccounts(), validProductionChannels());
    check("4 cuentas validas -> ok:true", result.ok === true);
    if (result.ok) {
      check("ok:true trae exactamente 4 contentAccountIds", result.contentAccountIds.length === 4);
      check("ok:true trae exactamente 4 channelIds", result.channelIds.length === 4);
    }
  }
  {
    const accounts = validProductionAccounts().filter((a) => a.folder_name !== "LUNA VERDE");
    const result = validateProductionAccountSet(accounts, validProductionChannels());
    check("falta 1 de las 4 -> ok:false (nunca reduce a 3 y continua)", result.ok === false);
    if (!result.ok) check("razon menciona la cuenta faltante", result.reason.includes("LUNA VERDE"));
  }
  {
    const accounts = [...validProductionAccounts(), { id: "ca-intrusa", folder_name: "CANAL NUEVO", channel_id: "channel-nuevo", channel_status: "ACTIVE" }];
    const channels = [...validProductionChannels(), { id: "channel-nuevo", name: "CANAL NUEVO" }];
    const result = validateProductionAccountSet(accounts, channels);
    check("cuenta 5ta inesperada -> ok:false (lista cerrada de 4)", result.ok === false);
  }
  {
    // channel_id de LUNA VERDE apunta al canal de OBJETOS MALDITOS - inconsistencia real.
    const accounts = validProductionAccounts().map((a) => (a.folder_name === "LUNA VERDE" ? { ...a, channel_id: CH_OBJETOS } : a));
    const result = validateProductionAccountSet(accounts, validProductionChannels());
    check("content_account apunta al channel equivocado -> ok:false", result.ok === false);
    if (!result.ok) check("razon menciona 'channel equivocado'", result.reason.includes("channel equivocado"));
  }
  {
    const accounts = validProductionAccounts().map((a) => (a.folder_name === "OBJETOS MALDITOS" ? { ...a, channel_id: "channel-inexistente" } : a));
    const result = validateProductionAccountSet(accounts, validProductionChannels());
    check("content_account referencia un channel_id que no existe en social_channels -> ok:false", result.ok === false);
  }

  // ==================================================
  // validateSocialAccountsConsistency — puro
  // ==================================================
  {
    const result = validateSocialAccountsConsistency(validProductionSocialAccounts(), [CH_SIN_EXPLICACION, CH_ENCIENDE, CH_LUNA, CH_OBJETOS]);
    check("social_accounts todas dentro de los channel_id permitidos -> ok:true", result.ok === true);
  }
  {
    const intrusa: SocialAccountRow = { id: "sa-intrusa", channel_id: "channel-fuera-de-scope" };
    const result = validateSocialAccountsConsistency([...validProductionSocialAccounts(), intrusa], [CH_SIN_EXPLICACION, CH_ENCIENDE, CH_LUNA, CH_OBJETOS]);
    check("social_account con channel_id fuera de los permitidos -> ok:false", result.ok === false);
  }

  // ==================================================
  // resolveRunScope() — orquestacion completa, con deps inyectados
  // ==================================================
  {
    const deps = makeDeps({
      fetchContentAccountsByFolderNames: async () => validProductionAccounts(),
      fetchSocialChannelsByIds: async () => validProductionChannels(),
      fetchSocialAccountsByChannelIds: async () => validProductionSocialAccounts(),
    });
    const resolved = await resolveRunScope({ RUN_SCOPE: "PRODUCTION" }, deps);
    check("PRODUCTION feliz: runScope='PRODUCTION'", resolved.runScope === "PRODUCTION");
    check("PRODUCTION feliz: 4 allowedContentAccountIds", resolved.allowedContentAccountIds.length === 4);
    check("PRODUCTION feliz: 5 allowedSocialAccountIds (2 de ENCIENDE EL CAOS)", resolved.allowedSocialAccountIds.length === 5);
    check("PRODUCTION feliz: materialRoot = default real", resolved.materialRoot === "D:\\MATERIAL VIDEOS");
  }

  await expectThrows(
    "PRODUCTION con solo 3 cuentas reales (falta OBJETOS MALDITOS) -> resolveRunScope lanza, NUNCA continua con 3",
    () =>
      resolveRunScope(
        { RUN_SCOPE: "PRODUCTION" },
        makeDeps({
          fetchContentAccountsByFolderNames: async () => validProductionAccounts().filter((a) => a.folder_name !== "OBJETOS MALDITOS"),
          fetchSocialChannelsByIds: async () => validProductionChannels(),
        })
      ),
    "OBJETOS MALDITOS"
  );

  await expectThrows(
    "PRODUCTION con social_account fuera de los channel_id validados -> resolveRunScope lanza",
    () =>
      resolveRunScope(
        { RUN_SCOPE: "PRODUCTION" },
        makeDeps({
          fetchContentAccountsByFolderNames: async () => validProductionAccounts(),
          fetchSocialChannelsByIds: async () => validProductionChannels(),
          fetchSocialAccountsByChannelIds: async () => [...validProductionSocialAccounts(), { id: "sa-intrusa", channel_id: "channel-ajeno" }],
        })
      ),
    "fuera de los channel_id"
  );

  await expectThrows("RUN_SCOPE ausente -> resolveRunScope lanza sin tocar deps", () => resolveRunScope({}, makeDeps()));
  {
    const deps = makeDeps();
    try {
      await resolveRunScope({}, deps);
    } catch {
      // esperado
    }
    check("RUN_SCOPE ausente: ninguna funcion de deps fue llamada (fail-closed ANTES de cualquier I/O)", Object.values(deps.calls).every((n) => n === 0));
  }

  await expectThrows("RUN_SCOPE invalido -> resolveRunScope lanza sin tocar deps", () => resolveRunScope({ RUN_SCOPE: "PROD" }, makeDeps()));

  {
    // TEST sin cuentas — Decision K.5: listas vacias, cero trabajo, NUNCA fallback.
    const deps = makeDeps({ fetchContentAccountsByChannelStatus: async () => [] });
    const resolved = await resolveRunScope({ RUN_SCOPE: "TEST", MATERIAL_ROOT: "C:\\Scratch\\TEST-MATERIAL" }, deps);
    check("TEST vacio: runScope='TEST'", resolved.runScope === "TEST");
    check("TEST vacio: allowedContentAccountIds=[]", resolved.allowedContentAccountIds.length === 0);
    check("TEST vacio: allowedSocialAccountIds=[]", resolved.allowedSocialAccountIds.length === 0);
    check(
      "TEST vacio: fetchSocialAccountsByChannelIds NUNCA se llamo (K.2/K.5 — no se ejecuta consulta sobre scope vacio)",
      deps.calls.fetchSocialAccountsByChannelIds === 0
    );
  }

  {
    const testAccounts: ContentAccountRow[] = [{ id: "ca-test-1", folder_name: "CANAL DE PRUEBA", channel_id: "channel-test-1", channel_status: "TEST" }];
    const testSocialAccounts: SocialAccountRow[] = [{ id: "sa-test-1-yt", channel_id: "channel-test-1" }];
    const deps = makeDeps({
      fetchContentAccountsByChannelStatus: async () => testAccounts,
      fetchSocialAccountsByChannelIds: async () => testSocialAccounts,
    });
    const resolved = await resolveRunScope({ RUN_SCOPE: "TEST", MATERIAL_ROOT: "C:\\Scratch\\TEST-MATERIAL" }, deps);
    check("TEST con 1 cuenta: allowedContentAccountIds=['ca-test-1']", resolved.allowedContentAccountIds.length === 1 && resolved.allowedContentAccountIds[0] === "ca-test-1");
    check("TEST con 1 cuenta: allowedSocialAccountIds=['sa-test-1-yt']", resolved.allowedSocialAccountIds.length === 1 && resolved.allowedSocialAccountIds[0] === "sa-test-1-yt");
  }

  await expectThrows(
    "TEST con MATERIAL_ROOT ausente -> resolveRunScope lanza SIN llamar a deps (falla antes de tocar Supabase)",
    () => resolveRunScope({ RUN_SCOPE: "TEST" }, makeDeps())
  );
  {
    const deps = makeDeps();
    try {
      await resolveRunScope({ RUN_SCOPE: "TEST" }, deps);
    } catch {
      // esperado
    }
    check("TEST sin MATERIAL_ROOT: ninguna funcion de deps fue llamada", Object.values(deps.calls).every((n) => n === 0));
  }

  // ==================================================
  // PRODUCTION_FOLDER_NAMES — confirma la lista cerrada de 4, sin mas.
  // ==================================================
  check(
    "PRODUCTION_FOLDER_NAMES tiene exactamente las 4 cuentas reales esperadas",
    PRODUCTION_FOLDER_NAMES.length === 4 &&
      PRODUCTION_FOLDER_NAMES.includes("SIN EXPLICACIÓN") &&
      PRODUCTION_FOLDER_NAMES.includes("ENCIENDE EL CAOS") &&
      PRODUCTION_FOLDER_NAMES.includes("LUNA VERDE") &&
      PRODUCTION_FOLDER_NAMES.includes("OBJETOS MALDITOS")
  );

  // ==================================================
  // Decision K.2 — defaultRunScopeDeps NUNCA ejecuta `.in("col", [])` contra
  // Supabase real: las funciones de "por ids" cortocircuitan ANTES de tocar
  // supabaseAdmin cuando la lista de entrada esta vacia. Esto se prueba
  // directamente (sin mocks de red) porque el cortocircuito ocurre antes de
  // cualquier llamada real - si esto alguna vez dejara de cortocircuitar,
  // esta prueba fallaria por timeout/error de red real, nunca en silencio.
  // ==================================================
  {
    const channels = await defaultRunScopeDeps.fetchSocialChannelsByIds([]);
    check("defaultRunScopeDeps.fetchSocialChannelsByIds([]) devuelve [] sin consultar Supabase", Array.isArray(channels) && channels.length === 0);
  }
  {
    const accounts = await defaultRunScopeDeps.fetchSocialAccountsByChannelIds([]);
    check("defaultRunScopeDeps.fetchSocialAccountsByChannelIds([]) devuelve [] sin consultar Supabase", Array.isArray(accounts) && accounts.length === 0);
  }

  console.log(`\n${failures === 0 ? "TODAS LAS PRUEBAS PASARON" : `${failures} PRUEBA(S) FALLARON`}`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main();

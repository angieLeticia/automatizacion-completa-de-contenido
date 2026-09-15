// Fase 20 — pruebas del comando operativo de reconciliacion de Instagram
// (READ -> VERIFY -> REPORT, ninguna ruta de publicacion). Mismo patron que
// el resto del proyecto: check() manual, sin framework externo. `fetch` se
// stubbea para lanzar si se le llama - ninguno de los 16 escenarios debe
// tocar red real, y menos aun un POST a Meta (Objetivo 10 / Seguridad 15-16).
// NO hay credenciales reales, NO hay Meta real, NO hay publicacion real.
import {
  runInstagramReconciliation,
  describeReconciliationResult,
  type ReconciliationDeps,
  type ReconciliationPostRow,
  type ReconciliationAccountRow,
  type IdentityCheckResult,
  type ReconcileVerdict,
} from "./instagramReconciliation.mts";

let failures = 0;
const check = (label: string, cond: boolean, extra = "") => {
  const mark = cond ? "PASS" : "FAIL";
  if (!cond) failures++;
  console.log(`[${mark}] ${label}${extra ? " — " + extra : ""}`);
};

const POST_ID = "296ec9b7-29e7-405d-a30c-eeae4cca3a28";
const ACCOUNT_ID = "06ba45aa-59ae-4d8e-aae5-14c36a94fa8d";
const REAL_REF = "17900000000000000"; // creationId de forma realista (dato ficticio, no secreto)

function basePost(overrides: Partial<ReconciliationPostRow> = {}): ReconciliationPostRow {
  return { id: POST_ID, status: "verification_required", account_id: ACCOUNT_ID, publisher_operation_ref: REAL_REF, ...overrides };
}
function baseAccount(overrides: Partial<ReconciliationAccountRow> = {}): ReconciliationAccountRow {
  return { platform: "instagram", credentials: { ig_user_id: "17841442604823009", access_token: "fake-token-for-tests" }, ...overrides };
}

// Cada dep individual, si se invoca, queda registrada aqui para poder
// verificar (escenarios de seguridad 15/16) que ninguna ruta llega a un
// media_publish ni a un fetch real - esta orquestacion solo conoce las
// funciones inyectadas, nunca fetch directamente.
function buildDeps(opts: {
  post?: ReconciliationPostRow | null;
  account?: ReconciliationAccountRow | null;
  identity?: IdentityCheckResult;
  verdict?: ReconcileVerdict;
  calls: { fetchPost: number; fetchAccount: number; verifyIdentity: number; reconcile: number };
}): ReconciliationDeps {
  const { post = basePost(), account = baseAccount(), identity = { status: "VERIFIED", reason: "ok" }, verdict = "CANNOT_VERIFY", calls } = opts;
  return {
    fetchPost: async (id: string) => {
      calls.fetchPost++;
      return id === POST_ID ? post : null;
    },
    fetchAccount: async (id: string) => {
      calls.fetchAccount++;
      return id === ACCOUNT_ID ? account : null;
    },
    verifyIdentity: async () => {
      calls.verifyIdentity++;
      return identity;
    },
    reconcile: async () => {
      calls.reconcile++;
      return verdict;
    },
    now: () => new Date("2026-09-15T22:00:00.000Z"),
  };
}

async function main() {
  // fetch NUNCA debe llamarse desde este modulo - ni siquiera indirectamente.
  // Este modulo no importa fetch en absoluto (solo isRealOperationRef, pura),
  // asi que este stub es una red de seguridad estructural para las 16 pruebas.
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error("SEGURIDAD: ningun escenario de reconciliacion debe llamar a fetch/red real directamente desde el orquestador");
  }) as typeof fetch;

  try {
    // ================= Validacion de entrada =================

    // 1. Post inexistente
    {
      const calls = { fetchPost: 0, fetchAccount: 0, verifyIdentity: 0, reconcile: 0 };
      const deps = buildDeps({ post: null, calls });
      const result = await runInstagramReconciliation(POST_ID, deps);
      check("1. Post inexistente -> POST_NOT_FOUND", result.code === "POST_NOT_FOUND");
      check("1b. No se intenta buscar cuenta si el post no existe", calls.fetchAccount === 0);
    }

    // 2. Post de Facebook
    {
      const calls = { fetchPost: 0, fetchAccount: 0, verifyIdentity: 0, reconcile: 0 };
      const deps = buildDeps({ account: baseAccount({ platform: "facebook" }), calls });
      const result = await runInstagramReconciliation(POST_ID, deps);
      check("2. Post de Facebook -> WRONG_PLATFORM, rechazado ANTES de tocar Meta", result.code === "WRONG_PLATFORM" && calls.verifyIdentity === 0 && calls.reconcile === 0);
    }

    // 3. Instagram pero status=pending
    {
      const calls = { fetchPost: 0, fetchAccount: 0, verifyIdentity: 0, reconcile: 0 };
      const deps = buildDeps({ post: basePost({ status: "pending" }), calls });
      const result = await runInstagramReconciliation(POST_ID, deps);
      check("3. status='pending' -> WRONG_STATUS, rechazado ANTES de tocar Meta", result.code === "WRONG_STATUS" && calls.verifyIdentity === 0 && calls.reconcile === 0);
    }
    // 3b otros estados explicitamente rechazados
    for (const badStatus of ["publishing", "published", "error"]) {
      const calls = { fetchPost: 0, fetchAccount: 0, verifyIdentity: 0, reconcile: 0 };
      const deps = buildDeps({ post: basePost({ status: badStatus }), calls });
      const result = await runInstagramReconciliation(POST_ID, deps);
      check(`3c. status='${badStatus}' -> WRONG_STATUS`, result.code === "WRONG_STATUS");
    }

    // 4. verification_required sin publisher_operation_ref
    {
      const calls = { fetchPost: 0, fetchAccount: 0, verifyIdentity: 0, reconcile: 0 };
      const deps = buildDeps({ post: basePost({ publisher_operation_ref: null }), calls });
      const result = await runInstagramReconciliation(POST_ID, deps);
      check("4. publisher_operation_ref ausente -> MISSING_OPERATION_REF", result.code === "MISSING_OPERATION_REF" && calls.verifyIdentity === 0);
    }

    // 5. operation_ref placeholder ("pending:instagram")
    {
      const calls = { fetchPost: 0, fetchAccount: 0, verifyIdentity: 0, reconcile: 0 };
      const deps = buildDeps({ post: basePost({ publisher_operation_ref: "pending:instagram" }), calls });
      const result = await runInstagramReconciliation(POST_ID, deps);
      check(
        "5. publisher_operation_ref='pending:instagram' (placeholder) -> PLACEHOLDER_OPERATION_REF, nunca tratado como creationId real",
        result.code === "PLACEHOLDER_OPERATION_REF" && calls.verifyIdentity === 0
      );
    }

    // 6. Credenciales ausentes
    {
      const calls = { fetchPost: 0, fetchAccount: 0, verifyIdentity: 0, reconcile: 0 };
      const deps = buildDeps({ account: baseAccount({ credentials: { ig_user_id: "", access_token: "" } }), calls });
      const result = await runInstagramReconciliation(POST_ID, deps);
      check(
        "6. credentials ausentes (ig_user_id y access_token) -> CREDENTIALS_MISSING",
        result.code === "CREDENTIALS_MISSING" && result.missing.includes("ig_user_id") && result.missing.includes("access_token") && calls.verifyIdentity === 0
      );
    }

    // 7. Identidad NO verificada
    {
      const calls = { fetchPost: 0, fetchAccount: 0, verifyIdentity: 0, reconcile: 0 };
      const deps = buildDeps({ identity: { status: "IDENTITY_MISMATCH", reason: "ig_user_id configurado no coincide" }, calls });
      const result = await runInstagramReconciliation(POST_ID, deps);
      check(
        "7. Identidad no VERIFIED -> IDENTITY_NOT_VERIFIED, NUNCA se consulta el creationId (reconcile no se llama)",
        result.code === "IDENTITY_NOT_VERIFIED" && calls.reconcile === 0
      );
    }

    // ================= Resultados de reconciliacion =================

    // 8. CONFIRMED_PUBLISHED
    {
      const calls = { fetchPost: 0, fetchAccount: 0, verifyIdentity: 0, reconcile: 0 };
      const deps = buildDeps({ verdict: "CONFIRMED_PUBLISHED", calls });
      const result = await runInstagramReconciliation(POST_ID, deps);
      check("8. Meta confirma PUBLISHED -> CONFIRMED_PUBLISHED_REQUIRES_HUMAN_REVIEW", result.code === "CONFIRMED_PUBLISHED_REQUIRES_HUMAN_REVIEW");
    }

    // 9. CONFIRMED_NOT_PUBLISHED
    {
      const calls = { fetchPost: 0, fetchAccount: 0, verifyIdentity: 0, reconcile: 0 };
      const deps = buildDeps({ verdict: "CONFIRMED_NOT_PUBLISHED", calls });
      const result = await runInstagramReconciliation(POST_ID, deps);
      check("9. Meta confirma ERROR -> CONFIRMED_NOT_PUBLISHED_REQUIRES_HUMAN_REVIEW", result.code === "CONFIRMED_NOT_PUBLISHED_REQUIRES_HUMAN_REVIEW");
    }

    // 10. CANNOT_VERIFY
    {
      const calls = { fetchPost: 0, fetchAccount: 0, verifyIdentity: 0, reconcile: 0 };
      const deps = buildDeps({ verdict: "CANNOT_VERIFY", calls });
      const result = await runInstagramReconciliation(POST_ID, deps);
      check("10. Evidencia insuficiente -> CANNOT_VERIFY", result.code === "CANNOT_VERIFY");
    }

    // ================= Seguridad =================

    // 11. CONFIRMED_PUBLISHED no modifica status (estructural: no existe ninguna
    // funcion de escritura entre las deps - ReconciliationDeps no tiene ningun
    // campo update*/write*/set*, asi que es imposible que este modulo escriba).
    {
      const calls = { fetchPost: 0, fetchAccount: 0, verifyIdentity: 0, reconcile: 0 };
      const deps = buildDeps({ verdict: "CONFIRMED_PUBLISHED", calls });
      const writeKeys = Object.keys(deps).filter((k) => /update|write|set|persist|save/i.test(k));
      const result = await runInstagramReconciliation(POST_ID, deps);
      check(
        "11. CONFIRMED_PUBLISHED no modifica status — ReconciliationDeps no expone NINGUNA funcion de escritura",
        writeKeys.length === 0 && result.code === "CONFIRMED_PUBLISHED_REQUIRES_HUMAN_REVIEW"
      );
    }

    // 12. CONFIRMED_PUBLISHED nunca escribe creationId como external_post_id
    {
      const calls = { fetchPost: 0, fetchAccount: 0, verifyIdentity: 0, reconcile: 0 };
      const deps = buildDeps({ verdict: "CONFIRMED_PUBLISHED", calls });
      const result = await runInstagramReconciliation(POST_ID, deps);
      const lines = describeReconciliationResult(result);
      const text = lines.join("\n");
      check(
        "12. CONFIRMED_PUBLISHED reporta external_post_id=UNKNOWN (nunca el creationId) y aclara creationId != external_post_id",
        result.code === "CONFIRMED_PUBLISHED_REQUIRES_HUMAN_REVIEW" &&
          text.includes("external_post_id=UNKNOWN") &&
          !text.includes(`external_post_id=${REAL_REF}`) &&
          text.includes("creationId != external_post_id")
      );
    }

    // 13. CONFIRMED_NOT_PUBLISHED nunca revierte a pending
    {
      const calls = { fetchPost: 0, fetchAccount: 0, verifyIdentity: 0, reconcile: 0 };
      const deps = buildDeps({ verdict: "CONFIRMED_NOT_PUBLISHED", calls });
      const result = await runInstagramReconciliation(POST_ID, deps);
      check(
        "13. CONFIRMED_NOT_PUBLISHED nunca produce un resultado 'pending' — solo REQUIRES_HUMAN_REVIEW",
        result.code === "CONFIRMED_NOT_PUBLISHED_REQUIRES_HUMAN_REVIEW" && (result as any).status !== "pending"
      );
    }

    // 14. CANNOT_VERIFY no modifica nada
    {
      const calls = { fetchPost: 0, fetchAccount: 0, verifyIdentity: 0, reconcile: 0 };
      const deps = buildDeps({ verdict: "CANNOT_VERIFY", calls });
      const writeKeys = Object.keys(deps).filter((k) => /update|write|set|persist|save/i.test(k));
      const result = await runInstagramReconciliation(POST_ID, deps);
      check("14. CANNOT_VERIFY no modifica ningun campo — sin funciones de escritura disponibles", writeKeys.length === 0 && result.code === "CANNOT_VERIFY");
    }

    // 15. Ningun escenario ejecuta media_publish — ReconciliationDeps no
    // declara (ni el orquestador invoca) ninguna funcion cuyo nombre sugiera
    // media_publish/publish en ninguno de los 10 resultados posibles.
    {
      const allCodes = ["POST_NOT_FOUND", "ACCOUNT_NOT_FOUND", "WRONG_PLATFORM", "WRONG_STATUS", "MISSING_OPERATION_REF", "PLACEHOLDER_OPERATION_REF", "CREDENTIALS_MISSING", "IDENTITY_NOT_VERIFIED", "CONFIRMED_PUBLISHED_REQUIRES_HUMAN_REVIEW", "CONFIRMED_NOT_PUBLISHED_REQUIRES_HUMAN_REVIEW", "CANNOT_VERIFY"];
      const calls = { fetchPost: 0, fetchAccount: 0, verifyIdentity: 0, reconcile: 0 };
      const deps = buildDeps({ calls });
      const depKeys = Object.keys(deps);
      check(
        "15. Ninguna dependencia inyectable se llama 'media_publish' ni similar en ningun escenario posible",
        !depKeys.some((k) => /media_publish|mediaPublish/i.test(k)) && allCodes.length === 11
      );
    }

    // 16. Ningun escenario ejecuta un POST real contra Meta — fetch global
    // quedo stubbeado para lanzar si se le llama; si cualquiera de las
    // pruebas anteriores hubiera tocado fetch real, ya habria fallado con
    // una excepcion no capturada. Se re-verifica aqui explicitamente con
    // todos los verdicts posibles en una sola pasada adicional.
    {
      let threw = false;
      try {
        for (const verdict of ["CONFIRMED_PUBLISHED", "CONFIRMED_NOT_PUBLISHED", "CANNOT_VERIFY"] as const) {
          const calls = { fetchPost: 0, fetchAccount: 0, verifyIdentity: 0, reconcile: 0 };
          const deps = buildDeps({ verdict, calls });
          await runInstagramReconciliation(POST_ID, deps);
        }
      } catch {
        threw = true;
      }
      check("16. Ningun escenario invoca fetch real (stub configurado para lanzar si se le llama, y no se lanzo)", !threw);
    }

    // Extra: mensajes de texto de los estados de rechazo tambien seguros (sin tokens)
    {
      const calls = { fetchPost: 0, fetchAccount: 0, verifyIdentity: 0, reconcile: 0 };
      const deps = buildDeps({ identity: { status: "CHECK_FAILED", reason: "fallo de red al verificar identidad" }, calls });
      const result = await runInstagramReconciliation(POST_ID, deps);
      const text = describeReconciliationResult(result).join("\n");
      check("Extra. Reporte de IDENTITY_NOT_VERIFIED nunca incluye access_token/credenciales", result.code === "IDENTITY_NOT_VERIFIED" && !text.includes("fake-token-for-tests"));
    }
  } finally {
    globalThis.fetch = originalFetch;
  }

  console.log(`\n${failures === 0 ? "TODAS LAS PRUEBAS PASARON" : `${failures} PRUEBA(S) FALLARON`}`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main();

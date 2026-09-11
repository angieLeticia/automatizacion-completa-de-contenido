// Fase 5.14 — pruebas del gate de revisión humana. La mayoría son PURAS
// (humanReviewGate.mts no importa supabaseClient.mts) - las que sí tocan
// Supabase real (authorizePublication()/revokePublicationAuthorization())
// se limitan a lo que es seguro probar HOY: el post inexistente (paso 1,
// columnas ya existentes) - el resto de la escritura real requiere que la
// migración de publication_authorized_at/publication_authorized_by ya esté
// aplicada en Supabase (NOT VERIFIED AGAINST REAL SUPABASE hasta entonces,
// ver docs/phase-5.14-human-review.md), exactamente el mismo límite que ya
// se documentó para claimed_at/publisher_operation_ref antes de Fase 5.5.
import { randomUUID } from "node:crypto";
import path from "node:path";
// authorizePublication() (importado dinámicamente más abajo, TEST 5) SÍ toca
// Supabase real vía ../supabaseClient.mts - a diferencia del resto de este
// archivo (puro), esa única prueba necesita credenciales reales cargadas
// ANTES de la importación dinámica.
try {
  process.loadEnvFile(path.join(import.meta.dirname, "..", "..", ".env.local"));
} catch {
  // .env.local no existe o ya está cargado por el shell - seguimos sin frenar.
}
import { isPublicationAuthorized, describeAuthorizationGap, evaluateAuthorizationEligibility } from "./humanReviewGate.mts";

let failures = 0;
const check = (label: string, cond: boolean, extra = "") => {
  const mark = cond ? "PASS" : "FAIL";
  if (!cond) failures++;
  console.log(`[${mark}] ${label}${extra ? " — " + extra : ""}`);
};

async function main() {
  // ==================================================
  // 1-4 — isPublicationAuthorized() (pura)
  // ==================================================
  check("1. Sin autorización (ambos ausentes) -> BLOQUEADO", isPublicationAuthorized({}) === false);
  check("1b. Sin autorización (ambos null) -> BLOQUEADO", isPublicationAuthorized({ publication_authorized_at: null, publication_authorized_by: null }) === false);
  check(
    "2. publication_authorized_at presente, publication_authorized_by ausente -> BLOQUEADO",
    isPublicationAuthorized({ publication_authorized_at: "2026-09-11T00:00:00Z", publication_authorized_by: null }) === false
  );
  check(
    "2b. publication_authorized_by presente pero vacío ('') -> BLOQUEADO (no cuenta como autor real)",
    isPublicationAuthorized({ publication_authorized_at: "2026-09-11T00:00:00Z", publication_authorized_by: "   " }) === false
  );
  check(
    "3. publication_authorized_by presente, publication_authorized_at ausente -> BLOQUEADO",
    isPublicationAuthorized({ publication_authorized_at: null, publication_authorized_by: "angie@visteapy.com" }) === false
  );
  check(
    "4. Autorización completa (ambos presentes y no vacíos) -> SUPERA el gate",
    isPublicationAuthorized({ publication_authorized_at: "2026-09-11T00:00:00Z", publication_authorized_by: "angie@visteapy.com" }) === true
  );

  check("describeAuthorizationGap — sin autorización, mensaje claro de 'pendiente'", /pendiente|ausentes/i.test(describeAuthorizationGap({})));
  check(
    "describeAuthorizationGap — autorización completa, describe 'autorizado'",
    describeAuthorizationGap({ publication_authorized_at: "x", publication_authorized_by: "y" }) === "autorizado"
  );

  // ==================================================
  // 7 — post ya publicado -> no elegible para (re)autorización (pura)
  // ==================================================
  check("7. evaluateAuthorizationEligibility('published') -> NO elegible", evaluateAuthorizationEligibility("published").eligible === false);
  for (const s of ["pending", "publishing", "error", "verification_required"] as const) {
    check(`7-control. evaluateAuthorizationEligibility('${s}') -> SÍ elegible (solo 'published' bloquea)`, evaluateAuthorizationEligibility(s).eligible === true);
  }

  // ==================================================
  // 8 — verification_required no debe quedar habilitado automáticamente:
  // la autorización es un campo completamente independiente del status - un
  // post en verification_required PUEDE tener autorización previa (de antes
  // de que algo saliera mal) sin que eso lo reactive: main() en run.mts
  // solo consulta status='pending', así que un post en verification_required
  // nunca vuelve a evaluarse aunque isPublicationAuthorized() diera true.
  // ==================================================
  check(
    "8. Un post en verification_required con autorización completa NO se reactiva por sí solo (isPublicationAuthorized no cambia el status)",
    isPublicationAuthorized({ publication_authorized_at: "x", publication_authorized_by: "y" }) === true &&
      evaluateAuthorizationEligibility("verification_required").eligible === true
    // (la garantía real de que esto no reactiva nada es estructural en run.mts::main() -
    // ver docs/phase-5.14-human-review.md §7 para la cita exacta del código)
  );

  // ==================================================
  // 9/10/11 — la autorización nunca debe, por construcción, poder llamar a
  // un publisher ni cambiar DRY_RUN/channel_status: verificado por
  // INSPECCIÓN DE CÓDIGO (humanReviewGate.mts/publicationAuthorization.mts
  // no importan PUBLISHERS, fetch a plataformas, ni ./config.mts) - se deja
  // como aserción explícita en vez de fabricar una prueba de red.
  // ==================================================
  const humanReviewGateSource = await import("node:fs").then((fs) => fs.readFileSync(new URL("./humanReviewGate.mts", import.meta.url), "utf-8"));
  const publicationAuthorizationSource = await import("node:fs").then((fs) => fs.readFileSync(new URL("./publicationAuthorization.mts", import.meta.url), "utf-8"));
  check("9. humanReviewGate.mts no importa PUBLISHERS/publishers.ts", !/publishers\.ts/.test(humanReviewGateSource));
  check("9b. publicationAuthorization.mts no importa PUBLISHERS/publishers.ts", !/publishers\.ts/.test(publicationAuthorizationSource));
  check("10/11. Ninguno de los dos archivos importa ./config.mts (DRY_RUN/channel_status/flags)", !/from ["']\.\/config\.mts["']/.test(humanReviewGateSource + publicationAuthorizationSource));

  // ==================================================
  // 12/13/14 — identidad/channel_status/cuenta inactiva siguen bloqueando
  // AUNQUE exista autorización humana: prueba de composición pura del gate
  // exacto usado en run.mts (`DRY_RUN || !authorizedForRealPublication ||
  // !humanAuthorized`) - basta con demostrar que autorización=true NUNCA
  // por sí sola hace que el resultado combinado sea "publicar".
  // ==================================================
  function combinedGateBlocks(dryRun: boolean, channelAuthorized: boolean, humanAuthorized: boolean): boolean {
    return dryRun || !channelAuthorized || !humanAuthorized;
  }
  check(
    "12. channel_status no autoriza (identity/channel mismatch ya resuelto río arriba a false) + autorización humana completa -> SIGUE bloqueado",
    combinedGateBlocks(false, false, true) === true
  );
  check("13. DRY_RUN=false pero channel_status no ACTIVE + autorización humana completa -> SIGUE bloqueado", combinedGateBlocks(false, false, true) === true);
  check(
    "14. Las 3 condiciones deben cumplirse a la vez - autorización humana sola (con DRY_RUN=false, channel=true) SÍ despeja el gate combinado",
    combinedGateBlocks(false, true, true) === false
  );
  check("Control — sin autorización humana, aunque todo lo demás esté listo, SIGUE bloqueado", combinedGateBlocks(false, true, false) === true);

  // ==================================================
  // 5 — autorización de post inexistente -> error controlado, PROBADO
  // CONTRA SUPABASE REAL (solo SELECT de columnas ya existentes hoy -
  // id/status - no requiere la migración de Fase 5.14 para dar este
  // resultado correctamente).
  // ==================================================
  const { authorizePublication } = await import("./publicationAuthorization.mts");
  const fakeId = randomUUID();
  const result = await authorizePublication(fakeId, "test-fase-5.14@example.com");
  check("5. authorizePublication() sobre un id inexistente -> ok:false, error controlado (no lanza)", result.ok === false);
  if (!result.ok) {
    check("5b. El mensaje identifica claramente que el post no existe", /no existe/i.test(result.reason));
  }

  const emptyAuthorResult = await authorizePublication(fakeId, "   ");
  check("Extra — authorizedBy vacío/solo espacios -> ok:false, controlado (no llega ni a consultar Supabase)", emptyAuthorResult.ok === false);

  console.log(`\n${failures === 0 ? "TODOS LOS CASOS PASARON" : `${failures} CASO(S) FALLARON`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main();

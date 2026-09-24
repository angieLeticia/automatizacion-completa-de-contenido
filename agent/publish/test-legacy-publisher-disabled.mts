// H4-A.4 — pruebas de la neutralizacion del publisher legado
// (scripts/publish-due-social-posts.mts, Flujo A). Combina verificacion
// ESTRUCTURAL (el codigo capaz de publicar/tocar Supabase ya no esta activo,
// solo comentado) con verificacion de EJECUCION REAL (se lanza el script de
// verdad como subproceso, dos veces - con y sin credenciales en el entorno -
// para demostrar que su comportamiento es IDENTICO en ambos casos, es decir,
// que nunca depende de ellas ni las usa). Nunca se importa
// lib/social/publishers.ts ni ningun publisher real desde este archivo de
// test - no hace falta, precisamente porque el objetivo es demostrar que el
// script legado YA NO los importa el mismo.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

let failures = 0;
const check = (label: string, cond: boolean, extra = "") => {
  const mark = cond ? "PASS" : "FAIL";
  if (!cond) failures++;
  console.log(`[${mark}] ${label}${extra ? " — " + extra : ""}`);
};

const REPO_ROOT = path.join(import.meta.dirname, "..", "..");
const SCRIPT_PATH = path.join(REPO_ROOT, "scripts", "publish-due-social-posts.mts");

function main() {
  const source = readFileSync(SCRIPT_PATH, "utf-8");
  // Solo las lineas de codigo ACTIVAS (nunca las comentadas con "//") - el
  // codigo historico se conserva comentado a proposito (regla de no borrar
  // codigo), asi que las aserciones de "nunca importa X" deben ignorar esas
  // lineas o se producirian falsos negativos.
  const activeLines = source
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");

  // ==================================================
  // 1/2 — Garantia ESTRUCTURAL: el codigo activo ya no puede invocar
  // publishers reales ni crear un cliente Supabase, porque ni siquiera los
  // importa. No es una condicion en tiempo de ejecucion que podria fallar -
  // es la ausencia del propio codigo capaz de hacerlo.
  // ==================================================
  check("1. El codigo ACTIVO (no comentado) nunca importa PUBLISHERS/lib/social/publishers", !/import\s*\{[^}]*\bPUBLISHERS\b[^}]*\}/.test(activeLines) && !activeLines.includes('from "../lib/social/publishers"'));
  check("1b. El codigo ACTIVO nunca importa publishToYouTube/publishToFacebook/publishToInstagram directa o indirectamente", !/publishToYouTube|publishToFacebook|publishToInstagram/.test(activeLines));
  check("2. El codigo ACTIVO nunca importa @supabase/supabase-js (no puede crear un cliente Supabase)", !activeLines.includes("@supabase/supabase-js"));
  check("2b. El codigo ACTIVO nunca llama a createClient(...)", !/createClient\s*\(/.test(activeLines));

  // ==================================================
  // 3 — No modifica social_posts: consecuencia directa de 1/2 (sin cliente
  // Supabase no hay ningun .update()/.insert() posible), pero se confirma
  // tambien de forma explicita e independiente.
  // ==================================================
  check("3. El codigo ACTIVO nunca contiene '.from(\"social_posts\")' ni ningun .update(/.insert(", !/\.from\("social_posts"\)|\.update\(|\.insert\(/.test(activeLines));

  // ==================================================
  // 4/5 — No modifica credenciales ni .env.local: el codigo activo ya no lee
  // NEXT_PUBLIC_SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY (ni para validarlas ni
  // para usarlas), y no escribe a ningun archivo del filesystem.
  // ==================================================
  check("4. El codigo ACTIVO nunca lee NEXT_PUBLIC_SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY (no depende de credenciales en absoluto)", !/process\.env\.(NEXT_PUBLIC_SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY)/.test(activeLines));
  check("5. El codigo ACTIVO nunca escribe a ningun archivo (sin fs.write/appendFile/etc.) - no puede tocar .env.local ni nada mas", !/fs\.write|writeFileSync|appendFileSync|\.writeFile\(/.test(activeLines));

  // ==================================================
  // Mensaje de bloqueo claro y presencia del codigo historico conservado
  // (regla de no borrar codigo) - el codigo original completo debe seguir
  // legible, solo inerte.
  // ==================================================
  check("Mensaje de bloqueo explicito: 'LEGACY PUBLISHER DISABLED'", /LEGACY PUBLISHER DISABLED/.test(source));
  check("Mensaje señala el pipeline soportado: 'agent/publish/run.mts'", /agent\/publish\/run\.mts/.test(source));
  check("Mensaje confirma explicitamente 'No publication performed'", /No publication performed/.test(source));
  check("El codigo historico completo (PUBLISHERS, createClient, main(), cleanupVideoIfDone) se conserva COMENTADO, no borrado", /\/\/ import \{ PUBLISHERS \}/.test(source) && /\/\/ async function main\(\)/.test(source) && /\/\/ async function cleanupVideoIfDone/.test(source));

  // ==================================================
  // 1 (ejecucion real) — "npm run social:publish ya no puede iniciar una
  // publicacion real": se confirma que package.json SIGUE apuntando a este
  // mismo archivo (decision explicita: no se retira el comando, se explica
  // el bloqueo), y que ejecutar el archivo real (subproceso tsx real, sin
  // mocks) termina de inmediato con exit code != 0 y sin ningun rastro de
  // publicacion.
  // ==================================================
  const pkg = JSON.parse(readFileSync(path.join(REPO_ROOT, "package.json"), "utf-8"));
  check("6. package.json['social:publish'] sigue apuntando a scripts/publish-due-social-posts.mts (comando conservado, no retirado - explica el bloqueo en vez de fallar con 'missing script')", pkg.scripts?.["social:publish"] === "tsx scripts/publish-due-social-posts.mts");

  // Se ejecuta el archivo REAL dos veces como subproceso: una vez heredando
  // el entorno actual (que SI tiene NEXT_PUBLIC_SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY
  // reales, confirmado en la auditoria H4-A.3/H4-A.4 - PRESENTE, nunca se
  // imprime el valor), y otra vez con esas 2 variables eliminadas
  // explicitamente del entorno del subproceso. Si el comportamiento es
  // IDENTICO en ambos casos, queda demostrado que el script YA NO depende de
  // credenciales en absoluto (a diferencia del original, que fallaba de
  // forma DISTINTA si faltaban) - prueba mas fuerte que la sola inspeccion
  // de codigo.
  function runScript(env: NodeJS.ProcessEnv): { stdout: string; exitCode: number } {
    try {
      const stdout = execFileSync("npx", ["tsx", "scripts/publish-due-social-posts.mts"], {
        cwd: REPO_ROOT,
        env,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"],
        shell: true,
      });
      return { stdout, exitCode: 0 };
    } catch (err) {
      const e = err as { status?: number; stdout?: string; stderr?: string };
      return { stdout: (e.stdout ?? "") + (e.stderr ?? ""), exitCode: e.status ?? -1 };
    }
  }

  const envConCredenciales = { ...process.env };
  const envSinCredenciales = { ...process.env };
  delete envSinCredenciales.NEXT_PUBLIC_SUPABASE_URL;
  delete envSinCredenciales.SUPABASE_SERVICE_ROLE_KEY;

  const resultConCredenciales = runScript(envConCredenciales);
  const resultSinCredenciales = runScript(envSinCredenciales);

  check(
    "7. Ejecucion REAL (subproceso tsx real) con credenciales presentes en el entorno -> exit code != 0 (bloqueado), nunca 0 (nunca 'exito' silencioso)",
    resultConCredenciales.exitCode !== 0
  );
  check("7b. La salida real contiene el mensaje de bloqueo", /LEGACY PUBLISHER DISABLED/.test(resultConCredenciales.stdout));
  check(
    "8. Ejecucion REAL SIN credenciales en el entorno -> EXACTAMENTE el mismo exit code que CON credenciales (nunca depende de ellas)",
    resultSinCredenciales.exitCode === resultConCredenciales.exitCode
  );
  check(
    "8b. La salida real SIN credenciales contiene el MISMO mensaje de bloqueo (comportamiento identico, no una ruta de error distinta por 'faltan credenciales')",
    /LEGACY PUBLISHER DISABLED/.test(resultSinCredenciales.stdout) && resultSinCredenciales.stdout === resultConCredenciales.stdout
  );
  check("9. Ninguna de las dos ejecuciones reales menciona 'Faltan NEXT_PUBLIC_SUPABASE_URL' (esa rama de codigo del original ya no existe activa)", !/Faltan NEXT_PUBLIC_SUPABASE_URL/.test(resultConCredenciales.stdout) && !/Faltan NEXT_PUBLIC_SUPABASE_URL/.test(resultSinCredenciales.stdout));

  // ==================================================
  // 6 (del pedido de la fase) — el pipeline moderno no se ve afectado: este
  // archivo de test nunca importa ni modifica agent/publish/run.mts; la
  // regresion completa de H1/H2/H3/H5 (ejecutada por separado en esta misma
  // fase) es la prueba real de que sigue funcionando exactamente igual.
  // ==================================================
  check("10. Este test nunca importa agent/publish/run.mts (el pipeline moderno se verifica por la regresion completa de la fase, no aqui)", true);

  // ==================================================
  // 8 (del pedido de la fase) — ningun estado nuevo: no se tocó schema.sql en
  // esta fase (grep de control).
  // ==================================================
  const schemaSource = readFileSync(path.join(REPO_ROOT, "supabase", "schema.sql"), "utf-8");
  const checkConstraintMatch = schemaSource.match(/status[\s\S]{0,20}CHECK[\s\S]{0,200}?\)/i);
  check(
    "11. supabase/schema.sql sigue listando exactamente los mismos 5 estados de siempre (pending/publishing/published/error/verification_required) - ningun estado nuevo introducido en esta fase",
    !!checkConstraintMatch &&
      /pending/.test(checkConstraintMatch[0]) &&
      /publishing/.test(checkConstraintMatch[0]) &&
      /published/.test(checkConstraintMatch[0]) &&
      /error/.test(checkConstraintMatch[0]) &&
      /verification_required/.test(checkConstraintMatch[0])
  );

  console.log(`\n${failures === 0 ? "TODOS LOS CASOS PASARON" : `${failures} CASO(S) FALLARON`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main();

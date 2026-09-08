// Fase 4.5 — GATE DE AUTORIZACIÓN. Separa la propiedad técnica "el material
// está completo" (READY, ver completenessChecker.mts) de la decisión humana
// "autorizo que esto se produzca ahora" (AUTHORIZED). Ningún archivo que
// aparezca, se copie o se modifique dentro de Material Videos alcanza por sí
// solo para producir — solo estas funciones (o su CLI) pueden mover un
// proyecto a AUTHORIZED. Ver agent.mts::decideEnqueue (gate antes de encolar)
// y processOne.mts::processProject (segunda capa, gate antes de procesar).
//
// Uso manual:
//   npx tsx scripts/pipeline/authorization.mts authorize "SIN EXPLICACIÓN" 013
//   npx tsx scripts/pipeline/authorization.mts revoke    "SIN EXPLICACIÓN" 013
//   npx tsx scripts/pipeline/authorization.mts hold      "SIN EXPLICACIÓN" 013
//   npx tsx scripts/pipeline/authorization.mts release   "SIN EXPLICACIÓN" 013
// (o vía npm run pipeline:authorize / pipeline:revoke / pipeline:hold / pipeline:release)
import "./env.mts"; // SIEMPRE primero — ver env.mts
import { pathToFileURL } from "node:url";
import { scanEpisode, listEpisodeFolders, allMaterialFiles } from "./materialScanner.mts";
import { checkCompleteness } from "./completenessChecker.mts";
import { hashAll } from "./fileRegistry.mts";
import { loadProject, saveProject, hashSetsEqual } from "./projectManifest.mts";
import { cancelQueued } from "./queue.mts";

export type AuthorizeResult = { ok: true; message: string } | { ok: false; reason: string };

// Requisitos (spec de Fase 4.5, punto 8): proyecto existe, material
// suficiente/READY, no PROCESSING, no COMPLETED-sin-cambios, no HELD, los
// archivos se pueden hashear, y se captura el snapshot de hashes autorizado.
// Si algo falla, NO autoriza y explica por qué.
export async function authorizeProject(
  account: string,
  episodeId: string,
  authorizedBy = "manual-cli"
): Promise<AuthorizeResult> {
  if (!listEpisodeFolders(account).includes(episodeId)) {
    return { ok: false, reason: `no existe la carpeta de episodio ${account}/${episodeId} en Material Videos` };
  }

  const ep = scanEpisode(account, episodeId);
  const completeness = checkCompleteness(ep);
  if (completeness.status === "WAITING_FOR_MATERIAL") {
    return { ok: false, reason: `material incompleto, no está READY: ${completeness.reason}` };
  }

  const manifest = loadProject(account, episodeId);
  if (manifest.status === "PROCESSING") {
    return { ok: false, reason: "el proyecto está PROCESSING ahora mismo — esperá a que termine o falle" };
  }
  if (manifest.status === "QUEUED") {
    return { ok: false, reason: "el proyecto ya está QUEUED — esperá a que el worker lo tome" };
  }
  if (manifest.status === "HELD") {
    return { ok: false, reason: "el proyecto está HELD — liberalo primero (pipeline:release) antes de autorizar" };
  }

  const files = allMaterialFiles(ep);
  let hashes: string[];
  try {
    hashes = await hashAll(files);
  } catch (err) {
    return { ok: false, reason: `no se pudieron identificar/hashear los archivos: ${err instanceof Error ? err.message : String(err)}` };
  }

  if (manifest.status === "COMPLETED" && hashSetsEqual(manifest.materialHashes, hashes)) {
    return { ok: false, reason: "ya está COMPLETED con este mismo material — no hay nada que autorizar" };
  }

  manifest.status = "AUTHORIZED";
  manifest.authorizedAt = new Date().toISOString();
  manifest.authorizedBy = authorizedBy;
  manifest.authorizedMaterialHashes = hashes;
  saveProject(manifest);

  return {
    ok: true,
    message: `${account}/${episodeId} AUTHORIZED (${files.length} archivos, hash capturado). Se encolará solo en el próximo ciclo del agente si el material sigue igual.`,
  };
}

// AUTHORIZED/QUEUED -> vuelve al estado neutro (no persiste READY, ver
// agent.mts). No borra archivos, no toca outputs, no cancela ElevenLabs, no
// mata un PROCESSING en curso: si ya está procesando, la revocación no aplica
// a esa ejecución (según lo pedido explícitamente).
export async function revokeAuthorization(account: string, episodeId: string): Promise<AuthorizeResult> {
  const manifest = loadProject(account, episodeId);

  if (manifest.status === "PROCESSING") {
    return {
      ok: false,
      reason: "el proyecto ya está PROCESSING — la revocación no interrumpe una ejecución en curso; no se aplicó ningún cambio",
    };
  }
  if (manifest.status !== "AUTHORIZED" && manifest.status !== "QUEUED") {
    return { ok: false, reason: `nada que revocar — el proyecto está en estado ${manifest.status}, no AUTHORIZED/QUEUED` };
  }

  const wasQueued = manifest.status === "QUEUED";
  manifest.status = "WAITING_FOR_MATERIAL"; // estado neutro; READY se re-deriva solo del disco en la próxima evaluación
  manifest.authorizedAt = undefined;
  manifest.authorizedBy = undefined;
  manifest.authorizedMaterialHashes = undefined;
  saveProject(manifest);
  if (wasQueued) cancelQueued(account, episodeId);

  return {
    ok: true,
    message: `${account}/${episodeId}: autorización revocada. Aplica desde el próximo ciclo — no interrumpe nada en curso.`,
  };
}

// Base mínima pedida explícitamente (Fase 4.5, punto 9) para dejar de
// depender de editar los manifests a mano — sin interfaz grande, solo la
// transición segura. Reemplaza en el futuro a la edición manual de JSON que
// se usó para retener 005/006/007/009.
export async function holdProject(account: string, episodeId: string): Promise<AuthorizeResult> {
  const manifest = loadProject(account, episodeId);
  if (manifest.status === "PROCESSING") {
    return { ok: false, reason: "el proyecto está PROCESSING — no se puede retener ahora; esperá a que termine o falle" };
  }
  if (manifest.status === "COMPLETED") {
    return { ok: false, reason: "el proyecto ya está COMPLETED — HELD no aplica sobre producciones ya terminadas" };
  }
  if (manifest.status === "QUEUED") cancelQueued(account, episodeId);

  manifest.status = "HELD";
  manifest.authorizedAt = undefined;
  manifest.authorizedBy = undefined;
  manifest.authorizedMaterialHashes = undefined;
  saveProject(manifest);
  return { ok: true, message: `${account}/${episodeId} retenido (HELD). No se encolará automáticamente hasta liberarlo (pipeline:release).` };
}

export async function releaseProject(account: string, episodeId: string): Promise<AuthorizeResult> {
  const manifest = loadProject(account, episodeId);
  if (manifest.status !== "HELD") {
    return { ok: false, reason: `el proyecto no está HELD (está ${manifest.status}) — nada que liberar` };
  }
  manifest.status = "WAITING_FOR_MATERIAL"; // neutro: sigue sin autorizar, requiere pipeline:authorize aparte
  saveProject(manifest);
  return { ok: true, message: `${account}/${episodeId} liberado de HELD. Sigue SIN autorizar — usá pipeline:authorize para producirlo.` };
}

// --- CLI manual: dispatch por subcomando, cero lógica de producción acá ---
type Action = (account: string, episodeId: string) => Promise<AuthorizeResult>;
const actions: Record<string, Action> = {
  authorize: (a, e) => authorizeProject(a, e),
  revoke: revokeAuthorization,
  hold: holdProject,
  release: releaseProject,
};

async function cli() {
  const [action, account, episodeId] = process.argv.slice(2);
  const fn = actions[action ?? ""];
  if (!fn || !account || !episodeId) {
    console.error('Uso: npx tsx scripts/pipeline/authorization.mts <authorize|revoke|hold|release> "SIN EXPLICACIÓN" 013');
    process.exit(1);
  }
  const result = await fn(account, episodeId);
  if (result.ok) {
    console.log(`OK: ${result.message}`);
    process.exit(0);
  }
  console.error(`RECHAZADO: ${result.reason}`);
  process.exit(1);
}

const isMainModule = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  cli().catch((err) => {
    console.error("Error:", err);
    process.exit(1);
  });
}

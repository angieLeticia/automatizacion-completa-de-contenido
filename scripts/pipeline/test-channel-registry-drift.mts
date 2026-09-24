// FASE 5.10-AD/AH — detector de desincronización entre el espejo LOCAL de
// channelRegistry.mts (channelStatus hardcodeado) y el content_accounts.
// channel_status REAL de Supabase. La auditoría de esta fase encontró que
// ambos llevaban meses desincronizados sin que nada lo detectara (SIN
// EXPLICACIÓN coincidía por casualidad; los otros 3 canales reales, no).
//
// Este archivo NO resuelve el problema de raíz (channelRegistry.mts sigue
// siendo un espejo local, no una lectura en vivo — ver su propio comentario
// de cabecera sobre por qué, y la Decision K.1 de RUN_SCOPE sobre por qué
// scripts/pipeline/ no importa agent/supabaseClient.mts en su código de
// producción real) — es la red de seguridad mínima: falla ALTO Y CLARO la
// próxima vez que alguien cambie channel_status en Supabase sin actualizar
// este archivo, en vez de dejarlo desincronizado en silencio otra vez.
//
// SOLO LECTURA — hace un SELECT contra content_accounts, nunca escribe nada.
import "./env.mts";
import { supabaseAdmin } from "../../agent/supabaseClient.mts";
import { listKnownChannels } from "./channelRegistry.mts";

let failures = 0;
const check = (label: string, cond: boolean, extra = "") => {
  const mark = cond ? "PASS" : "FAIL";
  if (!cond) failures++;
  console.log(`[${mark}] ${label}${extra ? " — " + extra : ""}`);
};

async function main() {
  const { data: realAccounts, error } = await supabaseAdmin.from("content_accounts").select("folder_name, channel_status");
  if (error) throw new Error(error.message);

  const realStatusByFolder = new Map((realAccounts ?? []).map((r) => [r.folder_name as string, r.channel_status as string]));
  const localChannels = listKnownChannels();

  let comparedAny = false;
  for (const local of localChannels) {
    const realStatus = realStatusByFolder.get(local.folderName);
    if (realStatus === undefined) {
      // Canal solo local (ej. ALZA LA VOZ, ASMR, PELICULAS, MUSICA, CHISMES) —
      // sin fila real en content_accounts todavía. No es una desincronización,
      // es un canal que Supabase ni siquiera conoce — no se compara.
      continue;
    }
    comparedAny = true;
    check(
      `channelRegistry["${local.folderName}"].channelStatus ("${local.channelStatus}") coincide con content_accounts.channel_status real ("${realStatus}")`,
      local.channelStatus === realStatus
    );
  }

  check("Se comparó al menos un canal real contra Supabase (la prueba no pasa vacía por casualidad)", comparedAny);

  console.log(failures === 0 ? "\nTODAS LAS PRUEBAS PASARON" : `\n${failures} DESINCRONIZACIÓN(ES) DETECTADA(S) — actualiza scripts/pipeline/channelRegistry.mts para que coincida con Supabase real (nunca al revés: este script NUNCA debe usarse para decidir cambiar Supabase).`);
  if (failures > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Error:", err instanceof Error ? err.message : err);
  process.exit(1);
});

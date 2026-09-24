// ============================================================================
// LEGACY PUBLISHER DISABLED — H4-A.4 (auditoría de seguridad, Agent 3).
//
// Este archivo era el "Flujo A" de publicación (pre Fase 5.0): un script sin
// claim atómico/CAS, sin channel_status, sin DRY_RUN, sin identidad
// estructural, sin autorización humana y sin runLock, que llamaba a los
// MISMOS publishers reales (lib/social/publishers.ts) que el pipeline
// endurecido, contra el mismo social_posts.
//
// Auditoría H4-A.3 lo clasificó RIESGO B: desconectado de todo disparador
// automático (GitHub Actions retirado desde Fase 5.4.3 — ver
// .github/workflows/publish-social.yml.retired; Windows Task Scheduler de la
// máquina de producción confirmado con `schtasks /query` — las 2 tareas
// reales `VisteapyAgentProduccion`/`VisteapyAgentPublicacion` ejecutan
// scripts/pipeline/agent.mts y agent/run.mts respectivamente, ninguna
// referencia este archivo), pero ejecutable MANUALMENTE
// (`npm run social:publish` o `npx tsx scripts/publish-due-social-posts.mts`)
// con credenciales reales activas — riesgo real de publicación accidental o
// de doble publicación si alguna vez se ejecutara junto a
// agent/publish/run.mts.
//
// H4-A.4 neutraliza ese riesgo de la forma MÁS REVERSIBLE posible, siguiendo
// la recomendación explícita ya dejada en docs/system-contracts.md línea 233
// ("no eliminar el archivo... marcarlo @deprecated... dejar de invocarlo") y
// la regla vigente desde Fase 5.0 de nunca borrar código histórico: el
// archivo se conserva en su misma ruta, con el mismo comando npm
// ("social:publish" en package.json, SIN CAMBIOS — sigue apuntando aquí a
// propósito, para que el comando exista y explique el bloqueo en vez de
// fallar con "missing script"). El código original que sí llamaba a
// publishers reales queda conservado ÍNTEGRO, comentado, al final de este
// archivo (nunca se ejecuta) — para reactivarlo haría falta revertir este
// cambio explícitamente Y una nueva autorización de seguridad, exactamente
// el mismo criterio ya usado para reactivar publish-social.yml.retired.
//
// GARANTÍA ESTRUCTURAL (no solo de comportamiento en tiempo de ejecución):
// este archivo, tal como queda, NO importa PUBLISHERS/publishToYouTube/
// publishToFacebook/publishToInstagram, NO importa @supabase/supabase-js, NO
// crea ningún cliente Supabase, NO lee NEXT_PUBLIC_SUPABASE_URL/
// SUPABASE_SERVICE_ROLE_KEY, y por tanto es IMPOSIBLE que publique nada real
// o toque una fila de social_posts — no porque una condición en tiempo de
// ejecución lo impida, sino porque el código capaz de hacerlo ya no está
// activo en este archivo.
//
// @deprecated Usar exclusivamente agent/publish/run.mts (Flujo B — el ÚNICO
// pipeline de publicación soportado, ver docs/technical-inventory.md). No
// reactivar este archivo sin autorización explícita y una revisión de
// seguridad completa.
// ============================================================================

console.error(
  [
    "",
    "============================================================",
    " LEGACY PUBLISHER DISABLED (H4-A.4)",
    "============================================================",
    " scripts/publish-due-social-posts.mts (Flujo A) esta deshabilitado",
    " deliberadamente - no invoca publishers reales, no toca Supabase,",
    " no publica nada.",
    "",
    " Usa el pipeline endurecido y unico soportado:",
    "   npm run agent:publish     (agent/publish/run.mts)",
    "",
    " Motivo y evidencia: docs/system-contracts.md, docs/phase-5.4.3-gap-closure.md,",
    " informe H4-A.3/H4-A.4 (auditoria de seguridad, Agent 3).",
    "",
    " No publication performed.",
    "============================================================",
    "",
  ].join("\n")
);
process.exitCode = 1;

// ============================================================================
// CÓDIGO HISTÓRICO (Flujo A, pre Fase 5.0) — conservado íntegro, INERTE,
// nunca se ejecuta desde aquí. Ver cabecera de este archivo.
//
// import { createClient } from "@supabase/supabase-js";
// import { PUBLISHERS } from "../lib/social/publishers";
// import type { SocialAccount, SocialPost } from "../lib/social/types";
//
// const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
// const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
//
// if (!supabaseUrl || !serviceRoleKey) {
//   console.error("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY.");
//   process.exit(1);
// }
//
// const supabase = createClient(supabaseUrl, serviceRoleKey, {
//   auth: { autoRefreshToken: false, persistSession: false },
// });
//
// type DuePost = SocialPost & { social_accounts: SocialAccount };
//
// // Borra el vídeo del bucket una vez que TODAS las publicaciones que lo usan
// // terminaron en "published" — las redes ya lo alojan ellas mismas, así que no
// // hace falta pagar por guardarlo también en Supabase Storage. Si alguna
// // quedó en "error", conservamos el vídeo para poder reintentar.
// async function cleanupVideoIfDone(videoPath: string) {
//   const { count } = await supabase
//     .from("social_posts")
//     .select("id", { count: "exact", head: true })
//     .eq("video_path", videoPath)
//     .neq("status", "published");
//
//   if (!count) {
//     await supabase.storage.from("social-videos").remove([videoPath]);
//     console.log(`  -> vídeo ${videoPath} borrado del storage (todas sus publicaciones ya se completaron)`);
//   }
// }
//
// async function main() {
//   const { data: duePosts, error } = await supabase
//     .from("social_posts")
//     .select("*, social_accounts(*)")
//     .eq("status", "pending")
//     .lte("scheduled_at", new Date().toISOString());
//
//   if (error) {
//     console.error("Error consultando social_posts:", error);
//     process.exit(1);
//   }
//
//   if (!duePosts || duePosts.length === 0) {
//     console.log("No hay publicaciones pendientes por ahora.");
//     return;
//   }
//
//   for (const post of duePosts as unknown as DuePost[]) {
//     const account = post.social_accounts;
//     console.log(`Publicando ${account.platform} (${account.label || account.id}) — post ${post.id} (${post.title || "sin título"})`);
//     await supabase.from("social_posts").update({ status: "publishing" }).eq("id", post.id);
//
//     const publish = PUBLISHERS[account.platform];
//     if (!publish) {
//       await supabase
//         .from("social_posts")
//         .update({ status: "error", error_message: `Plataforma no soportada aún: ${account.platform}` })
//         .eq("id", post.id);
//       continue;
//     }
//
//     try {
//       const { externalPostId } = await publish(post, account.credentials);
//       await supabase
//         .from("social_posts")
//         .update({
//           status: "published",
//           external_post_id: externalPostId,
//           published_at: new Date().toISOString(),
//           error_message: null,
//         })
//         .eq("id", post.id);
//       console.log(`  -> publicado (${externalPostId})`);
//     } catch (err) {
//       const message = err instanceof Error ? err.message : String(err);
//       console.error(`  -> error:`, message);
//       await supabase.from("social_posts").update({ status: "error", error_message: message }).eq("id", post.id);
//     }
//
//     await cleanupVideoIfDone(post.video_path);
//   }
// }
//
// main();
// ============================================================================

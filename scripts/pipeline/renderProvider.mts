// Fase 4.8 — contrato RenderProvider. Agent 2 pide "renderiza este episodio
// para este canal" y el provider resuelto decide cómo — sin que processOne.mts
// necesite saber qué motor de render usa cada canal (Remotion en este repo,
// un Remotion independiente externo, o lo que llegue después).
export type RenderResult = { path: string; hash: string; reused: boolean };

export interface RenderProvider {
  id: string;
  renderMain(episodeId: string): Promise<RenderResult>;
  renderClip(episodeId: string, clipIndex: number): Promise<RenderResult>;
}

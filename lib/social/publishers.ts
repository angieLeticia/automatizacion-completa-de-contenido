import { publishToYouTube } from "./youtube";
import { publishToFacebook } from "./facebook";
import { publishToInstagram } from "./instagram";
import type { PublishResult, SocialPlatform, SocialPost } from "./types";

type Publisher = (post: SocialPost, credentials: Record<string, string>) => Promise<PublishResult>;

// Registro único de "cómo se publica en cada plataforma". Añadir una nueva es
// implementar su publishToX (recibe credenciales genéricas) y sumarla aquí.
export const PUBLISHERS: Partial<Record<SocialPlatform, Publisher>> = {
  youtube: (post, creds) => publishToYouTube(post, creds as never),
  facebook: (post, creds) => publishToFacebook(post, creds as never),
  instagram: (post, creds) => publishToInstagram(post, creds as never),
};

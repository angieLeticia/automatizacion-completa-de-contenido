import type { SocialPlatform } from "./types";

export interface CredentialField {
  key: string;
  label: string;
  secret?: boolean; // se muestra como password en el formulario
}

// Qué credenciales necesita cada plataforma para poder publicar. Los valores
// se guardan tal cual en social_accounts.credentials (JSONB).
export const CREDENTIAL_FIELDS: Record<SocialPlatform, CredentialField[]> = {
  youtube: [
    { key: "client_id", label: "Client ID (Google Cloud)" },
    { key: "client_secret", label: "Client Secret", secret: true },
    { key: "refresh_token", label: "Refresh Token de esta cuenta", secret: true },
  ],
  facebook: [
    { key: "page_id", label: "ID de la Página de Facebook" },
    { key: "access_token", label: "Access Token de la Página (larga duración)", secret: true },
  ],
  instagram: [
    { key: "ig_user_id", label: "Instagram User ID" },
    { key: "access_token", label: "Access Token (el mismo de la Página vinculada)", secret: true },
  ],
  tiktok: [],
};

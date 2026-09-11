-- AUTOMATIZACION COMPLETA DE CONTENIDO — Schema SQL
-- Ejecutar en: Supabase Dashboard → SQL Editor → New query
--
-- Este schema contiene EXCLUSIVAMENTE las tablas usadas por los 3 agentes de
-- este repositorio (auditado contra el código real del commit 0c8af35 — ver
-- docs/database-contract.md para la evidencia completa). Las tablas del sitio
-- e-commerce Visteapy (profiles, wishlist_items, email_logs) NO forman parte
-- de este repositorio y no se incluyen aquí.
--
-- IMPORTANTE: las secciones marcadas "[NUEVO — Fase 2.1/4.1, no aplicado aún
-- en producción]" son adiciones aprobadas en la auditoría arquitectónica que
-- todavía no existen en la base de datos real de producción (la que sí
-- audité en Fase 1.1). Antes de ejecutar este archivo contra esa base de
-- datos real, revisar con el equipo qué secciones ya existen (para no
-- duplicar) y cuáles son genuinamente nuevas.

-- 1. SOCIAL CHANNELS (líneas/marcas de contenido — ej. "SIN EXPLICACIÓN")
-- Cada canal puede tener, como mucho, una cuenta conectada por plataforma.
CREATE TABLE IF NOT EXISTS public.social_channels (
  id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  name        TEXT        NOT NULL,
  is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.social_channels ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Solo sistema gestiona social_channels" ON public.social_channels;
CREATE POLICY "Solo sistema gestiona social_channels" ON public.social_channels FOR ALL USING (false);

-- 2. SOCIAL ACCOUNTS (credenciales de un canal en una plataforma concreta)
CREATE TABLE IF NOT EXISTS public.social_accounts (
  id           UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  channel_id   UUID        NOT NULL REFERENCES public.social_channels(id) ON DELETE CASCADE,
  platform     TEXT        NOT NULL CHECK (platform IN ('youtube', 'instagram', 'facebook', 'tiktok')),
  label        TEXT,
  credentials  JSONB       NOT NULL, -- forma distinta según la plataforma, ver lib/social/credentialFields.ts
  is_active    BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (channel_id, platform)
);
ALTER TABLE public.social_accounts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Solo sistema gestiona social_accounts" ON public.social_accounts;
CREATE POLICY "Solo sistema gestiona social_accounts" ON public.social_accounts FOR ALL USING (false);

-- 3. CONTENT ACCOUNTS (carpeta en MATERIAL_ROOT ↔ canal social — 1:1)
CREATE TABLE IF NOT EXISTS public.content_accounts (
  id           UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  folder_name  TEXT        NOT NULL UNIQUE, -- nombre EXACTO de la carpeta bajo MATERIAL_ROOT
  channel_id   UUID        NOT NULL UNIQUE REFERENCES public.social_channels(id) ON DELETE RESTRICT,
  style        JSONB       NOT NULL DEFAULT '{}'::jsonb, -- tono, temas, hashtags_base, palabras_prohibidas
  timezone     TEXT        NOT NULL DEFAULT 'America/Bogota',
  is_active    BOOLEAN     NOT NULL DEFAULT TRUE,
  -- [NUEVO — Fase 2.1/4.1, no aplicado aún en producción]
  -- Reemplaza conceptualmente el ACCOUNTS hardcodeado de scripts/pipeline/config.mts.
  -- Default HISTORICAL a propósito: agregar esta columna nunca debe activar un canal
  -- por sí solo (ver docs/architecture-unified.md §3).
  channel_status TEXT      NOT NULL DEFAULT 'HISTORICAL'
                   CHECK (channel_status IN ('ACTIVE', 'READY', 'TEST', 'BLOCKED', 'HISTORICAL')),
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.content_accounts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Solo sistema gestiona content_accounts" ON public.content_accounts;
CREATE POLICY "Solo sistema gestiona content_accounts" ON public.content_accounts FOR ALL USING (false);

-- 4. CONTENT FILES (registro anti-duplicados + estado de cada video detectado en disco)
CREATE TABLE IF NOT EXISTS public.content_files (
  id                 UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  content_account_id UUID        NOT NULL REFERENCES public.content_accounts(id) ON DELETE RESTRICT,
  folder_type        TEXT        NOT NULL CHECK (folder_type IN ('completo', 'clip')),
  file_path          TEXT        NOT NULL,
  file_hash          TEXT        NOT NULL UNIQUE, -- sha256 del contenido; único GLOBAL
  file_size          BIGINT,
  detected_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status             TEXT        NOT NULL DEFAULT 'detected'
                        CHECK (status IN ('detected', 'validating', 'invalid', 'analyzing', 'scheduled', 'error', 'account_conflict')),
  error_message      TEXT,
  -- [NUEVO — Fase 2.1/4.1, no aplicado aún en producción]
  -- Identidad de agrupación de episodio, decidida en Fase 2.1 para NO crear una
  -- tabla `episodes` separada (ver docs/system-contracts.md §1). Nullable porque
  -- no todo content_file histórico tendrá este dato retroactivamente.
  episode_id         TEXT
);
ALTER TABLE public.content_files ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Solo sistema gestiona content_files" ON public.content_files;
CREATE POLICY "Solo sistema gestiona content_files" ON public.content_files FOR ALL USING (false);
CREATE INDEX IF NOT EXISTS content_files_account_status_idx ON public.content_files (content_account_id, status);
CREATE INDEX IF NOT EXISTS content_files_episode_idx ON public.content_files (content_account_id, episode_id);

-- 5. CONTENT FILE CONFLICTS (auditoría explícita de choques de hash entre cuentas)
CREATE TABLE IF NOT EXISTS public.content_file_conflicts (
  id                        UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  file_hash                 TEXT        NOT NULL,
  original_content_file_id  UUID        NOT NULL REFERENCES public.content_files(id) ON DELETE CASCADE,
  conflicting_account_id    UUID        NOT NULL REFERENCES public.content_accounts(id) ON DELETE RESTRICT,
  conflicting_file_path     TEXT        NOT NULL,
  detected_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved                  BOOLEAN     NOT NULL DEFAULT FALSE,
  resolution_note           TEXT
);
ALTER TABLE public.content_file_conflicts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Solo sistema gestiona content_file_conflicts" ON public.content_file_conflicts;
CREATE POLICY "Solo sistema gestiona content_file_conflicts" ON public.content_file_conflicts FOR ALL USING (false);
CREATE INDEX IF NOT EXISTS content_file_conflicts_hash_idx ON public.content_file_conflicts (file_hash);

-- 6. POSTING SCHEDULE RULES (ventanas horarias por cuenta + plataforma + día)
CREATE TABLE IF NOT EXISTS public.posting_schedule_rules (
  id                  UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  content_account_id  UUID        REFERENCES public.content_accounts(id) ON DELETE CASCADE, -- NULL = regla global
  platform            TEXT        NOT NULL CHECK (platform IN ('youtube', 'instagram', 'facebook', 'tiktok')),
  day_of_week         SMALLINT    CHECK (day_of_week BETWEEN 0 AND 6),
  window_start        TIME        NOT NULL,
  window_end          TIME        NOT NULL CHECK (window_end > window_start),
  max_posts_per_day   SMALLINT    NOT NULL DEFAULT 1 CHECK (max_posts_per_day > 0),
  is_active           BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.posting_schedule_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Solo sistema gestiona posting_schedule_rules" ON public.posting_schedule_rules;
CREATE POLICY "Solo sistema gestiona posting_schedule_rules" ON public.posting_schedule_rules FOR ALL USING (false);
CREATE UNIQUE INDEX IF NOT EXISTS posting_schedule_rules_account_idx
  ON public.posting_schedule_rules (content_account_id, platform, COALESCE(day_of_week, -1::smallint))
  WHERE content_account_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS posting_schedule_rules_global_idx
  ON public.posting_schedule_rules (platform, COALESCE(day_of_week, -1::smallint))
  WHERE content_account_id IS NULL;

-- 7. SOCIAL POSTS (programación y publicación en redes)
CREATE TABLE IF NOT EXISTS public.social_posts (
  id                UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  account_id        UUID        NOT NULL REFERENCES public.social_accounts(id) ON DELETE RESTRICT,
  video_url         TEXT        NOT NULL,
  video_path        TEXT        NOT NULL,
  title             TEXT,
  caption           TEXT,
  scheduled_at      TIMESTAMPTZ NOT NULL,
  -- [MODIFICADO — Fase 5.4, no aplicado aún en producción] agrega
  -- 'verification_required': un claim vencido para el que existe evidencia
  -- (real o de placeholder, ver publisher_operation_ref abajo) de que el
  -- publisher real pudo haberse llamado. NUNCA se alcanza por inferencia —
  -- ver docs/phase-5.4-claim-recovery.md. El ALTER TABLE real, dado que este
  -- CHECK es un constraint de columna sin nombre explícito, es:
  --   ALTER TABLE public.social_posts DROP CONSTRAINT social_posts_status_check;
  --   ALTER TABLE public.social_posts ADD CONSTRAINT social_posts_status_check
  --     CHECK (status IN ('pending','publishing','published','error','verification_required'));
  -- (nombre inferido por la convención ya confirmada real en esta misma base
  -- para content_accounts_channel_status_check, Fase 5.2.2 — no verificado
  -- para ESTE constraint específico hasta ejecutarlo).
  status            TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'publishing', 'published', 'error', 'verification_required')),
  external_post_id  TEXT,
  error_message     TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  published_at      TIMESTAMPTZ,
  content_file_id   UUID        REFERENCES public.content_files(id) ON DELETE RESTRICT,
  hashtags          TEXT[]      NOT NULL DEFAULT '{}',
  retry_count       SMALLINT    NOT NULL DEFAULT 0,
  schedule_rule_id  UUID        REFERENCES public.posting_schedule_rules(id) ON DELETE SET NULL,
  -- claimed_at: EVIDENCIA (Fase 1.1) — ya existe en la base de datos real de
  -- producción aunque nunca se documentó en el schema.sql original. Se incluye
  -- aquí correctamente por primera vez.
  claimed_at        TIMESTAMPTZ,
  -- [NUEVO — Fase 2.1/4.1, no aplicado aún en producción]
  -- Gate de publicación, DISTINTO del gate de autorización de render de Agente 2
  -- (ProjectManifest.authorizedAt). Mientras sea NULL, el motor único de
  -- publicación no debe publicar en real así DRY_RUN=false (ver
  -- docs/system-contracts.md §4).
  publication_authorized_at TIMESTAMPTZ,
  publication_authorized_by TEXT,
  -- [NUEVO — Fase 5.4, no aplicado aún en producción]
  -- NULL = el publisher real nunca pudo haberse llamado para este claim
  -- (seguro reintentar automáticamente). "pending:<platform>" = se marcó el
  -- intento pero no hay referencia real de la plataforma (Facebook, o un
  -- crash antes de obtenerla). Cualquier otro valor = referencia real
  -- (uploadUrl de YouTube, creationId de Instagram) — permite reconciliar
  -- contra la plataforma real. Ver agent/publish/staleClaimClassification.mts
  -- y docs/phase-5.4-claim-recovery.md. ALTER TABLE real necesario:
  --   ALTER TABLE public.social_posts ADD COLUMN publisher_operation_ref TEXT NULL;
  publisher_operation_ref TEXT
);
ALTER TABLE public.social_posts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Solo sistema gestiona social_posts" ON public.social_posts;
CREATE POLICY "Solo sistema gestiona social_posts" ON public.social_posts FOR ALL USING (false);
CREATE INDEX IF NOT EXISTS social_posts_due_idx ON public.social_posts (status, scheduled_at);
CREATE INDEX IF NOT EXISTS social_posts_content_file_idx ON public.social_posts (content_file_id);
CREATE INDEX IF NOT EXISTS social_posts_schedule_rule_idx ON public.social_posts (schedule_rule_id);
-- [NUEVO — Fase 2.1/4.1, no aplicado aún en producción]
-- Constraint real de idempotencia de publicación (antes solo existía como
-- chequeo de aplicación en scheduleContent.mts, con ventana de carrera —
-- ver docs/system-contracts.md §1). NULL en content_file_id (origen manual)
-- no choca consigo mismo por semántica de NULL en UNIQUE de Postgres — ver
-- nota abajo sobre el origen manual.
CREATE UNIQUE INDEX IF NOT EXISTS social_posts_content_file_account_idx
  ON public.social_posts (content_file_id, account_id) WHERE content_file_id IS NOT NULL;

-- Bucket de Storage para los videos a publicar (público para que YouTube/Meta
-- puedan leer el archivo por URL).
INSERT INTO storage.buckets (id, name, public)
VALUES ('social-videos', 'social-videos', true)
ON CONFLICT (id) DO NOTHING;

-- 8. CONTENT METADATA (metadata generada por LLM para cada content_file)
CREATE TABLE IF NOT EXISTS public.content_metadata (
  id                  UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  content_file_id     UUID        NOT NULL UNIQUE REFERENCES public.content_files(id) ON DELETE CASCADE,
  status              TEXT        NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending','transcribing','sampling_frames','generating_metadata','ready','error')),
  has_speech          BOOLEAN,
  transcript          TEXT,
  duration_seconds    NUMERIC,
  width               INTEGER,
  height              INTEGER,
  topic_summary       TEXT,
  platform_metadata   JSONB,
  claude_model        TEXT,
  claude_raw_response TEXT,
  metadata_version    INTEGER     NOT NULL DEFAULT 1,
  error_message       TEXT,
  retry_count         SMALLINT    NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.content_metadata ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Solo sistema gestiona content_metadata" ON public.content_metadata;
CREATE POLICY "Solo sistema gestiona content_metadata" ON public.content_metadata FOR ALL USING (false);
CREATE INDEX IF NOT EXISTS content_metadata_status_idx ON public.content_metadata (status);

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$;
DROP TRIGGER IF EXISTS set_content_metadata_updated_at ON public.content_metadata;
CREATE TRIGGER set_content_metadata_updated_at BEFORE UPDATE ON public.content_metadata
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 9. EPISODE LOG (bitácora insert-only — NO es tabla de estado, NO es bus de eventos)
-- [NUEVO — Fase 2.1/4.1, no aplicado aún en producción]
-- Decidido en Fase 2.1: reemplaza la idea de un "episode_events" tipo bus de
-- eventos por algo mucho más simple. Cada agente inserta una fila al terminar
-- su paso; recalculateEpisodeStatus() (función, no proceso) la lee para
-- responder "¿qué pasó con este episodio y cuándo?" — ver
-- docs/system-contracts.md §6.
CREATE TABLE IF NOT EXISTS public.episode_log (
  id            UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  channel       TEXT        NOT NULL, -- content_accounts.folder_name (no FK: debe sobrevivir aunque la cuenta cambie)
  episode_id    TEXT        NOT NULL,
  stage         TEXT        NOT NULL, -- ej. 'render_completed', 'publication_succeeded' (ver system-contracts.md §6)
  detail        JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.episode_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Solo sistema gestiona episode_log" ON public.episode_log;
CREATE POLICY "Solo sistema gestiona episode_log" ON public.episode_log FOR ALL USING (false);
CREATE INDEX IF NOT EXISTS episode_log_episode_idx ON public.episode_log (channel, episode_id, created_at);

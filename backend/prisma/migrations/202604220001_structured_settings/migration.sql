INSERT INTO "config" (
  "id",
  "openai_key",
  "prompt_base",
  "configurations",
  "created_at",
  "updated_at"
)
VALUES (
  1,
  '',
  'Eres un asistente profesional de WhatsApp. Responde con claridad, foco comercial y tono amable.',
  '{}'::jsonb,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("id") DO NOTHING;

CREATE TABLE IF NOT EXISTS "ai_settings" (
  "config_id" INTEGER NOT NULL,
  "model_name" TEXT NOT NULL DEFAULT 'gpt-4o-mini',
  "temperature" DOUBLE PRECISION NOT NULL DEFAULT 0.4,
  "max_completion_tokens" INTEGER NOT NULL DEFAULT 180,
  "memory_window" INTEGER NOT NULL DEFAULT 6,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_settings_pkey" PRIMARY KEY ("config_id"),
  CONSTRAINT "ai_settings_config_id_fkey" FOREIGN KEY ("config_id") REFERENCES "config"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "bot_settings" (
  "config_id" INTEGER NOT NULL,
  "response_cache_ttl_seconds" INTEGER NOT NULL DEFAULT 60,
  "spam_group_window_ms" INTEGER NOT NULL DEFAULT 2000,
  "allow_audio_replies" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "bot_settings_pkey" PRIMARY KEY ("config_id"),
  CONSTRAINT "bot_settings_config_id_fkey" FOREIGN KEY ("config_id") REFERENCES "config"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "whatsapp_settings" (
  "config_id" INTEGER NOT NULL,
  "webhook_secret" TEXT NOT NULL DEFAULT '',
  "api_base_url" TEXT NOT NULL DEFAULT '',
  "api_key" TEXT NOT NULL DEFAULT '',
  "instance_name" TEXT NOT NULL DEFAULT '',
  "fallback_message" TEXT,
  "audio_voice_id" TEXT,
  "elevenlabs_base_url" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "whatsapp_settings_pkey" PRIMARY KEY ("config_id"),
  CONSTRAINT "whatsapp_settings_config_id_fkey" FOREIGN KEY ("config_id") REFERENCES "config"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "ai_settings" (
  "config_id",
  "model_name",
  "temperature",
  "max_completion_tokens",
  "memory_window",
  "created_at",
  "updated_at"
)
SELECT
  c."id",
  COALESCE(c."configurations"->'ai'->>'modelName', 'gpt-4o-mini'),
  CASE
    WHEN jsonb_typeof(c."configurations"->'ai'->'temperature') = 'number'
      THEN (c."configurations"->'ai'->>'temperature')::DOUBLE PRECISION
    ELSE 0.4
  END,
  CASE
    WHEN jsonb_typeof(c."configurations"->'ai'->'maxCompletionTokens') = 'number'
      THEN (c."configurations"->'ai'->>'maxCompletionTokens')::INTEGER
    ELSE 180
  END,
  CASE
    WHEN jsonb_typeof(c."configurations"->'ai'->'memoryWindow') = 'number'
      THEN (c."configurations"->'ai'->>'memoryWindow')::INTEGER
    ELSE 6
  END,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "config" c
ON CONFLICT ("config_id") DO NOTHING;

INSERT INTO "bot_settings" (
  "config_id",
  "response_cache_ttl_seconds",
  "spam_group_window_ms",
  "allow_audio_replies",
  "created_at",
  "updated_at"
)
SELECT
  c."id",
  CASE
    WHEN jsonb_typeof(c."configurations"->'bot'->'responseCacheTtlSeconds') = 'number'
      THEN (c."configurations"->'bot'->>'responseCacheTtlSeconds')::INTEGER
    ELSE 60
  END,
  CASE
    WHEN jsonb_typeof(c."configurations"->'bot'->'spamGroupWindowMs') = 'number'
      THEN (c."configurations"->'bot'->>'spamGroupWindowMs')::INTEGER
    ELSE 2000
  END,
  CASE
    WHEN jsonb_typeof(c."configurations"->'bot'->'allowAudioReplies') = 'boolean'
      THEN (c."configurations"->'bot'->>'allowAudioReplies')::BOOLEAN
    ELSE true
  END,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "config" c
ON CONFLICT ("config_id") DO NOTHING;

INSERT INTO "whatsapp_settings" (
  "config_id",
  "webhook_secret",
  "api_base_url",
  "api_key",
  "instance_name",
  "fallback_message",
  "audio_voice_id",
  "elevenlabs_base_url",
  "created_at",
  "updated_at"
)
SELECT
  c."id",
  COALESCE(c."configurations"->'whatsapp'->>'webhookSecret', ''),
  COALESCE(c."configurations"->'whatsapp'->>'apiBaseUrl', ''),
  COALESCE(c."configurations"->'whatsapp'->>'apiKey', ''),
  COALESCE(c."configurations"->'whatsapp'->>'instanceName', ''),
  NULLIF(c."configurations"->'whatsapp'->>'fallbackMessage', ''),
  NULLIF(c."configurations"->'whatsapp'->>'audioVoiceId', ''),
  NULLIF(c."configurations"->'elevenlabs'->>'baseUrl', ''),
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "config" c
ON CONFLICT ("config_id") DO NOTHING;

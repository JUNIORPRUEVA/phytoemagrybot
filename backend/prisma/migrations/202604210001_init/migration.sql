CREATE TABLE IF NOT EXISTS "config" (
  "id" INTEGER NOT NULL,
  "openai_key" TEXT NOT NULL DEFAULT '',
  "elevenlabs_key" TEXT,
  "prompt_base" TEXT NOT NULL DEFAULT 'Eres un asistente profesional de WhatsApp. Responde con claridad, foco comercial y tono amable.',
  "configurations" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "config_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "conversation_memory" (
  "id" TEXT NOT NULL,
  "contact_id" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "conversation_memory_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "conversation_memory_contact_id_created_at_idx"
  ON "conversation_memory"("contact_id", "created_at");

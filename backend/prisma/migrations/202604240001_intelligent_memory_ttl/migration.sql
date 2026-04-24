ALTER TABLE "client_memory"
ADD COLUMN "objective" TEXT,
ADD COLUMN "objections" JSONB,
ADD COLUMN "status" TEXT NOT NULL DEFAULT 'nuevo',
ADD COLUMN "expires_at" TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP + INTERVAL '15 days');

UPDATE "client_memory"
SET "expires_at" = COALESCE("updated_at", CURRENT_TIMESTAMP) + INTERVAL '15 days'
WHERE "expires_at" IS NULL;

CREATE INDEX IF NOT EXISTS "client_memory_expires_at_idx"
ON "client_memory"("expires_at");

ALTER TABLE "conversation_summaries"
ADD COLUMN "expires_at" TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP + INTERVAL '15 days');

UPDATE "conversation_summaries"
SET "expires_at" = COALESCE("updated_at", CURRENT_TIMESTAMP) + INTERVAL '15 days'
WHERE "expires_at" IS NULL;

CREATE INDEX IF NOT EXISTS "conversation_summaries_expires_at_idx"
ON "conversation_summaries"("expires_at");
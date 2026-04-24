ALTER TABLE "bot_settings"
ADD COLUMN "followup_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "followup_1_delay_minutes" INTEGER NOT NULL DEFAULT 10,
ADD COLUMN "followup_2_delay_minutes" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN "followup_3_delay_hours" INTEGER NOT NULL DEFAULT 24,
ADD COLUMN "max_followups" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN "stop_if_user_reply" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "conversation_followup" (
    "id" SERIAL NOT NULL,
    "contact_id" TEXT NOT NULL,
    "outbound_address" TEXT,
    "last_message_from" TEXT NOT NULL,
    "last_message_at" TIMESTAMP(3) NOT NULL,
    "followup_step" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "next_followup_at" TIMESTAMP(3),
    "last_followup_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_followup_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "conversation_followup_contact_id_key"
ON "conversation_followup"("contact_id");

CREATE INDEX "conversation_followup_is_active_next_followup_at_idx"
ON "conversation_followup"("is_active", "next_followup_at");

CREATE INDEX "conversation_followup_contact_id_last_message_at_idx"
ON "conversation_followup"("contact_id", "last_message_at");
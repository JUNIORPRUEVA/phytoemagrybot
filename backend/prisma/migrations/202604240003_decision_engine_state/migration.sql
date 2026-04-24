CREATE TABLE "contact_state" (
    "id" SERIAL NOT NULL,
    "contact_id" TEXT NOT NULL,
    "name" TEXT,
    "current_intent" TEXT,
    "stage" TEXT NOT NULL DEFAULT 'curioso',
    "last_interaction_at" TIMESTAMP(3),
    "last_bot_message_at" TIMESTAMP(3),
    "purchase_intent_score" INTEGER NOT NULL DEFAULT 0,
    "notes_json" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_state_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "contact_state_contact_id_key" ON "contact_state"("contact_id");
CREATE INDEX "contact_state_stage_idx" ON "contact_state"("stage");
CREATE INDEX "contact_state_last_interaction_at_idx" ON "contact_state"("last_interaction_at");

INSERT INTO "contact_state" (
    "contact_id",
    "name",
    "current_intent",
    "stage",
    "last_interaction_at",
    "purchase_intent_score",
    "notes_json",
    "created_at",
    "updated_at"
)
SELECT
    cm."contact_id",
    cm."name",
    cm."last_intent",
    CASE
        WHEN cm."status" = 'cliente' THEN 'cliente'
        WHEN cm."last_intent" = 'HOT' OR cm."objective" = 'comprar' THEN 'listo'
        WHEN cm."interest" = 'dudas' THEN 'dudoso'
        WHEN cm."status" = 'interesado' THEN 'interesado'
        ELSE 'curioso'
    END,
    cm."updated_at",
    LEAST(
        100,
        (CASE WHEN cm."interest" = 'precio' THEN 20 ELSE 0 END) +
        (CASE WHEN cm."objective" = 'comprar' THEN 30 ELSE 0 END) +
        (CASE WHEN cm."last_intent" = 'HOT' THEN 40 ELSE 0 END)
    ),
    jsonb_build_object(
        'objective', cm."objective",
        'interest', cm."interest",
        'objections', COALESCE(cm."objections", '[]'::jsonb),
        'legacy_status', cm."status",
        'legacy_notes', cm."notes"
    ),
    COALESCE(cm."updated_at", CURRENT_TIMESTAMP),
    COALESCE(cm."updated_at", CURRENT_TIMESTAMP)
FROM "client_memory" cm
ON CONFLICT ("contact_id") DO NOTHING;

CREATE TABLE "conversation_summary" (
    "id" SERIAL NOT NULL,
    "contact_id" TEXT NOT NULL,
    "summary_text" TEXT NOT NULL,
    "key_facts_json" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "last_message_id" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_summary_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "conversation_summary_contact_id_key" ON "conversation_summary"("contact_id");
CREATE INDEX "conversation_summary_updated_at_idx" ON "conversation_summary"("updated_at");

INSERT INTO "conversation_summary" (
    "contact_id",
    "summary_text",
    "key_facts_json",
    "last_message_id",
    "updated_at"
)
SELECT
    cs."contact_id",
    cs."summary",
    '{}'::jsonb,
    NULL,
    COALESCE(cs."updated_at", CURRENT_TIMESTAMP)
FROM "conversation_summaries" cs
ON CONFLICT ("contact_id") DO NOTHING;
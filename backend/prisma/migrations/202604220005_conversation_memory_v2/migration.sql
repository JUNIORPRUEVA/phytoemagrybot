CREATE TABLE "conversation_messages" (
    "id" SERIAL NOT NULL,
    "contact_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "conversation_messages_contact_id_created_at_idx"
ON "conversation_messages"("contact_id", "created_at");

CREATE TABLE "client_memory" (
    "id" SERIAL NOT NULL,
    "contact_id" TEXT NOT NULL,
    "name" TEXT,
    "interest" TEXT,
    "last_intent" TEXT,
    "notes" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_memory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "client_memory_contact_id_key"
ON "client_memory"("contact_id");

CREATE TABLE "conversation_summaries" (
    "id" SERIAL NOT NULL,
    "contact_id" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_summaries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "conversation_summaries_contact_id_key"
ON "conversation_summaries"("contact_id");
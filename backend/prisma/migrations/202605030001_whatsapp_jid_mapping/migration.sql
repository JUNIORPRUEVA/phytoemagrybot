-- CreateTable
CREATE TABLE IF NOT EXISTS "whatsapp_jid_mappings" (
    "id" SERIAL NOT NULL,
    "company_id" UUID NOT NULL,
    "instance_name" TEXT NOT NULL,
    "lid_jid" TEXT NOT NULL,
    "phone_jid" TEXT NOT NULL,
    "phone_number" TEXT NOT NULL,
    "push_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_jid_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_jid_mappings_company_id_instance_name_lid_jid_key" ON "whatsapp_jid_mappings"("company_id", "instance_name", "lid_jid");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "whatsapp_jid_mappings_company_id_phone_number_idx" ON "whatsapp_jid_mappings"("company_id", "phone_number");

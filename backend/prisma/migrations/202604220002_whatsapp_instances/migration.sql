CREATE TABLE IF NOT EXISTS "whatsapp_instances" (
  "id" SERIAL NOT NULL,
  "name" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "phone" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "whatsapp_instances_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_instances_name_key" ON "whatsapp_instances"("name");
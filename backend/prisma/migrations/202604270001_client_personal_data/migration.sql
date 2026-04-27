-- AlterTable: add personal_data column to client_memory
ALTER TABLE "client_memory" ADD COLUMN IF NOT EXISTS "personal_data" JSONB;

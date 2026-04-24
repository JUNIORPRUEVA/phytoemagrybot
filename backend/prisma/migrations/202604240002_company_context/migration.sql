CREATE TABLE "company_context" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "company_name" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL DEFAULT '',
    "whatsapp" TEXT NOT NULL DEFAULT '',
    "address" TEXT NOT NULL DEFAULT '',
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "google_maps_link" TEXT NOT NULL DEFAULT '',
    "working_hours_json" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "bank_accounts_json" JSONB NOT NULL DEFAULT '[]'::jsonb,
    "images_json" JSONB NOT NULL DEFAULT '[]'::jsonb,
    "usage_rules_json" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "company_context_pkey" PRIMARY KEY ("id")
);

INSERT INTO "company_context" (
    "id",
    "company_name",
    "description",
    "phone",
    "whatsapp",
    "address",
    "google_maps_link",
    "working_hours_json",
    "bank_accounts_json",
    "images_json",
    "usage_rules_json"
) VALUES (
    1,
    '',
    '',
    '',
    '',
    '',
    '',
    '{}'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb,
    '{}'::jsonb
)
ON CONFLICT ("id") DO NOTHING;
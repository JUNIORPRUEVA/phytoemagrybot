CREATE TABLE "bot_config" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "prompt_base" TEXT NOT NULL,
    "prompt_short" TEXT NOT NULL,
    "prompt_human" TEXT NOT NULL,
    "prompt_sales" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bot_config_pkey" PRIMARY KEY ("id")
);

INSERT INTO "bot_config" ("id", "prompt_base", "prompt_short", "prompt_human", "prompt_sales")
VALUES (
    1,
    'Eres un asistente de ventas por WhatsApp. Responde corto, claro y natural. No hables mucho. No expliques de mas. Habla como una persona real dominicana y enfocate en vender.',
    'Responde en maximo 2 lineas y menos de 15 palabras.',
    'Habla como humano. Usa expresiones naturales como: claro, perfecto, dale. No suenes robotico.',
    'Despues de responder, intenta cerrar la venta de forma natural. Ej: te lo envio?, lo quieres hoy?'
)
ON CONFLICT ("id") DO NOTHING;
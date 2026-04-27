-- CreateTable products
CREATE TABLE IF NOT EXISTS "products" (
    "id" SERIAL NOT NULL,
    "titulo" TEXT NOT NULL,
    "descripcion_corta" TEXT,
    "descripcion_completa" TEXT,
    "precio" DECIMAL(10,2),
    "precio_minimo" DECIMAL(10,2),
    "stock" INTEGER NOT NULL DEFAULT 0,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "imagenes_json" JSONB NOT NULL DEFAULT '[]',
    "videos_json" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "products_activo_idx" ON "products"("activo");

-- CreateTable orders
CREATE TABLE IF NOT EXISTS "orders" (
    "id" SERIAL NOT NULL,
    "contact_id" TEXT NOT NULL,
    "productos_json" JSONB NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'pendiente',
    "total" DECIMAL(10,2),
    "direccion" TEXT,
    "notas" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "orders_contact_id_idx" ON "orders"("contact_id");
CREATE INDEX IF NOT EXISTS "orders_estado_idx" ON "orders"("estado");

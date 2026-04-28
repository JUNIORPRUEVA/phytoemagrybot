import test from 'node:test';
import assert from 'node:assert/strict';
import { ProductsService } from '../src/products/products.service';

test('create stores normalized product variants', async () => {
  let createdData: Record<string, unknown> | undefined;
  const prisma = {
    product: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        createdData = data;
        return { id: 1, ...data };
      },
    },
  };
  const service = new ProductsService(prisma as never);

  await service.create({
    titulo: 'Pantalón',
    precio: 1800,
    stock: 20,
    variantesJson: [
      { nombre: ' Jean azul ', descripcion: ' Tela jean ', precio: 1900, stock: 4 },
      { nombre: '', precio: 1000 },
    ],
  });

  assert.deepEqual(createdData?.variantesJson, [
    {
      nombre: 'Jean azul',
      descripcion: 'Tela jean',
      precio: 1900,
      precioMinimo: null,
      stock: 4,
      activo: true,
    },
  ]);
});

test('buscarPorNombre matches active products by variant name', async () => {
  const prisma = {
    product: {
      findMany: async () => [
        {
          id: 1,
          titulo: 'Pantalón',
          descripcionCorta: '',
          descripcionCompleta: '',
          activo: true,
          variantesJson: [
            { nombre: 'Jean azul', descripcion: 'Talla 32', precio: 1900, stock: 4, activo: true },
          ],
        },
        {
          id: 2,
          titulo: 'Camisa',
          descripcionCorta: '',
          descripcionCompleta: '',
          activo: true,
          variantesJson: [],
        },
      ],
    },
  };
  const service = new ProductsService(prisma as never);

  const results = await service.buscarPorNombre('jean azul');

  assert.equal(results.length, 1);
  assert.equal(results[0].titulo, 'Pantalón');
});

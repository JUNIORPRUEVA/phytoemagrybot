import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProductDto, UpdateProductDto } from './dto/product.dto';

export interface ProductVariant {
  nombre: string;
  descripcion: string;
  precio: number | null;
  precioMinimo: number | null;
  stock: number | null;
  activo: boolean;
}

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    return this.prisma.product.findMany({ orderBy: { id: 'asc' } });
  }

  async findActive() {
    return this.prisma.product.findMany({
      where: { activo: true },
      orderBy: { id: 'asc' },
    });
  }

  async findOne(id: number) {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) throw new NotFoundException(`Product ${id} not found`);
    return product;
  }

  async create(dto: CreateProductDto) {
    return this.prisma.product.create({
      data: {
        titulo: dto.titulo,
        descripcionCorta: dto.descripcionCorta ?? null,
        descripcionCompleta: dto.descripcionCompleta ?? null,
        precio: dto.precio != null ? dto.precio : null,
        precioMinimo: dto.precioMinimo != null ? dto.precioMinimo : null,
        stock: dto.stock ?? 0,
        activo: dto.activo ?? true,
        variantesJson: this.normalizeVariants(dto.variantesJson) as unknown as Prisma.InputJsonValue,
        imagenesJson: dto.imagenesJson ?? [],
        videosJson: dto.videosJson ?? [],
      },
    });
  }

  async update(id: number, dto: UpdateProductDto) {
    await this.findOne(id);
    return this.prisma.product.update({
      where: { id },
      data: {
        ...(dto.titulo !== undefined && { titulo: dto.titulo }),
        ...(dto.descripcionCorta !== undefined && { descripcionCorta: dto.descripcionCorta }),
        ...(dto.descripcionCompleta !== undefined && { descripcionCompleta: dto.descripcionCompleta }),
        ...(dto.precio !== undefined && { precio: dto.precio }),
        ...(dto.precioMinimo !== undefined && { precioMinimo: dto.precioMinimo }),
        ...(dto.stock !== undefined && { stock: dto.stock }),
        ...(dto.activo !== undefined && { activo: dto.activo }),
        ...(dto.variantesJson !== undefined && {
          variantesJson: this.normalizeVariants(dto.variantesJson) as unknown as Prisma.InputJsonValue,
        }),
        ...(dto.imagenesJson !== undefined && { imagenesJson: dto.imagenesJson }),
        ...(dto.videosJson !== undefined && { videosJson: dto.videosJson }),
      },
    });
  }

  async remove(id: number) {
    await this.findOne(id);
    return this.prisma.product.delete({ where: { id } });
  }

  async consultarStock(productoId: number): Promise<{ id: number; titulo: string; stock: number; activo: boolean }> {
    const product = await this.prisma.product.findUnique({
      where: { id: productoId },
      select: { id: true, titulo: true, stock: true, activo: true },
    });
    if (!product) throw new NotFoundException(`Producto ${productoId} no encontrado`);
    return product;
  }

  async buscarPorNombre(nombre: string) {
    const normalized = this.normalizeText(nombre);
    const products = await this.prisma.product.findMany({
      where: { activo: true },
      orderBy: { id: 'asc' },
    });
    return products.filter((product) => {
      const haystack = [
        product.titulo,
        product.descripcionCorta ?? '',
        product.descripcionCompleta ?? '',
        ...this.getActiveVariants(product.variantesJson).flatMap((variant) => [
          variant.nombre,
          variant.descripcion,
        ]),
      ]
        .map((value) => this.normalizeText(value))
        .join(' ');
      return haystack.includes(normalized) || normalized.includes(this.normalizeText(product.titulo));
    });
  }

  async getCatalogText(): Promise<string> {
    const products = await this.findActive();
    if (products.length === 0) return 'No hay productos disponibles en el catálogo.';

    return products
      .map((p) => {
        const lines: string[] = [`📦 ${p.titulo}`];
        if (p.descripcionCorta) lines.push(`   ${p.descripcionCorta}`);
        if (p.precio != null) lines.push(`   Precio: RD$${p.precio}`);
        if (p.precioMinimo != null) lines.push(`   Precio mínimo: RD$${p.precioMinimo}`);
        const variants = this.getActiveVariants(p.variantesJson);
        if (variants.length > 0) {
          lines.push('   Variantes:');
          for (const v of variants) {
            const details: string[] = [v.nombre];
            if (v.precio != null) details.push(`RD$${v.precio}`);
            if (v.stock != null) details.push(v.stock > 0 ? `${v.stock} disponibles` : 'sin stock');
            if (v.descripcion) details.push(v.descripcion);
            lines.push(`   - ${details.join(' · ')}`);
          }
        }
        lines.push(`   Stock: ${p.stock > 0 ? `${p.stock} unidades disponibles` : 'Sin stock'}`);
        return lines.join('\n');
      })
      .join('\n\n');
  }

  getActiveVariants(raw: unknown): ProductVariant[] {
    return this.normalizeVariants(raw).filter((variant) => variant.activo !== false);
  }

  normalizeVariants(raw: unknown): ProductVariant[] {
    if (!Array.isArray(raw)) return [];
    const variants: ProductVariant[] = [];
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;
      const source = item as Record<string, unknown>;
      const nombre = String(source.nombre ?? '').trim();
      if (!nombre) continue;
      variants.push({
        nombre,
        descripcion: source.descripcion != null ? String(source.descripcion).trim() : '',
        precio: this.toNullableNumber(source.precio),
        precioMinimo: this.toNullableNumber(source.precioMinimo),
        stock: this.toNullableInteger(source.stock),
        activo: source.activo !== false,
      });
    }
    return variants;
  }

  private toNullableNumber(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(String(value).replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : null;
  }

  private toNullableInteger(value: unknown): number | null {
    const parsed = this.toNullableNumber(value);
    return parsed === null ? null : Math.max(0, Math.trunc(parsed));
  }

  private normalizeText(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }
}

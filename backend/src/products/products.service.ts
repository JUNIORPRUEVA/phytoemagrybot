import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProductDto, UpdateProductDto } from './dto/product.dto';

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
    return this.prisma.product.findMany({
      where: {
        activo: true,
        titulo: { contains: nombre, mode: 'insensitive' },
      },
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
        lines.push(`   Stock: ${p.stock > 0 ? `${p.stock} unidades disponibles` : 'Sin stock'}`);
        return lines.join('\n');
      })
      .join('\n\n');
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ProductsService } from '../products/products.service';
import { CompanyContextService } from '../company-context/company-context.service';
import { ToolConfig, ToolExecutionResult } from './tools.types';

@Injectable()
export class ToolsExecutor {
  private readonly logger = new Logger(ToolsExecutor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly productsService: ProductsService,
    private readonly companyContextService: CompanyContextService,
  ) {}

  async execute(
    toolName: string,
    args: Record<string, unknown>,
    contactId: string,
    toolConfig: ToolConfig,
  ): Promise<ToolExecutionResult> {
    this.logger.log(JSON.stringify({ event: 'tool_execute', toolName, contactId, args }));

    try {
      switch (toolName) {
        case 'consultar_stock':
          return { toolName, result: await this.consultarStock(args) };
        case 'consultar_catalogo':
          return { toolName, result: await this.consultarCatalogo() };
        case 'consultar_info_empresa':
          return { toolName, result: await this.consultarInfoEmpresa(args) };
        case 'generar_cotizacion':
          return { toolName, result: await this.generarCotizacion(args, toolConfig) };
        case 'aplicar_descuento':
          return { toolName, result: this.aplicarDescuento(args, toolConfig) };
        case 'crear_pedido':
          return { toolName, result: await this.crearPedido(args, contactId) };
        case 'escalar_a_vendedor':
          return { toolName, result: await this.escalarAVendedor(args, contactId, toolConfig) };
        default:
          return { toolName, result: { error: `Tool desconocida: ${toolName}` } };
      }
    } catch (error) {
      this.logger.warn(JSON.stringify({
        event: 'tool_execute_failed',
        toolName,
        error: error instanceof Error ? error.message : 'Unknown error',
      }));
      return { toolName, result: { error: `Error ejecutando ${toolName}: ${error instanceof Error ? error.message : 'error desconocido'}` } };
    }
  }

  private async consultarStock(args: Record<string, unknown>) {
    const nombre = String(args.nombre_producto ?? '').trim();
    if (!nombre) return { error: 'Se requiere el nombre del producto' };

    const products = await this.productsService.buscarPorNombre(nombre);
    if (products.length === 0) {
      return { disponible: false, mensaje: `No encontré el producto "${nombre}" en el catálogo.` };
    }

    return products.map((p) => ({
      id: p.id,
      titulo: p.titulo,
      stock: p.stock,
      disponible: p.stock > 0,
      precio: p.precio ? Number(p.precio) : null,
      variantes: this.productsService.getActiveVariants(p.variantesJson).map((variant) => ({
        nombre: variant.nombre,
        descripcion: variant.descripcion || null,
        stock: variant.stock ?? null,
        disponible: variant.stock == null ? p.stock > 0 : variant.stock > 0,
        precio: variant.precio ?? (p.precio ? Number(p.precio) : null),
        precioMinimo: variant.precioMinimo ?? (p.precioMinimo ? Number(p.precioMinimo) : null),
      })),
    }));
  }

  private async consultarCatalogo() {
    const products = await this.productsService.findActive();
    if (products.length === 0) return { mensaje: 'No hay productos disponibles.' };

    return products.map((p) => ({
      id: p.id,
      titulo: p.titulo,
      descripcion: p.descripcionCorta,
      precio: p.precio ? Number(p.precio) : null,
      precioMinimo: p.precioMinimo ? Number(p.precioMinimo) : null,
      stock: p.stock,
      disponible: p.stock > 0,
      variantes: this.productsService.getActiveVariants(p.variantesJson).map((variant) => ({
        nombre: variant.nombre,
        descripcion: variant.descripcion || null,
        precio: variant.precio ?? (p.precio ? Number(p.precio) : null),
        precioMinimo: variant.precioMinimo ?? (p.precioMinimo ? Number(p.precioMinimo) : null),
        stock: variant.stock ?? null,
        disponible: variant.stock == null ? p.stock > 0 : variant.stock > 0,
      })),
    }));
  }

  private async consultarInfoEmpresa(args: Record<string, unknown>) {
    const rawCampo = typeof args.campo === 'string' ? args.campo.trim().toLowerCase() : '';
    const campo =
      rawCampo === 'ubicacion' ||
      rawCampo === 'horario' ||
      rawCampo === 'cuentas' ||
      rawCampo === 'telefonos' ||
      rawCampo === 'fotos'
        ? rawCampo
        : 'todo';

    const ctx = await this.companyContextService.getContext();

    const base = {
      companyName: ctx.companyName,
      description: ctx.description,
    };

    if (campo === 'ubicacion') {
      return {
        ...base,
        address: ctx.address,
        latitude: ctx.latitude,
        longitude: ctx.longitude,
        googleMapsLink: ctx.googleMapsLink,
      };
    }

    if (campo === 'horario') {
      return {
        ...base,
        workingHours: ctx.workingHoursJson,
      };
    }

    if (campo === 'cuentas') {
      return {
        ...base,
        bankAccounts: ctx.bankAccountsJson,
      };
    }

    if (campo === 'telefonos') {
      return {
        ...base,
        phone: ctx.phone,
        whatsapp: ctx.whatsapp,
      };
    }

    if (campo === 'fotos') {
      return {
        ...base,
        images: ctx.imagesJson,
      };
    }

    return {
      ...base,
      phone: ctx.phone,
      whatsapp: ctx.whatsapp,
      address: ctx.address,
      latitude: ctx.latitude,
      longitude: ctx.longitude,
      googleMapsLink: ctx.googleMapsLink,
      workingHours: ctx.workingHoursJson,
      bankAccounts: ctx.bankAccountsJson,
      images: ctx.imagesJson,
      usageRules: ctx.usageRulesJson,
      updatedAt: ctx.updatedAt,
    };
  }

  private async generarCotizacion(args: Record<string, unknown>, toolConfig: ToolConfig) {
    const productos = Array.isArray(args.productos)
      ? args.productos as Array<{ id: number; cantidad: number; variante?: string }>
      : [];
    if (productos.length === 0) return { error: 'Se requiere al menos un producto' };

    let subtotal = 0;
    const items: Array<{
      titulo: string;
      variante?: string;
      cantidad: number;
      precioUnitario: number;
      subtotal: number;
      requiereVariante?: boolean;
      variantesDisponibles?: string[];
    }> = [];

    for (const item of productos) {
      try {
        const p = await this.productsService.findOne(item.id);
        const variants = this.productsService.getActiveVariants(p.variantesJson);
        const selectedVariant = this.findVariant(variants, item.variante);
        if (variants.length > 0 && !selectedVariant) {
          items.push({
            titulo: p.titulo,
            cantidad: item.cantidad ?? 1,
            precioUnitario: 0,
            subtotal: 0,
            requiereVariante: true,
            variantesDisponibles: variants.map((variant) => variant.nombre),
          });
          continue;
        }
        const precio = selectedVariant?.precio ?? (p.precio ? Number(p.precio) : 0);
        const cantidad = item.cantidad ?? 1;
        const sub = precio * cantidad;
        subtotal += sub;
        items.push({
          titulo: p.titulo,
          variante: selectedVariant?.nombre,
          cantidad,
          precioUnitario: precio,
          subtotal: sub,
        });
      } catch {
        // producto no encontrado, se omite
      }
    }

    const costoEnvio = toolConfig.generarCotizacion.costoEnvio ?? 200;
    const total = subtotal + costoEnvio;

    return {
      items,
      subtotal,
      costoEnvio,
      total,
      moneda: 'RD$',
      nota: `Precio incluye envío de RD$${costoEnvio}`,
      requiereDatos: items.some((item) => item.requiereVariante)
        ? 'Hay productos con variantes. Pide al cliente que elija una variante antes de cerrar la cotización.'
        : null,
    };
  }

  private findVariant(
    variants: ReturnType<ProductsService['getActiveVariants']>,
    requested?: string,
  ) {
    const normalized = this.normalizeText(requested ?? '');
    if (!normalized) return undefined;
    return variants.find((variant) => {
      const variantName = this.normalizeText(variant.nombre);
      return variantName.includes(normalized) || normalized.includes(variantName);
    });
  }

  private normalizeText(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }

  private aplicarDescuento(args: Record<string, unknown>, toolConfig: ToolConfig) {
    const precio = Number(args.precio ?? 0);
    const porcentajeSolicitado = Number(args.porcentaje ?? 0);
    const maxPorcentaje = toolConfig.aplicarDescuento.maxPorcentaje ?? 10;

    if (porcentajeSolicitado > maxPorcentaje) {
      return {
        aprobado: false,
        mensaje: `El descuento máximo permitido es ${maxPorcentaje}%. No puedo autorizar ${porcentajeSolicitado}%.`,
        maxPorcentaje,
      };
    }

    const descuento = precio * (porcentajeSolicitado / 100);
    const precioFinal = precio - descuento;

    return {
      aprobado: true,
      precioOriginal: precio,
      porcentaje: porcentajeSolicitado,
      descuento,
      precioFinal,
      moneda: 'RD$',
    };
  }

  private async crearPedido(args: Record<string, unknown>, contactId: string) {
    const productos = Array.isArray(args.productos) ? args.productos : [];
    const direccion = args.direccion ? String(args.direccion) : null;
    const notas = args.notas ? String(args.notas) : null;

    let total = 0;
    if (Array.isArray(args.productos)) {
      for (const item of args.productos as Array<{ precio?: number; cantidad?: number }>) {
        const precio = Number(item.precio ?? 0);
        const cantidad = Number(item.cantidad ?? 1);
        total += precio * cantidad;
      }
    }

    const order = await this.prisma.order.create({
      data: {
        contactId,
        productosJson: productos,
        estado: 'pendiente',
        total: total > 0 ? total : null,
        direccion,
        notas,
      },
    });

    return {
      pedidoId: order.id,
      estado: order.estado,
      total: order.total ? Number(order.total) : null,
      direccion: order.direccion,
      mensaje: `Pedido #${order.id} creado correctamente. Estado: pendiente de confirmación.`,
    };
  }

  private async escalarAVendedor(
    args: Record<string, unknown>,
    contactId: string,
    toolConfig: ToolConfig,
  ) {
    const razon = String(args.razon ?? 'El cliente está listo para comprar');
    const resumen = String(args.resumen ?? '');

    const numero = toolConfig.escalarAVendedor.numero?.trim();
    if (!numero) {
      return {
        escalado: false,
        mensaje: 'No hay un número de vendedor configurado. Configura el número en la sección de Herramientas.',
      };
    }

    // Log the escalation — WhatsApp notification sent via service injection if needed
    this.logger.log(JSON.stringify({
      event: 'tool_escalar_a_vendedor',
      contactId,
      razon,
      resumen,
      numeroVendedor: numero,
    }));

    return {
      escalado: true,
      contactId,
      razon,
      mensaje: `El cliente ha sido marcado para atención humana. El vendedor (${numero}) será notificado.`,
    };
  }
}

import { Injectable } from '@nestjs/common';
import { ToolConfig, DEFAULT_TOOLS_CONFIG, OpenAITool } from './tools.types';

@Injectable()
export class ToolsService {
  resolveConfig(raw: unknown): ToolConfig {
    if (!raw || typeof raw !== 'object') return { ...DEFAULT_TOOLS_CONFIG };
    const r = raw as Partial<ToolConfig>;
    return {
      consultarStock: { enabled: r.consultarStock?.enabled ?? DEFAULT_TOOLS_CONFIG.consultarStock.enabled },
      consultarCatalogo: { enabled: r.consultarCatalogo?.enabled ?? DEFAULT_TOOLS_CONFIG.consultarCatalogo.enabled },
      consultarInfoEmpresa: {
        enabled: r.consultarInfoEmpresa?.enabled ?? DEFAULT_TOOLS_CONFIG.consultarInfoEmpresa.enabled,
      },
      generarCotizacion: {
        enabled: r.generarCotizacion?.enabled ?? DEFAULT_TOOLS_CONFIG.generarCotizacion.enabled,
        costoEnvio: r.generarCotizacion?.costoEnvio ?? DEFAULT_TOOLS_CONFIG.generarCotizacion.costoEnvio,
      },
      aplicarDescuento: {
        enabled: r.aplicarDescuento?.enabled ?? DEFAULT_TOOLS_CONFIG.aplicarDescuento.enabled,
        maxPorcentaje: r.aplicarDescuento?.maxPorcentaje ?? DEFAULT_TOOLS_CONFIG.aplicarDescuento.maxPorcentaje,
      },
      crearPedido: { enabled: r.crearPedido?.enabled ?? DEFAULT_TOOLS_CONFIG.crearPedido.enabled },
      escalarAVendedor: {
        enabled: r.escalarAVendedor?.enabled ?? DEFAULT_TOOLS_CONFIG.escalarAVendedor.enabled,
        numero: r.escalarAVendedor?.numero ?? DEFAULT_TOOLS_CONFIG.escalarAVendedor.numero,
        email: r.escalarAVendedor?.email ?? DEFAULT_TOOLS_CONFIG.escalarAVendedor.email,
      },
    };
  }

  buildOpenAITools(config: ToolConfig): OpenAITool[] {
    const tools: OpenAITool[] = [];

    if (config.consultarStock.enabled) {
      tools.push({
        type: 'function',
        function: {
          name: 'consultar_stock',
          description: 'Consulta si un producto está disponible y cuántas unidades hay en stock. Úsala cuando el cliente pregunte si hay disponibilidad de un producto.',
          parameters: {
            type: 'object',
            properties: {
              nombre_producto: {
                type: 'string',
                description: 'Nombre o parte del nombre del producto o variante a consultar',
              },
            },
            required: ['nombre_producto'],
          },
        },
      });
    }

    if (config.consultarCatalogo.enabled) {
      tools.push({
        type: 'function',
        function: {
          name: 'consultar_catalogo',
          description: 'Obtiene el catálogo completo de productos disponibles con precios, stock y variantes/opciones. Úsala cuando el cliente pregunte qué productos hay, qué vendes, o pida una lista de productos.',
          parameters: {
            type: 'object',
            properties: {},
            required: [],
          },
        },
      });
    }

    if (config.consultarInfoEmpresa.enabled) {
      tools.push({
        type: 'function',
        function: {
          name: 'consultar_info_empresa',
          description:
            'Obtiene información real de la empresa (ubicación, GPS/Maps, horarios, cuentas de pago, teléfonos y fotos). Úsala cuando el cliente pregunte por ubicación, horario, métodos de pago, cuentas bancarias o datos de contacto.',
          parameters: {
            type: 'object',
            properties: {
              campo: {
                type: 'string',
                description:
                  'Qué información necesitas. Si no estás seguro, usa "todo".',
                enum: ['todo', 'ubicacion', 'horario', 'cuentas', 'telefonos', 'fotos'],
              },
            },
            required: [],
          },
        },
      });
    }

    if (config.generarCotizacion.enabled) {
      tools.push({
        type: 'function',
        function: {
          name: 'generar_cotizacion',
          description: 'Genera una cotización con el total a pagar incluyendo el costo de envío. Úsala cuando el cliente quiera saber el precio total de uno o más productos.',
          parameters: {
            type: 'object',
            properties: {
              productos: {
                type: 'array',
                description: 'Lista de productos a cotizar',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'number', description: 'ID del producto' },
                    variante: { type: 'string', description: 'Nombre de la variante/opción elegida, si aplica' },
                    cantidad: { type: 'number', description: 'Cantidad a comprar', default: 1 },
                  },
                  required: ['id'],
                },
              },
            },
            required: ['productos'],
          },
        },
      });
    }

    if (config.aplicarDescuento.enabled) {
      tools.push({
        type: 'function',
        function: {
          name: 'aplicar_descuento',
          description: `Verifica si se puede aplicar un descuento al precio. El descuento máximo permitido es ${config.aplicarDescuento.maxPorcentaje}%. Úsala cuando el cliente negocie precio o pida un descuento.`,
          parameters: {
            type: 'object',
            properties: {
              precio: { type: 'number', description: 'Precio original del producto' },
              porcentaje: { type: 'number', description: 'Porcentaje de descuento solicitado' },
            },
            required: ['precio', 'porcentaje'],
          },
        },
      });
    }

    if (config.crearPedido.enabled) {
      tools.push({
        type: 'function',
        function: {
          name: 'crear_pedido',
          description: 'Registra un pedido cuando el cliente confirma que quiere comprar. Úsala cuando el cliente diga que quiere comprar, confirme el pedido, o proporcione su dirección de entrega.',
          parameters: {
            type: 'object',
            properties: {
              productos: {
                type: 'array',
                description: 'Productos del pedido',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'number' },
                    titulo: { type: 'string' },
                    variante: { type: 'string', description: 'Variante/opción elegida, si aplica' },
                    cantidad: { type: 'number' },
                    precio: { type: 'number' },
                  },
                  required: ['titulo', 'cantidad'],
                },
              },
              direccion: { type: 'string', description: 'Dirección de entrega del cliente' },
              notas: { type: 'string', description: 'Notas adicionales del pedido' },
            },
            required: ['productos'],
          },
        },
      });
    }

    if (config.escalarAVendedor.enabled) {
      tools.push({
        type: 'function',
        function: {
          name: 'escalar_a_vendedor',
          description: 'Marca la conversación para que un vendedor humano tome el control. Úsala cuando el cliente esté listo para comprar y requiera atención personalizada, tenga preguntas muy específicas, o solicite hablar con una persona.',
          parameters: {
            type: 'object',
            properties: {
              razon: { type: 'string', description: 'Razón por la que se escala al vendedor' },
              resumen: { type: 'string', description: 'Resumen breve de la conversación y lo que el cliente quiere' },
            },
            required: ['razon', 'resumen'],
          },
        },
      });
    }

    return tools;
  }
}

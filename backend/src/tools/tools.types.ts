import OpenAI from 'openai';

export interface ToolConfig {
  consultarStock: { enabled: boolean };
  consultarCatalogo: { enabled: boolean };
  consultarInfoEmpresa: { enabled: boolean };
  generarCotizacion: { enabled: boolean; costoEnvio: number };
  aplicarDescuento: { enabled: boolean; maxPorcentaje: number };
  crearPedido: { enabled: boolean };
  escalarAVendedor: { enabled: boolean; numero: string; email: string };
}

export const DEFAULT_TOOLS_CONFIG: ToolConfig = {
  consultarStock: { enabled: true },
  consultarCatalogo: { enabled: true },
  consultarInfoEmpresa: { enabled: true },
  generarCotizacion: { enabled: true, costoEnvio: 200 },
  aplicarDescuento: { enabled: false, maxPorcentaje: 10 },
  crearPedido: { enabled: true },
  escalarAVendedor: { enabled: false, numero: '', email: '' },
};

export type OpenAITool = OpenAI.ChatCompletionTool;

export interface ToolExecutionResult {
  toolName: string;
  result: unknown;
}

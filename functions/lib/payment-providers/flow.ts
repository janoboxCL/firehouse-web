// Adapta el cliente de Flow ya existente (functions/lib/flow.ts) a la
// interfaz PaymentProvider común. No reimplementa nada de Flow — sólo lo
// presenta con la misma forma que cualquier otra pasarela.

import { crearPagoFlow, obtenerEstadoPagoFlow, type FlowCredenciales } from '../flow.ts';
import type {
  PaymentProvider,
  CrearPreferenciaInput,
  CrearPreferenciaResultado,
  VerificacionNotificacion,
  EstadoPagoConsultado,
  EstadoPagoNormalizado,
} from './types.ts';

function normalizarEstadoFlow(status: number): EstadoPagoNormalizado {
  if (status === 2) return 'APROBADO';
  if (status === 1) return 'PENDIENTE';
  return 'RECHAZADO'; // 3 (rechazada) y 4 (anulada) — ver nota en flow.ts sobre confirmar significado exacto
}

export class FlowProvider implements PaymentProvider {
  readonly id = 'FLOW' as const;

  constructor(private readonly creds: FlowCredenciales) {}

  async crearPreferencia(input: CrearPreferenciaInput): Promise<CrearPreferenciaResultado> {
    // Flow no soporta ítems ni 3 URLs de retorno distintas — un solo asunto y
    // una sola urlReturn (por diseño, las tres URLs del checkout apuntan al
    // mismo lugar: la página de descarga, que siempre vuelve a preguntarle
    // al backend el estado real en vez de confiar en el retorno).
    const asunto =
      input.items.length === 1
        ? input.items[0].nombre
        : `Campaña Firehouse 2026 - ${input.items.length} sobres`;

    const pago = await crearPagoFlow(this.creds, {
      commerceOrder: input.commerceOrder,
      subject: asunto,
      amount: input.items.reduce((acc, i) => acc + i.precio, 0),
      email: input.email,
      urlConfirmation: input.urlWebhook,
      urlReturn: input.urlExito,
    });

    return { urlPago: `${pago.url}?token=${pago.token}`, referenciaExterna: pago.token };
  }

  async verificarNotificacion(request: Request): Promise<VerificacionNotificacion> {
    // Flow no firma la notificación — el mecanismo de seguridad es volver a
    // consultar el pago con el token directo a la API de Flow (obligatorio,
    // no opcional), lo que hace obtenerEstadoPago() más abajo.
    const form = await request.formData().catch(() => null);
    const token = form?.get('token');
    if (!token || typeof token !== 'string') {
      return { valida: false, motivoRechazo: 'falta_token' };
    }
    return { valida: true, referenciaPago: token };
  }

  async obtenerEstadoPago(referenciaPago: string): Promise<EstadoPagoConsultado> {
    const estado = await obtenerEstadoPagoFlow(this.creds, referenciaPago);
    return {
      estado: normalizarEstadoFlow(estado.status),
      commerceOrder: estado.commerceOrder,
      pasarelaPaymentId: String(estado.flowOrder),
      monto: estado.amount,
      moneda: estado.currency,
      metodoPago: estado.paymentData?.media ?? null,
      datosCrudos: estado as unknown as Record<string, unknown>,
    };
  }
}

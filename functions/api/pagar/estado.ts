// GET /api/pagar/estado?t=TOKEN
// Cuenta de una familia para la página /pagar: solo nombres de pila, conceptos
// pendientes con su saldo e historial de pagos aprobados. Nunca RUT ni contacto.

import { createClient } from '@supabase/supabase-js';
import { jsonResponse } from '../../lib/admin-auth.ts';
import { apoderadoPorToken, estadoCuenta, primerNombre } from '../../lib/cuenta-servidor.ts';
import { cargosPagables, tokenValido } from '../../../src/lib/crm/cuenta.ts';
import { hoyChile } from '../../../src/lib/crm/programas.ts';

interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const token = new URL(request.url).searchParams.get('t');
  if (!tokenValido(token)) return jsonResponse(404, { error: 'link_invalido' });
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const apoderadoId = await apoderadoPorToken(supabase, token);
  if (!apoderadoId) return jsonResponse(404, { error: 'link_invalido' });

  const cuenta = await estadoCuenta(supabase, apoderadoId);
  await supabase.from('links_pago').update({ ultimo_uso_at: new Date().toISOString() }).eq('apoderado_id', apoderadoId);

  const pagables = cargosPagables(cuenta.cargos, hoyChile());
  const descripcionCargo = new Map(cuenta.cargos.map((c) => [c.id, { descripcion: c.descripcion, deportista: c.atleta_nombre }]));

  return jsonResponse(200, {
    familia: primerNombre(cuenta.apoderado?.nombre),
    pendientes: pagables.map((c) => ({
      id: c.id,
      deportista: cuenta.atletas.find((a) => a.id === c.atleta_id)?.nombre ?? null,
      concepto: c.concepto_codigo,
      descripcion: c.descripcion,
      saldo: c.saldo,
      vencimiento: c.vencimiento,
      sugerido: c.sugerido,
      obligatorio: c.obligatorio,
    })),
    historial: cuenta.pagos
      .filter((p) => p.estado === 'APROBADO')
      .map((p) => ({
        numero: p.commerce_order,
        fecha: p.aprobado_at ?? p.created_at,
        total: p.monto_total,
        medio: p.medio,
        lineas: p.detalle.map((d) => ({ ...descripcionCargo.get(d.cargo_id), monto: d.monto })),
      })),
  });
};

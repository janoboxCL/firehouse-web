// GET /api/tienda/pedido?pedido=TIENDA-...
// Estado de un pedido para la página de retorno: estado, total y tallas. Sin datos de contacto.

import { createClient } from '@supabase/supabase-js';
import { jsonResponse } from '../../lib/admin-auth.ts';
import { commerceOrderTiendaValido } from '../../../src/lib/crm/tienda.ts';

interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const co = new URL(request.url).searchParams.get('pedido');
  if (!commerceOrderTiendaValido(co)) return jsonResponse(404, { error: 'pedido_no_encontrado' });
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { data } = await supabase
    .from('tienda_pedidos')
    .select('estado, monto_total, tienda_pedido_items ( talla, cantidad )')
    .eq('commerce_order', co)
    .maybeSingle();
  if (!data) return jsonResponse(404, { error: 'pedido_no_encontrado' });
  return jsonResponse(200, { estado: data.estado, total: data.monto_total, items: data.tienda_pedido_items ?? [] });
};

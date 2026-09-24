// GET /api/pagar/resultado?pago=PAGO-...
// Estado de un pago para la página de retorno. Solo estado y total: sin datos personales.

import { createClient } from '@supabase/supabase-js';
import { jsonResponse } from '../../lib/admin-auth.ts';

interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const pago = new URL(request.url).searchParams.get('pago') ?? '';
  if (!/^PAGO-[0-9A-Z]+-[0-9A-F]{8}$/.test(pago)) return jsonResponse(404, { error: 'pago_no_encontrado' });
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { data } = await supabase.from('pagos').select('estado, monto_total').eq('commerce_order', pago).maybeSingle();
  if (!data) return jsonResponse(404, { error: 'pago_no_encontrado' });
  return jsonResponse(200, { estado: data.estado, total: data.monto_total });
};

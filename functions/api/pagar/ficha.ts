// POST /api/pagar/ficha  { t: TOKEN, apoderado: {...}, atletas: [...], aceptaCondiciones: true }
// La familia confirma o completa sus datos antes de pagar. El token del link
// identifica a la familia: solo se pueden modificar sus propios deportistas.

import { createClient } from '@supabase/supabase-js';
import { jsonResponse } from '../../lib/admin-auth.ts';
import { apoderadoPorToken } from '../../lib/cuenta-servidor.ts';
import { tokenValido } from '../../../src/lib/crm/cuenta.ts';
import { validarFicha } from '../../../src/lib/crm/ficha.ts';
import { hoyChile } from '../../../src/lib/crm/programas.ts';

interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let cuerpo: Record<string, unknown>;
  try {
    cuerpo = (await request.json()) as Record<string, unknown>;
  } catch {
    return jsonResponse(400, { error: 'json_invalido' });
  }
  if (!tokenValido(cuerpo.t)) return jsonResponse(404, { error: 'link_invalido' });

  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const apoderadoId = await apoderadoPorToken(supabase, cuerpo.t);
  if (!apoderadoId) return jsonResponse(404, { error: 'link_invalido' });

  const { data: atletas, error: errAtletas } = await supabase.from('atletas').select('id').eq('apoderado_id', apoderadoId);
  if (errAtletas) return jsonResponse(500, { error: 'no_disponible', mensaje: 'No pudimos guardar tus datos. Inténtalo nuevamente.' });

  const validacion = validarFicha(cuerpo, (atletas ?? []).map((a) => a.id as string), hoyChile());
  if (!validacion.ok) return jsonResponse(400, { error: 'datos_invalidos', errores: validacion.errores });

  const { error } = await supabase.rpc('fn_confirmar_ficha_familia', { p_apoderado_id: apoderadoId, payload: validacion.datos });
  if (error) {
    console.error('fn_confirmar_ficha_familia_error', error.message);
    return jsonResponse(500, { error: 'no_se_pudo_guardar', mensaje: 'No pudimos guardar tus datos. Inténtalo nuevamente.' });
  }
  return jsonResponse(200, { ok: true });
};

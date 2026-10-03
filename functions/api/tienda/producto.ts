// GET /api/tienda/producto
// Datos públicos de la polera: nombre, precio, tallas y si está a la venta.

import { createClient } from '@supabase/supabase-js';
import { jsonResponse } from '../../lib/admin-auth.ts';
import { PRODUCTO_POLERA } from '../../../src/lib/crm/tienda.ts';

interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
}

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return jsonResponse(500, { error: 'faltan_variables_de_entorno' });
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { data, error } = await supabase
    .from('tienda_productos')
    .select('nombre, descripcion, precio, tallas, activo')
    .eq('codigo', PRODUCTO_POLERA)
    .maybeSingle();
  // Sin la migración 0018 (o sin producto) la tienda simplemente aparece cerrada.
  if (error || !data || !data.activo || !(data.precio > 0)) return jsonResponse(200, { activo: false });
  return jsonResponse(200, { activo: true, nombre: data.nombre, descripcion: data.descripcion, precio: data.precio, tallas: data.tallas });
};

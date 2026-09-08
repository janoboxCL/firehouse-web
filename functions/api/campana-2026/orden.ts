/// <reference types="@cloudflare/workers-types" />
// GET /api/campana-2026/orden?orden=<uuid>
//
// Endpoint de solo lectura para la página de descarga. El UUID de la orden
// funciona como el "secreto" de acceso: sólo lo recibe el comprador, por
// correo, y es imposible de adivinar (a diferencia del código de
// participación FH-0001, FH-0002..., que es secuencial y está pensado para
// mostrarse públicamente en el sorteo — por eso NO se usa como llave de
// descarga).
//
// Los archivos en sí viven en rutas estáticas no listadas bajo /entregas/ —
// este endpoint sólo decide SI corresponde mostrarlas, arma sus URLs y
// entrega los códigos de participación de esa orden.

import { createClient } from '@supabase/supabase-js';

interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

// Slug no adivinable, generado una vez para esta campaña. Si algún día hay
// que invalidar los links viejos (ej. filtración), basta con generar un slug
// nuevo, subir los zips a la carpeta nueva y actualizar esta constante.
const SLUG_ENTREGA = 'eed19683ec';

const ARCHIVO_POR_PRODUCTO: Record<string, string> = {
  BLAZE: 'blaze.zip',
  NOVA: 'nova.zip',
  BLAZE_NOVA: 'blaze-nova.zip',
};

const NOMBRE_POR_PRODUCTO: Record<string, string> = {
  BLAZE: 'Sobre Blaze',
  NOVA: 'Sobre Nova',
  BLAZE_NOVA: 'Pack Blaze + Nova',
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const onRequestGet: PagesFunction<Env> = async (context) => {
  try {
    if (!context.env.SUPABASE_URL || !context.env.SUPABASE_SERVICE_ROLE_KEY) {
      return jsonResponse(500, { error: 'faltan_variables_de_entorno' });
    }

    const ordenId = new URL(context.request.url).searchParams.get('orden')?.trim() ?? '';
    if (!UUID_RE.test(ordenId)) {
      return jsonResponse(400, { error: 'orden_invalida' });
    }

    const supabase = createClient(context.env.SUPABASE_URL, context.env.SUPABASE_SERVICE_ROLE_KEY);

    const { data: orden, error } = await supabase
      .from('campana_ordenes')
      .select('id, estado, comprador_nombre, campana_orden_items ( id, producto )')
      .eq('id', ordenId)
      .maybeSingle();

    if (error) return jsonResponse(500, { error: 'no_se_pudo_consultar', detalle: error.message });
    if (!orden) return jsonResponse(404, { error: 'orden_no_encontrada' });

    if (orden.estado !== 'PAGADA') {
      // 202: la orden existe pero el pago todavía no se confirma (puede estar
      // en camino si el webhook de Flow no ha llegado todavía) o no se pudo
      // completar. El frontend decide qué mostrar según el estado.
      return jsonResponse(202, { estado: orden.estado });
    }

    const items = (orden as unknown as { campana_orden_items: { id: string; producto: string }[] }).campana_orden_items ?? [];

    const { data: entradas, error: errEntradas } = await supabase
      .from('campana_entradas')
      .select('codigo, orden_item_id')
      .in(
        'orden_item_id',
        items.map((i) => i.id),
      );
    if (errEntradas) return jsonResponse(500, { error: 'no_se_pudo_consultar_entradas', detalle: errEntradas.message });

    const productos = items.map((i) => ({
      producto: i.producto,
      nombre: NOMBRE_POR_PRODUCTO[i.producto] ?? i.producto,
      urlDescarga: `/entregas/${SLUG_ENTREGA}/${ARCHIVO_POR_PRODUCTO[i.producto] ?? ''}`,
    }));

    return jsonResponse(200, {
      estado: 'PAGADA',
      compradorNombre: orden.comprador_nombre,
      productos,
      codigos: (entradas ?? []).map((e) => e.codigo),
    });
  } catch (e) {
    return jsonResponse(500, { error: 'error_inesperado', detalle: e instanceof Error ? `${e.name}: ${e.message}` : String(e) });
  }
};

// GET /api/config/publica
// Datos públicos que el sitio muestra y que se editan en el CRM: precios y
// horario de Firehouse Star y horarios de clase de prueba. Sin datos personales.
// Las páginas tienen el texto de respaldo escrito; esto solo lo actualiza.

import { createClient } from '@supabase/supabase-js';
import { leerConfigAcademia, leerHorariosClasePrueba, leerPreciosStar } from '../../lib/config-servidor.ts';
import { montosProrrateo } from '../../../src/lib/crm/config-academia.ts';
import { getNextStarClassDate } from '../../../src/lib/crm/star-class.ts';

interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
}

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const encabezados = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=60' };
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return new Response('{}', { status: 200, headers: encabezados });

  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const config = await leerConfigAcademia(supabase);
  const proximaClase = getNextStarClassDate(new Date(), config.starPrimeraClase);
  const [precios, horarios] = await Promise.all([
    leerPreciosStar(supabase, Number(proximaClase.slice(0, 4))),
    leerHorariosClasePrueba(supabase),
  ]);

  return new Response(
    JSON.stringify({
      star: {
        matricula: precios.matricula,
        mensualidad: precios.mensualidad,
        prorrateo: montosProrrateo(precios.mensualidad, config.prorrateo),
        horaInicio: config.starHoraInicio,
        horaFin: config.starHoraFin,
        primeraClase: config.starPrimeraClase,
        proximaClase,
      },
      clasePrueba: horarios
        .filter((h) => h.habilitado)
        .map((h) => ({ dia: h.dia, disciplina: h.disciplina, horaInicio: h.horaInicio, horaFin: h.horaFin })),
    }),
    { status: 200, headers: encabezados },
  );
};
